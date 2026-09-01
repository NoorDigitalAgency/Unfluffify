import { describe, expect, it, vi } from "vitest";

import {
  createPageWorldCapabilityRuntime,
  type PageWorldDocumentIdentity,
} from "../../../src/background/page-world-capability-runtime";

type StoredRuntime = {
  endpointKey: string;
  capability: string;
  retired: boolean;
  armedNonce: string;
};

const identity = (patch: Partial<PageWorldDocumentIdentity> = {}): PageWorldDocumentIdentity => ({
  tabId: 7,
  documentId: "document-a",
  pageUrl: "https://example.com/a",
  generation: 3,
  ...patch,
});

function harness() {
  const documents = new Map<string, StoredRuntime>();
  const stored = new Map<string, unknown>();
  const executeScript = vi.fn(async (injection: {
    target: { tabId: number; documentIds: string[] };
    world: "MAIN";
    func: { name?: string };
    args: unknown[];
  }) => {
    const documentId = injection.target.documentIds[0]!;
    if (injection.args.length === 2) {
      const [endpointKey, capability] = injection.args as [string, string];
      documents.set(documentId, { endpointKey, capability, retired: false, armedNonce: "" });
      return [{
        frameId: 0,
        documentId,
        result: {
          ok: true,
          nonce: "",
          command: "PROBE",
          payload: { ready: true, version: 4 },
        },
      }];
    }
    const [endpointKey, capability, invocation] = injection.args as [
      string,
      string,
      { kind: "probe" | "retire" | "command"; request?: { nonce?: string; command?: string } },
    ];
    const runtime = documents.get(documentId);
    let result: Record<string, unknown>;
    if (!runtime || runtime.endpointKey !== endpointKey) {
      result = {
        ok: false,
        nonce: invocation.request?.nonce ?? "",
        command: invocation.request?.command ?? "",
        payload: null,
        failure: { code: "PAGE_RUNTIME_UNAVAILABLE", message: "unavailable" },
      };
    } else if (runtime.capability !== capability) {
      result = {
        ok: false,
        nonce: "",
        command: "",
        payload: null,
        failure: { code: "PAGE_CAPABILITY_REJECTED", message: "rejected" },
      };
    } else if (runtime.retired) {
      result = {
        ok: false,
        nonce: "",
        command: "",
        payload: null,
        failure: { code: "PAGE_RUNTIME_RETIRED", message: "retired" },
      };
    } else if (invocation.kind === "retire") {
      runtime.retired = true;
      result = { ok: true, nonce: "", command: "RETIRE", payload: { ready: false, retired: true } };
    } else if (invocation.kind === "probe") {
      result = { ok: true, nonce: "", command: "PROBE", payload: { ready: true, version: 4 } };
    } else {
      const nonce = invocation.request?.nonce ?? "";
      const command = invocation.request?.command ?? "";
      if (command === "ARM") runtime.armedNonce = nonce;
      if (command === "DESTROY") runtime.armedNonce = "";
      result = {
        ok: true,
        nonce,
        command,
        payload: {
          armed: runtime.armedNonce !== "",
          sessionNonce: runtime.armedNonce,
          phase: runtime.armedNonce ? "armed" : "idle",
        },
      };
    }
    return [{ frameId: 0, documentId, result }];
  });
  const storage = {
    async get(key: string) { return { [key]: stored.get(key) }; },
    async set(values: Record<string, unknown>) {
      for (const [key, value] of Object.entries(values)) stored.set(key, value);
    },
    async remove(key: string) { stored.delete(key); },
  };
  return { documents, executeScript, storage, stored };
}

describe("document-bound page-world capability runtime", () => {
  it("does not inject into an unauthorized document", async () => {
    const test = harness();
    const runtime = createPageWorldCapabilityRuntime({
      executeScript: test.executeScript,
      storage: test.storage,
      authorize: async () => false,
      retain: () => false,
      randomHex: (bytes) => "a".repeat(bytes * 2),
    });

    await expect(runtime.acquire(identity())).resolves.toEqual({
      status: "stale",
      reason: "document-authority-changed",
    });
    expect(test.executeScript).not.toHaveBeenCalled();
    expect(test.stored.size).toBe(0);
  });

  it("installs once into the exact MAIN document and keeps secrets out of its outcome", async () => {
    const test = harness();
    const runtime = createPageWorldCapabilityRuntime({
      executeScript: test.executeScript,
      storage: test.storage,
      authorize: async () => true,
      retain: () => true,
      randomHex: (bytes) => (bytes === 16 ? "b" : "c").repeat(bytes * 2),
    });

    const [first, second] = await Promise.all([runtime.acquire(identity()), runtime.acquire(identity())]);
    expect(first).toMatchObject({ status: "ok", result: { payload: { ready: true } } });
    expect(second).toMatchObject({ status: "ok", result: { payload: { ready: true } } });
    const installs = test.executeScript.mock.calls.filter(([injection]) => injection.args.length === 2);
    expect(installs).toHaveLength(1);
    expect(installs[0]?.[0]).toMatchObject({
      target: { tabId: 7, documentIds: ["document-a"] },
      world: "MAIN",
    });
    expect(test.executeScript).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([first, second])).not.toContain("__uf_");
    expect(JSON.stringify([first, second])).not.toContain("c".repeat(64));
  });

  it("recovers the stored exact lease after a worker restart without reinjection", async () => {
    const test = harness();
    const options = {
      executeScript: test.executeScript,
      storage: test.storage,
      authorize: async () => true,
      retain: () => true,
      randomHex: (bytes: number) => "d".repeat(bytes * 2),
    };
    const firstWorker = createPageWorldCapabilityRuntime(options);
    await firstWorker.acquire(identity());
    const restartedWorker = createPageWorldCapabilityRuntime(options);

    await expect(restartedWorker.acquire(identity())).resolves.toMatchObject({ status: "ok" });
    expect(test.executeScript.mock.calls.filter(([injection]) => injection.args.length === 2)).toHaveLength(1);
    expect(test.executeScript.mock.calls.some(([injection]) =>
      injection.args.length === 3 &&
      (injection.args[2] as { kind?: string }).kind === "probe"
    )).toBe(true);
  });

  it("invokes each hot command once without a redundant capability probe", async () => {
    const test = harness();
    const authorize = vi.fn(async () => true);
    const retain = vi.fn(() => true);
    const runtime = createPageWorldCapabilityRuntime({
      executeScript: test.executeScript,
      storage: test.storage,
      authorize,
      retain,
      randomHex: (bytes) => "1".repeat(bytes * 2),
    });
    await runtime.acquire(identity());
    test.executeScript.mockClear();
    authorize.mockClear();
    retain.mockClear();
    authorize.mockRejectedValue(new Error("hot commands must not await physical authority"));

    await expect(runtime.command(identity(), { nonce: "hot-arm", command: "ARM", payload: {} }))
      .resolves.toMatchObject({ status: "ok", result: { command: "ARM", nonce: "hot-arm" } });
    expect(test.executeScript).toHaveBeenCalledTimes(1);
    expect(test.executeScript.mock.calls[0]?.[0].args[2]).toMatchObject({
      kind: "command",
      request: { command: "ARM", nonce: "hot-arm" },
    });
    expect(authorize).not.toHaveBeenCalled();
    expect(retain).toHaveBeenCalledTimes(2);

    test.executeScript.mockClear();
    authorize.mockClear();
    retain.mockClear();
    await expect(runtime.command(identity(), {
      nonce: "hot-destroy",
      sessionNonce: "hot-arm",
      command: "DESTROY",
      payload: {},
    })).resolves.toMatchObject({ status: "ok", result: { command: "DESTROY", nonce: "hot-destroy" } });
    expect(test.executeScript).toHaveBeenCalledTimes(1);
    expect(test.executeScript.mock.calls[0]?.[0].args[2]).toMatchObject({ kind: "command" });
    expect(authorize).not.toHaveBeenCalled();
    expect(retain).toHaveBeenCalledTimes(2);
  });

  it("probes a recovered worker lease once, then keeps subsequent commands hot", async () => {
    const test = harness();
    const options = {
      executeScript: test.executeScript,
      storage: test.storage,
      authorize: vi.fn(async () => true),
      retain: vi.fn(() => true),
      randomHex: (bytes: number) => "2".repeat(bytes * 2),
    };
    const firstWorker = createPageWorldCapabilityRuntime(options);
    await firstWorker.acquire(identity());
    const restartedWorker = createPageWorldCapabilityRuntime(options);
    test.executeScript.mockClear();
    options.authorize.mockClear();
    options.retain.mockClear();

    await expect(restartedWorker.command(identity(), {
      nonce: "recovered-arm",
      command: "ARM",
      payload: {},
    })).resolves.toMatchObject({ status: "ok", result: { command: "ARM" } });
    expect(test.executeScript).toHaveBeenCalledTimes(2);
    expect(test.executeScript.mock.calls.map(([injection]) =>
      (injection.args[2] as { kind?: string }).kind)).toEqual(["probe", "command"]);
    expect(options.authorize).toHaveBeenCalledTimes(1);
    expect(options.retain).toHaveBeenCalledTimes(2);

    test.executeScript.mockClear();
    options.authorize.mockClear();
    options.retain.mockClear();
    await expect(restartedWorker.command(identity(), {
      nonce: "recovered-destroy",
      sessionNonce: "recovered-arm",
      command: "DESTROY",
      payload: {},
    })).resolves.toMatchObject({ status: "ok", result: { command: "DESTROY" } });
    expect(test.executeScript).toHaveBeenCalledTimes(1);
    expect(test.executeScript.mock.calls[0]?.[0].args[2]).toMatchObject({ kind: "command" });
    expect(options.authorize).not.toHaveBeenCalled();
    expect(options.retain).toHaveBeenCalledTimes(2);
  });

  it("forgets a poisoned hot lease so only a later action installs its replacement", async () => {
    const test = harness();
    const runtime = createPageWorldCapabilityRuntime({
      executeScript: test.executeScript,
      storage: test.storage,
      authorize: async () => true,
      retain: () => true,
      randomHex: (bytes) => "3".repeat(bytes * 2),
    });
    await runtime.acquire(identity());
    test.documents.delete("document-a");

    await expect(runtime.command(identity(), {
      nonce: "missing-runtime",
      command: "ARM",
      payload: {},
    })).resolves.toMatchObject({
      status: "ok",
      result: { ok: false, failure: { code: "PAGE_RUNTIME_UNAVAILABLE" } },
    });
    expect(test.stored.size).toBe(0);
    const installCountAfterFailure = test.executeScript.mock.calls.filter(
      ([injection]) => injection.args.length === 2,
    ).length;

    await expect(runtime.command(identity(), {
      nonce: "replacement-runtime",
      command: "ARM",
      payload: {},
    })).resolves.toMatchObject({ status: "ok", result: { ok: true, command: "ARM" } });
    expect(test.executeScript.mock.calls.filter(
      ([injection]) => injection.args.length === 2,
    )).toHaveLength(installCountAfterFailure + 1);
  });

  it("serializes a command behind acquire and rejects a stale generation before execution", async () => {
    const test = harness();
    let current = identity();
    const runtime = createPageWorldCapabilityRuntime({
      executeScript: test.executeScript,
      storage: test.storage,
      authorize: async (candidate) => JSON.stringify(candidate) === JSON.stringify(current),
      retain: (candidate) => JSON.stringify(candidate) === JSON.stringify(current),
      randomHex: (bytes) => "e".repeat(bytes * 2),
    });
    await runtime.acquire(current);
    await expect(runtime.command(current, { nonce: "arm", command: "ARM", payload: {} }))
      .resolves.toMatchObject({
        status: "ok",
        result: { ok: true, nonce: "arm", command: "ARM", payload: { armed: true } },
      });
    const commandCount = test.executeScript.mock.calls.length;
    current = identity({ pageUrl: "https://example.com/b", generation: 4 });

    await expect(runtime.command(identity(), { nonce: "stale", command: "DESTROY", payload: {} }))
      .resolves.toEqual({ status: "stale", reason: "document-authority-changed" });
    expect(test.executeScript).toHaveBeenCalledTimes(commandCount);
    expect(test.stored.size).toBe(1);

    await runtime.retireTab(7);
    expect(test.documents.get("document-a")?.retired).toBe(true);
    expect(test.stored.size).toBe(0);
  });

  it("withholds command success after a post-invocation authority loss and preserves cleanup", async () => {
    const test = harness();
    let retainCalls = 0;
    let loseAuthority = false;
    const runtime = createPageWorldCapabilityRuntime({
      executeScript: test.executeScript,
      storage: test.storage,
      authorize: async () => true,
      retain: () => !loseAuthority || ++retainCalls === 1,
      randomHex: (bytes) => "4".repeat(bytes * 2),
    });
    await runtime.acquire(identity());
    retainCalls = 0;
    loseAuthority = true;
    test.executeScript.mockClear();

    await expect(runtime.command(identity(), { nonce: "post-stale", command: "ARM", payload: {} }))
      .resolves.toEqual({ status: "stale", reason: "document-authority-changed" });
    expect(test.executeScript).toHaveBeenCalledTimes(1);
    expect(test.documents.get("document-a")?.armedNonce).toBe("post-stale");
    expect(test.stored.size).toBe(1);

    await runtime.retireTab(7);
    expect(test.documents.get("document-a")?.retired).toBe(true);
    expect(test.stored.size).toBe(0);
  });

  it("retires a capability installed across an acquisition authority loss", async () => {
    const test = harness();
    let authorizeCalls = 0;
    const runtime = createPageWorldCapabilityRuntime({
      executeScript: test.executeScript,
      storage: test.storage,
      authorize: async () => ++authorizeCalls === 1,
      retain: () => true,
      randomHex: (bytes) => "5".repeat(bytes * 2),
    });

    await expect(runtime.acquire(identity())).resolves.toEqual({
      status: "stale",
      reason: "document-authority-changed",
    });
    expect(test.documents.get("document-a")?.retired).toBe(true);
    expect(test.stored.size).toBe(0);
  });

  it("retires and forgets the lease on the terminal tab boundary", async () => {
    const test = harness();
    const runtime = createPageWorldCapabilityRuntime({
      executeScript: test.executeScript,
      storage: test.storage,
      authorize: async () => true,
      retain: () => true,
      randomHex: (bytes) => "f".repeat(bytes * 2),
    });
    await runtime.acquire(identity());

    await runtime.retireTab(7);
    expect(test.documents.get("document-a")?.retired).toBe(true);
    expect(test.stored.size).toBe(0);
  });
});
