/* eslint-disable @typescript-eslint/no-unused-expressions -- playwright-cli requires a bare function expression. */
async (page) => {
  const checks = [];
  const pageErrors = [];
  const consoleErrors = [];
  const scenarioEvidence = {};
  const initialUrl = page.url();
  const pathStart = initialUrl.indexOf("/", initialUrl.indexOf("//") + 2);
  const origin = pathStart >= 0 ? initialUrl.slice(0, pathStart) : initialUrl;
  const popupUrl = (variant) => `${origin}/popup?variant=${variant}`;
  const contentUrl = `${origin}/content?variant=production`;
  const terminalActions = [
    "candidateNavigate",
    "discard",
    "emptyCache",
    "enableChange",
    "save",
    "sendToLynx",
    "unregister",
  ];

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
      scenarioEvidence[id] = evidence ?? null;
      return evidence;
    } catch (error) {
      const failure = String(error?.stack || error);
      checks.push({ id, pass: false, error: failure });
      scenarioEvidence[id] = { error: failure };
      return null;
    }
  };
  const observePage = (target, realm) => {
    target.on("pageerror", (error) => pageErrors.push(`[${realm}] ${String(error?.stack || error)}`));
    target.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(`[${realm}] ${message.text()}`);
    });
  };
  const popupCall = (target, method, ...args) => target.evaluate(
    ({ methodName, methodArgs }) => window.__p18PopupRuntime[methodName](...methodArgs),
    { methodName: method, methodArgs: args },
  );
  const contentCall = (target, method, ...args) => target.evaluate(
    ({ methodName, methodArgs }) => window.__p18ContentRuntime[methodName](...methodArgs),
    { methodName: method, methodArgs: args },
  );
  const waitForPopup = async (target, variant) => {
    await target.waitForFunction(
      () => window.__p18PopupRuntime?.readyState() !== "booting",
      undefined,
      { timeout: 15_000 },
    );
    const ready = await target.evaluate(() => ({
      state: window.__p18PopupRuntime?.readyState(),
      error: window.__p18PopupRuntime?.readyError(),
      fixture: window.__p18Fixture,
      debugBuild: window.__p18PopupRuntime?.debugBuild(),
    }));
    assertion(ready.state === "ready", `P18 ${variant} popup runtime failed`, ready);
    assertion(ready.fixture?.realm === "popup" && ready.fixture?.variant === variant, "P18 popup fixture drifted", ready);
    assertion(ready.debugBuild === (variant === "debug"), "P18 popup build literal drifted", ready);
    return ready;
  };
  const gotoPopup = async (target, variant) => {
    await target.goto(popupUrl(variant), { waitUntil: "load" });
    return waitForPopup(target, variant);
  };
  const waitForContent = async (target) => {
    await target.waitForFunction(
      () => window.__p18ContentRuntime?.readyState() !== "booting",
      undefined,
      { timeout: 15_000 },
    );
    const ready = await target.evaluate(() => ({
      state: window.__p18ContentRuntime?.readyState(),
      error: window.__p18ContentRuntime?.readyError(),
      fixture: window.__p18Fixture,
    }));
    assertion(ready.state === "ready", "P18 content runtime failed", ready);
    assertion(
      ready.fixture?.realm === "content" && ready.fixture?.variant === "production",
      "P18 content fixture drifted",
      ready,
    );
    await target.waitForFunction(async () => {
      try {
        const snapshot = await window.__p18ContentRuntime.snapshot();
        return snapshot.status !== null;
      } catch {
        return false;
      }
    }, undefined, { timeout: 15_000 });
    return ready;
  };
  const outsidePoint = async (target) => {
    const box = await target.locator("#p18-popup-outside-target").boundingBox();
    assertion(box, "P18 outside-pointer target has no physical box");
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const hit = await target.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id ?? null, point);
    assertion(hit === "p18-popup-outside-target", "P18 outside-pointer target was occluded", { point, hit });
    return point;
  };
  const elementCenter = async (target, selector) => {
    const box = await target.locator(selector).boundingBox();
    assertion(box, `P18 physical target has no box: ${selector}`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const physicalClick = async (target, selector, button = "left", modifiers = []) => {
    const point = await elementCenter(target, selector);
    for (const modifier of modifiers) {
      await target.keyboard.down(modifier);
    }
    try {
      await target.mouse.click(point.x, point.y, { button });
    } finally {
      for (const modifier of [...modifiers].reverse()) {
        await target.keyboard.up(modifier);
      }
    }
    return point;
  };
  const invalidShiftClick = async (target, x, y) => {
    await target.keyboard.down("Shift");
    try {
      await target.mouse.click(x, y);
    } finally {
      await target.keyboard.up("Shift");
    }
  };
  const waitForPopupEffect = (target) => target.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  const waitForContentToastTone = (target, tone) => target.waitForFunction(
    (expectedTone) => document.querySelector('[data-uf-content-toast="true"]')
      ?.getAttribute("data-uf-content-toast-tone") === expectedTone,
    tone,
    { timeout: 5_000 },
  );
  const waitForPopupToastTone = (target, tone) => target.waitForFunction(
    (expectedTone) => document.querySelector("[data-popup-toast]")
      ?.getAttribute("data-popup-toast") === expectedTone,
    tone,
    { timeout: 5_000 },
  );
  const terminalActionSnapshot = (counts) => Object.fromEntries(
    terminalActions.map((name) => [name, counts?.[name] ?? null]),
  );
  const allTerminalActionsZero = (counts) => terminalActions.every((name) => counts?.[name] === 0);

  observePage(page, "popup-production");
  let contentPage = null;
  let toastPage = null;
  let deadlineContext = null;
  let deadlinePage = null;
  let debugPage = null;
  let browserEnvironment = null;
  let fatalError = null;
  let nestedEscapeEvidence = null;
  let busyEvidence = null;
  let popupReplacementEvidence = null;
  let contentReplacementEvidence = null;

  try {
    await gotoPopup(page, "production");
    browserEnvironment = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio,
    }));
    const browser = page.context().browser();
    browserEnvironment.browserType = browser?.browserType().name() ?? null;
    browserEnvironment.browserVersion = browser?.version() ?? null;

    await check("popup-menu-mutual-exclusion", async () => {
      await popupCall(page, "setScenario", "configuration");
      await waitForPopupEffect(page);
      await page.locator("#header-kebab-toggle").click();
      await page.waitForSelector('[data-transient-surface="header-menu"]', { state: "visible" });
      const headerOpen = await popupCall(page, "snapshot");

      // Keyboard activation deliberately avoids an outside pointerdown. The
      // production manager itself must replace the already-open ephemeral menu.
      await page.locator("#theme-dropdown-toggle").focus();
      await page.keyboard.press("Enter");
      await page.waitForSelector('[data-transient-surface="theme-menu"]', { state: "visible" });
      await page.waitForSelector('[data-transient-surface="header-menu"]', { state: "hidden" });
      const themeOpen = await popupCall(page, "snapshot");
      assertion(headerOpen.transientMarkers.includes("header-menu"), "Header menu did not register with the production manager", headerOpen);
      assertion(
        themeOpen.transientMarkers.length === 1 && themeOpen.transientMarkers[0] === "theme-menu",
        "Opening the theme menu did not replace the prior ephemeral surface",
        themeOpen,
      );
      assertion(themeOpen.menus.length === 1 && themeOpen.menus[0].role === "listbox", "Exactly one topmost menu was not visible", themeOpen);
      return { headerOpen, themeOpen, activation: "physical-keyboard-enter" };
    });

    await check("outside-pointer-dismisses-current-menu", async () => {
      await popupCall(page, "setScenario", "configuration");
      await waitForPopupEffect(page);
      await page.locator("#header-kebab-toggle").click();
      await page.waitForSelector('[data-transient-surface="header-menu"]', { state: "visible" });
      const before = await popupCall(page, "snapshot");
      const point = await outsidePoint(page);
      await page.mouse.click(point.x, point.y);
      await page.waitForSelector('[data-transient-surface="header-menu"]', { state: "hidden" });
      const after = await popupCall(page, "snapshot");
      const expanded = await page.locator("#header-kebab-toggle").getAttribute("aria-expanded");
      assertion(after.menus.length === 0 && !after.transientMarkers.includes("header-menu"), "Physical outside pointer did not dismiss the current menu", after);
      assertion(expanded === "false", "Header trigger remained expanded after outside dismissal", { expanded });
      return { point, before, after, expanded };
    });

    await check("nested-escape-dismisses-topmost-only", async () => {
      await popupCall(page, "setScenario", "nested");
      await page.waitForSelector('[data-transient-surface="lynx-checklist"]', { state: "visible" });
      await waitForPopupEffect(page);
      await page.locator('.lynx-checklist-popover__candidate-hint[data-transient-trigger="candidate-confirmation"]', { hasText: "/candidate" }).click();
      await page.waitForSelector('[data-transient-surface="candidate-confirmation"]', { state: "visible" });
      await waitForPopupEffect(page);
      const before = await popupCall(page, "snapshot");
      await page.keyboard.press("Escape");
      await page.waitForSelector('[data-transient-surface="candidate-confirmation"]', { state: "hidden" });
      const afterFirst = await popupCall(page, "snapshot");
      assertion(afterFirst.transientMarkers.includes("lynx-checklist"), "First Escape dismissed the parent checklist", afterFirst);
      assertion(!afterFirst.transientMarkers.includes("candidate-confirmation"), "First Escape did not dismiss the topmost confirmation", afterFirst);
      assertion(allTerminalActionsZero(afterFirst.actionCounts), "Topmost Escape ran an edit or terminal action", afterFirst.actionCounts);

      await page.keyboard.press("Escape");
      await page.waitForSelector('[data-transient-surface="lynx-checklist"]', { state: "hidden" });
      const afterSecond = await popupCall(page, "snapshot");
      assertion(afterSecond.actionCounts.closeChecklist === 1, "Second Escape did not close exactly the parent checklist", afterSecond.actionCounts);
      assertion(allTerminalActionsZero(afterSecond.actionCounts), "Nested Escape sequence ran a terminal action", afterSecond.actionCounts);
      nestedEscapeEvidence = { before, afterFirst, afterSecond };
      return nestedEscapeEvidence;
    });

    await check("busy-surface-resists-escape-and-outside", async () => {
      await popupCall(page, "setScenario", "busy");
      await page.waitForSelector('[data-transient-surface="lynx-checklist"]', { state: "visible" });
      await waitForPopupEffect(page);
      const before = await popupCall(page, "snapshot");
      const controls = await page.evaluate(() => ({
        phase: document.querySelector("[data-publication-phase]")?.getAttribute("data-publication-phase"),
        cancelDisabled: document.querySelector("#lynx-checklist-cancel")?.disabled,
        sendDisabled: document.querySelector("#lynx-checklist-send")?.disabled,
      }));
      const point = await outsidePoint(page);
      await page.mouse.click(point.x, point.y);
      await page.keyboard.press("Escape");
      await waitForPopupEffect(page);
      const after = await popupCall(page, "snapshot");
      assertion(controls.phase === "publishing" && controls.cancelDisabled && controls.sendDisabled, "Busy checklist controls were not protected", controls);
      assertion(after.transientMarkers.includes("lynx-checklist"), "Busy surface was dismissed by outside pointer or Escape", { point, after });
      assertion(allTerminalActionsZero(after.actionCounts), "Busy dismissal gestures ran a terminal action", after.actionCounts);
      busyEvidence = { point, controls, before, after };
      return busyEvidence;
    });

    await check("escape-never-runs-edit-or-terminal-actions", async () => {
      await popupCall(page, "setScenario", "configuration");
      await waitForPopupEffect(page);
      await page.locator("#header-kebab-toggle").click();
      await page.waitForSelector('[data-transient-surface="header-menu"]', { state: "visible" });
      await page.locator("#clear-domain-cache").click();
      await page.waitForSelector('[data-transient-surface="maintenance-confirmation"]', { state: "visible" });
      await waitForPopupEffect(page);
      await page.keyboard.press("Escape");
      await page.waitForSelector('[data-transient-surface="maintenance-confirmation"]', { state: "hidden" });
      const afterCacheEscape = await popupCall(page, "snapshot");

      await page.locator("#unregister-current-tab").click();
      await page.waitForSelector('[data-transient-surface="maintenance-confirmation"]', { state: "visible" });
      await waitForPopupEffect(page);
      await page.keyboard.press("Escape");
      await page.waitForSelector('[data-transient-surface="maintenance-confirmation"]', { state: "hidden" });
      const afterUnregisterEscape = await popupCall(page, "snapshot");
      assertion(allTerminalActionsZero(afterCacheEscape.actionCounts), "Cache confirmation Escape ran an edit or terminal action", afterCacheEscape.actionCounts);
      assertion(allTerminalActionsZero(afterUnregisterEscape.actionCounts), "Unregister confirmation Escape ran an edit or terminal action", afterUnregisterEscape.actionCounts);
      assertion(nestedEscapeEvidence && allTerminalActionsZero(nestedEscapeEvidence.afterSecond.actionCounts), "Nested Escape safety evidence is missing", nestedEscapeEvidence);
      assertion(busyEvidence && allTerminalActionsZero(busyEvidence.after.actionCounts), "Busy Escape safety evidence is missing", busyEvidence);
      return {
        nested: terminalActionSnapshot(nestedEscapeEvidence.afterSecond.actionCounts),
        busy: terminalActionSnapshot(busyEvidence.after.actionCounts),
        cacheConfirmation: terminalActionSnapshot(afterCacheEscape.actionCounts),
        unregisterConfirmation: terminalActionSnapshot(afterUnregisterEscape.actionCounts),
      };
    });

    await check("preview-escape-requests-normal-exit-boundary", async () => {
      await popupCall(page, "setScenario", "preview");
      await page.waitForSelector('[data-transient-fallback="preview"]', { state: "visible" });
      await waitForPopupEffect(page);
      const before = await popupCall(page, "snapshot");
      const exitInitiallyDisabled = await page.locator("#preview-exit").isDisabled();
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => document.querySelector('[data-transient-fallback="preview"]')?.getAttribute("aria-busy") === "true");
      await waitForPopupEffect(page);
      const afterFirst = await popupCall(page, "snapshot");
      const exitRestoringDisabled = await page.locator("#preview-exit").isDisabled();
      await page.keyboard.press("Escape");
      await waitForPopupEffect(page);
      const afterSecond = await popupCall(page, "snapshot");
      assertion(before.appView === "preview" && !exitInitiallyDisabled, "Preview fallback was not available before Escape", { before, exitInitiallyDisabled });
      assertion(afterFirst.actionCounts.exitPreview === 1, "First Escape did not invoke the sole normal exit boundary", afterFirst);
      assertion(exitRestoringDisabled, "Preview exit control stayed enabled during restoration", { exitRestoringDisabled });
      assertion(afterSecond.actionCounts.exitPreview === 1, "Repeated Escape birthed a competing preview exit", afterSecond);
      return { before, afterFirst, afterSecond, exitInitiallyDisabled, exitRestoringDisabled };
    });

    await check("panel-scroll-restored-after-dismissal", async () => {
      await popupCall(page, "setScenario", "configuration");
      await page.waitForFunction(() => !document.body.classList.contains("is-busy"));
      await page.evaluate(() => scrollTo(0, 640));
      await page.waitForFunction(() => scrollY === 640);
      const captured = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
      await popupCall(page, "setScenario", "nested");
      await page.waitForFunction(() => document.body.classList.contains("is-busy"));
      await page.evaluate(() => scrollTo(0, 1_200));
      const drifted = await page.evaluate(() => ({ x: scrollX, y: scrollY, busy: document.body.classList.contains("is-busy") }));
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        (expected) => !document.body.classList.contains("is-busy") && scrollX === expected.x && scrollY === expected.y,
        captured,
      );
      const restored = await page.evaluate(() => ({ x: scrollX, y: scrollY, busy: document.body.classList.contains("is-busy") }));
      await page.locator("#header-kebab-toggle").click();
      await page.waitForSelector('[data-transient-surface="header-menu"]', { state: "visible" });
      const point = await outsidePoint(page);
      await page.mouse.click(point.x, point.y);
      await page.waitForSelector('[data-transient-surface="header-menu"]', { state: "hidden" });
      assertion(drifted.busy && drifted.y !== captured.y, "Scroll fixture did not disturb the production lock", { captured, drifted });
      assertion(!restored.busy && restored.x === captured.x && restored.y === captured.y, "Panel position was not restored exactly", { captured, drifted, restored });
      return { captured, drifted, restored, postRestoreInteraction: "header-menu-opened-and-dismissed" };
    });

    contentPage = await page.context().newPage();
    observePage(contentPage, "content-production");
    await contentPage.goto(contentUrl, { waitUntil: "load" });
    const contentReady = await waitForContent(contentPage);
    const activation = await contentCall(contentPage, "activateMarking");
    await contentPage.waitForFunction(
      () => window.__p18PageState.pageWorldCommands >= 1,
      undefined,
      { timeout: 5_000 },
    );
    const markingReadinessStartedAt = Date.now();
    await contentPage.waitForFunction(() => {
      const curtain = document.querySelector('[data-uf-content-curtain-copy="true"]');
      return curtain?.textContent !== "Inspecting page... it will be ready soon";
    }, undefined, { timeout: 25_000, polling: 100 });
    const markingTargetPoint = await elementCenter(contentPage, "#p18-mark-target");
    await contentPage.waitForFunction(({ x, y }) => {
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit?.closest?.(".uf-marking-layer-root")) &&
        document.elementsFromPoint(x, y).some((element) => element.id === "p18-mark-target");
    }, markingTargetPoint, {
      timeout: Math.max(1, 25_000 - (Date.now() - markingReadinessStartedAt)),
      polling: 100,
    });
    const markingTargetHit = await contentPage.evaluate(
      ({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return {
          id: hit?.id ?? null,
          tagName: hit?.tagName ?? null,
          className: hit?.getAttribute("class") ?? null,
          extensionUi: hit?.closest?.('[data-uf-extension-ui="true"]')?.getAttribute("data-uf-extension-ui") ?? null,
          markingLayer: Boolean(hit?.closest?.(".uf-marking-layer-root")),
          authoredTargetInStack: document.elementsFromPoint(x, y).some((element) => element.id === "p18-mark-target"),
        };
      },
      markingTargetPoint,
    );
    assertion(
      markingTargetHit.markingLayer &&
      markingTargetHit.extensionUi === "true" &&
      markingTargetHit.authoredTargetInStack,
      "Settled marking layer was not the accepted physical hit target",
      {
        markingTargetPoint,
        markingTargetHit,
      },
    );
    scenarioEvidence.contentBoot = { contentReady, activation, markingTargetPoint, markingTargetHit };

    await check("marking-right-click-commits-canonical-action", async () => {
      const before = await contentCall(contentPage, "snapshot");
      const targetPoint = await physicalClick(contentPage, "#p18-mark-target", "right");
      await contentPage.waitForSelector('[data-uf-marking-menu="true"]', { state: "visible" });
      const menu = await contentCall(contentPage, "menuSnapshot");
      assertion(menu.role === "menu" && menu.connected, "Physical right-click did not open the shipping marking menu", menu);
      assertion(
        JSON.stringify(menu.actions.map((action) => action.id)) === JSON.stringify(["include", "exclude", "widen", "clear"]),
        "Canonical marking action order drifted",
        menu,
      );
      const targetXpath = "/html[1]/body[1]/main[1]/article[1]";
      const beforeTargetRow = before.status?.data?.contentRows?.find((row) => row.xpath === targetXpath);
      const exclude = menu.actions.find((action) => action.id === "exclude");
      assertion(beforeTargetRow?.classification === "included", "Canonical corpus target was not initially included", {
        targetXpath,
        beforeTargetRow,
      });
      assertion(exclude && exclude.label === "Exclude" && !exclude.disabled, "Canonical Exclude action was not enabled", menu);
      await contentPage.locator('[data-uf-marking-menu-action="exclude"]').click();
      await contentPage.waitForSelector('[data-uf-marking-menu="true"]', { state: "hidden" });
      await contentPage.waitForFunction(async () => {
        const snapshot = await window.__p18ContentRuntime.snapshot();
        return snapshot.status?.data?.dirty === true && snapshot.status?.data?.markedCount === 1;
      });
      const after = await contentCall(contentPage, "snapshot");
      const afterTargetRow = after.status?.data?.contentRows?.find((row) => row.xpath === targetXpath);
      assertion(after.status?.data?.active === true && after.status?.data?.dirty === true, "Canonical action did not update the real content controller", after.status);
      assertion(after.status.data.markedCount === 1, "One physical menu action did not commit exactly once", after.status);
      assertion(afterTargetRow?.classification === "excluded", "Canonical Exclude action did not change the exact target row", {
        targetXpath,
        beforeTargetRow,
        afterTargetRow,
      });
      assertion(after.reportedFacts.some((frame) => frame.payload?.sensation?.reason === "marking-toggle"), "Canonical marking fact was not emitted", after.reportedFacts);
      return { targetPoint, targetXpath, beforeTargetRow, menu, afterTargetRow, after };
    });

    await check("marking-menu-dismissal-preserves-marking-interaction", async () => {
      const firstPoint = await physicalClick(contentPage, "#p18-mark-target", "right");
      await contentPage.waitForSelector('[data-uf-marking-menu="true"]', { state: "visible" });
      const firstMenu = await contentPage.$('[data-uf-marking-menu="true"]');
      const first = await contentCall(contentPage, "menuSnapshot");
      const replacementPoint = await physicalClick(contentPage, "#p18-second-mark-target", "right");
      await contentPage.waitForFunction(() => document.querySelectorAll('[data-uf-marking-menu="true"]').length === 1);
      const firstConnectedAfterReplace = await firstMenu.evaluate((element) => element.isConnected);
      const replacement = await contentCall(contentPage, "menuSnapshot");
      assertion(!firstConnectedAfterReplace, "Second physical right-click did not retire the previous menu DOM", { first, replacement });
      assertion(replacement && replacement.rect.top !== first.rect.top, "Replacement menu did not target the second physical point", { first, replacement });

      const beforeDismissal = await contentCall(contentPage, "snapshot");
      const pageClicksBefore = beforeDismissal.pageState.clicks;
      const markedBeforeDismissal = beforeDismissal.status?.data?.markedCount;
      const rowsBeforeDismissal = beforeDismissal.status?.data?.contentRows;
      const markingFactsBeforeDismissal = beforeDismissal.reportedFacts.filter(
        (frame) => frame.payload?.sensation?.reason === "marking-toggle",
      ).length;
      const dismissalPoint = await physicalClick(contentPage, "#p18-page-action");
      await contentPage.waitForSelector('[data-uf-marking-menu="true"]', { state: "hidden" });
      const afterDismissal = await contentCall(contentPage, "snapshot");
      assertion(afterDismissal.pageState.clicks === pageClicksBefore, "Outside-dismissal click leaked into the inspected page", { pageClicksBefore, afterDismissal });
      assertion(afterDismissal.markingMenuCount === 0, "Outside pointer did not dismiss the content menu", afterDismissal);
      assertion(
        afterDismissal.status?.data?.markedCount === markedBeforeDismissal &&
        JSON.stringify(afterDismissal.status?.data?.contentRows) === JSON.stringify(rowsBeforeDismissal) &&
        afterDismissal.reportedFacts.filter(
          (frame) => frame.payload?.sensation?.reason === "marking-toggle",
        ).length === markingFactsBeforeDismissal,
        "Outside-dismissal click leaked into a canonical marking action",
        { beforeDismissal, afterDismissal },
      );

      const markedBefore = afterDismissal.status?.data?.markedCount;
      const resumedPoint = await physicalClick(contentPage, "#p18-second-mark-target", "left", ["Shift"]);
      await contentPage.waitForFunction(
        (previous) => window.__p18ContentRuntime.snapshot().then((snapshot) => snapshot.status?.data?.markedCount === previous + 1),
        markedBefore,
      );
      const afterInteraction = await contentCall(contentPage, "snapshot");
      assertion(afterInteraction.status.data.active === true && afterInteraction.status.data.markedCount === markedBefore + 1, "Marking interaction did not resume after menu dismissal", { markedBefore, afterInteraction });
      return { firstPoint, replacementPoint, dismissalPoint, resumedPoint, first, firstConnectedAfterReplace, replacement, pageClicksBefore, afterDismissal, afterInteraction };
    });

    // Replacement and manual dismissal stay on native browser time. The exact
    // boundary check below owns a fresh context whose clock is installed before
    // that context's first navigation or production import.
    toastPage = await page.context().newPage();
    observePage(toastPage, "popup-production-toast");
    await gotoPopup(toastPage, "production");

    await check("production-toast-replaces-current", async () => {
      await popupCall(toastPage, "setScenario", "toast");
      const popupFirstOccurrence = await popupCall(toastPage, "emitToast", "First popup result", "success");
      await waitForPopupToastTone(toastPage, "success");
      await toastPage.waitForTimeout(100);
      const popupSecondOccurrence = await popupCall(toastPage, "emitToast", "Replacement popup failure", "danger");
      await waitForPopupToastTone(toastPage, "danger");
      const popupAfterReplace = await popupCall(toastPage, "snapshot");
      await toastPage.waitForTimeout(1_700);
      const popupAtRetiredDeadline = await popupCall(toastPage, "snapshot");
      assertion(popupSecondOccurrence.id > popupFirstOccurrence.id, "Popup toast occurrence IDs were not monotonic", { popupFirstOccurrence, popupSecondOccurrence });
      assertion(popupAfterReplace.toast?.message === "Replacement popup failure" && popupAfterReplace.toast?.tone === "danger", "Popup did not replace the current toast", popupAfterReplace);
      assertion(popupAfterReplace.toast?.id === String(popupSecondOccurrence.id), "Popup rendered stale occurrence identity", { popupSecondOccurrence, popupAfterReplace });
      assertion(popupAtRetiredDeadline.toast?.id === String(popupSecondOccurrence.id), "Retired popup timer cleared its successor", popupAtRetiredDeadline);

      await contentPage.keyboard.down("Space");
      await waitForContentToastTone(contentPage, "success");
      await contentPage.keyboard.up("Space");
      const contentFirst = await contentCall(contentPage, "snapshot");
      await invalidShiftClick(contentPage, 1_100, 700);
      await waitForContentToastTone(contentPage, "warning");
      const contentAfterReplace = await contentCall(contentPage, "snapshot");
      assertion(contentFirst.toast?.message === "Page interaction mode", "Content success toast did not use production copy", contentFirst.toast);
      assertion(contentAfterReplace.toast?.count === 1 && contentAfterReplace.toast?.message === "That area can't be marked.", "Content warning did not replace the existing toast", contentAfterReplace.toast);
      assertion(Number(contentAfterReplace.toast.id) > Number(contentFirst.toast.id), "Content toast IDs were not monotonic", { first: contentFirst.toast, replacement: contentAfterReplace.toast });
      popupReplacementEvidence = { popupFirstOccurrence, popupSecondOccurrence, popupAfterReplace, popupAtRetiredDeadline };
      contentReplacementEvidence = { first: contentFirst.toast, replacement: contentAfterReplace.toast };
      return { popup: popupReplacementEvidence, content: contentReplacementEvidence };
    });

    await check("production-toast-manual-close-stays-dismissed", async () => {
      const popupManualOccurrence = await popupCall(toastPage, "emitToast", "Fresh popup close", "danger");
      await waitForPopupToastTone(toastPage, "danger");
      const popupBeforeClose = await popupCall(toastPage, "snapshot");
      assertion(
        popupManualOccurrence.id > popupReplacementEvidence.popupSecondOccurrence.id &&
          popupBeforeClose.toast?.id === String(popupManualOccurrence.id) &&
          popupBeforeClose.toast?.tone === "danger",
        "Fresh popup danger occurrence was not projected before manual close",
        { priorOccurrence: popupReplacementEvidence.popupSecondOccurrence, popupManualOccurrence, popupBeforeClose },
      );

      const priorContentOccurrenceId = contentReplacementEvidence.replacement.id;
      await invalidShiftClick(contentPage, 1_100, 700);
      await contentPage.waitForFunction(
        (priorId) => {
          const toast = document.querySelector("[data-uf-content-toast=\"true\"]");
          return toast?.getAttribute("data-uf-content-toast-tone") === "warning" &&
            toast.getAttribute("data-uf-content-toast-id") !== priorId;
        },
        priorContentOccurrenceId,
        { timeout: 5_000 },
      );
      const contentBeforeClose = await contentCall(contentPage, "snapshot");
      assertion(
        contentBeforeClose.toast?.tone === "warning" &&
          Number(contentBeforeClose.toast.id) > Number(priorContentOccurrenceId),
        "Fresh content warning occurrence was not projected before manual close",
        { priorContentOccurrenceId, contentBeforeClose },
      );

      const contentToastSelector = `[data-uf-content-toast="true"][data-uf-content-toast-id="${contentBeforeClose.toast.id}"]`;
      const contentCloseHit = await contentPage.locator(
        `${contentToastSelector} [data-uf-content-toast-close="true"]`,
      ).evaluate((close, expectedToastId) => {
        const rect = close.getBoundingClientRect();
        const center = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
        const hit = document.elementFromPoint(center.x, center.y);
        const hitClose = hit?.closest('[data-uf-content-toast-close="true"]') ?? null;
        const owner = close.closest('[data-uf-content-toast="true"]');
        const hitOwner = hitClose?.closest('[data-uf-content-toast="true"]') ?? null;
        return {
          center,
          rect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          },
          expectedToastId,
          ownerToastId: owner?.getAttribute("data-uf-content-toast-id") ?? null,
          hitOwnerToastId: hitOwner?.getAttribute("data-uf-content-toast-id") ?? null,
          hitTagName: hit?.tagName ?? null,
          hitClassName: hit?.getAttribute("class") ?? null,
          hitCloseIsExact: hitClose === close,
          hitOwnerIsExact: hitOwner === owner,
        };
      }, String(contentBeforeClose.toast.id));
      assertion(
        contentCloseHit.rect.width > 0 &&
          contentCloseHit.rect.height > 0 &&
          contentCloseHit.ownerToastId === String(contentBeforeClose.toast.id) &&
          contentCloseHit.hitOwnerToastId === String(contentBeforeClose.toast.id) &&
          contentCloseHit.hitCloseIsExact &&
          contentCloseHit.hitOwnerIsExact,
        "Fresh content warning close control did not own its physical hit point",
        contentCloseHit,
      );
      await contentPage.mouse.click(contentCloseHit.center.x, contentCloseHit.center.y);
      await contentPage.locator(contentToastSelector).waitFor({ state: "hidden", timeout: 5_000 });
      const contentAfterClose = await contentCall(contentPage, "snapshot");
      assertion(contentAfterClose.toast === null, "Fresh content warning did not close after raw physical input", { contentCloseHit, contentAfterClose });

      await toastPage.locator(`[data-popup-toast-close="${popupManualOccurrence.id}"]`).click();
      await toastPage.locator(`[data-popup-toast-close="${popupManualOccurrence.id}"]`).waitFor({ state: "hidden" });
      const popupAfterClose = await popupCall(toastPage, "snapshot");
      await Promise.all([
        toastPage.waitForTimeout(6_500),
        contentPage.waitForTimeout(4_200),
      ]);
      const popupAfterDeadlines = await popupCall(toastPage, "snapshot");
      const contentAfterDeadlines = await contentCall(contentPage, "snapshot");
      assertion(popupAfterClose.toast === null && popupAfterDeadlines.toast === null, "Manually closed popup toast returned", { popupAfterClose, popupAfterDeadlines });
      assertion(contentAfterClose.toast === null && contentAfterDeadlines.toast === null, "Manually closed content toast returned", { contentAfterClose, contentAfterDeadlines });
      return {
        popupManualOccurrence,
        popupBeforeClose,
        popupAfterClose,
        popupAfterDeadlines,
        contentBeforeClose,
        contentCloseHit,
        contentAfterClose,
        contentAfterDeadlines,
      };
    });

    await check("toast-deadlines-exact-1800-4000-6000", async () => {
      const expectedDurations = { success: 1_800, warning: 4_000, danger: 6_000 };
      const popupDurations = await popupCall(toastPage, "toastDurations");
      const contentDurations = await contentCall(contentPage, "toastDurations");
      assertion(JSON.stringify(popupDurations) === JSON.stringify(expectedDurations), "Popup runtime did not consume the production duration table", popupDurations);
      assertion(JSON.stringify(contentDurations) === JSON.stringify(expectedDurations), "Content runtime did not consume the production duration table", contentDurations);

      assertion(browser, "P18 deadline gate could not create an isolated browser context");
      deadlineContext = await browser.newContext({ viewport: page.viewportSize() ?? { width: 1_280, height: 900 } });
      deadlinePage = await deadlineContext.newPage();
      observePage(deadlinePage, "popup-production-deadline");
      await deadlinePage.clock.install({ time: new Date("2026-08-21T12:00:00.000Z") });
      await gotoPopup(deadlinePage, "production");
      const popupClockPausedAt = await deadlinePage.evaluate(() => Date.now());
      await deadlinePage.clock.pauseAt(new Date(popupClockPausedAt));

      const popupDeadlines = [];
      for (const tone of ["success", "warning", "danger"]) {
        await popupCall(deadlinePage, "setScenario", "toast");
        const { occurrenceBornAt, occurrence } = await deadlinePage.evaluate(({ message, occurrenceTone }) => {
          const bornAt = Date.now();
          return {
            occurrenceBornAt: bornAt,
            occurrence: window.__p18PopupRuntime.emitToast(message, occurrenceTone),
          };
        }, { message: `Exact ${tone} deadline`, occurrenceTone: tone });
        const initial = await popupCall(deadlinePage, "snapshot");
        assertion(
          initial.toast?.id === String(occurrence.id) && initial.controllerToast?.id === occurrence.id,
          `Popup ${tone} occurrence was not projected by both production controller and DOM at birth`,
          { occurrence, occurrenceBornAt, initial },
        );
        await deadlinePage.clock.fastForward(expectedDurations[tone] - 1);
        const beforeDeadlineAt = await deadlinePage.evaluate(() => Date.now());
        const beforeDeadline = await popupCall(deadlinePage, "snapshot");
        await deadlinePage.clock.fastForward(1);
        const atDeadlineAt = await deadlinePage.evaluate(() => Date.now());
        const atDeadline = await popupCall(deadlinePage, "snapshot");
        assertion(
          beforeDeadline.toast?.id === String(occurrence.id) && beforeDeadline.controllerToast?.id === occurrence.id,
          `Popup ${tone} toast cleared before its exact deadline`,
          { occurrence, beforeDeadline },
        );
        assertion(
          atDeadline.toast === null && atDeadline.controllerToast === null,
          `Popup ${tone} toast survived its exact deadline`,
          atDeadline,
        );
        assertion(
          beforeDeadlineAt - occurrenceBornAt === expectedDurations[tone] - 1 &&
          atDeadlineAt - occurrenceBornAt === expectedDurations[tone],
          `Popup ${tone} clock did not traverse the exact N-1/N boundary from occurrence birth`,
          { occurrenceBornAt, beforeDeadlineAt, atDeadlineAt, durationMs: expectedDurations[tone] },
        );
        const urgent = tone === "danger";
        assertion(initial.toast?.role === (urgent ? "alert" : "status") && initial.toast?.live === (urgent ? "assertive" : "polite"), `Popup ${tone} live-region semantics drifted`, initial.toast);
        popupDeadlines.push({
          tone,
          durationMs: expectedDurations[tone],
          occurrence,
          occurrenceBornAt,
          beforeDeadlineAt,
          atDeadlineAt,
          initial: initial.toast,
          beforeDeadline: beforeDeadline.toast,
          atDeadline: atDeadline.toast,
        });
      }
      await deadlineContext.close();
      deadlineContext = null;
      deadlinePage = null;

      const contentDeadlines = [];
      const contentSuccessStarted = await contentPage.evaluate(() => performance.now());
      await contentPage.keyboard.down("Space");
      await waitForContentToastTone(contentPage, "success");
      await contentPage.keyboard.up("Space");
      const contentSuccess = await contentCall(contentPage, "snapshot");
      await contentPage.waitForTimeout(expectedDurations.success - 150);
      const contentSuccessBefore = await contentCall(contentPage, "snapshot");
      await contentPage.waitForFunction(() => !document.querySelector('[data-uf-content-toast="true"]'));
      const contentSuccessAt = await contentCall(contentPage, "snapshot");
      const contentSuccessElapsed = await contentPage.evaluate((started) => performance.now() - started, contentSuccessStarted);
      assertion(contentSuccessBefore.toast?.id === contentSuccess.toast?.id && contentSuccessAt.toast === null, "Content success timer did not preserve then clear its occurrence", { contentSuccess, contentSuccessBefore, contentSuccessAt });
      assertion(contentSuccessElapsed >= expectedDurations.success && contentSuccessElapsed < expectedDurations.success + 500, "Content success timer drifted from the production 1800ms deadline", contentSuccessElapsed);
      contentDeadlines.push({ tone: "success", durationMs: 1_800, observedElapsedMs: contentSuccessElapsed, initial: contentSuccess.toast, beforeDeadline: contentSuccessBefore.toast, atDeadline: contentSuccessAt.toast });

      const contentWarningStarted = await contentPage.evaluate(() => performance.now());
      await invalidShiftClick(contentPage, 1_100, 700);
      await waitForContentToastTone(contentPage, "warning");
      const contentWarning = await contentCall(contentPage, "snapshot");
      await contentPage.waitForTimeout(expectedDurations.warning - 150);
      const contentWarningBefore = await contentCall(contentPage, "snapshot");
      await contentPage.waitForFunction(() => !document.querySelector('[data-uf-content-toast="true"]'));
      const contentWarningAt = await contentCall(contentPage, "snapshot");
      const contentWarningElapsed = await contentPage.evaluate((started) => performance.now() - started, contentWarningStarted);
      assertion(contentWarningBefore.toast?.id === contentWarning.toast?.id && contentWarningAt.toast === null, "Content warning timer did not preserve then clear its occurrence", { contentWarning, contentWarningBefore, contentWarningAt });
      assertion(contentWarningElapsed >= expectedDurations.warning && contentWarningElapsed < expectedDurations.warning + 500, "Content warning timer drifted from the production 4000ms deadline", contentWarningElapsed);
      contentDeadlines.push({ tone: "warning", durationMs: 4_000, observedElapsedMs: contentWarningElapsed, initial: contentWarning.toast, beforeDeadline: contentWarningBefore.toast, atDeadline: contentWarningAt.toast });
      return { expectedDurations, popupDurations, contentDurations, popupClockPausedAt, popupDeadlines, contentDeadlines };
    });

    await check("production-debug-toast-disclosure-consistent", async () => {
      await popupCall(toastPage, "setScenario", "toast");
      const productionOccurrence = await popupCall(toastPage, "emitToast", "Disclosure sentinel", "danger");
      await waitForPopupToastTone(toastPage, "danger");
      const production = await popupCall(toastPage, "snapshot");

      debugPage = await page.context().newPage();
      observePage(debugPage, "popup-debug");
      await gotoPopup(debugPage, "debug");
      await popupCall(debugPage, "setScenario", "toast");
      const debugOccurrence = await popupCall(debugPage, "emitToast", "Disclosure sentinel", "danger");
      await waitForPopupToastTone(debugPage, "danger");
      const debug = await popupCall(debugPage, "snapshot");
      assertion(production.toast?.message === "Disclosure sentinel" && debug.toast?.message === production.toast.message, "Production/debug operator toast copy diverged", { production, debug });
      assertion(production.toast?.tone === "danger" && debug.toast?.tone === "danger", "Production/debug toast tone diverged", { production, debug });
      assertion(production.toast?.role === "alert" && debug.toast?.role === "alert" && production.toast?.live === "assertive" && debug.toast?.live === "assertive", "Production/debug danger semantics diverged", { production, debug });
      assertion(production.toast?.closeLabel === "Close notification" && debug.toast?.closeLabel === "Close notification", "Production/debug manual close disclosure diverged", { production, debug });
      assertion(production.activity === null && production.debugBuildMarker === null && production.debugToolCount === 0, "Production popup exposed debug surfaces", production);
      assertion(debug.debugBuildMarker === "true" && debug.debugToolCount > 0, "Debug popup omitted its diagnostic surfaces", debug);
      assertion(debug.activity?.includes("Disclosure sentinel") && debug.activity.includes("p18-danger-detail"), "Debug activity omitted toast detail", debug.activity);
      assertion(!production.toast.message.includes("p18-danger-detail") && !debug.toast.message.includes("p18-danger-detail"), "Technical detail leaked into concise toast copy", { production: production.toast, debug: debug.toast });
      assertion(contentReplacementEvidence.replacement.message === "That area can't be marked." && !contentReplacementEvidence.replacement.message.includes("("), "Production content warning leaked debug coordinates", contentReplacementEvidence);
      return { productionOccurrence, debugOccurrence, production, debug, contentProduction: contentReplacementEvidence };
    });

    if (debugPage) {
      await debugPage.close();
      debugPage = null;
    }
    if (contentPage) {
      await contentPage.close();
      contentPage = null;
    }
    if (toastPage) {
      await toastPage.close();
      toastPage = null;
    }
    if (deadlineContext) {
      await deadlineContext.close();
      deadlineContext = null;
      deadlinePage = null;
    }

    await check("no-browser-errors", async () => {
      assertion(pageErrors.length === 0, "Browser page errors were observed", pageErrors);
      assertion(consoleErrors.length === 0, "Browser console errors were observed", consoleErrors);
      return { pageErrors: [...pageErrors], consoleErrors: [...consoleErrors] };
    });
  } catch (error) {
    fatalError = String(error?.stack || error);
  } finally {
    if (debugPage && !debugPage.isClosed()) {
      await debugPage.close().catch(() => undefined);
    }
    if (contentPage && !contentPage.isClosed()) {
      await contentPage.close().catch(() => undefined);
    }
    if (toastPage && !toastPage.isClosed()) {
      await toastPage.close().catch(() => undefined);
    }
    if (deadlineContext) {
      await deadlineContext.close().catch(() => undefined);
      deadlineContext = null;
      deadlinePage = null;
    }
  }

  const response = await page.request.post(`${origin}/results`, {
    data: {
      checks,
      pageErrors,
      consoleErrors,
      browserEnvironment,
      scenarioEvidence,
      fatalError,
    },
  });
  if (!response.ok()) {
    throw new Error(`P18 result upload failed: ${response.status()} ${await response.text()}`);
  }
}
