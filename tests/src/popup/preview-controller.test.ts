import { describe, expect, it, vi } from "vitest";

import type { PreviewProjection } from "../../../src/domain/schema/preview";
import {
  createPopupPreviewController,
  type PopupPreviewControllerPorts,
  type PopupPreviewOwner,
} from "../../../src/popup/preview-controller";

const OWNER: PopupPreviewOwner = {
  tabId: 77,
  requestKey: "77:https://example.com/page",
  pageUrl: "https://example.com/page",
};

function projection(
  revision = 1,
  projectionId = "preview-occurrence-1",
): PreviewProjection {
  return {
    projectionId,
    revision,
    pageUrl: OWNER.pageUrl,
    rows: [{
      id: "row-stable-1",
      classification: "explicit-included",
      text: "Quarterly revenue <safe>",
      xpath: "/html[1]/body[1]/main[1]",
      selector: "main",
      shadow: "light",
    }],
  };
}

function identity(value: PreviewProjection) {
  return {
    projectionId: value.projectionId,
    revision: value.revision,
    pageUrl: value.pageUrl,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createHarness(overrides: Partial<PopupPreviewControllerPorts> = {}) {
  let open = false;
  let currentOwner = OWNER;
  let currentProjection: PreviewProjection | null = null;
  const selectors = {
    inclusionSelectors: ["main"],
    exclusionSelectors: ["nav"],
  };
  const requestProjection = vi.fn(async () => projection());
  const requestCurrent = vi.fn(async () => currentProjection ? identity(currentProjection) : null);
  const emphasize = vi.fn(async () => ({ targeted: true }));
  const activate = vi.fn(async () => ({ targeted: true }));
  const notify = vi.fn();
  const onChange = vi.fn();
  const setProjection = vi.fn((next: PreviewProjection | null) => {
    currentProjection = next;
  });
  const ports: PopupPreviewControllerPorts = {
    currentProjection: () => currentProjection,
    setProjection,
    requestProjection,
    requestCurrent,
    emphasize,
    activate,
    isOpen: () => open,
    isCurrent: (owner) => owner.requestKey === currentOwner.requestKey,
    notify,
    onChange,
    ...overrides,
  };
  return {
    controller: createPopupPreviewController(ports),
    requestProjection,
    requestCurrent,
    emphasize,
    activate,
    notify,
    onChange,
    setProjection,
    selectors,
    projection: () => currentProjection,
    setOpen(value: boolean) {
      open = value;
    },
    setCurrentOwner(value: PopupPreviewOwner) {
      currentOwner = value;
    },
  };
}

describe("popup Preview controller", () => {
  it("keeps a pre-open projection inert until the Preview fact is authoritative", async () => {
    const harness = createHarness();
    const candidate = await harness.controller.requestCandidate(OWNER, harness.selectors);

    expect(candidate?.projection).toEqual(projection());
    expect(harness.projection()).toBeNull();
    expect(harness.requestProjection).toHaveBeenCalledWith({
      tabId: OWNER.tabId,
      pageUrl: OWNER.pageUrl,
      selectors: {
        inclusionSelectors: ["main"],
        exclusionSelectors: ["nav"],
      },
    });

    harness.setOpen(true);
    expect(candidate && harness.controller.adoptOpeningCandidate(candidate, OWNER))
      .toEqual(projection());
    expect(harness.projection()).toEqual(projection());
  });

  it("adopts only rising revisions within one projection occurrence", async () => {
    const replies = [projection(2), projection(3)];
    const identities = [identity(projection(1)), identity(projection(3))];
    const harness = createHarness({
      requestProjection: vi.fn(async () => replies.shift() ?? null),
      requestCurrent: vi.fn(async () => identities.shift() ?? null),
    });
    harness.setOpen(true);

    await expect(harness.controller.project(OWNER, harness.selectors)).resolves.toMatchObject({ revision: 2 });
    await expect(harness.controller.project(OWNER)).resolves.toMatchObject({ revision: 2 });
    await expect(harness.controller.project(OWNER)).resolves.toMatchObject({ revision: 3 });
    expect(harness.projection()?.revision).toBe(3);
  });

  it("keeps matching retained identity payload-light and requests full rows only after change", async () => {
    const next = projection(2);
    const requestProjection = vi.fn()
      .mockResolvedValueOnce(projection(1))
      .mockResolvedValueOnce(next);
    const requestCurrent = vi.fn()
      .mockResolvedValueOnce(identity(projection(1)))
      .mockResolvedValueOnce(identity(next));
    const harness = createHarness({ requestProjection, requestCurrent });
    harness.setOpen(true);

    await expect(harness.controller.project(OWNER, harness.selectors)).resolves.toMatchObject({ revision: 1 });
    await expect(harness.controller.project(OWNER)).resolves.toMatchObject({ revision: 1 });
    expect(requestProjection).toHaveBeenCalledTimes(1);
    await expect(harness.controller.project(OWNER)).resolves.toMatchObject({ revision: 2 });
    expect(requestCurrent).toHaveBeenCalledTimes(2);
    expect(requestProjection).toHaveBeenCalledTimes(2);
  });

  it("falls back to one full projection when the identity probe is unavailable", async () => {
    const requestProjection = vi.fn()
      .mockResolvedValueOnce(projection(1))
      .mockResolvedValueOnce(projection(2));
    const harness = createHarness({
      requestProjection,
      requestCurrent: vi.fn(async () => null),
    });
    harness.setOpen(true);

    await harness.controller.project(OWNER, harness.selectors);
    await harness.controller.project(OWNER);

    expect(requestProjection).toHaveBeenCalledTimes(2);
    expect(harness.projection()?.revision).toBe(2);
  });

  it("fences a delayed projection across a binding occurrence change", async () => {
    const pending = deferred<PreviewProjection | null>();
    const harness = createHarness({
      requestProjection: vi.fn(async () => await pending.promise),
    });
    const request = harness.controller.requestCandidate(OWNER, harness.selectors);
    harness.controller.bindingChanged();
    harness.setCurrentOwner({ ...OWNER, requestKey: "77:https://example.com/rebound" });
    pending.resolve(projection());

    await expect(request).resolves.toBeNull();
    expect(harness.projection()).toBeNull();
  });

  it("fences a delayed identity probe across a binding occurrence change", async () => {
    const pending = deferred<ReturnType<typeof identity> | null>();
    const harness = createHarness({
      requestCurrent: vi.fn(async () => await pending.promise),
    });
    harness.setOpen(true);
    await harness.controller.project(OWNER, harness.selectors);
    const retainedPoll = harness.controller.project(OWNER);

    harness.controller.bindingChanged();
    harness.setCurrentOwner({ ...OWNER, requestKey: "77:https://example.com/rebound" });
    pending.resolve(identity(projection(2)));

    await expect(retainedPoll).resolves.toBeNull();
    expect(harness.requestProjection).toHaveBeenCalledTimes(1);
  });

  it("does not let an older identity probe supersede a newer same-owner probe", async () => {
    const older = deferred<ReturnType<typeof identity> | null>();
    const requestCurrent = vi.fn()
      .mockImplementationOnce(async () => await older.promise)
      .mockResolvedValueOnce(identity(projection(1)));
    const harness = createHarness({ requestCurrent });
    harness.setOpen(true);
    await harness.controller.project(OWNER, harness.selectors);

    const olderPoll = harness.controller.project(OWNER);
    const newerPoll = harness.controller.project(OWNER);
    await expect(newerPoll).resolves.toMatchObject({ revision: 1 });
    older.resolve(identity(projection(2)));

    await expect(olderPoll).resolves.toBeNull();
    expect(harness.requestProjection).toHaveBeenCalledTimes(1);
  });

  it("does not let a delayed opening candidate erase a newer poll winner", async () => {
    const replies = [projection(1), projection(2)];
    const harness = createHarness({
      requestProjection: vi.fn(async () => replies.shift() ?? null),
    });
    const opening = await harness.controller.requestCandidate(OWNER, harness.selectors);
    harness.setOpen(true);
    await harness.controller.project(OWNER, harness.selectors);

    expect(opening).not.toBeNull();
    if (opening) {
      expect(harness.controller.adoptOpeningCandidate(opening, OWNER)).toBeNull();
    }
    expect(harness.projection()?.revision).toBe(2);
  });

  it("fences a delayed cycle-A target response after exit and cycle-B reopen", async () => {
    const activation = deferred<{ targeted: boolean } | null>();
    const harness = createHarness({
      requestProjection: vi.fn()
        .mockResolvedValueOnce(projection(1, "cycle-a"))
        .mockResolvedValueOnce(projection(2, "cycle-b")),
      activate: vi.fn(async () => await activation.promise),
    });
    harness.setOpen(true);
    await harness.controller.project(OWNER, harness.selectors);
    const oldActivation = harness.controller.activate(OWNER, "row-stable-1");
    harness.controller.previewClosed();
    harness.setOpen(false);
    harness.setProjection(null);
    harness.setOpen(true);
    await harness.controller.project(OWNER, harness.selectors);
    activation.resolve({ targeted: false });
    await oldActivation;

    expect(harness.projection()?.projectionId).toBe("cycle-b");
    expect(harness.notify).not.toHaveBeenCalled();
  });

  it("retains the last truthful list until a stale-row reprojection arrives", async () => {
    const emphasize = vi.fn(async () => ({ targeted: false }));
    const harness = createHarness({
      requestProjection: vi.fn()
        .mockResolvedValueOnce(projection(1))
        .mockResolvedValueOnce(projection(2)),
      emphasize,
    });
    harness.setOpen(true);
    await harness.controller.project(OWNER, harness.selectors);
    harness.setProjection.mockClear();

    await harness.controller.hover(OWNER, "row-stable-1", true);

    expect(harness.setProjection.mock.calls.some(([value]) => value === null)).toBe(false);
    expect(harness.projection()?.revision).toBe(2);
    expect(emphasize).toHaveBeenCalledWith(expect.objectContaining({
      projectionId: "preview-occurrence-1",
      rowId: "row-stable-1",
      active: true,
    }));
  });

  it("freezes the adopted opening selector snapshot across polling and recovery", async () => {
    const openingSelectors = {
      inclusionSelectors: [],
      exclusionSelectors: [".saved-broad-exclusion"],
    };
    const laterPresentationSelectors = {
      inclusionSelectors: ["main h1"],
      exclusionSelectors: [],
    };
    const harness = createHarness({
      emphasize: vi.fn(async () => ({ targeted: false })),
    });

    const candidate = await harness.controller.requestCandidate(OWNER, openingSelectors);
    openingSelectors.exclusionSelectors[0] = ".caller-mutated";
    harness.setOpen(true);
    expect(candidate && harness.controller.adoptOpeningCandidate(candidate, OWNER)).not.toBeNull();

    await harness.controller.project(OWNER, laterPresentationSelectors);
    await harness.controller.hover(OWNER, "row-stable-1", true);

    expect(harness.requestProjection).toHaveBeenCalledTimes(2);
    for (const [request] of harness.requestProjection.mock.calls.slice(0, 2)) {
      expect(request.selectors).toEqual({
        inclusionSelectors: [],
        exclusionSelectors: [".saved-broad-exclusion"],
      });
    }

    harness.controller.previewClosed();
    harness.setOpen(false);
    harness.setProjection(null);
    harness.setOpen(true);
    await harness.controller.project(OWNER, laterPresentationSelectors);

    expect(harness.requestProjection).toHaveBeenCalledTimes(3);
    expect(harness.requestProjection.mock.calls[2]?.[0].selectors).toEqual(laterPresentationSelectors);
  });
});
