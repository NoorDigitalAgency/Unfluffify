import {
  installPageWorldProgram,
  type PageWorldCapabilityInvocation,
  type PageWorldCommandResult,
  type PageWorldRequest,
} from "../page-world/program";
import { getBrowserRuntimeLastError } from "../common/browser";

export type PageWorldDocumentIdentity = Readonly<{
  tabId: number;
  documentId: string;
  pageUrl: string;
  generation: number;
}>;

export type PageWorldCapabilityOutcome =
  | Readonly<{ status: "ok"; result: PageWorldCommandResult }>
  | Readonly<{ status: "stale" | "unavailable"; reason: string }>;

type InjectionResult<T> = Readonly<{
  frameId?: number;
  documentId?: string;
  result?: T;
}>;

type ExecuteScript = <T>(
  injection: Readonly<{
    target: Readonly<{ tabId: number; documentIds: string[] }>;
    world: "MAIN";
    func: (...args: never[]) => T | Promise<T>;
    args: unknown[];
  }>,
  callback?: (results: readonly InjectionResult<T>[]) => void,
) => Promise<readonly InjectionResult<T>[]> | void;

type SessionStorage = Readonly<{
  get(key: string): Promise<Record<string, unknown>> | Record<string, unknown>;
  set(values: Record<string, unknown>): Promise<void> | void;
  remove(key: string): Promise<void> | void;
}>;

type StoredLease = Readonly<{
  version: 1;
  identity: PageWorldDocumentIdentity;
  endpointKey: string;
  capability: string;
}>;

const STORAGE_PREFIX = "uf:page-world-capability:";

function storageKey(tabId: number): string {
  return `${STORAGE_PREFIX}${tabId}`;
}

function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

function sameIdentity(left: PageWorldDocumentIdentity, right: PageWorldDocumentIdentity): boolean {
  return left.tabId === right.tabId &&
    left.documentId === right.documentId &&
    left.pageUrl === right.pageUrl &&
    left.generation === right.generation;
}

function parseStoredLease(value: unknown): StoredLease | null {
  if (!value || typeof value !== "object") return null;
  const lease = value as Partial<StoredLease>;
  const identity = lease.identity as Partial<PageWorldDocumentIdentity> | undefined;
  if (
    lease.version !== 1 ||
    !identity ||
    typeof identity.tabId !== "number" ||
    typeof identity.documentId !== "string" || !identity.documentId ||
    typeof identity.pageUrl !== "string" || !identity.pageUrl ||
    typeof identity.generation !== "number" || !Number.isInteger(identity.generation) ||
    typeof lease.endpointKey !== "string" || !/^__uf_[a-f\d]{32,128}$/i.test(lease.endpointKey) ||
    typeof lease.capability !== "string" || !/^[a-f\d]{64}$/i.test(lease.capability)
  ) {
    return null;
  }
  return {
    version: 1,
    identity: {
      tabId: identity.tabId,
      documentId: identity.documentId,
      pageUrl: identity.pageUrl,
      generation: identity.generation,
    },
    endpointKey: lease.endpointKey,
    capability: lease.capability,
  };
}

/** Serialized into the exact MAIN document by chrome.scripting. Keep this
 * function self-contained: Chrome reconstructs it without module bindings. */
export async function invokePageWorldCapability(
  endpointKey: string,
  capability: string,
  invocation: PageWorldCapabilityInvocation,
): Promise<PageWorldCommandResult> {
  const dispatcher = (globalThis as unknown as Record<string, unknown>)[endpointKey];
  if (typeof dispatcher !== "function") {
    return {
      ok: false,
      nonce: invocation.request?.nonce ?? "",
      command: invocation.request?.command ?? "",
      payload: null,
      failure: {
        code: "PAGE_RUNTIME_UNAVAILABLE",
        message: "Page-world runtime is unavailable",
      },
    };
  }
  return await (dispatcher as (
    providedCapability: string,
    request: PageWorldCapabilityInvocation,
  ) => Promise<PageWorldCommandResult>)(capability, invocation);
}

export function createPageWorldCapabilityRuntime(input: Readonly<{
  executeScript?: ExecuteScript;
  storage?: SessionStorage;
  authorize(identity: PageWorldDocumentIdentity): Promise<boolean>;
  randomHex?: (bytes: number) => string;
}>) {
  const leases = new Map<number, StoredLease>();
  const operations = new Map<number, Promise<unknown>>();
  const makeRandomHex = input.randomHex ?? randomHex;

  const withTabOperation = <T>(tabId: number, operation: () => Promise<T>): Promise<T> => {
    const previous = operations.get(tabId) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    const tail = next.then(() => undefined, () => undefined);
    operations.set(tabId, tail);
    void tail.finally(() => {
      if (operations.get(tabId) === tail) operations.delete(tabId);
    });
    return next;
  };

  const execute = async <T>(
    identity: PageWorldDocumentIdentity,
    func: (...args: never[]) => T | Promise<T>,
    args: unknown[],
  ): Promise<T | null> => {
    if (!input.executeScript) return null;
    const results = await new Promise<readonly InjectionResult<T>[]>((resolve, reject) => {
      let settled = false;
      const finish = (operation: () => void): void => {
        if (settled) return;
        settled = true;
        operation();
      };
      try {
        const maybePromise = input.executeScript!({
          target: { tabId: identity.tabId, documentIds: [identity.documentId] },
          world: "MAIN",
          func,
          args,
        }, (value) => {
          const lastError = getBrowserRuntimeLastError();
          finish(() => lastError
            ? reject(new Error(lastError.message || "MAIN document execution failed"))
            : resolve(value));
        });
        if (maybePromise && typeof maybePromise.then === "function") {
          void maybePromise.then(
            (value) => finish(() => resolve(value)),
            (error) => finish(() => reject(error)),
          );
        }
      } catch (error) {
        finish(() => reject(error));
      }
    });
    const exact = results.find((result) =>
      (result.frameId === undefined || result.frameId === 0) &&
      (result.documentId === undefined || result.documentId === identity.documentId));
    return exact?.result ?? null;
  };

  const load = async (tabId: number): Promise<StoredLease | null> => {
    const memory = leases.get(tabId);
    if (memory) return memory;
    if (!input.storage) return null;
    const key = storageKey(tabId);
    try {
      const stored = await Promise.resolve(input.storage.get(key));
      const lease = parseStoredLease(stored[key]);
      if (lease) leases.set(tabId, lease);
      return lease;
    } catch {
      return null;
    }
  };

  const persist = async (lease: StoredLease): Promise<void> => {
    leases.set(lease.identity.tabId, lease);
    await Promise.resolve(input.storage?.set({ [storageKey(lease.identity.tabId)]: lease }))
      .catch(() => undefined);
  };

  const forget = async (tabId: number): Promise<void> => {
    leases.delete(tabId);
    await Promise.resolve(input.storage?.remove(storageKey(tabId))).catch(() => undefined);
  };

  const invoke = async (
    lease: StoredLease,
    invocation: PageWorldCapabilityInvocation,
  ): Promise<PageWorldCommandResult | null> => await execute(
    lease.identity,
    invokePageWorldCapability,
    [lease.endpointKey, lease.capability, invocation],
  );

  const retireLease = async (lease: StoredLease): Promise<void> => {
    await invoke(lease, { kind: "retire" }).catch(() => null);
    await forget(lease.identity.tabId);
  };

  const acquireUnlocked = async (
    identity: PageWorldDocumentIdentity,
  ): Promise<PageWorldCapabilityOutcome> => {
    if (!await input.authorize(identity)) {
      return { status: "stale", reason: "document-authority-changed" };
    }
    const existing = await load(identity.tabId);
    if (existing && sameIdentity(existing.identity, identity)) {
      const proof = await invoke(existing, { kind: "probe" }).catch(() => null);
      if (proof?.ok && proof.payload?.ready === true && await input.authorize(identity)) {
        return { status: "ok", result: proof };
      }
      await retireLease(existing);
    } else if (existing) {
      await retireLease(existing);
    }
    if (!await input.authorize(identity)) {
      return { status: "stale", reason: "document-authority-changed" };
    }
    const lease: StoredLease = {
      version: 1,
      identity,
      endpointKey: `__uf_${makeRandomHex(16)}`,
      capability: makeRandomHex(32),
    };
    const installed = await execute(
      identity,
      installPageWorldProgram,
      [lease.endpointKey, lease.capability],
    ).catch(() => null);
    if (!installed?.ok || installed.payload?.ready !== true) {
      return {
        status: "unavailable",
        reason: installed?.failure?.code ?? "page-world-install-failed",
      };
    }
    if (!await input.authorize(identity)) {
      await retireLease(lease);
      return { status: "stale", reason: "document-authority-changed" };
    }
    await persist(lease);
    return { status: "ok", result: installed };
  };

  return {
    acquire(identity: PageWorldDocumentIdentity): Promise<PageWorldCapabilityOutcome> {
      return withTabOperation(identity.tabId, () => acquireUnlocked(identity));
    },
    command(
      identity: PageWorldDocumentIdentity,
      request: PageWorldRequest,
    ): Promise<PageWorldCapabilityOutcome> {
      return withTabOperation(identity.tabId, async () => {
        const acquired = await acquireUnlocked(identity);
        if (acquired.status !== "ok") return acquired;
        const lease = await load(identity.tabId);
        if (!lease || !sameIdentity(lease.identity, identity) || !await input.authorize(identity)) {
          return { status: "stale" as const, reason: "document-authority-changed" };
        }
        const result = await invoke(lease, { kind: "command", request }).catch(() => null);
        if (!result) {
          return { status: "unavailable" as const, reason: "page-world-command-failed" };
        }
        if (!await input.authorize(identity)) {
          return { status: "stale" as const, reason: "document-authority-changed" };
        }
        return { status: "ok" as const, result };
      });
    },
    retireTab(tabId: number): Promise<void> {
      return withTabOperation(tabId, async () => {
        const lease = await load(tabId);
        if (lease) await retireLease(lease);
        else await forget(tabId);
      });
    },
  };
}
