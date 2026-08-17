import { describe, expect, it } from "vitest";

import {
  applyEmulation,
  applyEmulationViaCdp,
  deriveGooglebotSmartphoneUserAgent,
  deriveGooglebotSmartphoneUserAgentMetadata,
  clearEmulation,
  clearEmulationViaCdp,
  clampDeviceScale,
  createFreezeController,
  createRevealVisitController,
  createSpaGuard,
  loadPageWithJavascript,
  reloadWithoutJavascriptViaCdp,
  restoreJavascriptViaCdp,
  runReveal,
} from "../../../../src/content/stabilization";

describe("P5 page stabilization", () => {
  it("freezes page-visit scope and flushes deferred callbacks on resume/lift", () => {
    const freeze = createFreezeController();
    const flushed: string[] = [];
    freeze.pause("marking");
    freeze.pause("silent-highlight");
    freeze.defer(() => flushed.push("done"));

    freeze.resume("marking");
    expect(freeze.isPaused()).toBe(true);
    expect(flushed).toEqual([]);
    freeze.resume("silent-highlight");
    expect(freeze.reasons()).toEqual(["page-visit"]);
    expect(flushed).toEqual(["done"]);
    freeze.lift();
    expect(freeze.isPaused()).toBe(false);
  });

  it("runs exactly one reveal ritual and skips stale/no-scroll cases", async () => {
    const steps: string[] = [];
    await expect(runReveal({
      hasVerticalScrollRoom: true,
      activationStale: false,
      initialScrollHeight: 1_000,
      measureExpandedScrollHeight: () => 1_500,
      scrollTo: (position) => steps.push(position),
      suppressLazyLoading: () => steps.push("suppress"),
      freezeAtBottom: () => steps.push("freeze"),
    })).resolves.toEqual({ skipped: false, lazyExpansions: 1, frozenAtBottom: true });
    expect(steps).toEqual(["top", "half", "suppress", "bottom", "freeze", "restore"]);

    await expect(runReveal({
      hasVerticalScrollRoom: false,
      activationStale: false,
      initialScrollHeight: 1,
      scrollTo: () => steps.push("unexpected"),
      suppressLazyLoading: () => steps.push("unexpected"),
      freezeAtBottom: () => steps.push("unexpected"),
    })).resolves.toMatchObject({ skipped: true });
  });

  it("yields paint between scrolls and freezes at the re-measured bottom", async () => {
    const steps: string[] = [];
    let scrollHeight = 1_000;
    let paintCount = 0;

    const result = await runReveal({
      hasVerticalScrollRoom: true,
      activationStale: false,
      initialScrollHeight: scrollHeight,
      measureExpandedScrollHeight: () => {
        steps.push(`measure:${scrollHeight}`);
        return scrollHeight;
      },
      scrollTo: (position, measuredScrollHeight) => {
        steps.push(`scroll:${position}:${measuredScrollHeight}`);
      },
      waitForPaint: async () => {
        paintCount += 1;
        steps.push(`paint:${paintCount}`);
        if (paintCount === 2) {
          scrollHeight = 1_500;
        }
      },
      suppressLazyLoading: () => steps.push("suppress"),
      freezeAtBottom: () => steps.push("freeze"),
    });

    expect(steps).toEqual([
      "scroll:top:1000",
      "paint:1",
      "scroll:half:1000",
      "paint:2",
      "suppress",
      "paint:3",
      "measure:1500",
      "scroll:bottom:1500",
      "paint:4",
      "freeze",
      "paint:5",
      "scroll:restore:1500",
      "paint:6",
    ]);
    expect(result).toEqual({ skipped: false, lazyExpansions: 1, frozenAtBottom: true });
  });

  it("runs reveal once per page visit until navigation reset", async () => {
    const controller = createRevealVisitController();
    let runs = 0;
    const input = {
      hasVerticalScrollRoom: true,
      activationStale: false,
      initialScrollHeight: 1_000,
      scrollTo: () => {
        runs += 1;
      },
      suppressLazyLoading: () => undefined,
      freezeAtBottom: () => undefined,
    };

    await expect(controller.run(input)).resolves.toMatchObject({ skipped: false });
    await expect(controller.run(input)).resolves.toMatchObject({ skipped: true });
    controller.resetForNavigation();
    await expect(controller.run(input)).resolves.toMatchObject({ skipped: false });
    expect(runs).toBe(8);
  });

  it("skips concurrent reveal attempts before the first ritual settles", async () => {
    const controller = createRevealVisitController();
    let release: (() => void) | null = null;
    const input = {
      hasVerticalScrollRoom: true,
      activationStale: false,
      initialScrollHeight: 1_000,
      scrollTo: () => undefined,
      suppressLazyLoading: () => undefined,
      freezeAtBottom: () => {
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    };

    const first = controller.run(input);
    await expect(controller.run(input)).resolves.toMatchObject({ skipped: true });
    release?.();
    await expect(first).resolves.toMatchObject({ skipped: false });
  });

  it("clamps and clears emulation state", () => {
    expect(clampDeviceScale(2)).toBe(1);
    expect(clampDeviceScale(0.1)).toBe(0.25);
    expect(applyEmulation("mobile", 0.85)).toMatchObject({
      width: 412,
      height: 960,
      scale: 0.85,
      active: true,
    });

    expect(clearEmulation(applyEmulation("desktop", 0.7)).active).toBe(false);
  });

  it("applies and clears CDP device emulation", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const client = { send: async (method: string, params?: Record<string, unknown>) => calls.push({ method, params }) };
    const state = await applyEmulationViaCdp(client, "mobile", 2);
    const cleared = await clearEmulationViaCdp(client, state);

    expect(calls).toEqual([
      {
        method: "Emulation.setDeviceMetricsOverride",
        params: { width: 412, height: 960, deviceScaleFactor: 1, mobile: true, scale: 1 },
      },
      { method: "Emulation.setTouchEmulationEnabled", params: { enabled: true, maxTouchPoints: 1 } },
      {
        method: "Emulation.setEmulatedMedia",
        params: {
          media: "",
          features: [
            { name: "pointer", value: "coarse" },
            { name: "hover", value: "none" },
            { name: "any-pointer", value: "coarse" },
            { name: "any-hover", value: "none" },
          ],
        },
      },
      { method: "Emulation.setTouchEmulationEnabled", params: { enabled: false } },
      { method: "Emulation.setEmulatedMedia", params: { media: "", features: [] } },
      { method: "Emulation.clearDeviceMetricsOverride", params: undefined },
    ]);
    expect(cleared.active).toBe(false);
  });

  it("spoofs Googlebot Smartphone while carrying the browser's own Chrome version", async () => {
    // A UA claiming a version this browser is not gets caught by any server that
    // cross-checks it, and it rots with every Chrome release. So the version is
    // carried across from the real UA rather than written down here.
    const real = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.65 Safari/537.36";

    const mobile = deriveGooglebotSmartphoneUserAgent(real);

    expect(mobile).toContain("Chrome/141.0.7390.65");
    expect(mobile).toContain("Android 6.0.1; Nexus 5X Build/MMB29P");
    expect(mobile).toContain("Mobile Safari/537.36");
    expect(mobile).toContain("Googlebot/2.1");
    expect(mobile).not.toContain("X11");
    expect(mobile).not.toContain("Linux x86_64");
  });

  it("matches the client hints to the spoofed user agent", async () => {
    // Sites increasingly read navigator.userAgentData.mobile instead of parsing
    // the string; one of the two saying "desktop" defeats spoofing the other.
    const real = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.65 Safari/537.36";

    const metadata = deriveGooglebotSmartphoneUserAgentMetadata(real);

    expect(metadata).toMatchObject({
      mobile: true,
      platform: "Android",
      platformVersion: "6.0.1",
      model: "Nexus 5X",
      fullVersion: "141.0.7390.65",
    });
    // Brand versions are the major; the full list carries the exact build.
    expect(metadata?.brands).toEqual(expect.arrayContaining([
      { brand: "Google Chrome", version: "141" },
    ]));
    expect(metadata?.fullVersionList).toEqual(expect.arrayContaining([
      { brand: "Google Chrome", version: "141.0.7390.65" },
    ]));
  });

  it("leaves the user agent alone rather than inventing a version", async () => {
    // No Chrome token means no version was read. Asserting one anyway would be a
    // claim about a browser nobody looked at.
    expect(deriveGooglebotSmartphoneUserAgent("Mozilla/5.0 (compatible; SomeBot/1.0)")).toBe("");
    expect(deriveGooglebotSmartphoneUserAgentMetadata("Mozilla/5.0 (compatible; SomeBot/1.0)")).toBe(null);

    const calls: Array<{ method: string }> = [];
    const client = { send: async (method: string) => { calls.push({ method }); } };
    await applyEmulationViaCdp(client, "mobile", 1, { realUserAgent: "Mozilla/5.0 (compatible; SomeBot/1.0)" });

    expect(calls.map((call) => call.method)).toEqual([
      "Emulation.setDeviceMetricsOverride",
      "Emulation.setTouchEmulationEnabled",
      "Emulation.setEmulatedMedia",
    ]);
  });

  it("does not override the user agent when the real one is unknown", async () => {
    // Reading the real UA can fail on a page that refuses evaluation; spoofing
    // from nothing would derive a mobile UA from our own previous spoof.
    const calls: Array<{ method: string }> = [];
    const client = { send: async (method: string) => { calls.push({ method }); } };

    await applyEmulationViaCdp(client, "mobile", 1);

    expect(calls.map((call) => call.method)).toEqual([
      "Emulation.setDeviceMetricsOverride",
      "Emulation.setTouchEmulationEnabled",
      "Emulation.setEmulatedMedia",
    ]);
  });

  it("restores the browser's own user agent for desktop", async () => {
    // Desktop is the truth, not a second fiction: the real UA goes back, and with
    // the metadata omitted the real client hints come back with it.
    const real = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.65 Safari/537.36";
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const client = { send: async (method: string, params?: Record<string, unknown>) => { calls.push({ method, params }); } };

    await applyEmulationViaCdp(client, "desktop", 1, { realUserAgent: real });

    expect(calls.map((call) => call.method)).toEqual([
      "Emulation.setDeviceMetricsOverride",
      "Emulation.setTouchEmulationEnabled",
      "Emulation.setEmulatedMedia",
      "Emulation.setUserAgentOverride",
    ]);
    expect(calls[1].params).toEqual({ enabled: false });
    expect(calls[2].params).toEqual({ media: "", features: [] });
    expect(calls[3].params).toEqual({ userAgent: real });
  });

  it("sends the mobile identity alongside the mobile metrics", async () => {
    const real = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.65 Safari/537.36";
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const client = { send: async (method: string, params?: Record<string, unknown>) => { calls.push({ method, params }); } };

    await applyEmulationViaCdp(client, "mobile", 1, { realUserAgent: real });

    expect(calls.map((call) => call.method)).toEqual([
      "Emulation.setDeviceMetricsOverride",
      "Emulation.setTouchEmulationEnabled",
      "Emulation.setEmulatedMedia",
      "Emulation.setUserAgentOverride",
    ]);
    const params = calls[3].params as { userAgent: string; platform: string; userAgentMetadata: { mobile: boolean } };
    expect(params.userAgent).toContain("Mobile Safari");
    expect(params.userAgent).toContain("Googlebot/2.1");
    expect(params.platform).toBe("Android");
    expect(params.userAgentMetadata.mobile).toBe(true);
    // Viewport, input media, and identity must all describe the same device.
    expect(calls[0].params).toMatchObject({ mobile: true, width: 412 });
    expect(calls[1].params).toEqual({ enabled: true, maxTouchPoints: 1 });
    expect(calls[2].params).toMatchObject({
      features: expect.arrayContaining([
        { name: "pointer", value: "coarse" },
        { name: "hover", value: "none" },
      ]),
    });
  });

  it("toggles script execution and reloads so the operator can compare views", async () => {
    const sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const reloads: string[] = [];
    const client = { send: async (method: string, params?: Record<string, unknown>) => { sent.push({ method, params }); } };

    await loadPageWithJavascript(client, () => { reloads.push("reload"); }, false);
    await loadPageWithJavascript(client, () => { reloads.push("reload"); }, true);

    // Disable-then-reload, and enable-then-reload: the override has to be in
    // place before the load or the page renders in the previous mode.
    expect(sent).toEqual([
      { method: "Emulation.setScriptExecutionDisabled", params: { value: true } },
      { method: "Emulation.setScriptExecutionDisabled", params: { value: false } },
    ]);
    expect(reloads).toEqual(["reload", "reload"]);
  });

  it("uses CDP to disable and restore JavaScript around reload", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> } | { reload: true }> = [];
    const client = { send: async (method: string, params?: Record<string, unknown>) => calls.push({ method, params }) };

    await reloadWithoutJavascriptViaCdp(client, () => calls.push({ reload: true }));
    await restoreJavascriptViaCdp(client);

    expect(calls).toEqual([
      { method: "Emulation.setScriptExecutionDisabled", params: { value: true } },
      { reload: true },
      { method: "Emulation.setScriptExecutionDisabled", params: { value: false } },
    ]);
  });

  it("forces SPA reload only while active and only on URL changes", () => {
    const reloads: string[] = [];
    const guard = createSpaGuard((url) => reloads.push(url));

    guard.onUrlChange("https://example.com/a");
    guard.arm("https://example.com/a");
    guard.onUrlChange("https://example.com/a");
    guard.onUrlChange("https://example.com/b");
    guard.disarm();
    guard.onUrlChange("https://example.com/c");

    expect(reloads).toEqual(["https://example.com/b"]);
  });
});

describe("page-visit reveal ritual", () => {
  it("walks top, half, bottom then back, freezing at the bottom", async () => {
    // The legacy contract: one full ritual per page visit — top, half (which is
    // where the lazyloader is capped), the true bottom, freeze, then return under
    // the freeze. The order is the point: freezing before the bottom would lock the
    // page down before the scroll-linked content had been triggered.
    // One ordered log, not one per kind: two lists cannot show that the freeze
    // happened after the bottom was reached, which is the whole claim.
    const log: string[] = [];

    const result = await runReveal({
      hasVerticalScrollRoom: true,
      activationStale: false,
      initialScrollHeight: 2000,
      measureExpandedScrollHeight: () => 3000,
      scrollTo: (position) => log.push(`scroll:${position}`),
      suppressLazyLoading: () => log.push("suppress-lazy"),
      freezeAtBottom: () => log.push("freeze"),
    });

    expect(log).toEqual([
      "scroll:top",
      "scroll:half",
      "suppress-lazy",
      "scroll:bottom",
      "freeze",
      "scroll:restore",
    ]);
    expect(result).toEqual({ skipped: false, lazyExpansions: 1, frozenAtBottom: true });
  });

  it("runs once per visit, however often it is asked", async () => {
    // Asked again by a second activation on the same page, the walk would find
    // nothing left to reveal while costing the operator another full scroll.
    const controller = createRevealVisitController();
    const input = {
      hasVerticalScrollRoom: true,
      activationStale: false,
      initialScrollHeight: 1000,
      scrollTo: () => undefined,
      suppressLazyLoading: () => undefined,
      freezeAtBottom: () => undefined,
    };

    expect((await controller.run(input)).skipped).toBe(false);
    expect((await controller.run(input)).skipped).toBe(true);
    expect((await controller.run(input)).skipped).toBe(true);
  });

  it("frees the attempt again after a navigation", async () => {
    // One ritual per VISIT, not per tab: the next page is a fresh page.
    const controller = createRevealVisitController();
    const input = {
      hasVerticalScrollRoom: true,
      activationStale: false,
      initialScrollHeight: 1000,
      scrollTo: () => undefined,
      suppressLazyLoading: () => undefined,
      freezeAtBottom: () => undefined,
    };
    await controller.run(input);
    controller.resetForNavigation();

    expect((await controller.run(input)).skipped).toBe(false);
  });

  it("does not spend the attempt on a page it cannot walk", async () => {
    // A page with no scroll room has nothing to reveal, and a stale activation
    // describes a page that has already been navigated away from. Neither should
    // consume the one attempt this visit gets.
    const controller = createRevealVisitController();
    const base = {
      initialScrollHeight: 1000,
      scrollTo: () => undefined,
      suppressLazyLoading: () => undefined,
      freezeAtBottom: () => undefined,
    };

    expect((await controller.run({ ...base, hasVerticalScrollRoom: false, activationStale: false })).skipped).toBe(true);
    expect((await controller.run({ ...base, hasVerticalScrollRoom: true, activationStale: true })).skipped).toBe(true);
    // The attempt survived both, so the real one still runs.
    expect((await controller.run({ ...base, hasVerticalScrollRoom: true, activationStale: false })).skipped).toBe(false);
  });
});

describe("reveal attempt bookkeeping", () => {
  it("keeps the attempt when the page had nothing to walk yet", async () => {
    // The failure this encodes: the ritual is triggered at document_start, where the
    // document is empty and there is no scroll room, so the walk skips. Recording
    // that skip as a completed ritual blocks the real one for the rest of the visit
    // — which read as the ritual never running at all.
    const controller = createRevealVisitController();
    const walkable = {
      hasVerticalScrollRoom: true,
      activationStale: false,
      initialScrollHeight: 5000,
      scrollTo: () => undefined,
      suppressLazyLoading: () => undefined,
      freezeAtBottom: () => undefined,
    };

    // Empty document: nothing to reveal.
    const early = await controller.run({ ...walkable, hasVerticalScrollRoom: false, initialScrollHeight: 0 });
    expect(early.skipped).toBe(true);

    // Once loaded, the attempt is still there — and it is the only one.
    expect((await controller.run(walkable)).skipped).toBe(false);
    expect((await controller.run(walkable)).skipped).toBe(true);
  });
});
