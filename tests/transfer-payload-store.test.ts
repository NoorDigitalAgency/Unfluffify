import { describe, expect, it } from "vitest";

import { createTransferPayloadStore } from "../src/background/transfer-payload-store";

describe("transfer payload store", () => {
  it("deduplicates one scoped payload and returns an integrity-bearing handle", async () => {
    let nextId = 0;
    const store = createTransferPayloadStore({
      id: () => `payload-${++nextId}`,
      now: () => 100,
    });

    const first = await store.put("capture:one", "<main>rendered</main>");
    const duplicate = await store.put("capture:one", "<main>rendered</main>");

    expect(duplicate).toEqual(first);
    expect(first).toMatchObject({
      id: "payload-1",
      scope: "capture:one",
      byteLength: new TextEncoder().encode("<main>rendered</main>").byteLength,
    });
    expect(first.sha256).toMatch(/^[a-f\d]{64}$/);
    await expect(store.get(first)).resolves.toBe("<main>rendered</main>");
    expect(store.entryCount()).toBe(1);
  });

  it("rejects altered scope or integrity facts and releases an entire scope", async () => {
    const store = createTransferPayloadStore({ id: () => "payload-1" });
    const handle = await store.put("capture:one", "rendered");

    await expect(store.get({ ...handle, scope: "capture:two" })).resolves.toBeNull();
    await expect(store.get({ ...handle, sha256: "0".repeat(64) })).resolves.toBeNull();
    await expect(store.get({ ...handle, byteLength: handle.byteLength + 1 })).resolves.toBeNull();
    expect(store.releaseScope("capture:one")).toBe(1);
    await expect(store.get(handle)).resolves.toBeNull();
  });

  it("expires payloads and evicts the oldest entries within its byte budget", async () => {
    let now = 0;
    let nextId = 0;
    const store = createTransferPayloadStore({
      id: () => `payload-${++nextId}`,
      now: () => now,
      ttlMs: 10,
      maxBytes: 7,
    });
    const old = await store.put("capture:old", "1234");
    const current = await store.put("capture:new", "5678");

    await expect(store.get(old)).resolves.toBeNull();
    await expect(store.get(current)).resolves.toBe("5678");

    now = 11;
    await expect(store.get(current)).resolves.toBeNull();
    expect(store.entryCount()).toBe(0);
  });
});
