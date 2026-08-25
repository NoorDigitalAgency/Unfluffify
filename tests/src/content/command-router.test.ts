import { describe, expect, it, vi } from "vitest";

import { createContentCommandRouter } from "../../../src/content/command-router";

describe("content command authority", () => {
  it("rejects a delayed silent clear from a different same-origin page", async () => {
    const clearSilentSelectors = vi.fn(() => ({ ok: true }));
    const router = createContentCommandRouter({
      currentContext: () => ({
        pageUrl: "https://example.com/new",
        baseUrl: "https://example.com",
        authority: {
          baseUrl: "https://example.com",
          environmentKey: "stage.example",
          siteId: 1,
          configPresent: true,
          lockRole: "editor",
          lockBlocked: false,
          blockedReason: "editor",
          banner: { visible: false, reason: "editor", text: "" },
        },
        presentation: {
          markingEditsBlocked: false,
          blockedReason: "",
          curtain: { visible: false, text: "" },
          reconciliationPending: false,
        },
      }),
      handlers: { clearSilentSelectors },
      pingActivity: vi.fn(),
    });

    await expect(router.dispatch({
      kind: "uf-command/1",
      name: "clearSilentSelectors",
      tabId: 1,
      payload: { pageUrl: "https://example.com/old" },
    })).resolves.toMatchObject({
      ok: false,
      failure: { code: "page-url-mismatch" },
    });
    expect(clearSilentSelectors).not.toHaveBeenCalled();

    await expect(router.dispatch({
      kind: "uf-command/1",
      name: "clearSilentSelectors",
      tabId: 1,
      payload: { pageUrl: "https://example.com/new" },
    })).resolves.toEqual({ ok: true, data: { ok: true } });
    expect(clearSilentSelectors).toHaveBeenCalledOnce();
  });

  it("inherits the canonical lock origin for the exact current page alias", async () => {
    const activate = vi.fn(() => ({ ok: true, initialized: true }));
    const router = createContentCommandRouter({
      currentContext: () => ({
        pageUrl: "https://www.example.com/page",
        baseUrl: "https://www.example.com",
        authority: {
          baseUrl: "https://example.com",
          environmentKey: "stage.example",
          siteId: 1,
          configPresent: true,
          lockRole: "editor",
          lockBlocked: false,
          blockedReason: "editor",
          banner: { visible: false, reason: "editor", text: "" },
        },
        presentation: {
          markingEditsBlocked: false,
          blockedReason: "",
          curtain: { visible: false, text: "" },
          reconciliationPending: false,
        },
      }),
      handlers: { activateContentMain: activate },
      pingActivity: vi.fn(),
    });

    await expect(router.dispatch({
      kind: "uf-command/1",
      name: "activateContentMain",
      tabId: 1,
      payload: {
        pageUrl: "https://www.example.com/page",
        baseUrl: "https://example.com",
      },
    })).resolves.toEqual({ ok: true, data: { ok: true, initialized: true } });
    expect(activate).toHaveBeenCalledOnce();

    await expect(router.dispatch({
      kind: "uf-command/1",
      name: "activateContentMain",
      tabId: 1,
      payload: { pageUrl: "https://other.example/page" },
    })).resolves.toMatchObject({
      ok: false,
      failure: { code: "page-url-mismatch" },
    });
    await expect(router.dispatch({
      kind: "uf-command/1",
      name: "activateContentMain",
      tabId: 1,
      payload: { pageUrl: "https://www.example.com/other" },
    })).resolves.toMatchObject({
      ok: false,
      failure: { code: "page-url-mismatch" },
    });
    await expect(router.dispatch({
      kind: "uf-command/1",
      name: "activateContentMain",
      tabId: 1,
      payload: {},
    })).resolves.toMatchObject({
      ok: false,
      failure: { code: "page-url-mismatch" },
    });
    expect(activate).toHaveBeenCalledOnce();
  });

  it("captures the immutable AI snapshot while the running curtain blocks edits", async () => {
    const capture = vi.fn(() => ({ ok: true, snapshot: { pages: [] } }));
    const activate = vi.fn(() => ({ ok: true }));
    const router = createContentCommandRouter({
      currentContext: () => ({
        pageUrl: "https://example.com/page",
        baseUrl: "https://example.com",
        authority: {
          baseUrl: "https://example.com",
          environmentKey: "stage.example",
          siteId: 1,
          configPresent: true,
          lockRole: "editor",
          lockBlocked: false,
          blockedReason: "editor",
          banner: { visible: false, reason: "editor", text: "" },
        },
        presentation: {
          markingEditsBlocked: true,
          blockedReason: "post_ai",
          curtain: { visible: true, text: "Computing selectors" },
          reconciliationPending: false,
        },
      }),
      handlers: {
        activateContentMain: activate,
        captureSubmissionSnapshot: capture,
      },
      pingActivity: vi.fn(),
    });
    const command = (name: string) => ({
      kind: "uf-command/1" as const,
      name,
      tabId: 1,
      payload: {
        pageUrl: "https://example.com/page",
        baseUrl: "https://example.com",
      },
    });

    await expect(router.dispatch(command("captureSubmissionSnapshot"))).resolves.toMatchObject({
      ok: true,
      data: { ok: true },
    });
    await expect(router.dispatch(command("activateContentMain"))).resolves.toMatchObject({
      ok: false,
      failure: { code: "post_ai" },
    });
    expect(capture).toHaveBeenCalledOnce();
    expect(activate).not.toHaveBeenCalled();
  });
});
