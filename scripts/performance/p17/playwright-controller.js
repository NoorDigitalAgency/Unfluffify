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

  const assertion = (condition, message, evidence) => {
    if (!condition) {
      const suffix = evidence === undefined ? "" : `: ${JSON.stringify(evidence)}`;
      throw new Error(`${message}${suffix}`);
    }
  };
  const approximately = (left, right, tolerance = 3) => Math.abs(left - right) <= tolerance;
  const check = async (id, run) => {
    try {
      const evidence = await run();
      checks.push({ id, pass: true, evidence: evidence ?? null });
      return evidence;
    } catch (error) {
      checks.push({ id, pass: false, error: String(error?.stack || error) });
      return null;
    }
  };
  const runtimeCall = (method, ...args) => page.evaluate(
    ({ methodName, methodArgs }) => window.__p17Runtime[methodName](...methodArgs),
    { methodName: method, methodArgs: args },
  );
  const waitForRuntime = async (variant) => {
    await page.waitForFunction(
      () => window.__p17Runtime?.readyState() !== "booting",
      undefined,
      { timeout: 15_000 },
    );
    const ready = await page.evaluate(() => ({
      state: window.__p17Runtime?.readyState(),
      error: window.__p17Runtime?.readyError(),
      variant: window.__p17Fixture?.variant,
      debugBuild: window.__p17Runtime?.debugBuild(),
    }));
    assertion(ready.state === "ready", `P17 ${variant} runtime failed to initialize`, ready);
    assertion(ready.variant === variant, "P17 fixture variant drifted", ready);
    assertion(ready.debugBuild === (variant === "debug"), "P17 build literal drifted from fixture variant", ready);
    return ready;
  };
  const gotoVariant = async (variant) => {
    await page.goto(fixtureUrl(variant), { waitUntil: "load" });
    const ready = await waitForRuntime(variant);
    await page.waitForFunction(
      () => document.querySelector("#p17-extension-panel-host")?.shadowRoot
        ?.querySelectorAll(".preview-sidebar__item").length > 0,
      undefined,
      { timeout: 10_000 },
    );
    return ready;
  };
  const waitForCommand = (kind, rowId, active, afterSequence = 0) => page.waitForFunction(
    ({ expectedKind, expectedRowId, expectedActive, minimumSequence }) => {
      const matches = window.__p17Runtime.commandLog().filter((entry) =>
        entry.kind === expectedKind &&
        entry.rowId === expectedRowId &&
        entry.sequence > minimumSequence &&
        (expectedActive === null || entry.active === expectedActive)
      );
      const latest = matches.at(-1);
      return latest?.response?.ok === true && latest.response?.data?.targeted === true;
    },
    { expectedKind: kind, expectedRowId: rowId, expectedActive: active ?? null, minimumSequence: afterSequence },
    { timeout: 10_000 },
  );
  const waitForCenteredTarget = (fixtureId) => page.waitForFunction(
    (expectedFixtureId) => {
      const snapshot = window.__p17Runtime.targetSnapshot(expectedFixtureId);
      return snapshot.targetRect && Math.abs(snapshot.targetRect.centerY - snapshot.viewportCenterY) <= 4;
    },
    fixtureId,
    { timeout: 10_000 },
  );
  const waitForStableScroll = async () => {
    let previous = null;
    let stable = 0;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const current = await page.evaluate(() => scrollY);
      if (previous !== null && Math.abs(current - previous) <= 0.5) {
        stable += 1;
        if (stable >= 3) return current;
      } else {
        stable = 0;
      }
      previous = current;
      await page.waitForTimeout(50);
    }
    throw new Error(`P17 smooth scroll did not settle: ${previous}`);
  };

  let browserEnvironment = null;
  let fatalError = null;
  try {
    await gotoVariant("production");
    browserEnvironment = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio,
    }));
    const browser = page.context().browser();
    browserEnvironment.browserType = browser?.browserType().name() ?? null;
    browserEnvironment.browserVersion = browser?.version() ?? null;

    const expected = await runtimeCall("expectedCorpus");
    const initialProjection = await runtimeCall("projection");
    const productionPopup = await runtimeCall("popupSnapshot");
    const transportStages = await runtimeCall("transportStages");
    const shadow = await runtimeCall("shadowSnapshot");
    scenarioEvidence.initialProduction = {
      projection: initialProjection,
      popup: productionPopup,
      transport: transportStages,
      shadow,
    };

    await check("canonical-six-class-corpus", async () => {
      assertion(initialProjection?.rows?.length === 6, "Production projection did not contain exactly six rows", initialProjection);
      assertion(expected.length === 6, "Fixture oracle did not contain exactly six rows", expected);
      const actualClassifications = initialProjection.rows.map((row) => row.classification);
      const expectedClassifications = expected.map((row) => row.classification);
      assertion(
        JSON.stringify([...actualClassifications].sort()) === JSON.stringify([...expectedClassifications].sort()),
        "Canonical classification set drifted",
        { expectedClassifications, actualClassifications },
      );
      const ids = initialProjection.rows.map((row) => row.id);
      assertion(new Set(ids).size === 6, "Canonical row IDs were not unique", ids);
      const occurrenceMatch = initialProjection.projectionId.match(/^(.*)-occurrence-([1-9]\d*)$/);
      assertion(occurrenceMatch, "Projection ID omitted its preview occurrence", initialProjection.projectionId);
      const documentNamespace = occurrenceMatch[1];
      assertion(ids.every((id) => id.startsWith(`${documentNamespace}-row-`)), "Row ID escaped the stable document namespace", { projectionId: initialProjection.projectionId, documentNamespace, ids });
      const rows = expected.map((oracle) => {
        const actual = initialProjection.rows.find((row) => row.classification === oracle.classification);
        assertion(actual, "Canonical classification row is missing", oracle);
        assertion(actual.text === oracle.text, "Readable text drifted from canonical corpus", { oracle, actual });
        assertion(actual.shadow === oracle.shadow, "Shadow provenance drifted from canonical corpus", { oracle, actual });
        assertion(actual.selector === oracle.selector, "Selector provenance drifted from canonical corpus", { oracle, actual });
        assertion(/^\/[A-Za-z][A-Za-z0-9:_-]*\[[1-9]\d*\](?:\/[A-Za-z][A-Za-z0-9:_-]*\[[1-9]\d*\])*$/.test(actual.xpath), "Projection emitted a non-positional XPath", actual);
        return { oracle, actual };
      });
      return { projectionId: initialProjection.projectionId, documentNamespace, revision: initialProjection.revision, rows };
    });

    await check("lossless-content-bus-popup-roundtrip", async () => {
      const contentJson = JSON.stringify(transportStages?.content);
      const wireJson = JSON.stringify(transportStages?.wire);
      const popupJson = JSON.stringify(transportStages?.popup);
      assertion(contentJson === wireJson && wireJson === popupJson, "Preview model changed across content, bus, or popup", transportStages);
      assertion(transportStages?.frames?.length === 2, "Typed preview transport did not make exactly one request/reply pair", transportStages?.frames);
      const [request, reply] = transportStages.frames;
      assertion(
        request.name === "preview.project" && request.frameType === "request" && request.source === "popup" && request.target === "content",
        "Typed preview request frame drifted",
        request,
      );
      assertion(
        reply.name === "preview.project" && reply.frameType === "reply" && reply.ok === true && reply.source === "content" && reply.target === "popup",
        "Typed preview reply frame drifted",
        reply,
      );
      return transportStages;
    });

    await check("readable-text-normalized-safe-leading", async () => {
      assertion(productionPopup.rowCount === 6, "Production App did not render six rows", productionPopup);
      for (const row of productionPopup.rows) {
        assertion(row.copy === row.projectionRow?.text, "Rendered readable copy drifted from canonical projection", row);
        assertion(row.copy.length > 0 && row.copy.length <= 80, "Rendered readable copy violated the concise contract", row);
        assertion(row.copyIndex >= 0 && row.copyIndex < row.publicClassificationIndex, "Readable text did not lead the public classification", row);
        assertion(row.scriptCount === 0, "Readable page text created executable markup", row);
      }
      const hostile = productionPopup.rows.find((row) => row.fixtureId === "undetected");
      assertion(hostile?.copy.includes("<script> &"), "Hostile readable sentinel was not preserved as text", hostile);
      assertion(hostile?.outerHTML.includes("&lt;script&gt; &amp;"), "Hostile readable sentinel was not HTML-escaped", hostile);
      return productionPopup.rows.map((row) => ({ fixtureId: row.fixtureId, copy: row.copy, outerHTML: row.outerHTML }));
    });

    await check("production-simple-projection", async () => {
      const included = new Set(["explicit-included", "implicit-included", "undetected"]);
      const expectedStatuses = expected.map((row) => included.has(row.classification) ? "Included" : "Excluded");
      const actualStatuses = productionPopup.rows.map((row) => row.publicClassification);
      assertion(JSON.stringify(actualStatuses) === JSON.stringify(expectedStatuses), "Production App did not collapse to the two public statuses", { expectedStatuses, actualStatuses });
      assertion(new Set(actualStatuses).size === 2, "Production App exposed more or fewer than two public statuses", actualStatuses);
      return { expectedStatuses, actualStatuses };
    });

    await check("production-technical-detail-absent", async () => {
      const technicalLiterals = [
        ...initialProjection.rows.flatMap((row) => [row.id, row.xpath, row.selector, row.shadow, row.classification]),
        "data-preview-row-debug",
        "data-preview-row-id",
        "data-preview-row-debug-detail",
      ].filter(Boolean);
      for (const row of productionPopup.rows) {
        assertion(row.debugDetail === "", "Production row exposed a debug detail surface", row);
        assertion(!row.selfHasTitle && row.selfTitle === "", "Production row itself exposed a diagnostic tooltip", row);
        assertion(row.descendantTitleCount === 0 && row.descendantTitles.length === 0, "Production row descendant exposed a diagnostic tooltip", row);
        assertion(row.titleCount === 0, "Production row subtree exposed a diagnostic tooltip", row);
        for (const literal of technicalLiterals) {
          assertion(!row.outerHTML.includes(literal), "Production row leaked technical preview detail", { fixtureId: row.fixtureId, literal, outerHTML: row.outerHTML });
        }
      }
      assertion(!productionPopup.mainOuterHTML.includes("data-state-name"), "Production preview exposed debug state metadata", productionPopup.mainOuterHTML);
      return { rowOuterHtml: productionPopup.rows.map((row) => row.outerHTML), mainOuterHTML: productionPopup.mainOuterHTML };
    });

    await check("shadow-provenance-roundtrip", async () => {
      const implicit = initialProjection.rows.find((row) => row.classification === "implicit-included");
      const closed = initialProjection.rows.find((row) => row.classification === "closed-shadow");
      assertion(implicit?.shadow === "force-open-closed", "Force-open shadow descendant lost provenance", implicit);
      assertion(closed?.shadow === "inaccessible-closed", "Inaccessible shadow host lost terminal provenance", closed);
      assertion(shadow.forcedHostMarked && shadow.forcedHostRootReachable, "Force-open authored-closed host is not reachable and tagged", shadow);
      assertion(shadow.implicitRootIsShadow && shadow.implicitRootHostMatches, "Implicit row is not inside the tagged shadow root", shadow);
      assertion(shadow.inaccessibleHostMarked && !shadow.inaccessibleHostRootReachable, "Closed-shadow row is not a tagged inaccessible host", shadow);
      return { implicit, closed, shadow };
    });

    const interactionEvidence = [];
    for (const oracle of expected) {
      await runtimeCall("positionTargetForHover", oracle.fixtureId);
      await waitForStableScroll();
      const positioned = await runtimeCall("targetSnapshot", oracle.fixtureId);
      assertion(
          positioned.targetRect &&
          positioned.targetRect.top >= 76 &&
          positioned.targetRect.top + positioned.targetRect.height <= positioned.viewportCenterY - 40,
        "Hover fixture setup did not leave the exact target visible and off-center",
        positioned,
      );
      const point = await runtimeCall("rowPoint", oracle.fixtureId);
      assertion(point && point.rowId, "Preview row has no physical point", { oracle, point });
      const beforeHoverSequence = Math.max(0, ...(await runtimeCall("commandLog")).map((entry) => entry.sequence));
      await page.mouse.move(point.x, point.y);
      await waitForCommand("emphasize", point.rowId, true, beforeHoverSequence);
      await page.waitForFunction(
        (fixtureId) => window.__p17Runtime.targetSnapshot(fixtureId).hoverBoxes.length > 0,
        oracle.fixtureId,
        { timeout: 5_000 },
      );
      const hoverBeforeClick = await runtimeCall("targetSnapshot", oracle.fixtureId);
      assertion(hoverBeforeClick.hoverBoxes.length > 0, "Physical pointer hover did not paint an exact-target overlay", hoverBeforeClick);
      const targetRect = hoverBeforeClick.targetRect;
      const hoverRect = hoverBeforeClick.hoverBoxes[0]?.rect;
      assertion(targetRect && hoverRect, "Hover geometry evidence is incomplete", hoverBeforeClick);
      assertion(hoverBeforeClick.hoverBoxes.every((box) => box.xpath === hoverBeforeClick.row.xpath), "Hover overlay used a different row XPath", hoverBeforeClick);
      assertion(
        approximately(targetRect.left, hoverRect.left) &&
          approximately(targetRect.top, hoverRect.top) &&
          approximately(targetRect.width, hoverRect.width) &&
          approximately(targetRect.height, hoverRect.height),
        "Hover overlay geometry did not match the exact target",
        hoverBeforeClick,
      );

      const beforeClickSequence = Math.max(0, ...(await runtimeCall("commandLog")).map((entry) => entry.sequence));
      await page.mouse.click(point.x, point.y);
      await waitForCommand("activate", point.rowId, null, beforeClickSequence);
      await waitForCenteredTarget(oracle.fixtureId);
      const settledScrollY = await waitForStableScroll();
      await page.waitForTimeout(300);
      const clicked = await runtimeCall("targetSnapshot", oracle.fixtureId);

      const beforeLeaveSequence = Math.max(0, ...(await runtimeCall("commandLog")).map((entry) => entry.sequence));
      await page.mouse.move(8, 8);
      await waitForCommand("emphasize", point.rowId, false, beforeLeaveSequence);
      await page.waitForFunction(
        (fixtureId) => window.__p17Runtime.targetSnapshot(fixtureId).hoverBoxes.length === 0,
        oracle.fixtureId,
        { timeout: 5_000 },
      );
      const left = await runtimeCall("targetSnapshot", oracle.fixtureId);
      interactionEvidence.push({ oracle, positioned, point, settledScrollY, clicked, hoverBeforeClick, left });
    }
    scenarioEvidence.interactions = interactionEvidence;

    await check("pointer-hover-exact-target", async () => {
      assertion(interactionEvidence.length === 6, "Physical hover did not cover all six rows", interactionEvidence);
      for (const entry of interactionEvidence) {
        assertion(entry.hoverBeforeClick.hoverBoxes.length > 0, "A canonical row had no hover overlay", entry);
        assertion(entry.hoverBeforeClick.hoverBoxes.every((box) => box.xpath === entry.hoverBeforeClick.row.xpath), "A hover overlay targeted a different row", entry);
      }
      return interactionEvidence.map((entry) => ({ fixtureId: entry.oracle.fixtureId, target: entry.hoverBeforeClick.targetRect, boxes: entry.hoverBeforeClick.hoverBoxes }));
    });

    await check("pointer-leave-clears-emphasis", async () => {
      for (const entry of interactionEvidence) {
        assertion(entry.left.hoverBoxes.length === 0, "Pointer leave retained a hover overlay", entry);
      }
      return interactionEvidence.map((entry) => ({ fixtureId: entry.oracle.fixtureId, boxesAfterLeave: entry.left.hoverBoxes }));
    });

    await check("pointer-click-centers-exact-target", async () => {
      for (const entry of interactionEvidence) {
        assertion(
          approximately(entry.clicked.targetRect.centerY, entry.clicked.viewportCenterY, 4),
          "Physical row click did not center its exact target",
          entry,
        );
      }
      const activations = await runtimeCall("commandLog");
      const successful = activations.filter((entry) => entry.kind === "activate" && entry.response?.ok && entry.response?.data?.targeted);
      assertion(successful.length >= 6, "Not every physical click crossed the typed activation controller", successful);
      return { centers: interactionEvidence.map((entry) => ({ fixtureId: entry.oracle.fixtureId, target: entry.clicked.targetRect, viewportCenterY: entry.clicked.viewportCenterY })), successful };
    });

    const keyboardRows = productionPopup.rows.map((row) => ({
      fixtureId: row.fixtureId,
      tabIndex: row.tabIndex,
      role: row.role,
      controlTagName: row.controlTagName,
      controlTabIndex: row.controlTabIndex,
      controlAccessibleName: row.controlAccessibleName,
      copy: row.copy,
      publicClassification: row.publicClassification,
      projectionRow: row.projectionRow,
      interactiveDescendantCount: row.interactiveDescendantCount,
    }));
    await runtimeCall("focusBody");
    const tabSequence = [];
    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press("Tab");
      tabSequence.push(await runtimeCall("focusSnapshot"));
    }
    const programmaticFocus = [];
    for (const oracle of expected) {
      programmaticFocus.push({
        fixtureId: oracle.fixtureId,
        focus: await runtimeCall("focusRowProgrammatically", oracle.fixtureId),
      });
    }
    const keyboardTarget = keyboardRows.find((row) => row.fixtureId === "explicit");
    await runtimeCall("focusRowProgrammatically", "explicit");
    const beforeEnterSequence = Math.max(0, ...(await runtimeCall("commandLog")).map((entry) => entry.sequence));
    await page.keyboard.press("Enter");
    await waitForCommand("activate", keyboardTarget.projectionRow.id, null, beforeEnterSequence);
    const enterActivation = (await runtimeCall("commandLog")).filter((entry) =>
      entry.kind === "activate" && entry.rowId === keyboardTarget.projectionRow.id && entry.sequence > beforeEnterSequence
    ).at(-1);
    const beforeSpaceSequence = Math.max(0, ...(await runtimeCall("commandLog")).map((entry) => entry.sequence));
    await page.keyboard.press("Space");
    await waitForCommand("activate", keyboardTarget.projectionRow.id, null, beforeSpaceSequence);
    const spaceActivation = (await runtimeCall("commandLog")).filter((entry) =>
      entry.kind === "activate" && entry.rowId === keyboardTarget.projectionRow.id && entry.sequence > beforeSpaceSequence
    ).at(-1);
    const keyboardCommands = await runtimeCall("commandLog");
    await check("preview-rows-keyboard-operable", async () => {
      assertion(keyboardRows.every((row) => row.tabIndex === -1 && row.role === null && row.interactiveDescendantCount === 1), "A preview list item exposed the wrong interaction structure", keyboardRows);
      assertion(keyboardRows.every((row) => row.controlTagName === "BUTTON" && row.controlTabIndex === 0), "A preview row omitted its native button", keyboardRows);
      assertion(keyboardRows.every((row) => /^[1-6]\. /.test(row.controlAccessibleName) && row.controlAccessibleName.includes(`. ${row.copy}. ${row.publicClassification}`)), "A preview button omitted ordinal, readable label, or extraction status", keyboardRows);
      assertion(new Set(keyboardRows.map((row) => row.controlAccessibleName.split(".", 1)[0])).size === 6, "Preview button ordinals were not unique", keyboardRows);
      const tabbedRowTokens = new Set(tabSequence.filter((entry) => entry.withinPreviewRow).map((entry) => entry.previewRowNodeToken));
      assertion(tabbedRowTokens.size === 6, "Tab focus did not visit every preview row", tabSequence);
      assertion(programmaticFocus.every((entry) => entry.focus.withinPreviewRow && entry.focus.shadowActive?.tagName === "BUTTON"), "A preview button rejected programmatic focus", programmaticFocus);
      for (const row of keyboardRows) {
        assertion(keyboardCommands.some((entry) => entry.kind === "emphasize" && entry.rowId === row.projectionRow.id && entry.active === true), "Keyboard focus did not share pointer emphasis", { row, keyboardCommands });
      }
      assertion(enterActivation?.response?.ok && enterActivation.response.data?.targeted, "Enter did not activate the focused preview row", enterActivation);
      assertion(spaceActivation?.response?.ok && spaceActivation.response.data?.targeted, "Space did not activate the focused preview row", spaceActivation);
      return { keyboardRows, tabSequence, programmaticFocus, enterActivation, spaceActivation, keyboardCommands };
    });

    const selectorOnlyReprojection = await runtimeCall("selectorOnlyReprojection");
    scenarioEvidence.selectorOnlyReprojection = selectorOnlyReprojection;
    await check("selector-only-reprojection-advances-revision", async () => {
      const {
        selector,
        before,
        baselineRow,
        changed,
        changedRow,
        changedTransport,
        restored,
        restoredRow,
        restoredTransport,
      } = selectorOnlyReprojection;
      assertion(changed.projectionId === before.projectionId, "Selector-only reprojection replaced the document projection identity", selectorOnlyReprojection);
      assertion(changed.revision === before.revision + 1, "Selector-only reprojection did not advance exactly one revision", selectorOnlyReprojection);
      assertion(changedRow?.id === baselineRow.id, "Selector-only reprojection replaced a surviving row ID", selectorOnlyReprojection);
      assertion(changedRow?.xpath === baselineRow.xpath, "Selector-only reprojection changed the stable target XPath", selectorOnlyReprojection);
      assertion(changedRow?.classification === "explicit-included", "Selector-only reprojection did not reclassify the selected row", selectorOnlyReprojection);
      assertion(changedRow?.selector === selector, "Selector-only reprojection lost the exact selector provenance", selectorOnlyReprojection);
      assertion(restored.projectionId === before.projectionId, "Canonical selector restoration replaced projection identity", selectorOnlyReprojection);
      assertion(restored.revision === changed.revision + 1, "Canonical selector restoration did not advance exactly one revision", selectorOnlyReprojection);
      assertion(restoredRow?.id === baselineRow.id && restoredRow?.classification === "undetected", "Canonical selector restoration did not restore the original stable row", selectorOnlyReprojection);
      for (const transport of [changedTransport, restoredTransport]) {
        assertion(transport?.frames?.length === 2, "Selector-only projection did not cross one typed request/reply pair", transport);
        assertion(JSON.stringify(transport?.content) === JSON.stringify(transport?.wire), "Selector-only projection changed between content and wire", transport);
        assertion(JSON.stringify(transport?.wire) === JSON.stringify(transport?.popup), "Selector-only projection changed between wire and popup store", transport);
      }
      return selectorOnlyReprojection;
    });

    const retiredPreviewOccurrence = await runtimeCall("retireAndReprojectCycle");
    scenarioEvidence.retiredPreviewOccurrence = retiredPreviewOccurrence;
    await check("retired-preview-occurrence-rejects-cycle-a", async () => {
      const {
        cycleA,
        cycleARow,
        cycleAActive,
        retiredProjection,
        retiredBeforeCycleB,
        cycleB,
        cycleBRow,
        cycleBTransport,
        retiredAfterCycleB,
        cycleBActive,
        cycleBClear,
      } = retiredPreviewOccurrence;
      assertion(cycleAActive?.ok === true && cycleAActive?.data?.targeted === true, "Cycle-A row was not targetable before retirement", retiredPreviewOccurrence);
      assertion(retiredProjection === null, "Controller retirement retained the engine projection", retiredPreviewOccurrence);
      assertion(retiredBeforeCycleB?.ok === true && retiredBeforeCycleB?.data?.targeted === false, "Retired cycle-A row remained targetable before cycle B", retiredPreviewOccurrence);
      assertion(cycleB.projectionId !== cycleA.projectionId, "Cycle B reused the retired projection occurrence ID", retiredPreviewOccurrence);
      assertion(cycleBRow?.id === cycleARow.id, "Occurrence rotation replaced the surviving document-stable row ID", retiredPreviewOccurrence);
      assertion(cycleBRow?.xpath === cycleARow.xpath, "Occurrence rotation changed the stable target XPath", retiredPreviewOccurrence);
      assertion(cycleB.revision === cycleA.revision + 1, "Cycle-B projection did not advance exactly one revision", retiredPreviewOccurrence);
      assertion(retiredAfterCycleB?.ok === true && retiredAfterCycleB?.data?.targeted === false, "Cycle-A projection ID targeted the cycle-B row", retiredPreviewOccurrence);
      assertion(cycleBActive?.ok === true && cycleBActive?.data?.targeted === true, "Cycle-B row was not targetable through the typed controller", retiredPreviewOccurrence);
      assertion(cycleBClear?.ok === true && cycleBClear?.data?.targeted === true, "Cycle-B emphasis clear was rejected", retiredPreviewOccurrence);
      assertion(cycleBTransport?.frames?.length === 2, "Cycle-B projection did not cross one typed request/reply pair", cycleBTransport);
      assertion(JSON.stringify(cycleBTransport?.content) === JSON.stringify(cycleBTransport?.wire), "Cycle-B projection changed between content and wire", cycleBTransport);
      assertion(JSON.stringify(cycleBTransport?.wire) === JSON.stringify(cycleBTransport?.popup), "Cycle-B projection changed between wire and popup store", cycleBTransport);
      return retiredPreviewOccurrence;
    });

    const mutationBaseline = await runtimeCall("mutationBaseline", "explicit");
    const insertedDecoy = await runtimeCall("mutateBeforeExplicit");
    await page.waitForFunction(
      ({ revision, rowId, xpath }) => {
        const projection = window.__p17Runtime.engineProjection();
        const explicit = projection?.rows.find((row) => row.id === rowId);
        return projection?.revision > revision && explicit?.xpath !== xpath;
      },
      {
        revision: mutationBaseline.revision,
        rowId: mutationBaseline.row.id,
        xpath: mutationBaseline.row.xpath,
      },
      { timeout: 10_000 },
    );
    await runtimeCall("reproject");
    const mutationAfter = await runtimeCall("mutationSnapshot", "explicit", mutationBaseline.row.xpath);
    scenarioEvidence.mutation = {
      baseline: mutationBaseline,
      insertedDecoy,
      after: mutationAfter,
    };

    await check("mutation-stable-row-identity", async () => {
      assertion(mutationAfter.projectionId === mutationBaseline.projectionId, "Mutation replaced the document projection identity", { mutationBaseline, mutationAfter });
      assertion(mutationAfter.revision > mutationBaseline.revision, "Mutation did not advance the projection revision", { mutationBaseline, mutationAfter });
      assertion(mutationAfter.row.id === mutationBaseline.row.id, "A surviving Element received a different row ID", { mutationBaseline, mutationAfter });
      assertion(mutationAfter.row.xpath !== mutationBaseline.row.xpath, "XPath did not change after same-tag insertion", { mutationBaseline, mutationAfter });
      assertion(mutationAfter.targetNodeToken === mutationBaseline.targetNodeToken, "Mutation replaced the original target Element", { mutationBaseline, mutationAfter });
      for (const field of ["classification", "text", "selector", "shadow"]) {
        assertion(mutationAfter.row[field] === mutationBaseline.row[field], `Mutation changed stable row field ${field}`, { mutationBaseline, mutationAfter });
      }
      return { mutationBaseline, insertedDecoy, mutationAfter };
    });

    await check("mutation-reuses-react-row-node", async () => {
      assertion(mutationAfter.rowNodeToken === mutationBaseline.rowNodeToken, "React replaced the keyed preview <li> after mutation", { mutationBaseline, mutationAfter });
      return { before: mutationBaseline.rowNodeToken, after: mutationAfter.rowNodeToken };
    });

    const postMutationPoint = await runtimeCall("rowPoint", "explicit");
    const beforePostMutationActivateSequence = Math.max(0, ...(await runtimeCall("commandLog")).map((entry) => entry.sequence));
    await page.mouse.move(postMutationPoint.x, postMutationPoint.y);
    await page.mouse.click(postMutationPoint.x, postMutationPoint.y);
    await waitForCommand("activate", mutationAfter.row.id, null, beforePostMutationActivateSequence);
    await waitForCenteredTarget("explicit");
    await waitForStableScroll();
    const postMutationTarget = await runtimeCall("targetSnapshot", "explicit");
    const beforePostMutationLeaveSequence = Math.max(0, ...(await runtimeCall("commandLog")).map((entry) => entry.sequence));
    await page.mouse.move(8, 8);
    await waitForCommand("emphasize", mutationAfter.row.id, false, beforePostMutationLeaveSequence);
    await check("post-mutation-id-command-ignores-stale-xpath", async () => {
      assertion(mutationAfter.oldXpathTargetIsDecoy, "The pre-mutation XPath did not resolve to the visible decoy", mutationAfter);
      assertion(mutationAfter.oldXpathTargetNodeToken === mutationAfter.decoyNodeToken, "Old XPath resolution did not identify the decoy node", mutationAfter);
      assertion(mutationAfter.decoyRect?.width > 0 && mutationAfter.decoyRect?.height > 0, "XPath decoy was not physically visible", mutationAfter);
      assertion(approximately(postMutationTarget.targetRect.centerY, postMutationTarget.viewportCenterY, 4), "Stable row-ID click did not center the original target", postMutationTarget);
      assertion(
        !postMutationTarget.decoyRect || Math.abs(postMutationTarget.decoyRect.centerY - postMutationTarget.viewportCenterY) > 40,
        "Stable row-ID click centered the stale-XPath decoy",
        postMutationTarget,
      );
      assertion(postMutationTarget.targetNodeToken === mutationBaseline.targetNodeToken, "Stable row-ID command hit a replacement target", { mutationBaseline, postMutationTarget });
      return { mutationAfter, postMutationTarget };
    });

    const beforeStale = await runtimeCall("targetSnapshot", "explicit");
    const staleResponse = await runtimeCall("staleProjectionRequest", "explicit");
    await page.waitForTimeout(100);
    const afterStale = await runtimeCall("targetSnapshot", "explicit");
    await check("stale-projection-rejected", async () => {
      assertion(staleResponse?.ok === true && staleResponse?.data?.targeted === false, "Stale projection command was not rejected by the production controller", staleResponse);
      assertion(approximately(beforeStale.scrollY, afterStale.scrollY, 0.5), "Stale projection command moved the page", { beforeStale, afterStale });
      assertion(afterStale.hoverBoxes.length === 0, "Stale projection command painted emphasis", { beforeStale, afterStale });
      return { staleResponse, beforeStale, afterStale };
    });

    await runtimeCall("pinFixtureTargetForHover", "explicit");
    // Pinning changes only viewport geometry. The optimized content renderer
    // refreshes presentation without replacing an otherwise identical Preview
    // projection, and this fixture explicitly reprojects immediately below.
    // Require the physical layout endpoint here, not canonical row churn.
    await page.waitForFunction(
      (fixtureId) => {
        const snapshot = window.__p17Runtime.targetSnapshot(fixtureId);
        return snapshot.targetRect &&
          Math.abs(snapshot.targetRect.top - 80) <= 1;
      },
      "explicit",
      { timeout: 10_000 },
    );
    await runtimeCall("reproject");
    const activeMutationBaseline = await runtimeCall("mutationBaseline", "explicit");
    const activeMutationHoverPoint = await runtimeCall("rowPoint", "explicit");
    const beforeActiveMutationHoverSequence = Math.max(0, ...(await runtimeCall("commandLog")).map((entry) => entry.sequence));
    await page.mouse.move(activeMutationHoverPoint.x, activeMutationHoverPoint.y);
    await waitForCommand("emphasize", activeMutationBaseline.row.id, true, beforeActiveMutationHoverSequence);
    await page.waitForFunction(
      (fixtureId) => window.__p17Runtime.targetSnapshot(fixtureId).hoverBoxes.length > 0,
      "explicit",
      { timeout: 5_000 },
    );
    const activeHoverBeforeMutation = await runtimeCall("targetSnapshot", "explicit");
    const hoverRebindDecoy = await runtimeCall("insertHoverRebindDecoy");
    await page.waitForFunction(
      ({ fixtureId, rowId, revision, xpath }) => {
        const projection = window.__p17Runtime.engineProjection();
        const row = projection?.rows.find((candidate) => candidate.id === rowId);
        const snapshot = window.__p17Runtime.targetSnapshot(fixtureId);
        return projection?.revision > revision &&
          row?.xpath !== xpath &&
          snapshot.hoverBoxes.length > 0 &&
          snapshot.hoverBoxes.every((box) => box.xpath === row.xpath);
      },
      {
        fixtureId: "explicit",
        rowId: activeMutationBaseline.row.id,
        revision: activeMutationBaseline.revision,
        xpath: activeMutationBaseline.row.xpath,
      },
      { timeout: 10_000 },
    );
    const engineHoverAfterMutation = {
      projection: await runtimeCall("engineProjection"),
      target: await runtimeCall("targetSnapshot", "explicit"),
    };
    const removedTarget = await runtimeCall("removeFixtureTarget", "explicit");
    await page.waitForFunction(
      ({ fixtureId, rowId, revision }) => {
        const projection = window.__p17Runtime.engineProjection();
        const snapshot = window.__p17Runtime.targetSnapshot(fixtureId);
        return projection?.revision > revision &&
          !projection.rows.some((row) => row.id === rowId) &&
          snapshot.targetConnected === false &&
          snapshot.hoverBoxes.length === 0;
      },
      {
        fixtureId: "explicit",
        rowId: activeMutationBaseline.row.id,
        revision: engineHoverAfterMutation.projection.revision,
      },
      { timeout: 10_000 },
    );
    const engineAfterRemoval = {
      projection: await runtimeCall("engineProjection"),
      target: await runtimeCall("targetSnapshot", "explicit"),
    };
    await runtimeCall("reproject");
    const popupAfterRemoval = await runtimeCall("projection");
    scenarioEvidence.activeHoverMutation = {
      baseline: activeMutationBaseline,
      activeHoverBeforeMutation,
      hoverRebindDecoy,
      engineHoverAfterMutation,
      removedTarget,
      engineAfterRemoval,
      popupAfterRemoval,
    };
    await check("active-hover-mutation-rebinds-and-clears", async () => {
      assertion(activeHoverBeforeMutation.hoverBoxes.length > 0, "Mutation began without active production emphasis", activeHoverBeforeMutation);
      assertion(activeHoverBeforeMutation.hoverBoxes.every((box) => box.xpath === activeMutationBaseline.row.xpath), "Pre-mutation emphasis used the wrong XPath", { activeMutationBaseline, activeHoverBeforeMutation });
      const reboundRow = engineHoverAfterMutation.projection.rows.find((row) => row.id === activeMutationBaseline.row.id);
      assertion(activeMutationBaseline.row.xpath.endsWith("/p17-card[2]"), "Active-hover baseline did not start at the once-shifted XPath", activeMutationBaseline);
      assertion(reboundRow && reboundRow.xpath.endsWith("/p17-card[3]"), "Structural refresh did not rebase the active row to the twice-shifted XPath", { activeMutationBaseline, engineHoverAfterMutation });
      assertion(hoverRebindDecoy.rect?.width > 0 && hoverRebindDecoy.rect?.height > 0, "Active-hover XPath decoy was not physically visible", hoverRebindDecoy);
      assertion(engineHoverAfterMutation.target.hoverBoxes.length > 0 && engineHoverAfterMutation.target.hoverBoxes.every((box) => box.xpath === reboundRow.xpath), "Structural refresh did not rebind active emphasis to the new XPath", engineHoverAfterMutation);
      assertion(removedTarget.targetNodeToken === mutationBaseline.targetNodeToken && removedTarget.targetConnectedAfterRemoval === false, "Removal did not detach the original stable target", { mutationBaseline, removedTarget });
      assertion(!engineAfterRemoval.projection.rows.some((row) => row.id === activeMutationBaseline.row.id), "Removed active row remained in the engine projection", engineAfterRemoval);
      assertion(engineAfterRemoval.target.targetConnected === false && engineAfterRemoval.target.hoverBoxes.length === 0, "Engine retained emphasis for a removed active target before popup reprojection", engineAfterRemoval);
      assertion(!popupAfterRemoval.rows.some((row) => row.id === activeMutationBaseline.row.id), "Removed active row remained in the popup projection", popupAfterRemoval);
      return scenarioEvidence.activeHoverMutation;
    });

    await gotoVariant("debug");
    const debugProjection = await runtimeCall("projection");
    const debugPopup = await runtimeCall("popupSnapshot");
    scenarioEvidence.debug = { projection: debugProjection, popup: debugPopup };
    await check("debug-full-detail-present", async () => {
      assertion(debugPopup.rowCount === 6, "Debug App did not render the canonical six rows", debugPopup);
      assertion(debugPopup.mainOuterHTML.includes('data-state-name="preview_open"'), "Debug App omitted state metadata", debugPopup.mainOuterHTML);
      for (const row of debugPopup.rows) {
        const projectionRow = row.projectionRow;
        const expectedTitle = [
          `Classification: ${projectionRow.classification}`,
          `XPath: ${projectionRow.xpath}`,
          `Selector: ${projectionRow.selector ?? "—"}`,
          `Shadow: ${projectionRow.shadow}`,
        ].join("\n");
        assertion(row.outerHTML.includes('data-preview-row-debug="true"'), "Debug row omitted its debug marker", row);
        assertion(row.outerHTML.includes('data-preview-row-debug-detail="true"'), "Debug row omitted its detail surface", row);
        assertion(row.outerHTML.includes(`data-preview-row-id="${projectionRow.id}"`), "Debug row omitted its stable ID", row);
        assertion(!row.selfHasTitle && row.controlTitle === expectedTitle, "Debug button omitted its exact native diagnostic tooltip", { expectedTitle, row });
        assertion(row.descendantTitleCount === 1 && row.titleCount === 1, "Debug diagnostic tooltip was attached outside the semantic control", row);
        for (const literal of [projectionRow.classification, projectionRow.xpath, projectionRow.selector ?? "—", projectionRow.shadow]) {
          assertion(row.debugDetail.includes(literal), "Debug row omitted canonical technical detail", { literal, row });
        }
        assertion(row.copyIndex >= 0 && row.copyIndex < row.publicClassificationIndex, "Debug detail displaced readable leading copy", row);
      }
      return debugPopup;
    });

    await check("no-browser-errors", async () => {
      assertion(pageErrors.length === 0, "Browser page errors occurred", pageErrors);
      assertion(consoleErrors.length === 0, "Browser console errors occurred", consoleErrors);
      return { pageErrors, consoleErrors };
    });
  } catch (error) {
    fatalError = String(error?.stack || error);
  } finally {
    const payload = {
      checks,
      pageErrors,
      consoleErrors,
      browserEnvironment,
      scenarioEvidence,
      fatalError,
    };
    await page.evaluate(async (result) => {
      await fetch("/results", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(result),
      });
    }, payload).catch((error) => {
      fatalError = [fatalError, `Unable to post P17 results: ${String(error?.stack || error)}`]
        .filter(Boolean)
        .join("\n");
    });
  }
  return { checks, pageErrors, consoleErrors, browserEnvironment, scenarioEvidence, fatalError };
}
