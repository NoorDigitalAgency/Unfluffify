/* eslint-disable @typescript-eslint/no-unused-expressions -- playwright-cli requires a bare function expression. */
async (page) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error?.stack || error)));
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  await page.goto(page.url().replace(/\/$/, "") + "/fixture", { waitUntil: "load" });
  await page.waitForFunction(
    () => Boolean(window.__p23Runtime),
    undefined,
    { polling: 10, timeout: 5_000 },
  );
  const environment = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight },
    devicePixelRatio,
  }));
  environment.browserVersion = page.context().browser()?.version() ?? null;
  const targets = await page.evaluate(() => window.__p23Runtime.targetPoints());
  const hovers = [];
  for (const target of targets) {
    await page.mouse.move(target.x, target.y);
    try {
      await page.waitForFunction(
        (xpath) => window.__p23Runtime.hoverState().currentXpath === xpath,
        target.xpath,
        { polling: 5, timeout: 500 },
      );
    } catch (error) {
      const state = await page.evaluate(() => window.__p23Runtime.hoverState());
      throw new Error(
        "P23 hover did not settle for " + target.xpath + ": " +
        JSON.stringify(state),
        { cause: error },
      );
    }
    hovers.push({
      target,
      state: await page.evaluate(() => window.__p23Runtime.hoverState()),
    });
  }

  await page.evaluate(() => window.__p23Runtime.enterSilent());
  const silentBefore = await page.evaluate(() => window.__p23Runtime.silentState());
  await page.mouse.wheel(0, 240);
  let silentDuring;
  try {
    await page.waitForFunction(
      () => {
        const state = window.__p23Runtime.silentState();
        return state.retained && state.allBoxesRetained && !state.geometryChanged &&
          state.rootScrolling && state.allRetainedLayersTransparent;
      },
      undefined,
      { polling: 1, timeout: 500 },
    );
    silentDuring = await page.evaluate(() => window.__p23Runtime.silentState());
  } catch (error) {
    const state = await page.evaluate(() => window.__p23Runtime.silentState());
    throw new Error(
      "P23 silent layers did not fade before geometry reposition: " + JSON.stringify(state),
      { cause: error },
    );
  }
  try {
    await page.waitForFunction(
      (initialTop) => {
        const state = window.__p23Runtime.silentState();
        return state.retained && state.allBoxesRetained && state.currentTop !== initialTop &&
          state.geometryChanged && state.latencyMs !== null && !state.rootScrolling &&
          state.allRetainedLayersVisible;
      },
      silentBefore.initialTop,
      { polling: 5, timeout: 500 },
    );
  } catch (error) {
    const state = await page.evaluate(() => window.__p23Runtime.silentState());
    throw new Error(
      "P23 silent geometry did not settle: " + JSON.stringify(state),
      { cause: error },
    );
  }
  const silentAfter = await page.evaluate(() => window.__p23Runtime.silentState());
  await page.waitForTimeout(50);
  const semantic = await page.evaluate(() => window.__p23Runtime.semanticState());
  const scheduling = await page.evaluate(() => window.__p23Runtime.schedulingState());
  const response = await page.evaluate(async (payload) => {
    const result = await fetch("/results", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { ok: result.ok, status: result.status };
  }, {
    environment,
    targets,
    hovers,
    silentBefore,
    silentDuring,
    silentAfter,
    semantic,
    scheduling,
    pageErrors,
    consoleErrors,
  });
  if (!response.ok) {
    throw new Error("Unable to retain P23 results (HTTP " + response.status + ")");
  }
  await page.evaluate(() => window.__p23Runtime.dispose());
  return {
    targets: targets.length,
    maxHoverLatencyMs: Math.max(...hovers.map((entry) => entry.state.latencyMs)),
  };
}
