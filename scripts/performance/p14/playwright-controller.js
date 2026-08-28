/* eslint-disable @typescript-eslint/no-unused-expressions -- playwright-cli requires a bare function expression. */
async (page) => {
  const initialUrl = page.url();
  const pathStart = initialUrl.indexOf("/", initialUrl.indexOf("//") + 2);
  const baseUrl = pathStart >= 0 ? initialUrl.slice(0, pathStart) : initialUrl;
  const plan = await page.evaluate(async () => (await fetch("/plan.json")).json());
  const benchmarkOrigin = "http://p14.test";
  await page.route(`${benchmarkOrigin}/**`, async (route) => {
    const upstream = route.request().url().replace(benchmarkOrigin, baseUrl);
    const response = await route.fetch({ url: upstream });
    await route.fulfill({ response });
  });
  const runs = [];
  const semanticSignatures = {};
  const semanticJson = {};
  const pageErrors = [];
  let environment = null;
  page.on("pageerror", (error) => pageErrors.push(String(error?.stack || error)));

  const retainSemantics = (scenario, stage, signature) => {
    if (!signature) {
      return null;
    }
    const key = `${scenario.fixture}/${scenario.mode}/${scenario.runtime}/${stage}`;
    // Coverage counts describe each runtime's larger internal overlay domain
    // and can vary with collapsed/nonpaintable wrapper geometry. Determinism is
    // required for the complete canonical rows/classes; raw coverage is kept on
    // every run below rather than used as a semantic equality field.
    const serialized = JSON.stringify({ rows: signature.rows, classes: signature.classes });
    if (semanticJson[key] && semanticJson[key] !== serialized) {
      const previous = JSON.parse(semanticJson[key]);
      const next = JSON.parse(serialized);
      const firstDifference = (field) => {
        const length = Math.max(previous[field]?.length ?? 0, next[field]?.length ?? 0);
        for (let index = 0; index < length; index += 1) {
          if (JSON.stringify(previous[field]?.[index]) !== JSON.stringify(next[field]?.[index])) {
            return { field, index, previous: previous[field]?.[index] ?? null, next: next[field]?.[index] ?? null };
          }
        }
        return null;
      };
      throw new Error(`Non-deterministic canonical semantic signature for ${key}: ${JSON.stringify(
        firstDifference("rows") ?? firstDifference("classes"),
      )}`);
    }
    if (!semanticJson[key]) {
      semanticJson[key] = serialized;
      semanticSignatures[key] = signature;
    }
    return key;
  };

  const installLongTaskCapture = () => page.evaluate(() => {
    const supported = typeof PerformanceObserver === "function"
      && PerformanceObserver.supportedEntryTypes?.includes("longtask") === true;
    const entries = [];
    const retain = (entry) => entries.push({
      name: entry.name,
      entryType: entry.entryType,
      startTime: entry.startTime,
      duration: entry.duration,
    });
    const observer = supported
      ? new PerformanceObserver((list) => list.getEntries().forEach(retain))
      : null;
    observer?.observe({ type: "longtask", buffered: true });
    window.__p14LongTaskCapture = { supported, entries, observer, retain };
    return { supported };
  });

  const beginInputWindow = (operation) => page.evaluate((operationName) => ({
    operation: operationName,
    startTime: performance.now(),
  }), operation);

  const finishInputWindow = (windowStart) => page.evaluate((start) => {
    const capture = window.__p14LongTaskCapture;
    capture?.observer?.takeRecords().forEach(capture.retain);
    const endTime = performance.now();
    const entries = (capture?.entries ?? []).filter((entry) =>
      entry.startTime <= endTime && entry.startTime + entry.duration >= start.startTime
    );
    return {
      operation: start.operation,
      startTime: start.startTime,
      endTime,
      durationMs: endTime - start.startTime,
      supported: capture?.supported === true,
      entries,
      maxDurationMs: entries.length > 0
        ? Math.max(...entries.map((entry) => entry.duration))
        : 0,
    };
  }, windowStart);

  for (const scenario of plan.scenarios) {
    const pageErrorStart = pageErrors.length;
    // Stable per-corpus URLs let legacy enable clear/rebuild the same current
    // page entry on every sample. A sequence URL would accumulate stale draft
    // entries in the shared origin config and bias later timed scans.
    const url = `${benchmarkOrigin}/fixture?fixture=${scenario.fixture}&runtime=${scenario.runtime}&mode=${scenario.mode}`;
    await page.goto(url, { waitUntil: "load" });
    try {
      await page.waitForFunction(() => Boolean(window.__p14Runtime), undefined, { timeout: 5_000 });
    } catch (error) {
      throw new Error(`Runtime bundle failed to initialize for ${scenario.runtime}: ${pageErrors.join("\n") || error}`, { cause: error });
    }

    if (!environment) {
      environment = await page.evaluate(() => ({
        userAgent: navigator.userAgent,
        appVersion: navigator.appVersion,
        userAgentBrands: navigator.userAgentData?.brands ?? null,
        browserVersion: null,
        platform: navigator.platform,
        viewport: { width: innerWidth, height: innerHeight },
        devicePixelRatio,
        language: navigator.language,
      }));
      const browser = page.context().browser();
      environment.browserVersion = browser?.version() ?? null;
      environment.browserType = browser?.browserType().name() ?? null;
    }

    try {
      await installLongTaskCapture();
      const activation = await page.evaluate(
        ({ mode, selectors }) => window.__p14Runtime.activate(mode, selectors),
        { mode: scenario.mode, selectors: plan.selectorsByMode[scenario.mode] },
      );
      const before = await page.evaluate(() => window.__p14Runtime.semantics());
      const timings = {
        [scenario.mode === "silent" ? "silentActivation" : "markingActivation"]: activation.durationMs,
      };
      let afterClick = null;
      let mutationPressure = null;
      const inputLongTasks = [];

      if (scenario.mode === "marking") {
        if (scenario.fixture === "large" && scenario.runtime === "rewrite") {
          await page.evaluate(() => window.__p14Runtime.startMutationPressure());
        }
        const point = await page.evaluate(() => window.__p14Runtime.point("click-target"));
        await page.mouse.move(4, 4);
        // Exclusion creation and its hover preview are Shift-only. Keep the
        // physical modifier held through both samples so this gate benchmarks
        // the production gesture instead of the ordinary-click unmark/no-op
        // path.
        await page.keyboard.down("Shift");
        const hoverWindow = await beginInputWindow("markingHover");
        await page.evaluate(() => window.__p14Runtime.armHover());
        await page.mouse.move(point.x, point.y);
        timings.markingHover = await page.evaluate(() => window.__p14Runtime.finishHover());
        inputLongTasks.push(await finishInputWindow(hoverWindow));

        const clickWindow = await beginInputWindow("markingClickCommitPaint");
        await page.evaluate(() => window.__p14Runtime.armClick());
        await page.mouse.click(point.x, point.y);
        await page.keyboard.up("Shift");
        const clickResult = await page.evaluate(() => window.__p14Runtime.finishClick());
        timings.markingClickCommitPaint = clickResult.durationMs;
        inputLongTasks.push(await finishInputWindow(clickWindow));
        afterClick = await page.evaluate(() => window.__p14Runtime.semantics());
        if (scenario.fixture === "large" && scenario.runtime === "rewrite") {
          mutationPressure = await page.evaluate(() => window.__p14Runtime.stopMutationPressure());
        }
      }

      const scrollOperation = scenario.mode === "silent"
        ? "silentScrollReposition"
        : "markingScrollReposition";
      const scrollWindow = await beginInputWindow(scrollOperation);
      await page.evaluate(() => window.__p14Runtime.prepareScroll());
      await page.mouse.wheel(0, 160);
      timings[scrollOperation] =
        await page.evaluate(() => window.__p14Runtime.finishScroll());
      inputLongTasks.push(await finishInputWindow(scrollWindow));

      // Scroll and mutation are independent operations. Restore the initial
      // viewport and let each shipping reposition path settle before timing the
      // structural observer, so an offscreen bridge refresh is not a confound.
      await page.evaluate(() => window.__p14Runtime.resetScrollForMutation());
      await page.evaluate(() => window.__p14Runtime.quiesceBeforeMutation());
      timings[scenario.mode === "silent" ? "silentMutationStabilization" : "markingMutationStabilization"] =
        await page.evaluate(() => window.__p14Runtime.mutateAndWait());
      const afterMutation = await page.evaluate(() => window.__p14Runtime.semantics());

      runs.push({
        ...scenario,
        activation,
        mutationPressure,
        timings,
        inputLongTasks,
        semanticRefs: {
          before: retainSemantics(scenario, "before", before),
          afterClick: retainSemantics(scenario, "after-click", afterClick),
          afterMutation: retainSemantics(scenario, "after-mutation", afterMutation),
        },
        semanticCoverage: {
          before: before.classificationCoverage,
          afterClick: afterClick?.classificationCoverage ?? null,
          afterMutation: afterMutation.classificationCoverage,
        },
      });
      const scenarioPageErrors = pageErrors.slice(pageErrorStart);
      if (scenarioPageErrors.length > 0) {
        throw new Error(`Uncaught page errors: ${scenarioPageErrors.join("\n")}`);
      }
    } catch (error) {
      throw new Error(`P14 scenario ${JSON.stringify(scenario)} failed: ${error?.stack || error}`, { cause: error });
    } finally {
      await page.evaluate(() => window.__p14Runtime?.dispose()).catch(() => undefined);
    }
  }

  const response = await page.evaluate(async (payload) => {
    const result = await fetch("/results", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { ok: result.ok, status: result.status };
  }, { environment, runs, semanticSignatures, pageErrors });
  if (!response.ok) {
    throw new Error(`Unable to retain P14 browser results (HTTP ${response.status})`);
  }
  return { scenarios: runs.length, environment };
}
