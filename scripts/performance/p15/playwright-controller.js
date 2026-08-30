/* eslint-disable @typescript-eslint/no-unused-expressions -- playwright-cli requires a bare function expression. */
async (page) => {
  const checks = [];
  const pageErrors = [];
  const consoleErrors = [];
  const scenarioEvidence = {};
  const initialUrl = page.url();
  const pathStart = initialUrl.indexOf("/", initialUrl.indexOf("//") + 2);
  const origin = pathStart >= 0 ? initialUrl.slice(0, pathStart) : initialUrl;
  const fixtureUrl = (variant) => `${origin}/fixture?variant=${variant}`;
  page.on("pageerror", (error) => pageErrors.push(String(error?.stack || error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const sleep = (milliseconds) => page.waitForTimeout(milliseconds);
  const waitForDocumentScrollQuiet = (quietMs = 250, timeoutMs = 5_000) => page.evaluate(
    async ({ requiredQuietMs, maximumWaitMs }) => {
      const startedAt = performance.now();
      let quietSince = startedAt;
      let lastX = scrollX;
      let lastY = scrollY;
      while (performance.now() - startedAt < maximumWaitMs) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const nextX = scrollX;
        const nextY = scrollY;
        if (nextX !== lastX || nextY !== lastY) {
          lastX = nextX;
          lastY = nextY;
          quietSince = performance.now();
        }
        if (performance.now() - quietSince >= requiredQuietMs) {
          return { scrollX: nextX, scrollY: nextY, quietMs: performance.now() - quietSince };
        }
      }
      throw new Error(`Document scroll did not become quiet within ${maximumWaitMs} ms`);
    },
    { requiredQuietMs: quietMs, maximumWaitMs: timeoutMs },
  );
  const assertion = (condition, message, evidence) => {
    if (!condition) {
      const suffix = evidence === undefined ? "" : `: ${JSON.stringify(evidence)}`;
      throw new Error(`${message}${suffix}`);
    }
  };
  const check = async (id, run) => {
    try {
      const evidence = await run();
      checks.push({ id, pass: true, evidence: evidence ?? null });
    } catch (error) {
      checks.push({ id, pass: false, error: String(error?.stack || error) });
    }
  };
  const waitForRuntime = async () => {
    await page.waitForFunction(() => window.__p15Runtime?.readyState() !== "booting", undefined, { timeout: 10_000 });
    const ready = await page.evaluate(() => ({
      state: window.__p15Runtime?.readyState(),
      error: window.__p15Runtime?.readyError(),
      documentId: window.__p15Runtime?.documentId,
    }));
    assertion(ready.state === "ready", "P15 runtime failed to initialize", ready);
    return ready;
  };
  const gotoFresh = async (variant) => {
    await page.goto(fixtureUrl(variant), { waitUntil: "load" });
    await waitForRuntime();
    await page.evaluate(() => window.__p15Runtime.resetDurablePosture());
    await page.reload({ waitUntil: "load" });
    const ready = await waitForRuntime();
    await page.waitForFunction(
      () => window.__p15Runtime.backgroundSnapshot().pageContextRequests >= 1,
      undefined,
      { timeout: 5_000 },
    );
    await sleep(20);
    return ready;
  };
  const dispatch = (name, payload = {}) => page.evaluate(
    ({ commandName, commandPayload }) => window.__p15Runtime.dispatch(commandName, commandPayload),
    { commandName: name, commandPayload: payload },
  );
  const waitForShield = (present = true) => page.waitForFunction(
    (expected) => Boolean(document.querySelector('[data-uf-interaction-shield="true"]')) === expected,
    present,
    { timeout: 10_000 },
  );
  const pointTarget = (point) => page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    return {
      tagName: target?.tagName ?? "",
      id: target?.id ?? "",
      shield: target?.getAttribute?.("data-uf-interaction-shield") ?? null,
      extension: target?.closest?.('[data-uf-extension-ui="true"]')?.getAttribute("data-uf-extension-ui") ?? null,
      contentSurface: target?.closest?.('[data-uf-content-surface-root="true"]')?.getAttribute("data-uf-content-surface-root") ?? null,
      markingSurface: target?.closest?.(".uf-marking-layer-root")?.classList.contains("uf-marking-layer-root") ?? false,
      spoof: target?.closest?.("[data-uf-fixture-spoof-surface]")?.getAttribute("data-uf-fixture-spoof-surface") ?? null,
      debugCopy: target?.getAttribute?.("data-uf-silent-copy") ?? null,
    };
  }, point);
  const fixtureSnapshot = () => page.evaluate(() => window.__p15Runtime.fixtureSnapshot());
  const backgroundSnapshot = () => page.evaluate(() => window.__p15Runtime.backgroundSnapshot());
  const waitForDurableStatus = (status, organState = null) => page.waitForFunction(
    ({ expectedStatus, expectedOrganState }) => {
      const durable = window.__p15Runtime.backgroundSnapshot().durable;
      return durable?.status === expectedStatus && (
        expectedOrganState === null || durable?.directive?.organ?.state === expectedOrganState
      );
    },
    { expectedStatus: status, expectedOrganState: organState },
    { timeout: 10_000 },
  );
  const waitForContentState = async (state) => {
    let latest = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      latest = await dispatch("getContentMainStatus");
      if (latest?.ok === true && latest?.data?.sessionState?.name === state) return latest;
      await sleep(100);
    }
    throw new Error(`Timed out waiting for content state ${state}: ${JSON.stringify(latest)}`);
  };
  const shieldGeometry = () => page.evaluate(() => {
    const shield = document.querySelector('[data-uf-interaction-shield="true"]');
    const rect = shield?.getBoundingClientRect();
    const viewport = window.visualViewport;
    return {
      count: document.querySelectorAll('[data-uf-interaction-shield="true"]').length,
      rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
      style: shield ? {
        left: shield.style.getPropertyValue("left"),
        top: shield.style.getPropertyValue("top"),
        width: shield.style.getPropertyValue("width"),
        height: shield.style.getPropertyValue("height"),
        pointerEvents: getComputedStyle(shield).pointerEvents,
        zIndex: getComputedStyle(shield).zIndex,
      } : null,
      visualViewport: viewport ? {
        offsetLeft: viewport.offsetLeft,
        offsetTop: viewport.offsetTop,
        pageLeft: viewport.pageLeft,
        pageTop: viewport.pageTop,
        width: viewport.width,
        height: viewport.height,
        scale: viewport.scale,
      } : null,
      inner: { width: innerWidth, height: innerHeight, devicePixelRatio },
    };
  });
  const approximately = (left, right, tolerance = 2) => Math.abs(left - right) <= tolerance;

  let browserEnvironment = null;
  let fatalError = null;
  try {
    const firstReady = await gotoFresh("production");
    browserEnvironment = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      viewport: { width: innerWidth, height: innerHeight },
      visualViewport: window.visualViewport ? {
        width: window.visualViewport.width,
        height: window.visualViewport.height,
        scale: window.visualViewport.scale,
      } : null,
      devicePixelRatio,
      maxTouchPoints: navigator.maxTouchPoints,
    }));
    const browser = page.context().browser();
    browserEnvironment.browserType = browser?.browserType().name() ?? null;
    browserEnvironment.browserVersion = browser?.version() ?? null;

    const selectors = {
      inclusionSelectors: [".meaningful"],
      exclusionSelectors: [],
    };
    const applyReply = await dispatch("applySilentSelectors", { selectors });
    await waitForShield(true);
    await waitForDurableStatus("active", "silent");

    await check("silent-production-active", async () => {
      const geometry = await shieldGeometry();
      const background = await backgroundSnapshot();
      assertion(applyReply?.ok === true && applyReply?.data?.ok === true, "Silent selector command failed", applyReply);
      assertion(geometry.count === 1, "Silent mode did not mount exactly one shield", geometry);
      assertion(background.durable?.status === "active", "Silent mode did not retain background posture", background);
      assertion(
        background.durable?.directive?.silentSelectors?.inclusionSelectors?.includes(".meaningful"),
        "Silent posture lost selectors",
        background,
      );
      return { command: applyReply, geometry, background };
    });

    await check("physical-hit-target", async () => {
      const blankTarget = await pointTarget({ x: 640, y: 520 });
      const clickTarget = await pointTarget({ x: 350, y: 150 });
      assertion(blankTarget.shield === "true", "Blank viewport point does not physically hit the shield", blankTarget);
      assertion(clickTarget.shield === "true", "Page control point does not physically hit the shield", clickTarget);
      return { blankTarget, clickTarget };
    });

    await page.evaluate(() => {
      const late = document.createElement("aside");
      late.id = "late-shield-popover";
      late.setAttribute("popover", "manual");
      late.style.setProperty("display", "flex", "important");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Late top-layer menu";
      button.addEventListener("click", () => { window.__p15Fixture.state.topLayerClicks += 1; });
      late.appendChild(button);
      document.body.appendChild(late);
      late.showPopover();
    });
    await page.waitForFunction(() => {
      const before = document.querySelector("#pre-shield-popover");
      const after = document.querySelector("#late-shield-popover");
      const shadow = document.querySelector("#shadow-host")?.shadowRoot?.querySelector("#shadow-popover");
      return Boolean(
        before && after && shadow &&
        before.hasAttribute("inert") && after.hasAttribute("inert") && shadow.hasAttribute("inert") &&
        getComputedStyle(before).display === "none" &&
        getComputedStyle(after).display === "none" &&
        getComputedStyle(shadow).display === "none" &&
        getComputedStyle(before).pointerEvents === "none" &&
        getComputedStyle(after).pointerEvents === "none" &&
        getComputedStyle(shadow).pointerEvents === "none" &&
        document.elementFromPoint(1030, 350)?.getAttribute("data-uf-interaction-shield") === "true" &&
        document.elementFromPoint(1030, 480)?.getAttribute("data-uf-interaction-shield") === "true" &&
        document.elementFromPoint(1030, 610)?.getAttribute("data-uf-interaction-shield") === "true"
      );
    }, undefined, { timeout: 10_000 });
    await page.mouse.click(1030, 350);
    await page.mouse.click(1030, 480);
    await page.mouse.click(1030, 610);
    const topLayerBlocked = await page.evaluate(() => ({
      clicks: window.__p15Fixture.state.topLayerClicks,
      beforeHit: document.elementFromPoint(1030, 350)?.getAttribute("data-uf-interaction-shield") ?? null,
      afterHit: document.elementFromPoint(1030, 480)?.getAttribute("data-uf-interaction-shield") ?? null,
      shadowHit: document.elementFromPoint(1030, 610)?.getAttribute("data-uf-interaction-shield") ?? null,
      beforeDisplay: getComputedStyle(document.querySelector("#pre-shield-popover")).display,
      afterDisplay: getComputedStyle(document.querySelector("#late-shield-popover")).display,
      shadowDisplay: getComputedStyle(document.querySelector("#shadow-host").shadowRoot.querySelector("#shadow-popover")).display,
      beforePointerEvents: getComputedStyle(document.querySelector("#pre-shield-popover")).pointerEvents,
      afterPointerEvents: getComputedStyle(document.querySelector("#late-shield-popover")).pointerEvents,
      shadowPointerEvents: getComputedStyle(document.querySelector("#shadow-host").shadowRoot.querySelector("#shadow-popover")).pointerEvents,
      beforeInert: document.querySelector("#pre-shield-popover")?.hasAttribute("inert") ?? false,
      afterInert: document.querySelector("#late-shield-popover")?.hasAttribute("inert") ?? false,
      shadowInert: document.querySelector("#shadow-host")?.shadowRoot?.querySelector("#shadow-popover")?.hasAttribute("inert") ?? false,
    }));
    await page.evaluate(() => {
      document.querySelector("#pre-shield-popover")?.hidePopover();
      document.querySelector("#late-shield-popover")?.hidePopover();
      document.querySelector("#shadow-host")?.shadowRoot?.querySelector("#shadow-popover")?.hidePopover();
    });
    await page.waitForFunction(() => {
      const before = document.querySelector("#pre-shield-popover");
      const after = document.querySelector("#late-shield-popover");
      const shadow = document.querySelector("#shadow-host")?.shadowRoot?.querySelector("#shadow-popover");
      return before?.style.getPropertyValue("pointer-events") === "auto" &&
        before.style.getPropertyPriority("pointer-events") === "important" &&
        before.style.getPropertyValue("display") === "grid" &&
        before.style.getPropertyPriority("display") === "important" &&
        after?.style.getPropertyValue("pointer-events") === "" &&
        after?.style.getPropertyValue("display") === "flex" &&
        after?.style.getPropertyPriority("display") === "important" &&
        shadow?.style.getPropertyValue("pointer-events") === "auto" &&
        shadow?.style.getPropertyPriority("pointer-events") === "important" &&
        shadow?.style.getPropertyValue("display") === "grid" &&
        shadow?.style.getPropertyPriority("display") === "important" &&
        !before.hasAttribute("inert") && !after?.hasAttribute("inert") && !shadow?.hasAttribute("inert");
    }, undefined, { timeout: 10_000 });
    await check("page-top-layer-surfaces-neutralized", async () => {
      assertion(topLayerBlocked.clicks === 0, "A page-owned top-layer control received input", topLayerBlocked);
      assertion(topLayerBlocked.beforeHit === "true" && topLayerBlocked.afterHit === "true" && topLayerBlocked.shadowHit === "true", "A page top layer remained the physical hit target", topLayerBlocked);
      assertion(topLayerBlocked.beforeDisplay === "none" && topLayerBlocked.afterDisplay === "none" && topLayerBlocked.shadowDisplay === "none", "Page top-layer paint or backdrop was not neutralized", topLayerBlocked);
      assertion(topLayerBlocked.beforePointerEvents === "none" && topLayerBlocked.afterPointerEvents === "none" && topLayerBlocked.shadowPointerEvents === "none", "Page top-layer pointer targeting was not neutralized", topLayerBlocked);
      assertion(topLayerBlocked.beforeInert && topLayerBlocked.afterInert && topLayerBlocked.shadowInert, "Page top-layer descendants were not made inert", topLayerBlocked);
      const restored = await page.evaluate(() => ({
        beforeValue: document.querySelector("#pre-shield-popover")?.style.getPropertyValue("pointer-events"),
        beforePriority: document.querySelector("#pre-shield-popover")?.style.getPropertyPriority("pointer-events"),
        beforeDisplay: document.querySelector("#pre-shield-popover")?.style.getPropertyValue("display"),
        afterValue: document.querySelector("#late-shield-popover")?.style.getPropertyValue("pointer-events"),
        afterDisplay: document.querySelector("#late-shield-popover")?.style.getPropertyValue("display"),
        shadowValue: document.querySelector("#shadow-host")?.shadowRoot?.querySelector("#shadow-popover")?.style.getPropertyValue("pointer-events"),
        shadowDisplay: document.querySelector("#shadow-host")?.shadowRoot?.querySelector("#shadow-popover")?.style.getPropertyValue("display"),
        beforeInert: document.querySelector("#pre-shield-popover")?.hasAttribute("inert") ?? false,
        afterInert: document.querySelector("#late-shield-popover")?.hasAttribute("inert") ?? false,
        shadowInert: document.querySelector("#shadow-host")?.shadowRoot?.querySelector("#shadow-popover")?.hasAttribute("inert") ?? false,
      }));
      assertion(restored.beforeValue === "auto" && restored.beforePriority === "important" && restored.beforeDisplay === "grid" && restored.afterValue === "" && restored.afterDisplay === "flex" && restored.shadowValue === "auto" && restored.shadowDisplay === "grid" && !restored.beforeInert && !restored.afterInert && !restored.shadowInert, "Authored top-layer interaction state was not restored", restored);
      return { blocked: topLayerBlocked, restored };
    });

    await page.evaluate(() => {
      const shield = document.querySelector('[data-uf-interaction-shield="true"]');
      shield?.style.setProperty("max-width", "1px", "important");
      shield?.style.setProperty("max-height", "1px", "important");
      shield?.style.setProperty("transform", "scale(0)", "important");
      shield?.style.setProperty("clip-path", "inset(100%)", "important");
      shield?.style.setProperty("filter", "opacity(0)", "important");
    });
    await page.waitForFunction(() => {
      const shield = document.querySelector('[data-uf-interaction-shield="true"]');
      const rect = shield?.getBoundingClientRect();
      const style = shield ? getComputedStyle(shield) : null;
      return Boolean(
        shield && rect && style &&
        rect.width >= innerWidth - 2 && rect.height >= innerHeight - 2 &&
        style.maxWidth === "none" && style.maxHeight === "none" &&
        style.transform === "none" && style.clipPath === "none" && style.filter === "none"
      );
    }, undefined, { timeout: 10_000 });
    await check("shield-style-tamper-reasserted", async () => {
      const evidence = await page.evaluate(() => {
        const shield = document.querySelector('[data-uf-interaction-shield="true"]');
        const rect = shield?.getBoundingClientRect();
        const style = shield ? getComputedStyle(shield) : null;
        const target = document.elementFromPoint(640, 520);
        return {
          rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
          style: style ? {
            maxWidth: style.maxWidth,
            maxHeight: style.maxHeight,
            transform: style.transform,
            clipPath: style.clipPath,
            filter: style.filter,
            pointerEvents: style.pointerEvents,
          } : null,
          hitShield: target?.getAttribute?.("data-uf-interaction-shield") ?? null,
        };
      });
      assertion(evidence.rect?.width >= 1278 && evidence.rect?.height >= 898, "Tampered shield did not recover full viewport geometry", evidence);
      assertion(evidence.style?.maxWidth === "none" && evidence.style?.maxHeight === "none" && evidence.style?.transform === "none" && evidence.style?.clipPath === "none" && evidence.style?.filter === "none", "Tampered shield retained hostile clipping/transforms", evidence);
      assertion(evidence.hitShield === "true", "Tampered shield did not recover the physical hit target", evidence);
      return evidence;
    });

    await page.mouse.move(8, 8);
    await page.mouse.move(110, 150);
    await sleep(80);
    await page.mouse.click(350, 150);
    await page.mouse.click(590, 150);
    await sleep(80);
    await check("page-hover-click-navigation-blocked", async () => {
      const snapshot = await fixtureSnapshot();
      assertion(snapshot.hoverEvents === 0, "Underlying JS hover listeners fired", snapshot);
      assertion(snapshot.hoverMatches === false && snapshot.hoverMenuDisplay === "none", "Underlying CSS hover state activated", snapshot);
      assertion(snapshot.pageClicks === 0, "Underlying page click handler fired", snapshot);
      assertion(snapshot.pageNavigations === 0, "Underlying navigation handler fired", snapshot);
      assertion(snapshot.href === fixtureUrl("production"), "Underlying link navigated away", snapshot);
      assertion(snapshot.documentClickEvents === 0, "Page-global click listener received shield input", snapshot);
      return snapshot;
    });

    await page.mouse.click(830, 150);
    await check("composed-shadow-target-blocked", async () => {
      const snapshot = await fixtureSnapshot();
      const target = await pointTarget({ x: 830, y: 150 });
      assertion(snapshot.shadowClicks === 0, "Composed shadow click reached the page target", snapshot);
      assertion(target.shield === "true", "Shadow target point did not physically hit the shield", target);
      return { snapshot, target };
    });

    const beforeSpoof = await fixtureSnapshot();
    await page.mouse.click(1080, 150);
    await check("page-spoof-extension-marker-blocked", async () => {
      const snapshot = await fixtureSnapshot();
      const target = await pointTarget({ x: 1080, y: 150 });
      assertion(snapshot.spoofClicks === beforeSpoof.spoofClicks, "Page-forged extension marker received its click", { beforeSpoof, snapshot });
      assertion(snapshot.documentClickEvents === beforeSpoof.documentClickEvents, "Spoof click leaked into page-global listeners", { beforeSpoof, snapshot });
      assertion(target.shield === "true" && target.spoof === null, "Forged marker rose above the physical shield", target);
      return { target, before: beforeSpoof, after: snapshot };
    });

    const baseUrlForSurface = await page.evaluate(() => location.origin);
    const lockSurfaceReply = await dispatch("lock.state.changed", {
      baseUrl: baseUrlForSurface,
      configPresent: true,
      lockRole: "passive",
      canEdit: false,
      blockedReason: "locked",
      banner: {
        visible: true,
        reason: "locked",
        editorName: "P15 fixture editor",
        actions: [{ kind: "suggest-takeover" }],
      },
    });
    await page.waitForSelector('[data-uf-content-lock-action="true"]', { state: "visible" });
    await check("extension-surface-interactive", async () => {
      const beforeFixture = await fixtureSnapshot();
      const beforeBackground = await backgroundSnapshot();
      const action = page.locator('[data-uf-content-lock-action="true"]').first();
      const box = await action.boundingBox();
      assertion(lockSurfaceReply?.ok === true && lockSurfaceReply?.data?.ok === true && box, "Real content-owned control did not render", { lockSurfaceReply, box });
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const targetBefore = await pointTarget(point);
      await page.mouse.click(point.x, point.y);
      await page.waitForFunction((count) => window.__p15Runtime.backgroundSnapshot().lockActions.length > count, beforeBackground.lockActions.length);
      const snapshot = await fixtureSnapshot();
      const background = await backgroundSnapshot();
      assertion(background.lockActions.length === beforeBackground.lockActions.length + 1, "Real extension action did not cross the content bus", { beforeBackground, background });
      assertion(snapshot.documentClickEvents === beforeFixture.documentClickEvents, "Extension click leaked into page listeners", { beforeFixture, snapshot });
      assertion(targetBefore.contentSurface === "true" && targetBefore.shield === null, "Identity-trusted content control is not physically above the shield", targetBefore);
      return { point, targetBefore, beforeFixture, afterFixture: snapshot, beforeBackground, background };
    });
    await dispatch("lock.state.changed", {
      baseUrl: baseUrlForSurface,
      configPresent: true,
      lockRole: "editor",
      canEdit: true,
      blockedReason: "editor",
      banner: { visible: false, reason: "editor" },
    });

    await page.evaluate(() => scrollTo(0, 0));
    const beforeWheel = await fixtureSnapshot();
    await page.mouse.move(640, 520);
    await page.mouse.wheel(0, 620);
    await page.waitForFunction((before) => scrollY > before + 30, Number(beforeWheel.scrollY), { timeout: 5_000 });
    await check("wheel-scroll-preserved", async () => {
      const snapshot = await fixtureSnapshot();
      assertion(snapshot.scrollY > beforeWheel.scrollY + 30, "Real wheel input did not scroll the frozen document", { beforeWheel, snapshot });
      assertion(snapshot.documentWheelEvents === beforeWheel.documentWheelEvents, "Page-global wheel listener received frozen input", { beforeWheel, snapshot });
      return { before: beforeWheel, after: snapshot };
    });

    // A physical wheel packet is compositor-owned and can continue after the
    // first positive scroll observation. Do not let that prior transaction
    // contaminate the following touch-owner proof.
    const wheelQuiet = await waitForDocumentScrollQuiet();
    await page.evaluate(() => {
      document.documentElement.style.setProperty("overflow", "hidden");
      document.body.style.setProperty("overflow", "hidden");
      scrollTo(0, 900);
      const owner = document.createElement("section");
      owner.id = "touch-nested-viewport-owner";
      Object.assign(owner.style, {
        position: "fixed",
        inset: "0",
        overflow: "auto",
        zIndex: "0",
        touchAction: "pan-x pan-y",
      });
      const content = document.createElement("div");
      content.style.cssText = "width:100%;height:3600px;background:linear-gradient(#f8fbfd,#dceaf2)";
      owner.appendChild(content);
      document.documentElement.appendChild(owner);
    });
    await page.waitForFunction(() => scrollY === 900, undefined, { timeout: 5_000 });
    const lockedDocumentQuiet = await waitForDocumentScrollQuiet(160);
    await page.waitForFunction(() =>
      document.querySelector("#touch-nested-viewport-owner") &&
      document.elementFromPoint(640, 520)?.getAttribute("data-uf-interaction-shield") === "true" &&
      getComputedStyle(document.querySelector('[data-uf-interaction-shield="true"]')).touchAction === "pinch-zoom"
    );
    const beforeTouch = await page.evaluate(({ wheelQuietEvidence, lockedDocumentQuietEvidence }) => ({
      fixture: window.__p15Runtime.fixtureSnapshot(),
      nestedScrollTop: document.querySelector("#touch-nested-viewport-owner")?.scrollTop ?? -1,
      documentScrollTop: scrollY,
      shieldTouchAction: getComputedStyle(
        document.querySelector('[data-uf-interaction-shield="true"]'),
      ).touchAction,
      wheelQuiet: wheelQuietEvidence,
      lockedDocumentQuiet: lockedDocumentQuietEvidence,
    }), { wheelQuietEvidence: wheelQuiet, lockedDocumentQuietEvidence: lockedDocumentQuiet });
    assertion(
      beforeTouch.documentScrollTop === 900 && lockedDocumentQuiet.scrollY === 900,
      "Touch scenario did not establish an exact quiet document baseline",
      beforeTouch,
    );
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 640, y: 620, radiusX: 2, radiusY: 2, force: 1, id: 1 }],
    });
    for (const y of [570, 510, 450, 390, 330]) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: 640, y, radiusX: 2, radiusY: 2, force: 1, id: 1 }],
      });
      await sleep(25);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForFunction((before) =>
      (document.querySelector("#touch-nested-viewport-owner")?.scrollTop ?? 0) > before + 30,
    Number(beforeTouch.nestedScrollTop), { timeout: 5_000 });
    await sleep(100);
    await check("touch-scroll-preserved", async () => {
      const afterTouch = await page.evaluate(() => ({
        fixture: window.__p15Runtime.fixtureSnapshot(),
        nestedScrollTop: document.querySelector("#touch-nested-viewport-owner")?.scrollTop ?? -1,
        documentScrollTop: scrollY,
      }));
      assertion(afterTouch.nestedScrollTop > beforeTouch.nestedScrollTop + 30, "Real touch gesture did not scroll the nested viewport owner", { beforeTouch, afterTouch });
      assertion(afterTouch.documentScrollTop === beforeTouch.documentScrollTop, "Locked document scroller moved instead of the nested owner", { beforeTouch, afterTouch });
      assertion(beforeTouch.shieldTouchAction === "pinch-zoom", "Shield did not reserve single-touch panning for the nested owner before gesture start", beforeTouch);
      assertion(
        afterTouch.fixture.windowCapturePointerCancels > beforeTouch.fixture.windowCapturePointerCancels ||
          afterTouch.fixture.windowCaptureTouchEvents > beforeTouch.fixture.windowCaptureTouchEvents,
        "Neither Chromium ownership transfer nor the cancelable touch fallback stream was exercised",
        { beforeTouch, afterTouch },
      );
      assertion(afterTouch.fixture.documentTouchEvents === beforeTouch.fixture.documentTouchEvents, "Page-global touch/pointer listener received frozen gesture", { beforeTouch, afterTouch });
      return { before: beforeTouch, after: afterTouch };
    });
    await page.evaluate(() => {
      document.querySelector("#touch-nested-viewport-owner")?.remove();
      document.documentElement.style.removeProperty("overflow");
      document.body.style.removeProperty("overflow");
    });

    await check("pre-extension-window-capture-order-evidenced", async () => {
      const snapshot = await fixtureSnapshot();
      assertion(snapshot.windowCaptureClicks > 0, "Adversarial pre-extension Window capture listener did not observe a physical click", snapshot);
      assertion(snapshot.windowCaptureWheels > 0, "Adversarial pre-extension Window capture listener did not observe a real wheel", snapshot);
      assertion(snapshot.windowCapturePointerEvents > 0, "Adversarial pre-extension Window capture listener did not observe pointer input", snapshot);
      assertion(snapshot.pageClicks === 0 && snapshot.pageNavigations === 0 && snapshot.shadowClicks === 0, "Window capture observation coincided with activation of an underlying page target", snapshot);
      assertion(snapshot.documentClickEvents === 0 && snapshot.documentWheelEvents === 0 && snapshot.documentTouchEvents === 0, "Shield-targeted input propagated beyond the Window capture boundary", snapshot);
      return {
        ...snapshot,
        physicalBoundary: "A page listener registered earlier on the same Window capture target observes the shield-targeted event before the later extension listener; underlying targets and later propagation remain blocked.",
      };
    });

    await page.setViewportSize({ width: 930, height: 640 });
    await page.waitForFunction(() => {
      const shield = document.querySelector('[data-uf-interaction-shield="true"]');
      const viewport = window.visualViewport;
      if (!shield || !viewport) return false;
      const rect = shield.getBoundingClientRect();
      return Math.abs(rect.width - viewport.width) <= 2 && Math.abs(rect.height - viewport.height) <= 2;
    });
    const resizedGeometry = await shieldGeometry();
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1.25 });
    await sleep(200);
    const scaledGeometry = await shieldGeometry();
    await check("viewport-and-visual-viewport-tracked", async () => {
      for (const [label, geometry] of [["resized", resizedGeometry], ["scaled", scaledGeometry]]) {
        assertion(Boolean(geometry.rect && geometry.visualViewport), `${label} visual viewport evidence missing`, geometry);
        assertion(approximately(geometry.rect.left, geometry.visualViewport.offsetLeft), `${label} shield left does not track visualViewport.offsetLeft`, geometry);
        assertion(approximately(geometry.rect.top, geometry.visualViewport.offsetTop), `${label} shield top does not track visualViewport.offsetTop`, geometry);
        assertion(approximately(geometry.rect.width, geometry.visualViewport.width), `${label} shield width does not track visualViewport.width`, geometry);
        assertion(approximately(geometry.rect.height, geometry.visualViewport.height), `${label} shield height does not track visualViewport.height`, geometry);
      }
      const snapshot = await fixtureSnapshot();
      assertion(snapshot.visualViewportResizeEvents > 0, "Fixture observed no real visualViewport resize", snapshot);
      return { resizedGeometry, scaledGeometry, fixture: snapshot };
    });
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => scrollTo(0, 0));

    await page.evaluate(() => {
      const hostile = document.createElement("button");
      hostile.id = "p15-hostile-max-z";
      hostile.textContent = "Hostile late page layer";
      hostile.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:auto";
      hostile.addEventListener("click", () => { window.__p15Fixture.state.pageClicks += 1000; });
      document.documentElement.appendChild(hostile);
    });
    await page.waitForFunction(() => {
      const shield = document.querySelector('[data-uf-interaction-shield="true"]');
      const hostile = document.querySelector("#p15-hostile-max-z");
      return Boolean(shield && hostile && hostile.compareDocumentPosition(shield) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    await check("late-max-z-layer-reasserted", async () => {
      const evidence = await page.evaluate(() => {
        const children = [...document.documentElement.children];
        const shield = document.querySelector('[data-uf-interaction-shield="true"]');
        const hostile = document.querySelector("#p15-hostile-max-z");
        const trustedSurfaces = children.filter((element) =>
          element.getAttribute("data-uf-content-surface-root") === "true" || element.classList.contains("uf-marking-layer-root")
        );
        const spoof = document.querySelector("[data-uf-fixture-spoof-surface]");
        return {
          hostileIndex: children.indexOf(hostile),
          shieldIndex: children.indexOf(shield),
          trustedSurfaceIndices: trustedSurfaces.map((surface) => children.indexOf(surface)),
          spoofIndex: children.indexOf(spoof),
          hit: (() => {
            const target = document.elementFromPoint(640, 520);
            return { id: target?.id ?? "", shield: target?.getAttribute?.("data-uf-interaction-shield") ?? null };
          })(),
        };
      });
      assertion(evidence.hostileIndex < evidence.shieldIndex, "Late max-z sibling remained above the shield", evidence);
      assertion(evidence.trustedSurfaceIndices.length >= 1 && evidence.trustedSurfaceIndices.every((index) => index > evidence.shieldIndex), "Identity-trusted extension surfaces were not ordered above the shield", evidence);
      assertion(evidence.spoofIndex < evidence.shieldIndex, "Page-forged marker was privileged during layer reassertion", evidence);
      assertion(evidence.hit.shield === "true", "Late max-z sibling owns the physical hit target", evidence);
      return evidence;
    });
    await page.evaluate(() => document.querySelector("#p15-hostile-max-z")?.remove());

    const removedIdentity = await page.evaluate(() => {
      const shield = document.querySelector('[data-uf-interaction-shield="true"]');
      const trustedSurface = document.querySelector(".uf-marking-layer-root");
      shield?.setAttribute("data-p15-identity", "removed-instance");
      trustedSurface?.setAttribute("data-p15-trusted-identity", "removed-trusted-instance");
      window.__p15RemovedShield = shield;
      window.__p15RemovedTrustedSurface = trustedSurface;
      shield?.remove();
      trustedSurface?.remove();
      return { shield: Boolean(shield), trustedSurface: Boolean(trustedSurface) };
    });
    await page.waitForFunction(() => Boolean(
      window.__p15RemovedShield?.isConnected && window.__p15RemovedTrustedSurface?.isConnected
    ));
    await check("removed-shield-re-adopted", async () => {
      const evidence = await page.evaluate(() => ({
        count: document.querySelectorAll('[data-uf-interaction-shield="true"]').length,
        identity: document.querySelector('[data-uf-interaction-shield="true"]')?.getAttribute("data-p15-identity") ?? null,
        trustedIdentity: document.querySelector('[data-p15-trusted-identity="removed-trusted-instance"]')?.getAttribute("data-p15-trusted-identity") ?? null,
        sameShieldNode: document.querySelector('[data-uf-interaction-shield="true"]') === window.__p15RemovedShield,
        sameTrustedNode: document.querySelector('[data-p15-trusted-identity="removed-trusted-instance"]') === window.__p15RemovedTrustedSurface,
        trustedAboveShield: Boolean(
          window.__p15RemovedShield?.compareDocumentPosition(window.__p15RemovedTrustedSurface) & Node.DOCUMENT_POSITION_FOLLOWING
        ),
        hit: document.elementFromPoint(640, 520)?.getAttribute?.("data-uf-interaction-shield") ?? null,
      }));
      assertion(removedIdentity.shield && removedIdentity.trustedSurface && evidence.count === 1, "Removed shield/trusted surface were not re-adopted exactly once", evidence);
      assertion(evidence.identity === "removed-instance" && evidence.sameShieldNode, "Controller replaced rather than re-adopted its removed shield node", evidence);
      assertion(evidence.trustedIdentity === "removed-trusted-instance" && evidence.sameTrustedNode, "Controller replaced rather than re-adopted its trusted extension surface", evidence);
      assertion(evidence.trustedAboveShield, "Re-adopted trusted surface was not restored above the shield", evidence);
      assertion(evidence.hit === "true", "Re-adopted shield did not recover physical targeting", evidence);
      return evidence;
    });

    await page.evaluate(() => window.__p15Runtime.setPageContextMode("transient-retained"));
    const durableBeforePagehide = await backgroundSnapshot();
    const pagehideEvidence = await page.evaluate(() => window.__p15Runtime.dispatchPagehide());
    await check("local-pagehide-disposes-only-local-shield", async () => {
      assertion(pagehideEvidence.shieldPresent === false, "pagehide did not synchronously dispose the local shield", pagehideEvidence);
      assertion(pagehideEvidence.durable?.status === "active", "pagehide incorrectly cleared durable posture", pagehideEvidence);
      assertion(durableBeforePagehide.durable?.revision === pagehideEvidence.durable?.revision, "pagehide mutated the durable revision", { durableBeforePagehide, pagehideEvidence });
      return { before: durableBeforePagehide, after: pagehideEvidence };
    });

    await page.evaluate(() => window.__p15Runtime.setPageContextDeferred(true));
    const documentBeforeReload = firstReady.documentId;
    await page.reload({ waitUntil: "load" });
    const reloadReady = await waitForRuntime();
    await waitForShield(true);
    await page.waitForFunction(() => {
      const background = window.__p15Runtime.backgroundSnapshot();
      return background.retainedAdoptionRequests >= 1 &&
        background.pageContextRequests >= 1 &&
        background.pendingPageContextRequests >= 1 &&
        background.pageContextResponses.length === 0;
    }, undefined, { timeout: 10_000 });
    const retainedTarget = await pointTarget({ x: 350, y: 150 });
    const retainedBeforeClick = await fixtureSnapshot();
    await page.mouse.click(350, 150);
    await sleep(120);
    const retainedAfterClick = await fixtureSnapshot();
    await check("retained-adoption-precedes-deferred-page-context", async () => {
      const background = await backgroundSnapshot();
      const adoption = background.retainedAdoptionResponses.at(-1);
      assertion(reloadReady.documentId !== documentBeforeReload, "Retained-adoption reload did not create a new content document", { documentBeforeReload, reloadReady });
      assertion(background.frameNames.indexOf("shield.posture.adoptRetained") < background.frameNames.indexOf("page.context"), "page.context started before retained-posture adoption", background);
      assertion(adoption?.status === "active" && adoption?.directive?.organ?.state === "silent", "Early retained adoption did not return active silent posture", adoption);
      assertion(adoption?.scope?.documentKey === reloadReady.documentId && adoption?.scope?.pageUrl === page.url(), "Early retained adoption was not rebound to the reloaded document", { adoption, reloadReady, pageUrl: page.url() });
      assertion(background.pageContextDeferred === true && background.pendingPageContextRequests >= 1 && background.pageContextResponses.length === 0, "Ordinary page.context was not deterministically held behind early adoption", background);
      assertion(retainedTarget.shield === "true", "Retained shield was not the physical elementFromPoint target before page.context released", retainedTarget);
      assertion(retainedBeforeClick.pageClicks === 0 && retainedAfterClick.pageClicks === 0, "A real page click escaped the retained shield before page.context released", { retainedBeforeClick, retainedAfterClick, retainedTarget });
      return { documentBeforeReload, reloadReady, background, adoption, retainedTarget, retainedBeforeClick, retainedAfterClick };
    });
    const contextRelease = await page.evaluate(() => window.__p15Runtime.releasePageContext());
    await page.waitForFunction(() => {
      const background = window.__p15Runtime.backgroundSnapshot();
      return background.pendingPageContextRequests === 0 && background.pageContextResponses.length >= 1;
    }, undefined, { timeout: 10_000 });
    await check("silent-reload-re-adopts-without-popup", async () => {
      const geometry = await shieldGeometry();
      const background = await backgroundSnapshot();
      const hit = await pointTarget({ x: 640, y: 520 });
      assertion(reloadReady.documentId !== documentBeforeReload, "Reload did not create a new content document", { documentBeforeReload, reloadReady });
      assertion(background.pageContextRequests >= 1 && background.pageContextResponses.length >= 1, "Reload did not complete page.context after early adoption", background);
      assertion(background.durable?.status === "active", "Reload lost durable silent posture", background);
      assertion(geometry.count === 1 && hit.shield === "true", "Reload did not restore a physical shield", { geometry, hit });
      return { documentBeforeReload, reloadReady, geometry, background, hit, contextRelease };
    });

    await check("transient-context-reload-adopts-retained-shield", async () => {
      const background = await backgroundSnapshot();
      const response = background.pageContextResponses.at(-1);
      const hit = await pointTarget({ x: 640, y: 520 });
      assertion(response?.status === "unavailable" && response?.siteId === null && response?.draftDisposition === "preserve", "Reload did not receive the deterministic transient siteId-null page.context", response);
      assertion(response?.shieldPosture?.status === "active" && response?.shieldPosture?.directive?.organ?.state === "silent", "Transient page.context did not retain active silent posture", response);
      assertion(background.pageContextMode === "transient-retained" && hit.shield === "true", "Content did not physically adopt retained posture from transient page.context", { background, hit });
      return { response, hit, documentId: reloadReady.documentId };
    });
    await page.evaluate(() => window.__p15Runtime.setPageContextMode("managed"));

    const reloadScrollXpath = await page.evaluate(() => window.__p15Fixture.xpath("#reload-scroll-target"));
    await page.waitForFunction((xpath) => [...document.querySelectorAll("[data-uf-silent-highlight]")].some(
      (element) => element.getAttribute("data-uf-silent-highlight") === xpath && element.getBoundingClientRect().height > 0
    ), reloadScrollXpath, { timeout: 10_000 });
    const reloadScrollGeometry = () => page.evaluate((xpath) => {
      const target = document.querySelector("#reload-scroll-target");
      const overlay = [...document.querySelectorAll("[data-uf-silent-highlight]")].find(
        (element) => element.getAttribute("data-uf-silent-highlight") === xpath
      );
      const targetRect = target?.getBoundingClientRect();
      const overlayRect = overlay?.getBoundingClientRect();
      return {
        scrollY,
        target: targetRect ? { left: targetRect.left, top: targetRect.top, width: targetRect.width, height: targetRect.height } : null,
        overlay: overlayRect ? { left: overlayRect.left, top: overlayRect.top, width: overlayRect.width, height: overlayRect.height } : null,
        overlayXpath: overlay?.getAttribute("data-uf-silent-highlight") ?? null,
      };
    }, reloadScrollXpath);
    const beforeReloadScroll = await reloadScrollGeometry();
    await page.mouse.move(640, 520);
    await page.mouse.wheel(0, 240);
    await page.waitForFunction((before) => scrollY > before + 30, beforeReloadScroll.scrollY, { timeout: 5_000 });
    await sleep(350);
    await check("reload-scroll-highlight-repositions", async () => {
      const afterReloadScroll = await reloadScrollGeometry();
      assertion(Boolean(beforeReloadScroll.target && beforeReloadScroll.overlay && afterReloadScroll.target && afterReloadScroll.overlay), "Reload scroll geometry evidence is incomplete", { beforeReloadScroll, afterReloadScroll });
      assertion(afterReloadScroll.scrollY > beforeReloadScroll.scrollY + 30, "Real wheel did not move the reload-adopted document", { beforeReloadScroll, afterReloadScroll });
      assertion(Math.abs(afterReloadScroll.overlay.left - afterReloadScroll.target.left) <= 2, "Reload-adopted overlay left drifted after real scroll", { beforeReloadScroll, afterReloadScroll });
      assertion(Math.abs(afterReloadScroll.overlay.top - afterReloadScroll.target.top) <= 2, "Reload-adopted overlay top did not reposition after real scroll", { beforeReloadScroll, afterReloadScroll });
      assertion(Math.abs(afterReloadScroll.overlay.width - afterReloadScroll.target.width) <= 2, "Reload-adopted overlay width drifted after real scroll", { beforeReloadScroll, afterReloadScroll });
      assertion(Math.abs(afterReloadScroll.overlay.top - beforeReloadScroll.overlay.top) > 30, "Overlay geometry remained frozen across the real scroll", { beforeReloadScroll, afterReloadScroll });
      return { xpath: reloadScrollXpath, before: beforeReloadScroll, after: afterReloadScroll };
    });

    await check("production-debug-copy-absent", async () => {
      const count = await page.locator('[data-uf-silent-copy="true"]').count();
      assertion(count === 0, "Production bundle exposed debug copy targets", { count });
      return { count };
    });

    const clearReply = await dispatch("clearSilentSelectors", { pageUrl: page.url() });
    await waitForShield(false);
    await waitForDurableStatus("inactive");
    await check("silent-terminal-clear-removes-durable-posture", async () => {
      const beforeClick = await fixtureSnapshot();
      await page.mouse.click(350, 150);
      const afterClick = await fixtureSnapshot();
      const background = await backgroundSnapshot();
      assertion(clearReply?.ok === true && clearReply?.data?.ok === true, "Silent clear command failed", clearReply);
      assertion(background.durable?.status === "inactive", "Silent clear retained durable posture", background);
      assertion(afterClick.pageClicks === beforeClick.pageClicks + 1, "Page input remained blocked after terminal clear", { beforeClick, afterClick });
      await page.reload({ waitUntil: "load" });
      await waitForRuntime();
      await sleep(100);
      const shieldPresentAfterReload = await page.locator('[data-uf-interaction-shield="true"]').count();
      assertion(shieldPresentAfterReload === 0, "Terminal clear re-adopted after reload", { shieldPresentAfterReload, background });
      return { clearReply, background, beforeClick, afterClick, shieldPresentAfterReload };
    });
    scenarioEvidence.silent = await backgroundSnapshot();

    await gotoFresh("debug");
    const debugApply = await dispatch("applySilentSelectors", { selectors });
    await waitForShield(true);
    await page.waitForFunction(() => {
      return [...document.querySelectorAll('[data-uf-silent-copy="true"]')].some((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 4 && rect.height > 4 && rect.bottom > 0 && rect.top < innerHeight;
      });
    }, undefined, { timeout: 10_000 });
    await check("debug-copy-remains-interactive", async () => {
      const debugTarget = await page.evaluate(() => {
        const element = [...document.querySelectorAll('[data-uf-silent-copy="true"]')].find((candidate) => {
          const rect = candidate.getBoundingClientRect();
          return rect.width > 4 && rect.height > 4 && rect.bottom > 0 && rect.top < innerHeight;
        });
        const rect = element?.getBoundingClientRect();
        return rect ? {
          x: Math.max(1, Math.min(innerWidth - 1, rect.left + Math.min(rect.width / 2, 10))),
          y: Math.max(1, Math.min(innerHeight - 1, rect.top + Math.min(rect.height / 2, 10))),
        } : null;
      });
      assertion(debugApply?.ok === true && debugTarget, "Debug silent mode did not expose a visible copy target", { debugApply, debugTarget });
      const before = await fixtureSnapshot();
      const targetBeforeClick = await pointTarget(debugTarget);
      await page.mouse.click(debugTarget.x, debugTarget.y);
      await sleep(120);
      const after = await fixtureSnapshot();
      const debugDom = await page.evaluate(({ x, y }) => {
        const target = document.elementFromPoint(x, y);
        return {
          targetHtml: target?.outerHTML ?? "",
          silentXpath: target?.getAttribute?.("data-uf-silent-highlight") ?? null,
          toast: document.querySelector('[data-uf-content-toast="true"]')?.textContent ?? null,
        };
      }, debugTarget);
      assertion(targetBeforeClick.debugCopy === "true", "Debug copy box was not the physical hit target", targetBeforeClick);
      assertion(after.clipboardWrites.length > before.clipboardWrites.length || debugDom.toast, "Debug interaction neither copied nor produced its extension toast", { before, after, debugDom, targetBeforeClick });
      assertion(after.documentClickEvents === before.documentClickEvents, "Debug copy click leaked into page listeners", { before, after });
      return { debugTarget, targetBeforeClick, debugDom, before, after };
    });
    await dispatch("clearSilentSelectors", { pageUrl: page.url() });
    await waitForShield(false);

    await gotoFresh("production");
    const baseUrl = await page.evaluate(() => location.origin);
    const pageUrl = page.url();
    const lockReply = await dispatch("lock.state.changed", {
      baseUrl,
      configPresent: true,
      lockRole: "editor",
      canEdit: true,
      blockedReason: "editor",
      banner: { visible: false, reason: "editor" },
    });
    const activationReply = await dispatch("activateContentMain", {
      baseUrl,
      pageUrl,
      realEditorActivation: true,
      selectors,
    });
    await page.waitForFunction(
      () => window.__p15Runtime.fixtureSnapshot().pageWorldCommandCount >= 1,
      undefined,
      { timeout: 5_000 },
    );
    await page.waitForFunction(() => {
      const curtain = document.querySelector('[data-uf-content-curtain-copy="true"]');
      return curtain?.textContent !== "Inspecting page... it will be ready soon";
    }, undefined, { timeout: 25_000, polling: 100 });
    await page.evaluate(() => window.__p15Runtime.queueSignals([
      { name: "marking.enabled", payload: { pageUrl: location.href } },
      { name: "run.started", payload: { sessionId: "p15-run" } },
      { name: "run.completed", payload: { sessionId: "p15-run" } },
      { name: "preview.opened", payload: { origin: "post_ai" } },
    ]));
    await page.waitForFunction(async () => {
      const reply = await window.__p15Runtime.dispatch("getContentMainStatus", {});
      return reply?.ok === true && reply?.data?.sessionState?.name === "preview_open";
    }, undefined, { timeout: 10_000, polling: 100 });
    await waitForShield(true);
    await waitForDurableStatus("active", "preview");
    await check("post-ai-preview-active", async () => {
      await sleep(120);
      const status = await dispatch("getContentMainStatus");
      const background = await backgroundSnapshot();
      const hit = await pointTarget({ x: 640, y: 520 });
      const contentSurface = await page.evaluate(() => {
        const root = document.querySelector('[data-uf-content-surface-root="true"]');
        return {
          inlinePointerEvents: root?.style.pointerEvents ?? null,
          computedPointerEvents: root ? getComputedStyle(root).pointerEvents : null,
          curtainCount: root?.querySelectorAll('[data-uf-content-curtain="true"]').length ?? 0,
          curtainText: root?.querySelector('[data-uf-content-curtain-copy="true"]')?.textContent ?? null,
          childHtml: root?.innerHTML ?? null,
        };
      });
      assertion(lockReply?.ok === true && activationReply?.ok === true, "Post-AI setup commands failed", { lockReply, activationReply });
      assertion(status?.data?.sessionState?.name === "preview_open", "Content organ did not reach post-AI preview", status);
      assertion(hit.shield === "true", "Post-AI preview lacks a physical shield target", { hit, contentSurface, status });
      assertion(background.durable?.directive?.organ?.state === "preview", "Post-AI preview posture was not retained", background);
      return { lockReply, activationReply, status, background, hit, contentSurface };
    });

    await check("shield-artifact-excluded-from-evaluation", async () => {
      const sentinel = await page.evaluate(() => {
        const shield = document.querySelector('[data-uf-interaction-shield="true"]');
        shield?.setAttribute("id", "p15-shield-evaluation-sentinel");
        shield?.setAttribute("data-p15-capture-sentinel", "must-not-serialize");
        return {
          shieldXpath: window.__p15Fixture.xpath("#p15-shield-evaluation-sentinel"),
          marker: shield?.getAttribute("data-uf-extension-ui") ?? null,
        };
      });
      const status = await dispatch("getContentMainStatus");
      const capture = await dispatch("captureSubmissionSnapshot", {
        baseUrl,
        pageUrl,
        renderMode: "rendered",
      });
      const pageCapture = capture?.data?.snapshot?.pages?.[0];
      const renderedRows = pageCapture?.renderedXPaths ?? [];
      const contentRows = status?.data?.contentRows ?? [];
      assertion(sentinel.marker === "true", "Owned shield lacks its extension-artifact marker", sentinel);
      assertion(capture?.ok === true && capture?.data?.ok === true && pageCapture, "Active content engine could not capture submission evidence", capture);
      assertion(!contentRows.some((row) => row.xpath === sentinel.shieldXpath), "Shield leaked into canonical content rows", { sentinel, contentRows });
      assertion(!renderedRows.some((row) => row.xpath === sentinel.shieldXpath), "Shield leaked into evaluated submission rows", { sentinel, renderedRows });
      assertion(!pageCapture.renderedHtml.includes("p15-shield-evaluation-sentinel"), "Shield leaked into flattened submission HTML", { sentinel, renderedHtmlTail: pageCapture.renderedHtml.slice(-800) });
      assertion(!pageCapture.renderedHtml.includes("data-uf-interaction-shield"), "Shield artifact attribute leaked into submission HTML", { sentinel, renderedHtmlTail: pageCapture.renderedHtml.slice(-800) });
      return {
        sentinel,
        contentRowCount: contentRows.length,
        renderedRowCount: renderedRows.length,
        renderedHtmlBytes: pageCapture.renderedHtml.length,
      };
    });

    await check("preview-row-commands-remain-interactive", async () => {
      const xpath = await page.evaluate(() => window.__p15Fixture.xpath("#preview-target"));
      const emphasize = await dispatch("emphasizePreviewRow", { xpath });
      const activate = await dispatch("activatePreviewRow", { xpath });
      const beforeSpoofClick = await fixtureSnapshot();
      const target = await pointTarget({ x: 1080, y: 150 });
      await page.mouse.click(1080, 150);
      const afterSpoofClick = await fixtureSnapshot();
      assertion(emphasize?.ok === true && emphasize?.data?.targeted === true, "Preview emphasize command could not reach the real overlay", { xpath, emphasize });
      assertion(activate?.ok === true && activate?.data?.targeted === true, "Preview activation command could not reach the real overlay", { xpath, activate });
      assertion(target.shield === "true" && afterSpoofClick.spoofClicks === beforeSpoofClick.spoofClicks, "Post-AI shield privileged the forged extension marker", { target, beforeSpoofClick, afterSpoofClick });
      assertion(afterSpoofClick.documentClickEvents === beforeSpoofClick.documentClickEvents, "Post-AI spoof click leaked into page listeners", { beforeSpoofClick, afterSpoofClick });
      return { xpath, emphasize, activate, target, beforeSpoofClick, afterSpoofClick };
    });

    await page.evaluate(() => window.__p15Runtime.queueSignals([
      { name: "preview.exit.requested", payload: {} },
      { name: "preview.exited", payload: { restored: true } },
    ]));
    await page.waitForFunction(async () => {
      const reply = await window.__p15Runtime.dispatch("getContentMainStatus", {});
      return reply?.ok === true && reply?.data?.sessionState?.name === "post_ai_clean";
    }, undefined, { timeout: 10_000, polling: 100 });
    await waitForShield(false);
    await waitForDurableStatus("inactive");
    await check("preview-terminal-exit-removes-shield", async () => {
      const status = await dispatch("getContentMainStatus");
      const background = await backgroundSnapshot();
      const shieldCount = await page.locator('[data-uf-interaction-shield="true"]').count();
      await dispatch("deactivateContentMain");
      await page.evaluate(() => scrollTo(0, 0));
      const beforeClick = await fixtureSnapshot();
      const target = await pointTarget({ x: 350, y: 150 });
      await page.mouse.click(350, 150);
      const afterClick = await fixtureSnapshot();
      assertion(status?.data?.sessionState?.name === "post_ai_clean", "Preview did not restore its prior organ state", status);
      assertion(shieldCount === 0, "Preview exit retained a local shield", { shieldCount, status });
      assertion(background.durable?.status === "inactive", "Preview exit retained durable document posture", background);
      assertion(target.id === "page-button", "Terminal deactivation did not restore the page button as physical hit target", target);
      assertion(afterClick.pageClicks === beforeClick.pageClicks + 1, "Terminal deactivation left page input blocked", { target, beforeClick, afterClick });
      return { status, background, shieldCount, target, beforeClick, afterClick };
    });
    scenarioEvidence.preview = await backgroundSnapshot();

    const configureEditor = async () => {
      const scenarioBaseUrl = await page.evaluate(() => location.origin);
      const reply = await dispatch("lock.state.changed", {
        baseUrl: scenarioBaseUrl,
        configPresent: true,
        lockRole: "editor",
        canEdit: true,
        blockedReason: "editor",
        banner: { visible: false, reason: "editor" },
      });
      assertion(reply?.ok === true && reply?.data?.ok === true, "Unable to configure editor authority for terminal scenario", reply);
      return scenarioBaseUrl;
    };
    const activateMarking = async () => {
      const scenarioBaseUrl = await configureEditor();
      const scenarioPageUrl = page.url();
      const reply = await dispatch("activateContentMain", {
        baseUrl: scenarioBaseUrl,
        pageUrl: scenarioPageUrl,
        realEditorActivation: true,
        selectors,
      });
      assertion(reply?.ok === true && reply?.data?.ok === true, "Unable to activate marking for terminal scenario", reply);
      return { scenarioBaseUrl, scenarioPageUrl, reply };
    };
    const queueAndWait = async (signals, state) => {
      await page.evaluate((queued) => window.__p15Runtime.queueSignals(queued), signals);
      await waitForContentState(state);
      return dispatch("getContentMainStatus");
    };
    const simulateBackgroundTerminal = (reason) => page.evaluate(
      (terminalReason) => window.__p15Runtime.simulateBackgroundTerminal(terminalReason),
      reason,
    );
    const dispatchBackgroundCommand = (name, payload) => page.evaluate(
      ({ commandName, commandPayload }) => window.__p15Runtime.dispatchBackgroundCommand(commandName, commandPayload),
      { commandName: name, commandPayload: payload },
    );

    await gotoFresh("production");
    const saveActivation = await activateMarking();
    await queueAndWait([
      { name: "marking.enabled", payload: { pageUrl: page.url() } },
      { name: "run.started", payload: { sessionId: "p15-save-run" } },
      { name: "run.completed", payload: { sessionId: "p15-save-run" } },
      { name: "reconciliation.started", payload: { reason: "saving" } },
    ], "reconciling");
    await waitForShield(true);
    await waitForDurableStatus("active", "blocked-organ");
    const saveBefore = await backgroundSnapshot();
    const saveBoundary = await simulateBackgroundTerminal("save");
    const saveEnterSilent = await dispatch("enterSilentContentMain");
    const saveStatus = await queueAndWait([
      { name: "session.saved", payload: { savedSeq: 1 } },
    ], "silent");
    const saveClear = await dispatch("clearSilentSelectors", { pageUrl: page.url() });
    await waitForShield(false);
    await waitForDurableStatus("inactive");
    await check("save-terminal-path", async () => {
      const background = await backgroundSnapshot();
      const saveRecords = background.terminalBoundaries.filter((entry) => entry.reason === "save");
      assertion(saveBoundary?.posture?.status === "inactive", "Save boundary did not fully clear durable posture", saveBoundary);
      assertion(saveEnterSilent?.ok === true && saveEnterSilent?.data?.ok === true && saveClear?.ok === true && saveClear?.data?.ok === true, "Save terminal content sequence failed", { saveEnterSilent, saveClear });
      assertion(saveStatus?.data?.sessionState?.name === "silent", "Save terminal did not reach silent state", saveStatus);
      assertion(saveRecords.some((entry) => entry.source === "background-boundary-simulation"), "Save background boundary was not recorded", background);
      assertion(background.durable?.status === "inactive" && await page.locator('[data-uf-interaction-shield="true"]').count() === 0, "Save terminal retained shield authority", background);
      return { activation: saveActivation, before: saveBefore, boundary: saveBoundary, enterSilent: saveEnterSilent, status: saveStatus, clear: saveClear, after: background };
    });

    const discardActivation = await activateMarking();
    await queueAndWait([
      { name: "marking.enabled", payload: { pageUrl: page.url() } },
      { name: "run.started", payload: { sessionId: "p15-discard-run" } },
    ], "running");
    await waitForShield(true);
    await waitForDurableStatus("active", "blocked-organ");
    const discardBefore = await backgroundSnapshot();
    const discardReset = await dispatch("resetContentMain");
    const discardBoundary = await simulateBackgroundTerminal("discard");
    const discardStatus = await queueAndWait([
      { name: "session.discarded", payload: { discardedSeq: 1 } },
    ], "pre_ai_clean");
    await waitForShield(false);
    await waitForDurableStatus("inactive");
    await check("discard-terminal-path", async () => {
      const background = await backgroundSnapshot();
      const discardRecords = background.terminalBoundaries.filter((entry) => entry.reason === "discard");
      assertion(discardReset?.ok === true && discardReset?.data?.ok === true, "Discard terminal reset failed", discardReset);
      assertion(discardBoundary?.posture?.status === "inactive", "Discard boundary did not fully clear durable posture", discardBoundary);
      assertion(discardStatus?.data?.sessionState?.name === "pre_ai_clean", "Discard terminal did not restore clean marking state", discardStatus);
      assertion(discardRecords.some((entry) => entry.source === "background-boundary-simulation"), "Discard background boundary was not recorded", background);
      assertion(background.durable?.status === "inactive" && await page.locator('[data-uf-interaction-shield="true"]').count() === 0, "Discard terminal retained shield authority", background);
      return { activation: discardActivation, before: discardBefore, reset: discardReset, boundary: discardBoundary, status: discardStatus, after: background };
    });

    await queueAndWait([
      { name: "run.started", payload: { sessionId: "p15-navigation-run" } },
    ], "running");
    await waitForShield(true);
    await waitForDurableStatus("active", "blocked-organ");
    const navigationBefore = await backgroundSnapshot();
    const navigationFrom = page.url();
    await page.evaluate(async () => {
      history.pushState({ p15: true }, "", "/fixture-routed?variant=production");
      await window.__p15Runtime.notifyPageUrlChanged(location.href);
      window.__p15Runtime.queueSignals([{ name: "session.navigated", payload: { pageUrl: location.href } }]);
    });
    await waitForContentState("silent");
    await waitForShield(false);
    await waitForDurableStatus("inactive");
    await check("same-document-navigation-terminal-path", async () => {
      const status = await dispatch("getContentMainStatus");
      const background = await backgroundSnapshot();
      const navigationRecords = background.terminalBoundaries.filter((entry) => entry.reason === "navigation");
      assertion(page.url() !== navigationFrom && page.url().startsWith(origin) && navigationFrom.startsWith(origin), "Navigation terminal was not a same-document same-origin route", { navigationFrom, navigationTo: page.url(), origin });
      assertion(background.pageContextRequests > navigationBefore.pageContextRequests, "Same-document route did not re-probe page.context", { navigationBefore, background });
      assertion(navigationRecords.some((entry) => entry.source === "content-request"), "Content did not issue the navigation posture clear", background);
      assertion(status?.data?.sessionState?.name === "silent" && background.durable?.status === "inactive", "Navigation terminal retained active state", { status, background });
      return { from: navigationFrom, to: page.url(), before: navigationBefore, status, after: background };
    });

    const failureActivation = await activateMarking();
    await queueAndWait([
      { name: "marking.enabled", payload: { pageUrl: page.url() } },
      { name: "run.started", payload: { sessionId: "p15-failure-run" } },
    ], "running");
    await waitForShield(true);
    await waitForDurableStatus("active", "blocked-organ");
    const failureBefore = await backgroundSnapshot();
    const failureStatus = await queueAndWait([
      { name: "run.failed", payload: { sessionId: "p15-failure-run", error: "deterministic-p15-failure" } },
    ], "pre_ai_clean");
    await waitForShield(false);
    await waitForDurableStatus("inactive");
    await check("failure-terminal-path", async () => {
      const background = await backgroundSnapshot();
      const failureRecords = background.terminalBoundaries.filter((entry) => entry.reason === "failure");
      assertion(failureStatus?.data?.sessionState?.name === "pre_ai_clean", "Failure terminal did not restore its prior state", failureStatus);
      assertion(failureRecords.some((entry) => entry.source === "content-request"), "Content did not issue the failure posture clear", background);
      assertion(background.durable?.status === "inactive" && await page.locator('[data-uf-interaction-shield="true"]').count() === 0, "Failure terminal retained shield authority", background);
      return { activation: failureActivation, before: failureBefore, status: failureStatus, after: background };
    });

    await dispatch("deactivateContentMain");
    const unregisterApply = await dispatch("applySilentSelectors", { selectors });
    await waitForShield(true);
    await waitForDurableStatus("active", "silent");
    const unregisterBefore = await backgroundSnapshot();
    const unregisterDeactivate = await dispatch("deactivateContentMain");
    const unregisterConsent = await dispatch("terminateConsentSuppression");
    const unregisterBoundary = await dispatchBackgroundCommand("session.unregister", { tabId: 77 });
    await waitForShield(false);
    await waitForDurableStatus("inactive");
    await check("unregister-terminal-path", async () => {
      const background = await backgroundSnapshot();
      const unregisterRecords = background.terminalBoundaries.filter((entry) => entry.reason === "unregister");
      const localArtifacts = await page.evaluate(() => ({
        shields: document.querySelectorAll('[data-uf-interaction-shield="true"]').length,
        overlayRoots: document.querySelectorAll(".uf-marking-layer-root").length,
        silentHighlights: document.querySelectorAll("[data-uf-silent-highlight]").length,
      }));
      assertion(unregisterApply?.ok === true && unregisterApply?.data?.ok === true, "Unregister scenario could not establish silent posture", unregisterApply);
      assertion(unregisterDeactivate?.ok === true && unregisterDeactivate?.data?.ok === true && unregisterConsent?.ok === true && unregisterConsent?.data?.ok === true, "Unregister content teardown failed", { unregisterDeactivate, unregisterConsent });
      assertion(unregisterBoundary?.posture?.status === "inactive" && unregisterRecords.some((entry) => entry.source === "background-boundary-simulation"), "Unregister background boundary did not clear the tab", { unregisterBoundary, background });
      assertion(background.backgroundCommands.some((entry) => entry.name === "session.unregister" && entry.payload?.tabId === 77), "Exact session.unregister background command was not recorded", background);
      assertion(background.durable?.status === "inactive" && localArtifacts.shields === 0 && localArtifacts.overlayRoots === 0 && localArtifacts.silentHighlights === 0, "Unregister retained shield/overlay artifacts before reload", { background, localArtifacts });
      return { before: unregisterBefore, deactivate: unregisterDeactivate, consent: unregisterConsent, boundary: unregisterBoundary, localArtifacts, after: background };
    });

    await gotoFresh("production");
    const propertyExitApply = await dispatch("applySilentSelectors", { selectors });
    await waitForShield(true);
    await waitForDurableStatus("active", "silent");
    const propertyExitBefore = await backgroundSnapshot();
    await page.evaluate(async () => {
      window.__p15Runtime.setPageContextMode("unmanaged");
      history.pushState({ p15: "property-exit" }, "", "/outside-property");
      await window.__p15Runtime.notifyPageUrlChanged(location.href);
    });
    await waitForShield(false);
    await waitForDurableStatus("inactive");
    await check("definitive-property-exit-terminal-path", async () => {
      const background = await backgroundSnapshot();
      const propertyExitRecords = background.terminalBoundaries.filter((entry) => entry.reason === "property-exit");
      assertion(propertyExitApply?.ok === true && propertyExitApply?.data?.ok === true, "Property-exit scenario could not establish silent posture", propertyExitApply);
      assertion(background.pageContextRequests > propertyExitBefore.pageContextRequests, "Definitive property exit did not re-probe page.context", { propertyExitBefore, background });
      assertion(propertyExitRecords.some((entry) => entry.source === "page-context"), "Definitive property exit was not recorded at page.context", background);
      assertion(background.durable?.status === "inactive" && await page.locator('[data-uf-interaction-shield="true"]').count() === 0, "Definitive property exit retained shield authority", background);
      return { before: propertyExitBefore, after: background, url: page.url() };
    });

    await gotoFresh("production");
    const invalidationApply = await dispatch("applySilentSelectors", { selectors });
    await waitForShield(true);
    await waitForDurableStatus("active", "silent");
    const invalidationBefore = await backgroundSnapshot();
    const invalidation = await page.evaluate(() => window.__p15Runtime.invalidate());
    await waitForShield(false);
    await waitForDurableStatus("inactive");
    await check("extension-invalidation-terminal-path", async () => {
      const background = await backgroundSnapshot();
      const invalidationRecords = background.terminalBoundaries.filter((entry) => entry.reason === "extension-invalidation");
      assertion(invalidationApply?.ok === true && invalidationApply?.data?.ok === true, "Invalidation scenario could not establish silent posture", invalidationApply);
      assertion(invalidation.shieldPresent === false && invalidation.durable?.status === "inactive", "Extension invalidation did not synchronously release shield authority", invalidation);
      assertion(invalidationRecords.some((entry) => entry.source === "content-request"), "Extension invalidation did not issue its terminal background clear", background);
      return { before: invalidationBefore, invalidation, after: background };
    });

    const unloadFirstReady = await gotoFresh("production");
    const unloadApply = await dispatch("applySilentSelectors", { selectors });
    await waitForShield(true);
    await waitForDurableStatus("active", "silent");
    const unloadBefore = await backgroundSnapshot();
    const unloadEvidence = await page.evaluate(() => window.__p15Runtime.dispatchUnload());
    await check("local-unload-disposes-only-local-shield", async () => {
      assertion(unloadApply?.ok === true && unloadApply?.data?.ok === true, "Unload scenario could not establish silent posture", unloadApply);
      assertion(unloadEvidence.shieldPresent === false, "Unload did not synchronously dispose the local shield", unloadEvidence);
      assertion(unloadEvidence.durable?.status === "active", "Unload incorrectly cleared durable posture", unloadEvidence);
      assertion(unloadBefore.durable?.revision === unloadEvidence.durable?.revision, "Unload mutated the durable revision", { unloadBefore, unloadEvidence });
      return { before: unloadBefore, after: unloadEvidence };
    });
    await page.reload({ waitUntil: "load" });
    const unloadReloadReady = await waitForRuntime();
    await waitForShield(true);
    await check("local-unload-reload-re-adopts", async () => {
      const background = await backgroundSnapshot();
      const hit = await pointTarget({ x: 640, y: 520 });
      assertion(unloadReloadReady.documentId !== unloadFirstReady.documentId, "Unload reload did not create a fresh document", { unloadFirstReady, unloadReloadReady });
      assertion(background.durable?.status === "active" && hit.shield === "true", "Unload reload did not re-adopt durable posture", { background, hit });
      return { unloadFirstReady, unloadReloadReady, background, hit };
    });
    scenarioEvidence.terminals = await backgroundSnapshot();

    await check("no-browser-errors", async () => {
      assertion(pageErrors.length === 0, "Uncaught browser errors occurred", pageErrors);
      assertion(consoleErrors.length === 0, "Browser console errors occurred", consoleErrors);
      return { pageErrors, consoleErrors };
    });
  } catch (error) {
    fatalError = String(error?.stack || error);
  }

  const response = await page.evaluate(async (payload) => {
    const result = await fetch("/results", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { ok: result.ok, status: result.status };
  }, { checks, pageErrors, consoleErrors, browserEnvironment, scenarioEvidence, fatalError });
  if (!response.ok) {
    throw new Error(`Unable to retain P15 browser results (HTTP ${response.status})`);
  }
  if (fatalError) {
    throw new Error(fatalError);
  }
  return { checks: checks.length, passed: checks.filter((entry) => entry.pass).length };
}
