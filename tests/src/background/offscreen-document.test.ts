import { describe, expect, it, vi } from "vitest";

import { createOffscreenDocumentOwner } from "../../../src/background/offscreen-document";

const DOCUMENT_URL = "chrome-extension://extension-id/offscreen.html";

describe("offscreen document owner", () => {
  it("single-flights concurrent callers and proves the exact Chrome 116 context", async () => {
    let created = false;
    let releaseCreate!: () => void;
    const createBarrier = new Promise<void>((resolve) => { releaseCreate = resolve; });
    const createDocument = vi.fn(async () => {
      await createBarrier;
      created = true;
    });
    const getContexts = vi.fn(async () => created
      ? [{ contextType: "OFFSCREEN_DOCUMENT", documentUrl: DOCUMENT_URL }]
      : []);
    const owner = createOffscreenDocumentOwner({
      runtime: { getURL: () => DOCUMENT_URL, getContexts },
      offscreen: { createDocument },
    });

    const first = owner.ensure();
    const second = owner.ensure();
    const third = owner.ensure();
    expect(first).toBe(second);
    expect(second).toBe(third);
    await Promise.resolve();
    releaseCreate();
    await Promise.all([first, second, third]);

    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(getContexts).toHaveBeenCalledWith({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [DOCUMENT_URL],
    });
  });

  it("accepts a duplicate-create error only after exact context re-proof", async () => {
    let attempt = 0;
    const getContexts = vi.fn(async () => attempt > 0
      ? [{ contextType: "OFFSCREEN_DOCUMENT", documentUrl: DOCUMENT_URL }]
      : []);
    const owner = createOffscreenDocumentOwner({
      runtime: { getURL: () => DOCUMENT_URL, getContexts },
      offscreen: {
        createDocument: vi.fn(async () => {
          attempt += 1;
          throw new Error("Only a single offscreen document may be created");
        }),
      },
    });

    await expect(owner.ensure()).resolves.toBeUndefined();
    expect(getContexts).toHaveBeenCalledTimes(2);
  });

  it("rejects create success or failure when no exact context can be proved", async () => {
    const missing = () => Promise.resolve([
      { contextType: "OFFSCREEN_DOCUMENT", documentUrl: "chrome-extension://extension-id/other.html" },
    ]);
    const successWithoutProof = createOffscreenDocumentOwner({
      runtime: { getURL: () => DOCUMENT_URL, getContexts: missing },
      offscreen: { createDocument: vi.fn(async () => undefined) },
    });
    const failureWithoutProof = createOffscreenDocumentOwner({
      runtime: { getURL: () => DOCUMENT_URL, getContexts: missing },
      offscreen: { createDocument: vi.fn(async () => { throw new Error("create failed"); }) },
    });

    await expect(successWithoutProof.ensure()).rejects.toThrow("without an exact context proof");
    await expect(failureWithoutProof.ensure()).rejects.toThrow("create failed");
  });

  it("uses hasDocument only as a compatibility fallback", async () => {
    const hasDocument = vi.fn(async () => true);
    const createDocument = vi.fn();
    const owner = createOffscreenDocumentOwner({
      runtime: { getURL: () => DOCUMENT_URL },
      offscreen: { hasDocument, createDocument },
    });

    await expect(owner.ensure()).resolves.toBeUndefined();
    expect(hasDocument).toHaveBeenCalledTimes(1);
    expect(createDocument).not.toHaveBeenCalled();
  });
});
