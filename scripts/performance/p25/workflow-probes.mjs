import { normalizeLiveUrl, sha256 } from "./live-comparison-contract.mjs";

export const CANDIDATE_DISPOSITION_SCHEMA_VERSION = "p25-candidate-disposition/v1";

export function measureTrustedProjectionInterval(inputDispatchedAtEpochMs, observedAtEpochMs = Date.now()) {
  if (!Number.isFinite(inputDispatchedAtEpochMs) || !Number.isFinite(observedAtEpochMs) ||
      observedAtEpochMs < inputDispatchedAtEpochMs) {
    throw new Error("A monotonic trusted-input epoch interval is required");
  }
  return {
    inputDispatchedAtEpochMs,
    observedAtEpochMs,
    projectedWithinMs: observedAtEpochMs - inputDispatchedAtEpochMs,
  };
}

const NOT_FOUND_COPY = /(?:\b404\b|page\s+not\s+found|page\s+does\s+not\s+exist|sidan\s+(?:du\s+söker\s+)?(?:finns\s+inte|kunde\s+inte\s+hittas)|siden\s+(?:du\s+leter\s+etter\s+)?(?:finnes\s+ikke|ble\s+ikke\s+funnet)|siden\s+(?:findes\s+ikke|kunne\s+ikke\s+findes)|side\s+ikke\s+fundet)/iu;

function normalizedCopy(value, limit = 512) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function finiteStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

/** Capture only implementation-neutral page facts. Raw body copy is returned in
 * `analysis` for the immediate decision and must not be persisted by callers. */
export async function captureCandidateSignals(session, expectedUrl) {
  const raw = await session.evaluate(`(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    const bodyText = (document.body?.innerText ?? '').replace(/\\s+/g, ' ').trim();
    const main = document.querySelector('main, article, [role="main"]');
    const meaningfulBlocks = [...document.querySelectorAll('h1,h2,h3,p,li')].filter((element) => {
      const text = (element.textContent ?? '').replace(/\\s+/g, ' ').trim();
      if (text.length < 24) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0 && rect.width > 0 && rect.height > 0;
    });
    return {
      href: location.href,
      responseStatus: Number.isInteger(navigation?.responseStatus) ? navigation.responseStatus : null,
      title: document.title,
      primaryHeading: document.querySelector('h1')?.textContent ?? '',
      bodyLead: bodyText.slice(0, 4000),
      bodyTextLength: bodyText.length,
      mainTextLength: (main?.textContent ?? '').replace(/\\s+/g, ' ').trim().length,
      meaningfulBlockCount: meaningfulBlocks.length,
      headingCount: document.querySelectorAll('h1,h2,h3').length,
      contentElementCount: document.querySelectorAll('main,article,section,h1,h2,h3,p,li').length,
      hasMainLandmark: Boolean(main),
      readyState: document.readyState,
    };
  })()`);
  const title = normalizedCopy(raw?.title);
  const primaryHeading = normalizedCopy(raw?.primaryHeading);
  const bodyLead = normalizedCopy(raw?.bodyLead, 4_000);
  return {
    signals: {
      expectedNormalizedUrl: normalizeLiveUrl(expectedUrl),
      observedNormalizedUrl: normalizeLiveUrl(raw?.href ?? expectedUrl),
      httpStatus: finiteStatus(raw?.responseStatus),
      statusAvailable: finiteStatus(raw?.responseStatus) !== null,
      title,
      primaryHeading,
      bodyLeadSha256: sha256(bodyLead),
      bodyTextLength: Number(raw?.bodyTextLength) || 0,
      mainTextLength: Number(raw?.mainTextLength) || 0,
      meaningfulBlockCount: Number(raw?.meaningfulBlockCount) || 0,
      headingCount: Number(raw?.headingCount) || 0,
      contentElementCount: Number(raw?.contentElementCount) || 0,
      hasMainLandmark: raw?.hasMainLandmark === true,
      readyState: raw?.readyState ?? null,
    },
    analysis: { title, primaryHeading, bodyLead },
  };
}

export function evaluateCandidateValidity({ signals, analysis }) {
  const urlMatches = signals?.observedNormalizedUrl === signals?.expectedNormalizedUrl;
  const status = finiteStatus(signals?.httpStatus);
  const statusNotFound = status === 404 || status === 410;
  const titleNotFound = NOT_FOUND_COPY.test(normalizedCopy(analysis?.title));
  const headingNotFound = NOT_FOUND_COPY.test(normalizedCopy(analysis?.primaryHeading));
  const bodyLead = normalizedCopy(analysis?.bodyLead, 4_000);
  // Body copy alone is conclusive only when the not-found phrase leads a sparse
  // document. A valid article that happens to mention a 404 must not be demoted.
  const sparseBodyNotFound = NOT_FOUND_COPY.test(bodyLead.slice(0, 600)) &&
    Number(signals?.bodyTextLength ?? 0) < 6_000 &&
    Number(signals?.meaningfulBlockCount ?? 0) < 8;
  const definitiveNotFound = statusNotFound || titleNotFound || headingNotFound || sparseBodyNotFound;
  const substantiveContent = Number(signals?.bodyTextLength ?? 0) >= 500 &&
    Number(signals?.meaningfulBlockCount ?? 0) >= 3 &&
    Number(signals?.contentElementCount ?? 0) >= 5 &&
    (Number(signals?.headingCount ?? 0) >= 1 || signals?.hasMainLandmark === true);
  const valid = urlMatches && !definitiveNotFound && substantiveContent && signals?.readyState === "complete";
  const reasonCode = !urlMatches
    ? "preflight-url-mismatch"
    : definitiveNotFound
      ? "site-not-found-body"
      : signals?.readyState !== "complete"
        ? "preflight-document-incomplete"
        : !substantiveContent
          ? "preflight-content-signals-insufficient"
          : null;
  return {
    valid,
    reasonCode,
    checks: {
      urlMatches,
      statusNotFound,
      titleNotFound,
      headingNotFound,
      sparseBodyNotFound,
      definitiveNotFound,
      substantiveContent,
      documentComplete: signals?.readyState === "complete",
    },
  };
}

export function adoptCandidateDisposition({ declared, matrixEligibility, evaluation, signals, evidenceArtifact }) {
  const runtimeValidationRequired = matrixEligibility === "runtime-validation-required";
  const fixedExternal = !declared?.parityEligible && !runtimeValidationRequired;
  const parityEligible = !fixedExternal && evaluation?.valid === true;
  const reasonCode = parityEligible
    ? null
    : fixedExternal
      ? declared?.reasonCode ?? "matrix-candidate-unavailable"
      : evaluation?.reasonCode ?? "preflight-candidate-invalid";
  const reason = parityEligible
    ? null
    : fixedExternal
      ? declared?.reason ?? "The matrix does not authorize candidate-workflow parity for this property."
      : `Implementation-neutral preflight did not prove a valid candidate document (${reasonCode}).`;
  return {
    eligibility: parityEligible ? "candidate" : (declared?.eligibility ?? "external-block"),
    reasonCode,
    reason,
    parityEligible,
    source: "preflight",
    evidenceArtifact,
    candidateSignals: signals,
  };
}

function dispositionCore(record) {
  return {
    schemaVersion: record?.schemaVersion,
    createdAt: record?.createdAt,
    runNonce: record?.runNonce,
    label: record?.label,
    normalizedUrl: record?.normalizedUrl,
    documentKey: record?.documentKey,
    documentFingerprint: record?.documentFingerprint,
    matrixEligibility: record?.matrixEligibility,
    evaluation: record?.evaluation,
    signals: record?.signals,
  };
}

export function createCandidateDispositionRecord({ identity, document, matrixEligibility, captured, relativePath = "candidate-disposition.json" }) {
  const evaluation = evaluateCandidateValidity(captured);
  const core = {
    schemaVersion: CANDIDATE_DISPOSITION_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    runNonce: identity.runNonce,
    label: identity.label,
    normalizedUrl: identity.normalizedUrl,
    documentKey: `document-${document.fingerprint.slice(0, 16)}`,
    documentFingerprint: document.fingerprint,
    matrixEligibility,
    evaluation,
    signals: captured.signals,
  };
  const evidenceArtifact = { path: relativePath, sha256: sha256(JSON.stringify(core)) };
  return {
    ...core,
    evidenceArtifact,
    candidateDisposition: adoptCandidateDisposition({
      declared: identity.declaredCandidateDisposition ?? identity.candidateDisposition,
      matrixEligibility,
      evaluation,
      signals: captured.signals,
      evidenceArtifact,
    }),
  };
}

export function validateCandidateDispositionRecord(record, identity, document = null) {
  const failures = [];
  if (record?.schemaVersion !== CANDIDATE_DISPOSITION_SCHEMA_VERSION) failures.push("schema-version");
  if (record?.runNonce !== identity?.runNonce) failures.push("run-nonce");
  if (record?.label !== identity?.label) failures.push("label");
  if (record?.normalizedUrl !== identity?.normalizedUrl) failures.push("normalized-url");
  if (document && record?.documentFingerprint !== document.fingerprint) failures.push("document-fingerprint");
  if (document && record?.documentKey !== `document-${document.fingerprint.slice(0, 16)}`) failures.push("document-key");
  const expectedDigest = sha256(JSON.stringify(dispositionCore(record)));
  if (record?.evidenceArtifact?.sha256 !== expectedDigest) failures.push("evidence-digest");
  if (record?.candidateDisposition?.source !== "preflight") failures.push("source");
  if (record?.candidateDisposition?.evidenceArtifact?.sha256 !== expectedDigest) failures.push("disposition-evidence-digest");
  if (JSON.stringify(record?.candidateDisposition?.candidateSignals) !== JSON.stringify(record?.signals)) failures.push("candidate-signals");
  return { pass: failures.length === 0, failures };
}

export function proveRequestedRenderMode(state, requestedMode) {
  if (state?.renderInspectionView === requestedMode) return { modeProven: true, proofSource: "inspection-lifecycle" };
  if (state?.renderChoice === requestedMode) return { modeProven: true, proofSource: "confirmed-render-choice" };
  return { modeProven: false, proofSource: null };
}

export async function captureWorkflowPopupState(session) {
  return session.evaluate(`(() => {
    const control = (id) => {
      const element = document.getElementById(id);
      if (!(element instanceof HTMLElement)) return null;
      return {
        id,
        disabled: Boolean(element.disabled),
        checked: 'checked' in element ? Boolean(element.checked) : null,
        blockedReason: element.getAttribute('data-blocked-reason'),
        text: element.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
      };
    };
    const rowButtons = [...document.querySelectorAll('.preview-sidebar__item-button')];
    const active = document.activeElement;
    const previewRoot = document.querySelector('.preview-sidebar');
    const domFocusedPreviewButton = active?.matches?.('.preview-sidebar__item-button') ? active : null;
    const selectedPreviewButton = document.querySelector('.preview-sidebar__item--active .preview-sidebar__item-button');
    const activePreviewButton = domFocusedPreviewButton || selectedPreviewButton;
    const rowName = (element) => element?.getAttribute?.('aria-label') || element?.getAttribute?.('title') || element?.textContent?.replace(/\\s+/g, ' ').trim() || null;
    const rowIdentity = (element) => element ? {
      name: rowName(element),
      readableText: element.querySelector('.preview-sidebar__item-copy')?.textContent?.replace(/\\s+/g, ' ').trim() || element.querySelector('.preview-sidebar__item-text')?.textContent?.replace(/\\s+/g, ' ').trim() || element.textContent?.replace(/\\s+/g, ' ').trim() || null,
      title: element.getAttribute('title'),
    } : null;
    const checklistRoot = document.querySelector('[data-transient-surface="lynx-checklist"], .lynx-checklist-popover:not([hidden])');
    const explicitPhase = document.querySelector('[data-publication-phase]')?.getAttribute('data-publication-phase') ?? null;
    const legacyChecking = Boolean(checklistRoot?.querySelector('.lynx-checklist-popover__checking'));
    const legacySend = document.getElementById('lynx-checklist-send');
    const checklistPhase = explicitPhase || (checklistRoot ? legacyChecking ? 'checking' : legacySend && !legacySend.disabled ? 'ready' : 'error' : null);
    const toggle = document.getElementById('toggle-enabled');
    const busyCurtain = document.querySelector('[data-transient-surface="popup-busy-curtain"]');
    const busyCurtainRect = busyCurtain?.getBoundingClientRect();
    const busyCurtainStyle = busyCurtain ? getComputedStyle(busyCurtain) : null;
    const busyCurtainVisible = Boolean(busyCurtain && !busyCurtain.hidden &&
      busyCurtainStyle?.display !== 'none' && busyCurtainStyle?.visibility !== 'hidden' &&
      Number(busyCurtainStyle?.opacity || '1') > 0 &&
      Number(busyCurtainRect?.width || 0) > 0 && Number(busyCurtainRect?.height || 0) > 0);
    return {
      at: Date.now(),
      view: document.querySelector('main[data-view]')?.getAttribute('data-view') ?? null,
      busy: busyCurtainVisible,
      silentAcknowledged: document.querySelector('[data-silent-mode="active"]') !== null || (toggle instanceof HTMLInputElement && !toggle.checked && document.getElementById('preview-latest') !== null),
      controls: ['toggle-enabled','desktop-preview-enabled','compute','marking-preview','page-save','page-revert','preview-exit','preview-latest','save-excludes','discard-confirm','lynx-checklist-cancel','lynx-checklist-send'].map(control),
      preview: {
        open: previewRoot !== null,
        rowCount: rowButtons.length,
        firstRowName: rowName(rowButtons[0]),
        focusedRowName: rowName(activePreviewButton),
        domFocusedRowName: rowName(domFocusedPreviewButton),
        selectedRowName: rowName(selectedPreviewButton),
        domFocusedRow: rowIdentity(domFocusedPreviewButton),
        selectedRow: rowIdentity(selectedPreviewButton),
      },
      discardOpen: document.querySelector('[data-transient-surface="discard-confirmation"]') !== null,
      checklist: {
        open: checklistRoot !== null,
        phase: checklistPhase,
        pageTypes: [...document.querySelectorAll('[data-checklist-page-type], .lynx-checklist-popover__page-type')].map((element) => ({
          pageType: element.getAttribute('data-checklist-page-type') || element.querySelector('.lynx-checklist-popover__page-type-title')?.textContent?.trim() || null,
          missing: element.classList.contains('lynx-checklist-popover__page-type--missing'),
        })),
      },
    };
  })()`);
}

export async function physicalActivatePopupControl(
  session,
  id,
  method = "pointer",
  fallbackSelector = null,
  {
    hitTargetTimeoutMs = 0,
    pollIntervalMs = 100,
    trustedActivation = false,
    activationAckTimeoutMs = 250,
    maxDispatchAttempts = 3,
  } = {},
) {
  await session.send("Page.enable");
  await session.send("Page.bringToFront");
  const readinessStartedAtEpochMs = Date.now();
  const deadline = readinessStartedAtEpochMs + Math.max(0, Number(hitTargetTimeoutMs) || 0);
  const pollMs = Math.max(0, Number(pollIntervalMs) || 0);
  let before;
  let initialBlocker = null;
  let readinessAttempts = 0;
  while (true) {
    readinessAttempts += 1;
    before = await session.evaluate(`(() => {
      const element = document.getElementById(${JSON.stringify(id)}) || (${JSON.stringify(fallbackSelector)} ? document.querySelector(${JSON.stringify(fallbackSelector)}) : null);
      if (!(element instanceof HTMLElement)) return null;
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      const label = element.closest('label') || ('labels' in element ? element.labels?.[0] : null);
      const hitMatches = hit === element || Boolean(hit && element.contains(hit)) || Boolean(hit && label?.contains(hit));
      return {
        id: element.id,
        tag: element.tagName,
        disabled: Boolean(element.disabled),
        checked: 'checked' in element ? Boolean(element.checked) : null,
        rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        viewport: { width: innerWidth, height: innerHeight },
        hitMatches,
        hit: hit instanceof HTMLElement ? {
          id: hit.id,
          tag: hit.tagName,
          className: hit.className,
          transientSurface: hit.getAttribute('data-transient-surface'),
        } : null,
      };
    })()`);
    const available = Boolean(before && !before.disabled && before.rect.width > 0 && before.rect.height > 0);
    if (available && before.hitMatches) break;
    const transientBlocker = before?.hit?.id === "ui-curtain" || before?.hit?.transientSurface === "popup-busy-curtain";
    initialBlocker ??= before;
    if (!transientBlocker || Date.now() >= deadline) {
      if (!available) throw new Error(`Real popup control #${id} is unavailable: ${JSON.stringify({ before, readinessAttempts, initialBlocker })}`);
      throw new Error(`Real popup control #${id} is not the physical hit target: ${JSON.stringify({ before, readinessAttempts, initialBlocker })}`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  const readyAtEpochMs = Date.now();
  const activationToken = `${id}:${readyAtEpochMs}:${Math.random().toString(16).slice(2)}`;
  const proofKey = "__ufP25TrustedActivationProof";
  const dispatchLimit = trustedActivation
    ? Math.max(1, Math.floor(Number(maxDispatchAttempts) || 1))
    : 1;
  const dispatches = [];
  let activationProof = null;
  let dispatchedAtEpochMs = null;
  for (let attempt = 1; attempt <= dispatchLimit; attempt += 1) {
    let dispatchRect = before.rect;
    if (trustedActivation) {
      if (attempt > 1) {
        await session.send("Page.bringToFront");
      }
      const armed = await session.evaluate(`(() => {
        const element = document.getElementById(${JSON.stringify(id)}) || (${JSON.stringify(fallbackSelector)} ? document.querySelector(${JSON.stringify(fallbackSelector)}) : null);
        if (!(element instanceof HTMLElement) || element.disabled) return null;
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        const label = element.closest('label') || ('labels' in element ? element.labels?.[0] : null);
        const hitMatches = hit === element || Boolean(hit && element.contains(hit)) || Boolean(hit && label?.contains(hit));
        if (rect.width <= 0 || rect.height <= 0 || !hitMatches) return null;
        const token = ${JSON.stringify(activationToken)};
        const proofKey = ${JSON.stringify(proofKey)};
        element.addEventListener('click', (event) => {
          globalThis[proofKey] = {
            token,
            trusted: event.isTrusted === true,
            detail: event.detail,
            atEpochMs: Date.now(),
            targetId: event.target instanceof HTMLElement ? event.target.id : null,
          };
        }, { capture: true, once: true });
        return { rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } };
      })()`);
      if (!armed?.rect) {
        throw new Error(`Real popup control #${id} could not arm a trusted activation proof`);
      }
      dispatchRect = armed.rect;
    }
    const dispatched = Date.now();
    dispatchedAtEpochMs ??= dispatched;
    if (method === "keyboard") {
      await session.evaluate(`(document.getElementById(${JSON.stringify(id)}) || (${JSON.stringify(fallbackSelector)} ? document.querySelector(${JSON.stringify(fallbackSelector)}) : null))?.focus()`);
      await session.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    } else {
      const x = dispatchRect.x + dispatchRect.width / 2;
      const y = dispatchRect.y + dispatchRect.height / 2;
      await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
      await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
    }
    dispatches.push({ attempt, atEpochMs: dispatched });
    if (!trustedActivation) {
      break;
    }
    const acknowledgementDeadline = Date.now() + Math.max(0, Number(activationAckTimeoutMs) || 0);
    do {
      activationProof = await session.evaluate(`(() => {
        const proof = globalThis[${JSON.stringify(proofKey)}];
        return proof?.token === ${JSON.stringify(activationToken)} ? proof : null;
      })()`);
      if (activationProof?.trusted === true) {
        break;
      }
      if (Date.now() < acknowledgementDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } while (Date.now() < acknowledgementDeadline);
    if (activationProof?.trusted === true) {
      break;
    }
  }
  if (trustedActivation && activationProof?.trusted !== true) {
    throw new Error(`Real popup control #${id} did not receive a trusted activation after ${dispatches.length} attempts`);
  }
  return {
    method,
    before,
    readiness: {
      startedAtEpochMs: readinessStartedAtEpochMs,
      readyAtEpochMs,
      waitMs: readyAtEpochMs - readinessStartedAtEpochMs,
      attempts: readinessAttempts,
      initialBlocker,
    },
    dispatchedAtEpochMs,
    dispatchedAt: new Date(dispatchedAtEpochMs).toISOString(),
    trustedActivation: trustedActivation
      ? { required: true, attempts: dispatches.length, proof: activationProof, dispatches }
      : { required: false, attempts: dispatches.length, proof: null, dispatches },
  };
}

export function popupControlIsActionable(state, id) {
  const control = state?.controls?.find((candidate) => candidate?.id === id);
  return Boolean(control && !control.disabled && control.visible !== false);
}

export function popupRecoveryTransitioned(before, after, controlId) {
  if (!after) return false;
  if (!popupControlIsActionable(after, controlId)) return true;
  const signature = (state) => JSON.stringify({
    view: state?.view ?? null,
    busy: state?.busy ?? null,
    bodyLead: state?.bodyLead ?? null,
    spinnerText: state?.spinnerText ?? null,
    toast: state?.toast ?? null,
    controls: (state?.controls ?? []).map((control) => ({
      id: control?.id ?? null,
      disabled: control?.disabled ?? null,
      visible: control?.visible ?? null,
      checked: control?.checked ?? null,
    })),
  });
  return signature(before) !== signature(after);
}

export async function physicalActivatePreviewRow(session, index = 0) {
  await session.send("Page.enable");
  await session.send("Page.bringToFront");
  const before = await session.evaluate(`(() => {
    const enabledRows = [...document.querySelectorAll('.preview-sidebar__item-button')]
      .filter((candidate) => candidate instanceof HTMLButtonElement && !candidate.disabled);
    const element = enabledRows[${Number(index)}] ?? enabledRows[0];
    if (!(element instanceof HTMLButtonElement)) return null;
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    element.focus();
    const token = String(Date.now()) + ':' + Math.random().toString(36).slice(2);
    const events = [];
    const record = (event) => {
      if (event.target !== element) return;
      events.push({ type: event.type, trusted: event.isTrusted, key: event.key || null, detail: Number(event.detail || 0) });
    };
    for (const type of ['keydown', 'keyup', 'click']) document.addEventListener(type, record, true);
    globalThis.__ufP25PreviewKeyboardWitness = {
      token,
      events,
      cleanup: () => {
        for (const type of ['keydown', 'keyup', 'click']) document.removeEventListener(type, record, true);
      },
    };
    return {
      name: element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent?.replace(/\\s+/g, ' ').trim() || null,
      readableText: element.querySelector('.preview-sidebar__item-copy')?.textContent?.replace(/\\s+/g, ' ').trim() || element.querySelector('.preview-sidebar__item-text')?.textContent?.replace(/\\s+/g, ' ').trim() || element.textContent?.replace(/\\s+/g, ' ').trim() || null,
      title: element.getAttribute('title'),
      focused: document.activeElement === element,
      semanticButton: element.tagName === 'BUTTON' && element.getAttribute('type') === 'button',
      token,
    };
  })()`);
  if (!before?.focused) throw new Error(`Preview row ${index} is unavailable for trusted keyboard activation`);
  let witness;
  try {
    await session.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
    await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 25));
    witness = await session.evaluate(`(() => {
      const witness = globalThis.__ufP25PreviewKeyboardWitness;
      if (!witness) return null;
      const matches = witness.token === ${JSON.stringify(before.token)};
      witness.cleanup?.();
      delete globalThis.__ufP25PreviewKeyboardWitness;
      return { events: witness.events, tokenMatches: matches };
    })()`);
  }
  const eventTypes = new Set((witness?.events ?? []).filter((event) => event.trusted === true).map((event) => event.type));
  const trustedKeyboard = before.semanticButton === true && witness?.tokenMatches === true && ['keydown', 'keyup', 'click'].every((type) => eventTypes.has(type));
  if (!trustedKeyboard) throw new Error(`Preview row ${index} did not produce a trusted native Space activation: ${JSON.stringify(witness)}`);
  return { trustedKeyboard, activationKey: "Space", before, witness, dispatchedAt: new Date().toISOString() };
}

export async function physicalActivatePreviewPageTarget(session) {
  const target = await session.evaluate(`(() => {
    const xpathNode = (xpath) => { try { return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; } catch { return null; } };
    const describe = (source) => (source?.getAttribute?.('aria-label') || source?.getAttribute?.('title') || source?.getAttribute?.('alt') || source?.getAttribute?.('placeholder') || source?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 400);
    const xpathTerminalTag = (xpath) => xpath?.match(/\\/([a-z][a-z0-9-]*)\\[\\d+\\]$/i)?.[1]?.toLocaleLowerCase('en') || '';
    const pageUnderlayAt = (x, y) => {
      const elements = document.elementsFromPoint(x, y).filter((element) =>
        element instanceof Element && !element.closest('[data-uf-extension-ui="true"]'));
      const depth = elements.findIndex((element) => describe(element).length > 0);
      return { exact: elements[0] || null, source: depth >= 0 ? elements[depth] : elements[0] || null, depth: depth >= 0 ? depth : 0 };
    };
    const candidates = [];
    const focusedXpaths = new Set([...document.querySelectorAll('[data-uf-overlay-focus]')].map((element) => element.getAttribute('data-uf-overlay-focus')).filter(Boolean));
    const focusedMarkIds = new Set([...document.querySelectorAll('[data-layer="focus"] [data-mc-mark-id]')].map((element) => element.getAttribute('data-mc-mark-id')).filter(Boolean));
    for (const source of document.querySelectorAll('[data-uf-ai-preview-clickable="on"]')) {
      if (!source.classList.contains('uf-ai-preview-focus-target')) candidates.push({ geometry: source, source, identity: source.getAttribute('title') || source.tagName, sourceKind: 'legacy-source' });
    }
    for (const overlay of document.querySelectorAll('[data-uf-overlay-xpath], [data-uf-silent-highlight], [data-mc-mark-id]')) {
      const xpath = overlay.getAttribute('data-uf-overlay-xpath') || overlay.getAttribute('data-uf-silent-highlight');
      const markId = overlay.getAttribute('data-mc-mark-id');
      if (focusedXpaths.has(xpath) || focusedMarkIds.has(markId)) continue;
      const resolved = xpath ? xpathNode(xpath) : markId ? document.querySelector('[data-uf-mark-id="' + CSS.escape(markId) + '"]') : null;
      if (!(resolved instanceof Element) || !resolved.matches('.uf-ai-preview-focus-target')) {
        const rect = overlay.getBoundingClientRect();
        const x = Math.max(2, Math.min(innerWidth - 2, rect.left + Math.min(rect.width / 2, 80)));
        const y = Math.max(2, Math.min(innerHeight - 2, rect.top + Math.min(rect.height / 2, 40)));
        const underlay = pageUnderlayAt(x, y);
        const identity = xpath || markId;
        const readableText = describe(underlay.exact) || xpathTerminalTag(xpath) || describe(underlay.source || resolved);
        candidates.push({ geometry: overlay, source: underlay.source || resolved, readableText, underlayDepth: underlay.depth, identity, sourceKind: resolved instanceof Element ? 'resolved-overlay' : 'visible-overlay-underlay' });
      }
    }
    const visibleCandidates = candidates.map((candidate) => {
      const { geometry, source } = candidate;
      const rect = geometry.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const x = Math.max(2, Math.min(innerWidth - 2, rect.left + Math.min(rect.width / 2, 80)));
      const y = Math.max(2, Math.min(innerHeight - 2, rect.top + Math.min(rect.height / 2, 40)));
      const hit = document.elementFromPoint(x, y);
      const readableText = candidate.readableText || describe(source);
      if (!readableText || !(hit === geometry || geometry.contains(hit) || Boolean(hit?.closest?.('[data-uf-interaction-shield="true"]')))) return null;
      const sourceRect = source?.getBoundingClientRect?.();
      const geometryArea = Math.max(1, rect.width * rect.height);
      const sourceArea = sourceRect ? Math.max(1, sourceRect.width * sourceRect.height) : geometryArea;
      return { ...candidate, readableText, geometryArea, sourceArea };
    }).filter(Boolean);
    const candidate = visibleCandidates.find(({ readableText, underlayDepth = 0, sourceArea, geometryArea }) =>
      readableText.length <= 160 && underlayDepth <= 1 && sourceArea <= geometryArea * 16) || visibleCandidates[0];
    if (!candidate) return null;
    const { geometry, identity, sourceKind, readableText } = candidate;
    const rect = geometry.getBoundingClientRect();
    return {
      x: Math.max(2, Math.min(innerWidth - 2, rect.left + Math.min(rect.width / 2, 80))),
      y: Math.max(2, Math.min(innerHeight - 2, rect.top + Math.min(rect.height / 2, 40))),
      identity,
      readableText,
      sourceKind,
    };
  })()`);
  if (!target) throw new Error("No real preview page target is available");
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y });
  await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x: target.x, y: target.y, button: "left", buttons: 1, clickCount: 1 });
  await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: target.x, y: target.y, button: "left", buttons: 0, clickCount: 1 });
  return { trustedPointer: true, target, dispatchedAt: new Date().toISOString() };
}

export async function waitForWorkflowPopupState(session, predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await captureWorkflowPopupState(session);
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Popup workflow state did not terminalize: ${JSON.stringify(last)}`);
}

export async function captureSiteWorkflowPosture(session) {
  return session.evaluate(`(() => {
    const xpathNode = (xpath) => { try { return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; } catch { return null; } };
    const describe = (source) => (source?.getAttribute?.('aria-label') || source?.getAttribute?.('title') || source?.getAttribute?.('alt') || source?.getAttribute?.('placeholder') || source?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 400);
    const destinationLabel = (source) => {
      const href = source?.tagName === 'A' ? source.getAttribute('href') : null;
      if (!href || href === '#' || /^(?:javascript|mailto|tel):/i.test(href)) return '';
      let pathname = href;
      try { pathname = new URL(href, document.baseURI).pathname; } catch {}
      const segment = pathname.split('/').filter(Boolean).at(-1) || '';
      try { return decodeURIComponent(segment).replace(/[-_]+/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 400); }
      catch { return segment.replace(/[-_]+/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 400); }
    };
    const semanticDescribe = (source) => describe(source) || destinationLabel(source) || destinationLabel(source?.querySelector?.('a[href]'));
    const xpathTerminalTag = (xpath) => xpath?.match(/\\/([a-z][a-z0-9-]*)\\[\\d+\\]$/i)?.[1]?.toLocaleLowerCase('en') || '';
    const pageUnderlayFor = (overlay) => {
      const rect = overlay.getBoundingClientRect();
      const x = Math.max(2, Math.min(innerWidth - 2, rect.left + rect.width / 2));
      const y = Math.max(2, Math.min(innerHeight - 2, rect.top + rect.height / 2));
      const elements = document.elementsFromPoint(x, y).filter((element) =>
        element instanceof Element && !element.closest('[data-uf-extension-ui="true"]'));
      const depth = elements.findIndex((element) => semanticDescribe(element).length > 0);
      return { exact: elements[0] || null, source: depth >= 0 ? elements[depth] : elements[0] || null };
    };
    const targets = [];
    const append = (source, owner, readableText = null) => {
      if (!(source instanceof Element) || targets.some((target) => target.source === source)) return;
      targets.push({ source, owner, readableText });
    };
    for (const overlay of document.querySelectorAll('[data-uf-overlay-focus]')) {
      const xpath = overlay.getAttribute('data-uf-overlay-focus');
      const underlay = pageUnderlayFor(overlay);
      const ownerNode = xpath ? xpathNode(xpath) : null;
      append(underlay.source || ownerNode, xpath, semanticDescribe(ownerNode) || semanticDescribe(underlay.exact) || semanticDescribe(underlay.source) || xpathTerminalTag(xpath));
    }
    for (const source of document.querySelectorAll('.uf-ai-preview-focus-target')) append(source, source.getAttribute('title') || 'legacy-focus');
    for (const overlay of document.querySelectorAll('[data-layer="focus"] [data-mc-mark-id]')) {
      const markId = overlay.getAttribute('data-mc-mark-id');
      append(markId ? document.querySelector('[data-uf-mark-id="' + CSS.escape(markId) + '"]') : null, markId);
    }
    const visualViewport = window.visualViewport;
    return ({
    viewport: { width: innerWidth, height: innerHeight, scrollX: Math.round(scrollX), scrollY: Math.round(scrollY) },
    interactiveViewport: {
      left: visualViewport?.offsetLeft ?? 0,
      top: visualViewport?.offsetTop ?? 0,
      width: visualViewport?.width ?? document.documentElement?.clientWidth ?? innerWidth,
      height: visualViewport?.height ?? document.documentElement?.clientHeight ?? innerHeight,
    },
    markingRootCount: document.querySelectorAll('.uf-marking-layer-root, #unfluffify-overlay').length,
    silentHighlightCount: document.querySelectorAll('[data-uf-silent-highlight], #unfluffify-silent-highlight-overlay .uf-rect, #unfluffify-overlay [data-layer="ai-content"] .uf-rect, #unfluffify-overlay [data-layer="saved-explicit-include"] .uf-rect, #unfluffify-overlay [data-layer="saved-explicit-exclude"] .uf-rect').length,
    shield: [...document.querySelectorAll('[data-uf-interaction-shield="true"], #unfluffify-overlay')].map((element) => {
      const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
      return { connected: element.isConnected, pointerEvents: style.pointerEvents, opacity: Number(style.opacity || '1'), rect: [rect.left, rect.top, rect.width, rect.height] };
    }),
    focusOwners: targets.map((target) => target.owner),
    focusTargets: targets.map((target) => ({
      owner: target.owner,
      readableText: target.readableText || describe(target.source),
    })),
  }); })()`);
}

export function viewportPostureMatches(posture, width, height) {
  return [posture?.viewport, posture?.interactiveViewport].some((viewport) =>
    Math.round(viewport?.width ?? 0) === width &&
    Math.round(viewport?.height ?? 0) === height
  );
}

export function silentPosturePass(posture) {
  const viewport = posture?.viewport;
  const interactiveViewport = posture?.interactiveViewport ?? {
    left: 0,
    top: 0,
    width: viewport?.width,
    height: viewport?.height,
  };
  const shield = posture?.shield?.find((candidate) =>
    candidate.connected && candidate.pointerEvents === "auto" && candidate.opacity === 1);
  const approximately = (actual, expected) =>
    Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= 2;
  return Math.round(viewport?.width ?? 0) === 1920 &&
    Math.round(viewport?.height ?? 0) === 1080 &&
    posture?.markingRootCount === 1 &&
    posture?.silentHighlightCount > 0 &&
    Boolean(shield) &&
    approximately(shield?.rect?.[0], interactiveViewport.left) &&
    approximately(shield?.rect?.[1], interactiveViewport.top) &&
    approximately(shield?.rect?.[2], interactiveViewport.width) &&
    approximately(shield?.rect?.[3], interactiveViewport.height);
}

export function readableTextsCorrespond(left, right) {
  const normalize = (value) => String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/^\s*\d+[.)]\s*/, "")
    .replace(/\b(?:included|excluded|immutable|closed shadow)\s*$/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  // Short labels such as prices, percentages, and compact headings are common
  // Content List targets. Exact normalized identity is conclusive regardless
  // of length; the longer substring/token heuristics below are only needed for
  // labels whose row copy contains additional surrounding text.
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 8 && (a.includes(b) || b.includes(a))) return true;
  const aTokens = new Set(a.split(" ").filter((token) => token.length >= 3));
  const bTokens = new Set(b.split(" ").filter((token) => token.length >= 3));
  const common = [...aTokens].filter((token) => bTokens.has(token)).length;
  return common >= 3 && common / Math.min(aTokens.size, bTokens.size) >= 0.75;
}

export function validateFullWorkflowEvidence(workflow) {
  const failures = [];
  const requireValue = (condition, reason) => { if (!condition) failures.push(reason); };
  requireValue(workflow?.contentList?.firstPaintMs >= 0 && workflow.contentList.firstPaintMs <= 1_000, "content-list-first-paint");
  requireValue(workflow?.contentList?.openActivation?.method === "ai-auto-open", "content-list-ai-auto-open");
  requireValue(workflow?.contentList?.rowCount > 0, "content-list-empty");
  requireValue(workflow?.contentList?.rowToPage?.trustedKeyboard === true && workflow.contentList.rowToPage.targetCorresponds === true, "content-list-row-to-page");
  requireValue(workflow?.contentList?.pageToRow?.trustedPointer === true && workflow.contentList.pageToRow.rowFocused === true && workflow.contentList.pageToRow.targetCorresponds === true, "content-list-page-to-row");
  requireValue(workflow?.initialAi?.success === true, "initial-ai-terminal-success");
  requireValue(workflow?.freshAi?.success === true, "fresh-ai-terminal-success");
  requireValue(workflow?.initialAi?.requestCount === 1 && workflow?.freshAi?.requestCount === 1, "ai-single-request-per-run");
  const trustedInputEpochMs = workflow?.dirtyEdit?.inputDispatchedAtEpochMs;
  const observedEpochMs = workflow?.freshness?.observedAtEpochMs;
  requireValue(workflow?.dirtyEdit?.acknowledged === true && Number.isFinite(trustedInputEpochMs) &&
    workflow?.freshness?.inputDispatchedAtEpochMs === trustedInputEpochMs && Number.isFinite(observedEpochMs) &&
    observedEpochMs >= trustedInputEpochMs &&
    workflow?.freshness?.projectedWithinMs === observedEpochMs - trustedInputEpochMs, "post-ai-freshness-origin");
  requireValue(workflow?.freshness?.projectedWithinMs >= 0 && workflow.freshness.projectedWithinMs <= 1_000, "post-ai-freshness");
  requireValue(workflow?.freshness?.saveBlockedReason === "requires-ai-run" && workflow.freshness?.previewBlockedReason === "requires-ai-run", "post-ai-block-reasons");
  requireValue(workflow?.save?.trustedPointer === true && workflow.save.requestCount === 1 && workflow.save.authoritativeAdopted === true, "save-authoritative-single-request");
  requireValue(workflow?.discard?.trustedPointer === true && workflow.discard.confirmed === true && workflow.discard.restored === true, "discard-flow");
  requireValue(workflow?.silentTransition?.trustedPointer === true && workflow.silentTransition.acknowledged === true, "silent-transition");
  requireValue(workflow?.payloadHygiene?.pass === true, "payload-hygiene");
  return { pass: failures.length === 0, failures };
}

const REQUIRED_CONTEXT_ACTIONS = Object.freeze(["clear", "exclude", "include", "widen"]);

export function validateExactMarkingGestureEvidence(evidence, options = {}) {
  const failures = [];
  const operations = new Map((evidence?.operations ?? []).map((operation) => [operation.id, operation]));
  const shiftOperation = operations.get("shift-expand");
  const clearOperation = operations.get("plain-exact-unmark");
  const expectedShiftOwnerXpath = evidence?.target?.shiftedOwnerXpath ?? null;
  const expectedShiftRelation = expectedShiftOwnerXpath && evidence?.target?.xpath === expectedShiftOwnerXpath
    ? "exact"
    : "ancestor";
  const unpaintedExclusionPair = Boolean(
    shiftOperation?.interactionAcknowledgement?.kind === "explicit-exclusion" &&
    shiftOperation?.interactionAcknowledgement?.ownerRelation === expectedShiftRelation &&
    (expectedShiftOwnerXpath === null ||
      shiftOperation?.interactionAcknowledgement?.ownerXpath === expectedShiftOwnerXpath) &&
    clearOperation?.interactionAcknowledgement?.kind === "explicit-exclusion" &&
    clearOperation?.interactionAcknowledgement?.ownerXpath ===
      shiftOperation?.interactionAcknowledgement?.ownerXpath,
  );
  const requireOperation = (id, predicate, reason) => {
    const operation = operations.get(id);
    if (!operation) failures.push(`${id}:missing`);
    else {
      if (operation.acknowledged !== true || !Number.isFinite(operation.acknowledgementLatencyMs)) failures.push(`${id}:target-acknowledgement-missing`);
      if (!predicate(operation)) failures.push(`${id}:${reason}`);
    }
  };
  requireOperation("plain-no-create", (value) => value.targetDelta?.created.length === 0 && value.targetDelta?.removed.length === 0 && value.targetDelta?.changed.length === 0, "target-mutated");
  requireOperation("shift-expand", (value) => (
    value.assertion?.kind === "explicit-exclusion" &&
    value.assertion?.ownerRelation === expectedShiftRelation &&
    (expectedShiftOwnerXpath === null || value.assertion?.ownerXpath === expectedShiftOwnerXpath) &&
    (expectedShiftRelation === "exact" || value.assertion?.breadthIncreased === true)
  ) || unpaintedExclusionPair, "not-widened-exclusion");
  requireOperation("plain-exact-unmark", (value) => (
    value.assertion?.removedExactOwner === true && value.assertion?.remainingTargetOwned === 0
  ) || unpaintedExclusionPair, "exact-owner-not-removed");
  requireOperation("alt-include", (value) => value.assertion?.kind === "explicit-inclusion" && value.assertion?.ownerRelation === "exact", "not-explicit-inclusion");
  requireOperation("plain-include-unmark", (value) => value.assertion?.removedExactOwner === true && value.assertion?.remainingTargetOwned === 0, "inclusion-not-removed");
  if (options.requireContextMenu !== false) {
    const contextOperation = operations.get("context-menu");
    if (!contextOperation) failures.push("context-menu:operation-missing");
    else if (contextOperation.acknowledged !== true || !Number.isFinite(contextOperation.acknowledgementLatencyMs)) failures.push("context-menu:target-acknowledgement-missing");
    const contextActions = new Map((evidence?.contextMenu ?? []).map((action) => [action.action, action]));
    for (const id of REQUIRED_CONTEXT_ACTIONS) {
      if (!contextActions.has(id)) failures.push(`context-menu:${id}:missing`);
    }
    if (contextActions.size !== REQUIRED_CONTEXT_ACTIONS.length) failures.push("context-menu:unexpected-action-set");
    const expectedDisabled = evidence?.contextExpectedDisabled ?? {};
    for (const id of REQUIRED_CONTEXT_ACTIONS) {
      if (typeof expectedDisabled[id] !== "boolean") failures.push(`context-menu:${id}:expected-state-missing`);
      else if (contextActions.get(id)?.disabled !== expectedDisabled[id]) failures.push(`context-menu:${id}:disabled-state-mismatch`);
    }
  }
  return { pass: failures.length === 0, failures };
}
