/* eslint-disable @typescript-eslint/no-unused-expressions -- playwright-cli requires a bare function expression. */
async (page) => {
  const checks = [];
  const pageErrors = [];
  const consoleErrors = [];
  const evidence = {};
  const initialUrl = page.url();
  const pathStart = initialUrl.indexOf("/", initialUrl.indexOf("//") + 2);
  const origin = pathStart >= 0 ? initialUrl.slice(0, pathStart) : initialUrl;
  const browserContract = await page.evaluate(() => window.__p20Contract);
  const lockCases = browserContract.lockCases;
  const watchdogMs = browserContract.spaceWatchdogMs;

  const assertion = (condition, message, detail) => {
    if (!condition) {
      throw new Error(`${message}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
    }
  };
  const check = async (id, run) => {
    try {
      const result = await run();
      checks.push({ id, pass: true, evidence: result ?? null });
      evidence[id] = result ?? null;
    } catch (error) {
      const failure = String(error?.stack || error);
      checks.push({ id, pass: false, error: failure });
      evidence[id] = { error: failure };
    }
  };
  const observe = (target, realm) => {
    target.on("pageerror", (error) => pageErrors.push(`[${realm}] ${String(error?.stack || error)}`));
    target.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(`[${realm}] ${message.text()}`);
    });
  };
  const contentCall = (target, method, ...args) => target.evaluate(
    ({ methodName, methodArgs }) => window.__p18ContentRuntime[methodName](...methodArgs),
    { methodName: method, methodArgs: args },
  );
  const popupCall = (target, method, ...args) => target.evaluate(
    ({ methodName, methodArgs }) => window.__p20PopupRuntime[methodName](...methodArgs),
    { methodName: method, methodArgs: args },
  );
  const waitForContent = async (target) => {
    await target.waitForFunction(() => window.__p18ContentRuntime?.readyState() !== "booting", undefined, { timeout: 15_000 });
    const ready = await target.evaluate(() => ({
      state: window.__p18ContentRuntime?.readyState(),
      error: window.__p18ContentRuntime?.readyError(),
      fixture: window.__p18Fixture,
    }));
    assertion(ready.state === "ready", "P20 content runtime failed", ready);
    await target.waitForFunction(async () => {
      try {
        return (await window.__p18ContentRuntime.snapshot()).status !== null;
      } catch {
        return false;
      }
    }, undefined, { timeout: 15_000 });
    return ready;
  };
  const waitForPopup = async (target, variant) => {
    await target.waitForFunction(() => window.__p20PopupRuntime?.readyState() !== "booting", undefined, { timeout: 15_000 });
    const ready = await target.evaluate(() => ({
      state: window.__p20PopupRuntime?.readyState(),
      error: window.__p20PopupRuntime?.readyError(),
      debugBuild: window.__p20PopupRuntime?.debugBuild(),
    }));
    assertion(ready.state === "ready", `P20 ${variant} popup runtime failed`, ready);
    assertion(ready.debugBuild === (variant === "debug"), `P20 ${variant} build literal drifted`, ready);
    return ready;
  };
  const spaceSnapshot = (target) => target.evaluate(async () => {
    const status = await window.__p18ContentRuntime.snapshot();
    const root = document.querySelector(".uf-marking-layer-root");
    return {
      url: location.href,
      active: status.status?.data?.active ?? null,
      rootConnected: Boolean(root?.isConnected),
      rootPointerEvents: root ? getComputedStyle(root).pointerEvents : null,
      cursorPassthrough: document.documentElement.classList.contains("uf-cursor-passthrough"),
      rootTemporarilyDisabled: root?.classList.contains("uf-marking-temporarily-disabled") ?? false,
    };
  });
  const waitForSpace = async (target, active) => {
    await target.waitForFunction((expected) => {
      const root = document.querySelector(".uf-marking-layer-root");
      const cursor = document.documentElement.classList.contains("uf-cursor-passthrough");
      const transparent = root ? getComputedStyle(root).pointerEvents === "none" : false;
      return expected ? cursor && transparent : !cursor && (!root || getComputedStyle(root).pointerEvents !== "none");
    }, active, { timeout: 4_000, polling: 20 });
    return spaceSnapshot(target);
  };

  let fatalError = null;
  let contentPage = null;
  let productionPage = null;
  let debugPage = null;
  observe(page, "gate-root");
  try {
    contentPage = await page.context().newPage();
    observe(contentPage, "content-production");
    await contentPage.goto(`${origin}/content?variant=production`, { waitUntil: "load" });
    const contentReady = await waitForContent(contentPage);
    const activation = await contentCall(contentPage, "activateMarking");
    await contentPage.waitForFunction(() => window.__p18PageState.pageWorldCommands >= 1, undefined, { timeout: 5_000 });
    const readinessStarted = Date.now();
    await contentPage.waitForFunction(() => {
      const curtain = document.querySelector('[data-uf-content-curtain-copy="true"]');
      return curtain?.textContent !== "Inspecting page... it will be ready soon";
    }, undefined, { timeout: 25_000, polling: 100 });
    const targetBox = await contentPage.locator("#p18-mark-target").boundingBox();
    assertion(targetBox, "P20 marking target has no physical box");
    const targetPoint = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };
    await contentPage.waitForFunction(({ x, y }) => {
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit?.closest?.(".uf-marking-layer-root")) &&
        document.elementsFromPoint(x, y).some((element) => element.id === "p18-mark-target");
    }, targetPoint, { timeout: Math.max(1, 25_000 - (Date.now() - readinessStarted)), polling: 100 });

    await check("space-passthrough-recovers-on-every-boundary", async () => {
      const baseline = await spaceSnapshot(contentPage);
      assertion(baseline.active === true && baseline.rootPointerEvents === "auto", "Marking was not active before Space recovery", baseline);

      await contentPage.keyboard.down("Space");
      const keydown = await waitForSpace(contentPage, true);
      await contentPage.keyboard.up("Space");
      const keyup = await waitForSpace(contentPage, false);

      await contentPage.keyboard.down("Space");
      await waitForSpace(contentPage, true);
      await contentPage.evaluate(() => window.dispatchEvent(new Event("blur")));
      const blur = await waitForSpace(contentPage, false);
      await contentPage.keyboard.up("Space");

      await contentPage.keyboard.down("Space");
      await waitForSpace(contentPage, true);
      await contentPage.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      const visibility = await waitForSpace(contentPage, false);
      await contentPage.keyboard.up("Space");

      await contentPage.keyboard.down("Space");
      const missedKeyupStart = await waitForSpace(contentPage, true);
      const missedKeyupStartedAt = Date.now();
      const watchdog = await waitForSpace(contentPage, false);
      const watchdogElapsedMs = Date.now() - missedKeyupStartedAt;
      await contentPage.keyboard.up("Space");
      assertion(watchdogElapsedMs >= watchdogMs - 80 && watchdogElapsedMs < watchdogMs + 1_000, "Missed-keyup watchdog drifted", { watchdogElapsedMs, watchdogMs });

      await contentPage.keyboard.down("Space");
      await waitForSpace(contentPage, true);
      const beforeNavigationUrl = contentPage.url();
      await contentPage.evaluate(() => {
        history.pushState({}, "", `${location.pathname}?p20-spa=1`);
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      await contentPage.waitForFunction(async () => {
        const snapshot = await window.__p18ContentRuntime.snapshot();
        return snapshot.status?.data?.active === false &&
          !document.documentElement.classList.contains("uf-cursor-passthrough") &&
          !document.querySelector(".uf-marking-layer-root");
      }, undefined, { timeout: 5_000 });
      const navigation = await spaceSnapshot(contentPage);
      await contentPage.keyboard.up("Space");

      assertion(keydown.cursorPassthrough && keydown.rootPointerEvents === "none", "Space keydown did not release page input", keydown);
      for (const [name, snapshot] of Object.entries({ keyup, blur, visibility, watchdog })) {
        assertion(!snapshot.cursorPassthrough && snapshot.rootPointerEvents === "auto", `${name} did not restore marking input`, snapshot);
      }
      assertion(navigation.active === false && !navigation.cursorPassthrough && !navigation.rootConnected, "Same-document navigation did not retire marking passthrough", navigation);
      return { contentReady, activation, targetPoint, baseline, keydown, keyup, blur, visibility, missedKeyupStart, watchdog, watchdogElapsedMs, beforeNavigationUrl, navigation };
    });

    productionPage = await page.context().newPage();
    debugPage = await page.context().newPage();
    observe(productionPage, "popup-production");
    observe(debugPage, "popup-debug");
    await productionPage.goto(`${origin}/popup?variant=production`, { waitUntil: "load" });
    await debugPage.goto(`${origin}/popup?variant=debug`, { waitUntil: "load" });
    const productionReady = await waitForPopup(productionPage, "production");
    const debugReady = await waitForPopup(debugPage, "debug");

    let productionSnapshots = [];
    await check("production-lock-copy-is-curated", async () => {
      productionSnapshots = [];
      for (const lockCase of lockCases) {
        const snapshot = await popupCall(productionPage, "setLockCase", lockCase, false);
        assertion(snapshot.statusText === lockCase.expected, "Production lock copy drifted", { lockCase, snapshot });
        assertion(snapshot.statusOccurrences === 1, "Production repeated its curated lock sentence", { lockCase, snapshot });
        assertion(snapshot.detailText === null && snapshot.fence === null, "Production exposed raw lock diagnostics", { lockCase, snapshot });
        assertion(
          !(snapshot.lockText || "").includes("status ") && !(snapshot.lockText || "").includes(" · role "),
          "Production lock copy contained raw fields",
          { lockCase, snapshot },
        );
        productionSnapshots.push(snapshot);
      }
      const operation = await popupCall(productionPage, "setLockCase", lockCases.find((entry) => entry.id === "editor"), true);
      assertion(operation.operationId === null && operation.operationText === null, "Production exposed a raw operation ID", operation);
      return { productionReady, corpus: productionSnapshots, activeOperation: operation };
    });

    await check("debug-lock-fence-and-operation-are-retained", async () => {
      const debugSnapshots = [];
      for (const lockCase of lockCases) {
        const snapshot = await popupCall(debugPage, "setLockCase", lockCase, false);
        assertion(snapshot.statusText === lockCase.expected, "Debug build changed curated lock copy", { lockCase, snapshot });
        assertion(snapshot.detailText?.includes(`status ${lockCase.status}`), "Debug lock status missing", { lockCase, snapshot });
        assertion(snapshot.detailText?.includes(`role ${lockCase.role}`) && snapshot.detailText?.includes("site 60"), "Debug role/site missing", { lockCase, snapshot });
        const expectedFence = lockCase.role === "editor" ? "property 41 · feed 73" : "property — · feed —";
        assertion(snapshot.fence === expectedFence && snapshot.detailText?.includes(expectedFence), "Debug fence detail missing", { lockCase, expectedFence, snapshot });
        debugSnapshots.push(snapshot);
      }
      const operation = await popupCall(debugPage, "setLockCase", lockCases.find((entry) => entry.id === "editor"), true);
      assertion(operation.operationId === "p20-operation-7f3a" && operation.operationText === "Operation p20-operation-7f3a", "Debug active operation detail missing", operation);
      return { debugReady, corpus: debugSnapshots, activeOperation: operation };
    });

    await check("no-browser-errors", async () => {
      assertion(pageErrors.length === 0 && consoleErrors.length === 0, "Browser errors were observed", { pageErrors, consoleErrors });
      const environment = await page.evaluate(() => ({
        userAgent: navigator.userAgent,
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      }));
      return { environment, pageErrors: [...pageErrors], consoleErrors: [...consoleErrors] };
    });
  } catch (error) {
    fatalError = String(error?.stack || error);
  } finally {
    await Promise.allSettled([contentPage?.close(), productionPage?.close(), debugPage?.close()]);
  }

  const browser = page.context().browser();
  const browserEnvironment = {
    browserType: browser?.browserType().name() ?? null,
    browserVersion: browser?.version() ?? null,
    ...await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    })),
  };
  const payload = { checks, pageErrors, consoleErrors, evidence, browserEnvironment, fatalError };
  const response = await page.evaluate(async ({ endpoint, body }) => {
    const result = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: result.ok, status: result.status, text: await result.text() };
  }, { endpoint: `${origin}/results`, body: payload });
  assertion(response.ok, "P20 result upload failed", response);
}
