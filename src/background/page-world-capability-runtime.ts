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

function debugPageWorldStage(
  stage: string,
  detail: Readonly<Record<string, unknown>> = {},
): void {
  const debugBuild = typeof __UF_DEBUG_BUILD__ !== "undefined" && __UF_DEBUG_BUILD__;
  if (debugBuild) {
    console.debug(
      "[Unfluffify][page-world-capability] Lifecycle",
      JSON.stringify({ stage, ...detail }),
    );
  }
}

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
  // Session storage proves only that this worker inherited an exact lease
  // description. The MAIN-world endpoint itself is proved once after recovery;
  // leases installed or successfully probed by this worker stay hot until an
  // identity boundary or explicit retirement forgets them.
  const provedLeaseTabs = new Set<number>();
  const operations = new Map<number, Promise<unknown>>();
  let operationSequence = 0;
  const makeRandomHex = input.randomHex ?? randomHex;

  const readyProof = (): PageWorldCommandResult => ({
    ok: true,
    nonce: "",
    command: "PROBE",
    payload: { ready: true },
  });

  const withTabOperation = <T>(
    tabId: number,
    label: string,
    operation: (sequence: number) => Promise<T>,
  ): Promise<T> => {
    operationSequence += 1;
    const sequence = operationSequence;
    const queuedAt = Date.now();
    const queuedBehindPrior = operations.has(tabId);
    debugPageWorldStage("queued", { tabId, sequence, label, queuedBehindPrior });
    const previous = operations.get(tabId) ?? Promise.resolve();
    const run = async (): Promise<T> => {
      const startedAt = Date.now();
      debugPageWorldStage("started", {
        tabId,
        sequence,
        label,
        queueWaitMs: startedAt - queuedAt,
      });
      try {
        const result = await operation(sequence);
        debugPageWorldStage("settled", {
          tabId,
          sequence,
          label,
          durationMs: Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        debugPageWorldStage("rejected", {
          tabId,
          sequence,
          label,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    };
    const next = previous.then(run, run);
    const tail = next.then(() => undefined, () => undefined);
    operations.set(tabId, tail);
    void tail.finally(() => {
      if (operations.get(tabId) === tail) operations.delete(tabId);
    });
    return next;
  };

  const runTracedPhase = async <T>(
    identity: PageWorldDocumentIdentity,
    sequence: number,
    operationLabel: string,
    phase: string,
    operation: () => Promise<T>,
    summarize: (result: T) => unknown = () => undefined,
  ): Promise<T> => {
    const startedAt = Date.now();
    debugPageWorldStage("phase-started", {
      tabId: identity.tabId,
      sequence,
      label: operationLabel,
      phase,
    });
    try {
      const result = await operation();
      debugPageWorldStage("phase-settled", {
        tabId: identity.tabId,
        sequence,
        label: operationLabel,
        phase,
        durationMs: Date.now() - startedAt,
        result: summarize(result),
      });
      return result;
    } catch (error) {
      debugPageWorldStage("phase-rejected", {
        tabId: identity.tabId,
        sequence,
        label: operationLabel,
        phase,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
    provedLeaseTabs.add(lease.identity.tabId);
    await Promise.resolve(input.storage?.set({ [storageKey(lease.identity.tabId)]: lease }))
      .catch(() => undefined);
  };

  const forget = async (tabId: number): Promise<void> => {
    leases.delete(tabId);
    provedLeaseTabs.delete(tabId);
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

  type ResolvedLease =
    | Readonly<{ status: "ok"; lease: StoredLease; result: PageWorldCommandResult }>
    | Exclude<PageWorldCapabilityOutcome, Readonly<{ status: "ok"; result: PageWorldCommandResult }>>;

  const provedExactLease = (identity: PageWorldDocumentIdentity): StoredLease | null => {
    const lease = leases.get(identity.tabId);
    return lease && provedLeaseTabs.has(identity.tabId) && sameIdentity(lease.identity, identity)
      ? lease
      : null;
  };

  /** Resolve or install the exact lease after the caller has established
   * document authority. This helper deliberately does not authorize on its own:
   * acquire and command place their proofs around the precise operation they
   * own, avoiding four repeated browser/storage round trips per hot command. */
  const resolveLeaseUnlocked = async (
    identity: PageWorldDocumentIdentity,
  ): Promise<ResolvedLease> => {
    const existing = await load(identity.tabId);
    if (existing && sameIdentity(existing.identity, identity)) {
      if (provedLeaseTabs.has(identity.tabId)) {
        return { status: "ok", lease: existing, result: readyProof() };
      }
      const proof = await invoke(existing, { kind: "probe" }).catch(() => null);
      if (proof?.ok && proof.payload?.ready === true) {
        provedLeaseTabs.add(identity.tabId);
        return { status: "ok", lease: existing, result: proof };
      }
      await retireLease(existing);
    } else if (existing) {
      await retireLease(existing);
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
    await persist(lease);
    return { status: "ok", lease, result: installed };
  };

  const acquireUnlocked = async (
    identity: PageWorldDocumentIdentity,
  ): Promise<PageWorldCapabilityOutcome> => {
    if (!await input.authorize(identity)) {
      return { status: "stale", reason: "document-authority-changed" };
    }
    const hotLease = provedExactLease(identity);
    const resolved = hotLease
      ? { status: "ok" as const, lease: hotLease, result: readyProof() }
      : await resolveLeaseUnlocked(identity);
    if (resolved.status !== "ok") return resolved;
    if (!await input.authorize(identity)) {
      // This acquisition may have installed the endpoint after its initial
      // authority proof. Retire that exact endpoint now; otherwise a terminal
      // retirement already queued behind this operation would find no lease and
      // leave page-world state orphaned in the still-live document.
      await retireLease(resolved.lease);
      return { status: "stale", reason: "document-authority-changed" };
    }
    return { status: "ok", result: resolved.result };
  };

  return {
    acquire(identity: PageWorldDocumentIdentity): Promise<PageWorldCapabilityOutcome> {
      return withTabOperation(identity.tabId, "acquire", () => acquireUnlocked(identity));
    },
    command(
      identity: PageWorldDocumentIdentity,
      request: PageWorldRequest,
    ): Promise<PageWorldCapabilityOutcome> {
      const operationLabel = `command:${request.command}`;
      return withTabOperation(identity.tabId, operationLabel, async (sequence) => {
        let lease = provedExactLease(identity);
        if (!lease) {
          const authorized = await runTracedPhase(
            identity,
            sequence,
            operationLabel,
            "resolve-authorize",
            () => input.authorize(identity),
            (result) => result,
          );
          if (!authorized) {
            return { status: "stale" as const, reason: "document-authority-changed" };
          }
          const resolved = await runTracedPhase(
            identity,
            sequence,
            operationLabel,
            "resolve-lease",
            () => resolveLeaseUnlocked(identity),
            (result) => result.status,
          );
          if (resolved.status !== "ok") return resolved;
          lease = resolved.lease;
        }
        // A recovered/installed resolution can yield while navigation commits.
        // This is the exact pre-invocation authority fence for both cold and hot
        // paths; the matching post-invocation fence remains below.
        const admitted = await runTracedPhase(
          identity,
          sequence,
          operationLabel,
          "pre-authorize",
          () => input.authorize(identity),
          (result) => result,
        );
        if (!admitted) {
          // Do not execute even a cleanup invocation after a failed command
          // admission proof. Keep the lease discoverable so the navigation or
          // terminal owner queued for this tab can retire it in order.
          return { status: "stale" as const, reason: "document-authority-changed" };
        }
        const result = await runTracedPhase(
          identity,
          sequence,
          operationLabel,
          "invoke",
          () => invoke(lease, { kind: "command", request }).catch(() => null),
          (outcome) => outcome
            ? { ok: outcome.ok, failureCode: outcome.failure?.code ?? null }
            : null,
        );
        if (!result) {
          // A transport/injection failure does not prove the endpoint is dead.
          // Make it unproved so the next authorized action probes once, while
          // retaining the lease for an already-queued terminal retirement.
          provedLeaseTabs.delete(identity.tabId);
          return { status: "unavailable" as const, reason: "page-world-command-failed" };
        }
        if (
          !result.ok &&
          (result.failure?.code === "PAGE_RUNTIME_UNAVAILABLE" ||
            result.failure?.code === "PAGE_RUNTIME_RETIRED" ||
            result.failure?.code === "PAGE_CAPABILITY_REJECTED")
        ) {
          // The current action remains failed. Forget only the poisoned local
          // lease so a later explicit acquisition/action can install one exact
          // replacement instead of probing or invoking the dead endpoint again.
          await forget(identity.tabId);
        }
        const retained = await runTracedPhase(
          identity,
          sequence,
          operationLabel,
          "post-authorize",
          () => input.authorize(identity),
          (outcome) => outcome,
        );
        if (!retained) {
          // The command already completed, so return no success. Retaining a
          // non-poisoned lease lets the authority owner retire any state the
          // command may have installed; definite dead/rejected leases above
          // have already been forgotten because they cannot be retired.
          return { status: "stale" as const, reason: "document-authority-changed" };
        }
        return { status: "ok" as const, result };
      });
    },
    retireTab(tabId: number): Promise<void> {
      return withTabOperation(tabId, "retire", async () => {
        const lease = await load(tabId);
        if (lease) await retireLease(lease);
        else await forget(tabId);
      });
    },
  };
}
