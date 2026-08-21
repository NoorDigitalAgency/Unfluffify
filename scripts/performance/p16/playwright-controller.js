/* eslint-disable @typescript-eslint/no-unused-expressions -- playwright-cli requires a bare function expression. */
async (page) => {
  const checks = [];
  const pageErrors = [];
  const consoleErrors = [];
  const scenarioEvidence = {};
  const initialUrl = page.url();
  const pathStart = initialUrl.indexOf("/", initialUrl.indexOf("//") + 2);
  const origin = pathStart >= 0 ? initialUrl.slice(0, pathStart) : initialUrl;
  const fixtureUrl = `${origin}/fixture`;

  page.on("pageerror", (error) => pageErrors.push(String(error?.stack || error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

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
    await page.waitForFunction(
      () => window.__p16Runtime?.readyState() !== "booting",
      undefined,
      { timeout: 10_000 },
    );
    const ready = await page.evaluate(() => ({
      state: window.__p16Runtime?.readyState(),
      error: window.__p16Runtime?.readyError(),
      documentId: window.__p16Runtime?.documentId,
    }));
    assertion(ready.state === "ready", "P16 runtime failed to initialize", ready);
    return ready;
  };
  const snapshot = () => page.evaluate(() => window.__p16Runtime.snapshot());
  const waitForInspectionPaint = () => page.waitForFunction(() => {
    const current = window.__p16Runtime?.snapshot();
    return current?.record?.phase === "adopted" &&
      current?.pendingAcks === 1 &&
      current?.curtain?.connected === true;
  }, undefined, { timeout: 10_000 });
  const topLayerEvidence = () => page.evaluate(() => {
    const popover = document.querySelector("#pre-inspection-popover");
    const button = document.querySelector("#top-layer-action");
    const buttonRect = button?.getBoundingClientRect();
    const point = buttonRect
      ? { x: buttonRect.left + buttonRect.width / 2, y: buttonRect.top + buttonRect.height / 2 }
      : { x: 180, y: 250 };
    const hit = document.elementFromPoint(point.x, point.y);
    const curtain = hit?.closest?.('[data-uf-render-inspection-curtain="true"]');
    const shield = hit?.closest?.('[data-uf-interaction-shield="true"]');
    return {
      popoverOpen: popover?.matches?.(":popover-open") ?? false,
      popoverInert: popover?.hasAttribute("inert") ?? false,
      popoverPointerEvents: popover ? getComputedStyle(popover).pointerEvents : null,
      authoredButtonPointerEvents: button?.style.getPropertyValue("pointer-events") ||
        (button ? getComputedStyle(button).pointerEvents : null),
      point,
      hit: {
        tagName: hit?.tagName ?? null,
        id: hit?.id ?? null,
        curtain: curtain?.getAttribute("data-uf-render-inspection-curtain") ?? null,
        shield: shield?.getAttribute("data-uf-interaction-shield") ?? null,
      },
    };
  });

  let browserEnvironment = null;
  let fatalError = null;
  try {
    await page.goto(fixtureUrl, { waitUntil: "load" });
    await waitForRuntime();
    await page.evaluate(() => window.__p16Runtime.reset());
    await page.reload({ waitUntil: "load" });
    const sourceReady = await waitForRuntime();
    await page.evaluate(() => {
      window.__p16Runtime.setPageContextDeferred(true);
      window.__p16Runtime.setPaintAcknowledgementHeld(true);
    });
    const beforeStart = await snapshot();

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
    }));
    const browser = page.context().browser();
    browserEnvironment.browserType = browser?.browserType().name() ?? null;
    browserEnvironment.browserVersion = browser?.version() ?? null;

    const navigation = page.waitForNavigation({ waitUntil: "load", timeout: 10_000 });
    const startPromise = page.evaluate(() => window.__p16Runtime.startInspection(false));
    const [replacementNavigation, startResponse] = await Promise.all([navigation, startPromise]);
    const replacementReady = await waitForRuntime();
    await waitForInspectionPaint();
    await page.waitForFunction(
      () => window.__p16Runtime.snapshot().pendingPageContexts === 1,
      undefined,
      { timeout: 10_000 },
    );
    const painted = await snapshot();
    const topLayer = await topLayerEvidence();
    scenarioEvidence.replacement = {
      sourceReady,
      replacementReady,
      replacementNavigationUrl: replacementNavigation?.url() ?? page.url(),
      startResponse,
      beforeStart,
      painted,
      topLayer,
    };

    await check("durable-start-reloads-replacement-document", async () => {
      const reloadEvents = painted.durableEvents.filter((event) => event.name === "reload-requested");
      const commitEvents = painted.durableEvents.filter((event) => event.name === "replacement-commit");
      assertion(startResponse?.status === "started", "Inspection did not report a durable start", startResponse);
      assertion(sourceReady.documentId !== replacementReady.documentId, "Start did not replace the source document", {
        sourceReady,
        replacementReady,
      });
      assertion(reloadEvents.length === 1, "Start did not issue exactly one reload request", reloadEvents);
      assertion(commitEvents.length === 1, "Replacement document did not bind the pending session", commitEvents);
      assertion(
        startResponse.session.token === painted.record?.token &&
          startResponse.session.generation === painted.record?.generation,
        "Replacement document adopted a different durable generation",
        { startResponse, record: painted.record },
      );
      return { sourceReady, replacementReady, reloadEvents, commitEvents, session: startResponse.session };
    });

    await check("replacement-adopts-before-page-context", async () => {
      assertion(painted.adoptIndex >= 0, "Replacement document did not request render-inspection adoption", painted);
      assertion(painted.pageContextIndex >= 0, "Replacement document did not begin ordinary page.context", painted);
      assertion(
        painted.adoptIndex < painted.pageContextIndex,
        "Ordinary page.context began before render-inspection adoption",
        { frameNames: painted.frameNames, adoptIndex: painted.adoptIndex, pageContextIndex: painted.pageContextIndex },
      );
      assertion(painted.pendingPageContexts === 1 && painted.pageContextResponses === 0,
        "Deferred page.context unexpectedly resolved during early adoption", painted);
      return {
        frameNames: painted.frameNames,
        adoptIndex: painted.adoptIndex,
        pageContextIndex: painted.pageContextIndex,
        pendingPageContexts: painted.pendingPageContexts,
      };
    });

    await check("curtain-painted-before-acknowledgement", async () => {
      const rect = painted.curtain?.rect;
      const viewport = browserEnvironment.viewport;
      assertion(painted.pendingAcks === 1, "Double-rAF paint acknowledgement was not held", painted);
      assertion(painted.curtain?.connected === true, "Curtain was not connected while paint ack was pending", painted.curtain);
      assertion(rect && rect.width >= viewport.width - 2 && rect.height >= viewport.height - 2,
        "Curtain did not physically cover the viewport", { rect, viewport });
      assertion(topLayer.popoverOpen, "The adversarial page popover was not open", topLayer);
      assertion(topLayer.popoverInert && topLayer.popoverPointerEvents === "none",
        "Early inspection lease did not neutralize the page-owned top layer", topLayer);
      assertion(topLayer.authoredButtonPointerEvents === "auto",
        "Fixture lost its explicit page-child pointer targeting", topLayer);
      assertion(topLayer.hit.curtain === "true" || topLayer.hit.shield === "true",
        "Page-owned top layer remained the physical hit target", topLayer);
      return { pendingAcks: painted.pendingAcks, curtain: painted.curtain, topLayer };
    });

    await check("curtain-carries-exact-session-identity", async () => {
      const session = painted.record;
      const curtain = painted.curtain;
      assertion(session?.phase === "adopted", "Durable session was not adopted", session);
      assertion(
        session?.tabId === 76 &&
          session?.property?.environmentKey === "p16.test" &&
          session?.property?.siteId === 16 &&
          session?.property?.baseUrl === origin &&
          session?.pageUrl === fixtureUrl &&
          session?.javascriptEnabled === false &&
          session?.sourceDocumentId === sourceReady.documentId &&
          session?.documentId === replacementReady.documentId,
        "Durable session lost its exact tab, property, mode, or document scope",
        { session, origin, fixtureUrl, sourceReady, replacementReady },
      );
      assertion(
        curtain?.token === session.token &&
          curtain?.generation === String(session.generation) &&
          curtain?.documentNonce === session.documentNonce &&
          curtain?.mode === "static" &&
          curtain?.extensionUi === "true",
        "Curtain identity or mode did not exactly match durable authority",
        { curtain, session },
      );
      return { curtain, session };
    });

    const beforePanelClose = await snapshot();
    const afterPanelClose = await page.evaluate(() => window.__p16Runtime.closePanelProjection());
    await check("panel-close-does-not-cancel", async () => {
      assertion(afterPanelClose.record?.phase === "adopted", "Closing panel projection ended the session", afterPanelClose);
      assertion(
        afterPanelClose.record?.token === beforePanelClose.record?.token &&
          afterPanelClose.record?.generation === beforePanelClose.record?.generation &&
          afterPanelClose.pendingAcks === beforePanelClose.pendingAcks,
        "Panel close mutated durable inspection authority",
        { beforePanelClose, afterPanelClose },
      );
      return { before: beforePanelClose.record, after: afterPanelClose.record };
    });

    const beforeRestart = await snapshot();
    const afterRestart = await page.evaluate(() => window.__p16Runtime.restartWorker());
    await check("worker-restart-reconstructs-session", async () => {
      const reloadsBefore = beforeRestart.durableEvents.filter((event) => event.name === "reload-requested").length;
      const reloadsAfter = afterRestart.durableEvents.filter((event) => event.name === "reload-requested").length;
      assertion(afterRestart.workerRestarts === 1, "Fixture did not recreate the background runtime", afterRestart);
      assertion(
        afterRestart.record?.phase === "adopted" &&
          afterRestart.record?.token === beforeRestart.record?.token &&
          afterRestart.record?.generation === beforeRestart.record?.generation &&
          afterRestart.record?.documentNonce === beforeRestart.record?.documentNonce,
        "Fresh runtime did not reconstruct the durable adopted session",
        { beforeRestart, afterRestart },
      );
      assertion(reloadsAfter === reloadsBefore, "Restart reloaded an already adopted document", {
        reloadsBefore,
        reloadsAfter,
      });
      return { before: beforeRestart.record, after: afterRestart.record, workerRestarts: afterRestart.workerRestarts };
    });

    const staleResponse = await page.evaluate(() => window.__p16Runtime.sendStaleAcknowledgement());
    const afterStale = await snapshot();
    await check("stale-acknowledgement-is-rejected", async () => {
      assertion(staleResponse?.status === "stale", "Stale paint acknowledgement was not rejected", staleResponse);
      assertion(
        afterStale.record?.phase === "adopted" &&
          afterStale.curtain?.connected === true &&
          afterStale.pendingAcks === 1,
        "Stale acknowledgement changed the active session or curtain",
        afterStale,
      );
      return { response: staleResponse, session: afterStale.record, curtain: afterStale.curtain };
    });

    const matchingRelease = await page.evaluate(() => window.__p16Runtime.releaseMatchingAcknowledgement());
    await page.waitForFunction(
      () => document.querySelector('[data-uf-render-inspection-curtain="true"]') === null &&
        document.querySelector('[data-uf-interaction-shield="true"]') === null,
      undefined,
      { timeout: 10_000 },
    );
    const afterMatching = await snapshot();
    scenarioEvidence.paintTerminal = { staleResponse, afterStale, matchingRelease, afterMatching };
    await check("matching-acknowledgement-is-terminal", async () => {
      const response = matchingRelease.responses?.[0];
      assertion(matchingRelease.released === 1, "Matching held acknowledgement was not released exactly once", matchingRelease);
      assertion(
        response?.status === "ok" &&
          response.session?.phase === "terminal" &&
          response.session?.terminalReason === "paint-acknowledged",
        "Matching acknowledgement did not become the exact terminal authority",
        response,
      );
      assertion(
        afterMatching.record?.phase === "terminal" &&
          afterMatching.record?.terminalReason === "paint-acknowledged",
        "Durable record did not retain matching paint success",
        afterMatching.record,
      );
      return { response, durable: afterMatching.record };
    });

    await check("matching-terminal-clears-curtain", async () => {
      assertion(afterMatching.curtain === null, "Matching terminal reply left the curtain mounted", afterMatching);
      const local = await page.evaluate(() => ({
        curtains: document.querySelectorAll('[data-uf-render-inspection-curtain="true"]').length,
        shields: document.querySelectorAll('[data-uf-interaction-shield="true"]').length,
      }));
      assertion(local.curtains === 0 && local.shields === 0,
        "Matching terminal reply retained local inspection input surfaces", local);
      return local;
    });

    const terminalMatrix = await page.evaluate(() => window.__p16Runtime.runTerminalMatrix());
    scenarioEvidence.terminals = terminalMatrix;
    await check("terminal-matrix-is-exact", async () => {
      const expected = {
        cancel: "cancelled",
        failure: "content-failed",
        navigation: "unexpected-navigation",
        timeout: "timeout",
        unregister: "unregistered",
      };
      assertion(terminalMatrix.outcomes.length === Object.keys(expected).length,
        "Terminal matrix has the wrong number of paths", terminalMatrix);
      for (const outcome of terminalMatrix.outcomes) {
        const expectedReason = expected[outcome.path];
        assertion(expectedReason !== undefined, "Terminal matrix returned an unknown path", outcome);
        assertion(
          outcome.terminal?.phase === "terminal" &&
            outcome.terminal?.terminalReason === expectedReason,
          `Terminal path ${outcome.path} resolved to the wrong reason`,
          outcome,
        );
        if (outcome.response) {
          assertion(outcome.response.status === "ok", `Terminal mutation ${outcome.path} was rejected`, outcome);
        }
      }
      return terminalMatrix.outcomes;
    });

    await check("generation-is-monotonic", async () => {
      const generations = [startResponse.session.generation, ...terminalMatrix.generations];
      assertion(generations.every((generation, index) => index === 0 || generation === generations[index - 1] + 1),
        "Durable inspection generations were not strictly monotonic", generations);
      assertion(new Set(generations).size === generations.length,
        "A durable inspection generation was reused", generations);
      return { generations };
    });

    const finalSnapshot = await snapshot();
    await check("legacy-inspection-facts-have-no-authority", async () => {
      const serializedEvidence = JSON.stringify({
        frames: finalSnapshot.frameNames,
        durableEvents: finalSnapshot.durableEvents,
      });
      assertion(finalSnapshot.legacyInspectionFacts === 0,
        "A legacy inspectionPending fact was emitted", finalSnapshot);
      assertion(!serializedEvidence.includes("inspectionPending"),
        "Browser evidence contains legacy inspectionPending authority", serializedEvidence);
      return {
        legacyInspectionFacts: finalSnapshot.legacyInspectionFacts,
        frameNames: finalSnapshot.frameNames,
      };
    });

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
    throw new Error(`Unable to retain P16 browser results (HTTP ${response.status})`);
  }
  if (fatalError) {
    throw new Error(fatalError);
  }
  return { checks: checks.length, passed: checks.filter((entry) => entry.pass).length };
}
