import { createHash } from "node:crypto";
import { validateExactMarkingGestureEvidence } from "./marking-gesture-contract.mjs";

export const P25_LIVE_SCHEMA_VERSION = "p25-live-comparison/v1";
export const P25_LIVE_STAGE_SCHEMA_VERSION = "p25-live-comparison-stage/v1";
export const P25_LIVE_COMPARISON_SCHEMA_VERSION = "p25-live-comparison-pair/v1";
export const P25_LIVE_ARTIFACT_ROOT = "output/playwright/p25-live-comparison";
export const PINNED_LEGACY_HEAD = "28974c2a0c859c91a7167f4757cf84a47ea31e28";
export const P25_LIVE_RELATIVE_P95_RATIO = 1.05;

export const IMPLEMENTATIONS = Object.freeze(["legacy", "rewrite"]);
export const BUILD_VARIANTS = Object.freeze(["production", "debug"]);
export const RENDER_MODES = Object.freeze(["with-javascript", "without-javascript"]);
export const LEGACY_DEBUG_UNAVAILABLE = Object.freeze({
  parityEligible: false,
  reasonCode: "legacy-debug-artifact-unavailable",
  reason: "The pinned legacy baseline has no authentic debug build; debug rewrite runs are diagnostic-only and cannot produce a legacy parity matrix.",
});

export function matrixVariantDisposition(buildVariant) {
  if (buildVariant === "production") return { parityEligible: true, reasonCode: null, reason: null };
  if (buildVariant === "debug") return { ...LEGACY_DEBUG_UNAVAILABLE };
  throw new Error(`Unknown P25 matrix build variant: ${buildVariant}`);
}

export const REQUIRED_LIVE_STAGE_IDS = Object.freeze([
  "preflight",
  "render-mode-with-javascript",
  "render-mode-without-javascript",
  "activation-network",
  "marking-visual",
  "marking-gestures",
  "marking-scroll-fade",
  "marking-resize",
  "workflow-summary",
  "silent-visual",
  "silent-scroll-fade",
  "silent-resize",
  "publication-fence",
]);

const COMPARABLE_WORKFLOW_STAGE_IDS = new Set(REQUIRED_LIVE_STAGE_IDS.slice(3));
const FRAME_PROOF_STAGE_IDS = Object.freeze([
  "activation-network",
  "marking-visual",
  "marking-gestures",
  "marking-scroll-fade",
  "marking-resize",
  "silent-visual",
  "silent-scroll-fade",
  "silent-resize",
]);
const CARDINALITY_KEYS = Object.freeze([
  "sourceCount",
  "sourceFragmentCount",
  "paintedRectCount",
  "visibleLayerCount",
  "physicalHitCount",
  "markableCandidateCount",
]);

export const CANDIDATE_MATRIX = Object.freeze([
  { label: "ledigajobb", url: "https://ledigajobb.se/", eligibility: "candidate" },
  { label: "dpj", url: "https://www.dpj.se/", eligibility: "candidate" },
  {
    label: "aleris",
    url: "https://www.aleris.se/kirurgi/brack/aderbrack/",
    eligibility: "runtime-validation-required",
    unavailableReasonCode: "site-not-found-body",
    unavailableReason: "The authoritative Aleris candidate currently serves a not-found body; it is comparable only if the live preflight proves a valid content page.",
  },
  { label: "acne-specialisten", url: "https://www.acnespecialisten.se/", eligibility: "candidate" },
  {
    label: "acapedia",
    url: "https://acapedia.no/",
    eligibility: "external-block",
    unavailableReasonCode: "site-403-after-required-reload",
    unavailableReason: "Acapedia serves a valid first document but replaces it with a site-owned 403 on the reloads required by Render Inspection, so a stable candidate workflow is not comparable.",
  },
  { label: "assist24", url: "https://www.assist24.dk/", eligibility: "candidate" },
  { label: "arno", url: "https://arno.eu/collections/katting", eligibility: "candidate" },
  { label: "arkivit", url: "https://arkivit.se/tjanster/arkivering-registratur/", eligibility: "candidate" },
  {
    label: "teknikhallen",
    url: "https://teknikhallen.se/surfplattor-tillbehor/samsung-surfplattor/galaxy-tab-s8",
    eligibility: "candidate",
  },
  { label: "humanova", url: "https://www.humanova.com/", eligibility: "candidate" },
  {
    label: "3dprima-se",
    url: "https://www.3dprima.com/se/3d-skrivare-mer/tillverkare/anycubic",
    eligibility: "external-block",
    unavailableReasonCode: "site-owned-404-candidate",
    unavailableReason: "The Hub-supplied 3D Prima candidate resolves to a site-owned 404 page, so candidate-workflow parity is not claimable.",
  },
  {
    label: "bigbag",
    url: "https://www.bigbag.se/",
    aliases: ["https://bigbag.se/"],
    eligibility: "n/a",
    unavailableReasonCode: "hub-no-authoritative-candidate",
    unavailableReason: "Hub supplies zero authoritative Bigbag candidate pages; candidate-only stages must remain N/A and no URL may be invented.",
  },
]);

const CANDIDATES_BY_LABEL = new Map(CANDIDATE_MATRIX.map((candidate) => [candidate.label, candidate]));

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function baseManifestVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\.\d+)?$/.exec(String(value ?? ""));
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

export function normalizeLiveUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }
  url.pathname = url.pathname.replace(/\/+/g, "/");
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  const sorted = [...url.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  url.search = "";
  for (const [key, value] of sorted) url.searchParams.append(key, value);
  return url.toString();
}

export function safeArtifactLabel(value) {
  const label = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(label)) {
    throw new Error(`Invalid live-comparison label: ${JSON.stringify(value)}`);
  }
  return label;
}

export function candidateFor(label) {
  return CANDIDATES_BY_LABEL.get(safeArtifactLabel(label)) ?? null;
}

export function resolveCandidateDisposition({ label, url, runtimeEligibility }) {
  const candidate = candidateFor(label);
  if (!candidate) {
    throw new Error(`Unknown P25 candidate label: ${label}`);
  }
  const acceptedUrls = [candidate.url, ...(candidate.aliases ?? [])].map(normalizeLiveUrl);
  if (!acceptedUrls.includes(normalizeLiveUrl(url))) {
    throw new Error(`Candidate URL mismatch for ${label}: expected ${candidate.url}, received ${url}`);
  }
  if (candidate.eligibility === "candidate") {
    return { eligibility: "candidate", reasonCode: null, reason: null, parityEligible: true };
  }
  if (candidate.eligibility === "runtime-validation-required" && runtimeEligibility === "candidate") {
    return { eligibility: "candidate", reasonCode: null, reason: null, parityEligible: true };
  }
  return {
    eligibility: candidate.eligibility === "runtime-validation-required" ? "external-block" : candidate.eligibility,
    reasonCode: candidate.unavailableReasonCode,
    reason: candidate.unavailableReason,
    parityEligible: false,
  };
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isNonce(value) {
  return typeof value === "string" && /^[a-f0-9-]{16,80}$/i.test(value);
}

function isIsoDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function timestampsOrdered(startedAt, finishedAt) {
  return isIsoDate(startedAt) && isIsoDate(finishedAt) && Date.parse(startedAt) <= Date.parse(finishedAt);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function finiteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value;
}

function sameUnorderedRecords(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const normalized = (values) => values.map((value) => JSON.stringify(canonicalJson(value))).sort();
  return sameJson(normalized(left), normalized(right));
}

function comparableDocumentFor(aggregate) {
  const preferred = aggregate?.stages?.find((stage) => stage.id === "preflight")?.document;
  return preferred ?? Object.values(aggregate?.documents ?? {})[0] ?? null;
}

function exactGestureSemantics(legacy, rewrite) {
  const project = (value) => (value?.operations ?? []).map((operation) => ({
    id: operation?.id ?? null,
    changed: operation?.changed ?? null,
    target: operation?.target ?? null,
    targetKey: operation?.targetKey ?? null,
    targetXpath: operation?.targetXpath ?? null,
    targetDelta: operation?.targetDelta ?? null,
    assertion: operation?.assertion ?? null,
    decision: operation?.decision ?? null,
    markingKind: operation?.markingKind ?? null,
  }));
  return sameJson(project(legacy), project(rewrite)) &&
    sameUnorderedRecords(legacy?.contextMenu ?? [], rewrite?.contextMenu ?? []);
}

function relativeP95Checks(legacy, rewrite) {
  const checks = [];
  const add = (id, legacyP95, rewriteP95) => {
    const valuesValid = finiteNonNegative(legacyP95) && finiteNonNegative(rewriteP95);
    const limitMs = valuesValid ? legacyP95 * P25_LIVE_RELATIVE_P95_RATIO : null;
    checks.push({
      id,
      legacyP95Ms: valuesValid ? legacyP95 : null,
      rewriteP95Ms: valuesValid ? rewriteP95 : null,
      limitMs,
      ratio: P25_LIVE_RELATIVE_P95_RATIO,
      pass: valuesValid && rewriteP95 <= limitMs,
    });
  };
  add("marking-gestures", legacy?.probes?.markingGestures?.timing?.p95Ms, rewrite?.probes?.markingGestures?.timing?.p95Ms);
  const legacyFrames = new Map((legacy?.frames ?? []).map((frame) => [frame.stage, frame]));
  const rewriteFrames = new Map((rewrite?.frames ?? []).map((frame) => [frame.stage, frame]));
  for (const stage of FRAME_PROOF_STAGE_IDS) {
    add(stage, legacyFrames.get(stage)?.rAF?.p95Ms, rewriteFrames.get(stage)?.rAF?.p95Ms);
  }
  return checks;
}

function pushCheck(checks, id, pass, detail = null) {
  checks.push({ id, pass: Boolean(pass), detail });
}

export function validateRunIdentity(identity) {
  const checks = [];
  pushCheck(checks, "schema", identity?.schemaVersion === P25_LIVE_SCHEMA_VERSION, identity?.schemaVersion ?? null);
  pushCheck(checks, "nonce", isNonce(identity?.runNonce), identity?.runNonce ?? null);
  pushCheck(checks, "implementation", IMPLEMENTATIONS.includes(identity?.implementation), identity?.implementation ?? null);
  pushCheck(checks, "build-variant", BUILD_VARIANTS.includes(identity?.build?.variant), identity?.build?.variant ?? null);
  pushCheck(checks, "label", (() => {
    try { return safeArtifactLabel(identity?.label) === identity?.label; } catch { return false; }
  })(), identity?.label ?? null);
  pushCheck(checks, "candidate-known", (() => {
    try { return Boolean(candidateFor(identity?.label ?? "invalid")); } catch { return false; }
  })(), identity?.label ?? null);
  pushCheck(checks, "url-normalized", (() => {
    try { return normalizeLiveUrl(identity?.expectedUrl) === identity?.normalizedUrl; } catch { return false; }
  })(), identity?.normalizedUrl ?? null);
  pushCheck(checks, "created-at", isIsoDate(identity?.createdAt), identity?.createdAt ?? null);
  pushCheck(checks, "source-head", typeof identity?.build?.source?.head === "string" && /^[a-f0-9]{40}$/.test(identity.build.source.head), identity?.build?.source?.head ?? null);
  pushCheck(checks, "source-tree", typeof identity?.build?.source?.tree === "string" && /^[a-f0-9]{40}$/.test(identity.build.source.tree), identity?.build?.source?.tree ?? null);
  pushCheck(checks, "source-dirty", typeof identity?.build?.source?.dirty === "boolean", identity?.build?.source?.dirty ?? null);
  pushCheck(checks, "source-clean", identity?.build?.source?.clean === true && identity?.build?.source?.dirty === false, { clean: identity?.build?.source?.clean ?? null, dirty: identity?.build?.source?.dirty ?? null });
  pushCheck(checks, "source-status-digest", isSha256(identity?.build?.source?.statusDigest), identity?.build?.source?.statusDigest ?? null);
  pushCheck(checks, "source-package-lock", isSha256(identity?.build?.source?.packageLockSha256), identity?.build?.source?.packageLockSha256 ?? null);
  pushCheck(checks, "source-build-command", identity?.build?.source?.buildCommand === "pnpm build", identity?.build?.source?.buildCommand ?? null);
  pushCheck(checks, "bundle-digest", isSha256(identity?.build?.bundle?.sha256), identity?.build?.bundle?.sha256 ?? null);
  pushCheck(checks, "bundle-inventory-digest", isSha256(identity?.build?.bundle?.inventoryDigest), identity?.build?.bundle?.inventoryDigest ?? null);
  pushCheck(checks, "bundle-file-count", Number.isInteger(identity?.build?.bundle?.fileCount) && identity.build.bundle.fileCount > 0, identity?.build?.bundle?.fileCount ?? null);
  const expectedManifestVersion = identity?.implementation === "legacy" ? "1.10.0" : "2.0.0";
  pushCheck(checks, "bundle-manifest-version", baseManifestVersion(identity?.build?.bundle?.manifestVersion) === expectedManifestVersion, identity?.build?.bundle?.manifestVersion ?? null);
  pushCheck(checks, "browser-fingerprint", isSha256(identity?.browser?.fingerprint), identity?.browser?.fingerprint ?? null);
  pushCheck(checks, "browser-instance", isNonce(identity?.browser?.instanceNonce), identity?.browser?.instanceNonce ?? null);
  pushCheck(checks, "profile-fingerprint", isSha256(identity?.profile?.fingerprint), identity?.profile?.fingerprint ?? null);
  pushCheck(checks, "profile-path-digest", isSha256(identity?.profile?.pathDigest), identity?.profile?.pathDigest ?? null);
  pushCheck(checks, "final-publish-forbidden", identity?.publicationContract?.finalPublishForbidden === true, identity?.publicationContract ?? null);
  pushCheck(checks, "publication-fence-before-activation", identity?.publicationContract?.fenceRequiredBeforeActivation === true, identity?.publicationContract ?? null);
  pushCheck(checks, "publication-extension-id", typeof identity?.publicationContract?.extensionId === "string" && /^[a-p]{32}$/.test(identity.publicationContract.extensionId), identity?.publicationContract?.extensionId ?? null);
  pushCheck(checks, "publication-guard-nonce", isNonce(identity?.publicationContract?.guardNonce), identity?.publicationContract?.guardNonce ?? null);
  pushCheck(checks, "launch-provenance", identity?.launchProvenance?.schemaVersion === "browser-live-provenance/v1" &&
    isNonce(identity?.launchProvenance?.launchNonce) && isIsoDate(identity?.launchProvenance?.createdAt) &&
    isSha256(identity?.launchProvenance?.sha256), identity?.launchProvenance ?? null);
  if (identity?.implementation === "legacy") {
    pushCheck(checks, "legacy-head-pinned", identity?.build?.source?.head === PINNED_LEGACY_HEAD, identity?.build?.source?.head ?? null);
    pushCheck(checks, "legacy-tree-pinned", identity?.build?.source?.tree === "ebfb2f160763e3acc3331e62f9824ac18d45fcad", identity?.build?.source?.tree ?? null);
    pushCheck(checks, "legacy-load-shim-policy", identity?.legacyLoadCompatibility?.policy === "installed-before-activation", identity?.legacyLoadCompatibility ?? null);
  }
  return { pass: checks.every((check) => check.pass), checks };
}

export function createStageExpectation({ runIdentity, id, sequence, stageNonce, documentKey = null, renderMode = null }) {
  if (!REQUIRED_LIVE_STAGE_IDS.includes(id)) throw new Error(`Unknown P25 live stage: ${id}`);
  if (!Number.isInteger(sequence) || sequence < 0) throw new Error(`Invalid stage sequence: ${sequence}`);
  if (!isNonce(stageNonce)) throw new Error(`Invalid stage nonce: ${stageNonce}`);
  if (renderMode !== null && !RENDER_MODES.includes(renderMode)) throw new Error(`Invalid render mode: ${renderMode}`);
  return {
    schemaVersion: P25_LIVE_STAGE_SCHEMA_VERSION,
    runNonce: runIdentity.runNonce,
    stageNonce,
    id,
    sequence,
    label: runIdentity.label,
    normalizedUrl: runIdentity.normalizedUrl,
    implementation: runIdentity.implementation,
    buildVariant: runIdentity.build.variant,
    sourceHead: runIdentity.build.source.head,
    sourceDirty: runIdentity.build.source.dirty,
    sourceStatusDigest: runIdentity.build.source.statusDigest,
    bundleDigest: runIdentity.build.bundle.sha256,
    browserFingerprint: runIdentity.browser.fingerprint,
    browserInstanceNonce: runIdentity.browser.instanceNonce,
    profileFingerprint: runIdentity.profile.fingerprint,
    documentKey,
    renderMode,
  };
}

export function validateStageRecord({ stage, expected, runIdentity, documents, fileMtimeMs = null, observedExitCode = null }) {
  const checks = [];
  pushCheck(checks, "stage-schema", stage?.schemaVersion === P25_LIVE_STAGE_SCHEMA_VERSION, stage?.schemaVersion ?? null);
  for (const key of [
    "runNonce", "stageNonce", "id", "sequence", "label", "normalizedUrl", "implementation",
    "buildVariant", "sourceHead", "sourceDirty", "sourceStatusDigest", "bundleDigest",
    "browserFingerprint", "browserInstanceNonce", "profileFingerprint", "documentKey", "renderMode",
  ]) {
    pushCheck(checks, `coherence-${key}`, sameJson(stage?.[key] ?? null, expected?.[key] ?? null), { expected: expected?.[key] ?? null, actual: stage?.[key] ?? null });
  }
  pushCheck(checks, "timestamps", timestampsOrdered(stage?.startedAt, stage?.finishedAt), { startedAt: stage?.startedAt, finishedAt: stage?.finishedAt });
  pushCheck(checks, "after-run-created", isIsoDate(stage?.startedAt) && Date.parse(stage.startedAt) >= Date.parse(runIdentity.createdAt), { runCreatedAt: runIdentity.createdAt, stageStartedAt: stage?.startedAt });
  if (fileMtimeMs !== null) {
    pushCheck(checks, "fresh-file-mtime", Number.isFinite(fileMtimeMs) && fileMtimeMs >= Date.parse(runIdentity.createdAt), { fileMtimeMs, runCreatedAt: runIdentity.createdAt });
  }
  if (observedExitCode !== null) {
    pushCheck(checks, "stage-exit-code-recorded", stage?.exitCode === observedExitCode, { observedExitCode, recordedExitCode: stage?.exitCode ?? null });
  }
  pushCheck(checks, "exit-code", Number.isInteger(stage?.exitCode), stage?.exitCode ?? null);
  pushCheck(checks, "stage-status", ["passed", "failed", "n/a"].includes(stage?.status), stage?.status ?? null);
  if (stage?.status === "passed") {
    pushCheck(checks, "passed-exit-zero", stage?.exitCode === 0, stage?.exitCode ?? null);
  }
  if (stage?.status === "failed") {
    pushCheck(checks, "failed-exit-nonzero", stage?.exitCode !== 0, stage?.exitCode ?? null);
  }
  if (stage?.status === "n/a") {
    pushCheck(checks, "n-a-reason", typeof stage?.reasonCode === "string" && stage.reasonCode.length > 0 && typeof stage?.reason === "string" && stage.reason.length > 0, { reasonCode: stage?.reasonCode, reason: stage?.reason });
  }
  if (stage?.documentKey !== null) {
    const document = documents?.[stage.documentKey];
    pushCheck(checks, "document-registered", Boolean(document), stage.documentKey);
    pushCheck(checks, "document-fingerprint", isSha256(stage?.documentFingerprint) && stage.documentFingerprint === document?.fingerprint, { stage: stage?.documentFingerprint, registered: document?.fingerprint });
    pushCheck(checks, "document-url", document?.normalizedUrl === runIdentity.normalizedUrl, { expected: runIdentity.normalizedUrl, actual: document?.normalizedUrl });
  }
  return { pass: checks.every((check) => check.pass), checks };
}

export function summarizeTiming(samples) {
  const values = samples.filter((value) => typeof value === "number" && Number.isFinite(value) && value >= 0).sort((left, right) => left - right);
  const percentile = (ratio) => values.length ? values[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)] : null;
  return {
    count: values.length,
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
    worstMs: values.at(-1) ?? null,
  };
}

export function validateAiEvidence(ai) {
  const checks = [];
  pushCheck(checks, "ai-mode", ["measured-current-run", "retained-reference-only", "not-run"].includes(ai?.mode), ai?.mode ?? null);
  if (ai?.mode === "measured-current-run") {
    pushCheck(checks, "ai-current-duration", typeof ai?.durationMs === "number" && ai.durationMs >= 0, ai?.durationMs ?? null);
    pushCheck(checks, "ai-current-request", Number.isInteger(ai?.requestCount) && ai.requestCount > 0, ai?.requestCount ?? null);
    pushCheck(checks, "ai-parity-eligible", ai?.parityEligible === true, ai?.parityEligible ?? null);
  } else {
    pushCheck(checks, "ai-not-parity", ai?.parityEligible === false, ai?.parityEligible ?? null);
    pushCheck(checks, "ai-reason", typeof ai?.reason === "string" && ai.reason.length > 0, ai?.reason ?? null);
    if (ai?.mode === "retained-reference-only") {
      pushCheck(checks, "ai-reference", typeof ai?.referenceArtifact === "string" && ai.referenceArtifact.length > 0, ai?.referenceArtifact ?? null);
      pushCheck(checks, "ai-reference-duration", typeof ai?.durationMs === "number" && ai.durationMs >= 0, ai?.durationMs ?? null);
    }
  }
  return { pass: checks.every((check) => check.pass), checks };
}

export function validateRunAggregate(aggregate) {
  const checks = [];
  const identityValidation = validateRunIdentity(aggregate?.identity);
  pushCheck(checks, "identity", identityValidation.pass, identityValidation.checks.filter((check) => !check.pass));
  const disposition = aggregate?.candidateDisposition;
  pushCheck(checks, "candidate-disposition", typeof disposition?.eligibility === "string" && typeof disposition?.parityEligible === "boolean", disposition ?? null);
  if (disposition?.parityEligible === false) {
    pushCheck(checks, "candidate-n-a-reason", typeof disposition?.reasonCode === "string" && disposition.reasonCode.length > 0 && typeof disposition?.reason === "string" && disposition.reason.length > 0, disposition ?? null);
  }
  const stages = Array.isArray(aggregate?.stages) ? aggregate.stages : [];
  const ids = stages.map((stage) => stage.id);
  const required = disposition?.parityEligible === false ? ["preflight", "publication-fence"] : REQUIRED_LIVE_STAGE_IDS;
  pushCheck(checks, "stage-completeness", required.every((id) => ids.includes(id)) && new Set(ids).size === ids.length, { required, ids });
  pushCheck(checks, "stage-order", stages.every((stage, index) => stage.sequence === index), stages.map((stage) => ({ id: stage.id, sequence: stage.sequence })));
  pushCheck(checks, "stage-validation", stages.every((stage) => stage.validation?.pass === true), stages.filter((stage) => stage.validation?.pass !== true).map((stage) => stage.id));
  pushCheck(checks, "stage-exits", stages.every((stage) => stage.status === "n/a" || stage.exitCode === 0), stages.filter((stage) => stage.status !== "n/a" && stage.exitCode !== 0).map((stage) => ({ id: stage.id, exitCode: stage.exitCode })));
  const comparableStages = stages.filter((stage) => COMPARABLE_WORKFLOW_STAGE_IDS.has(stage.id));
  const comparableDocuments = comparableStages.map((stage) => ({
    stage: stage.id,
    documentKey: stage.documentKey ?? null,
    document: stage.documentKey ? aggregate?.documents?.[stage.documentKey] ?? null : null,
  }));
  const firstComparableDocument = comparableDocuments[0]?.document ?? null;
  pushCheck(checks, "stable-workflow-document", disposition?.parityEligible === false || (
    comparableDocuments.length === COMPARABLE_WORKFLOW_STAGE_IDS.size &&
    typeof firstComparableDocument?.loaderId === "string" && firstComparableDocument.loaderId.length > 0 &&
    typeof firstComparableDocument?.timeOrigin === "number" && Number.isFinite(firstComparableDocument.timeOrigin) &&
    comparableDocuments.every(({ document }) =>
      document !== null &&
      document.loaderId === firstComparableDocument.loaderId &&
      document.timeOrigin === firstComparableDocument.timeOrigin)
  ), comparableDocuments.map(({ stage, documentKey, document }) => ({
    stage,
    documentKey,
    loaderId: document?.loaderId ?? null,
    timeOrigin: document?.timeOrigin ?? null,
  })));
  const renderModes = new Set(stages.filter((stage) => stage.status === "passed" && stage.renderMode).map((stage) => stage.renderMode));
  pushCheck(checks, "both-render-modes", disposition?.parityEligible === false || RENDER_MODES.every((mode) => renderModes.has(mode)), [...renderModes]);
  pushCheck(checks, "visual-probes", disposition?.parityEligible === false || ["marking-visual", "marking-scroll-fade", "marking-resize", "silent-visual", "silent-scroll-fade", "silent-resize"].every((id) => ids.includes(id)), ids);
  const gestureValidation = validateExactMarkingGestureEvidence(aggregate?.probes?.markingGestures);
  pushCheck(checks, "gesture-probes", disposition?.parityEligible === false || gestureValidation.pass, {
    failures: gestureValidation.failures,
    evidence: aggregate?.probes?.markingGestures ?? null,
  });
  pushCheck(checks, "independent-cardinality", disposition?.parityEligible === false || ["sourceCount", "sourceFragmentCount", "paintedRectCount", "visibleLayerCount", "physicalHitCount", "markableCandidateCount"].every((key) => Number.isInteger(aggregate?.probes?.cardinality?.[key]) && aggregate.probes.cardinality[key] >= 0), aggregate?.probes?.cardinality ?? null);
  pushCheck(checks, "border-layer-proof", disposition?.parityEligible === false || ((aggregate?.probes?.borders?.length ?? 0) > 0 && (aggregate?.probes?.layers?.length ?? 0) > 0), { borders: aggregate?.probes?.borders?.length ?? 0, layers: aggregate?.probes?.layers?.length ?? 0 });
  const scrollFadePass = (probe) => probe?.applicable === false
    ? probe.reason === "no-scrollable-viewport-owner"
    : probe?.scrolled === true && probe?.faded === true &&
      probe?.repositioned === true && probe?.restored === true;
  const resizePass = (probe) => probe?.viewportRestored === true && (
    probe?.repositioned === true ||
    (probe?.applicable === false && probe?.reason === "source-highlight-geometry-unchanged")
  );
  pushCheck(checks, "scroll-fade-resize-proof", disposition?.parityEligible === false || (
    scrollFadePass(aggregate?.probes?.markingScrollFade) &&
    scrollFadePass(aggregate?.probes?.silentScrollFade) &&
    resizePass(aggregate?.probes?.markingResize) &&
    resizePass(aggregate?.probes?.silentResize)
  ), {
    markingScrollFade: aggregate?.probes?.markingScrollFade ?? null,
    silentScrollFade: aggregate?.probes?.silentScrollFade ?? null,
    markingResize: aggregate?.probes?.markingResize ?? null,
    silentResize: aggregate?.probes?.silentResize ?? null,
  });
  const frames = Array.isArray(aggregate?.frames) ? aggregate.frames : [];
  const frameIds = frames.map((frame) => frame.stage);
  pushCheck(checks, "frame-proof", disposition?.parityEligible === false || (
    frames.length === FRAME_PROOF_STAGE_IDS.length &&
    new Set(frameIds).size === FRAME_PROOF_STAGE_IDS.length &&
    FRAME_PROOF_STAGE_IDS.every((id) => frameIds.includes(id)) &&
    frames.every((frame) =>
      (frame.rAF?.count ?? 0) > 0 &&
      finiteNonNegative(frame.rAF?.p95Ms) &&
      (frame.compositorFrames ?? 0) > 0 &&
      finiteNonNegative(frame.worstLongTaskMs))
  ), frames);
  const inputFrameStages = new Set([
    "marking-gestures",
    "marking-scroll-fade",
    "marking-resize",
    "silent-scroll-fade",
    "silent-resize",
  ]);
  const inputFrames = frames.filter((frame) => inputFrameStages.has(frame.stage));
  pushCheck(checks, "input-long-tasks", disposition?.parityEligible === false || inputFrames.every((frame) => frame.worstLongTaskMs <= 50), inputFrames.filter((frame) => frame.worstLongTaskMs > 50));
  pushCheck(checks, "activation-network", disposition?.parityEligible === false || (Array.isArray(aggregate?.network?.activation) && aggregate.network.activation.length > 0), aggregate?.network?.activation?.length ?? null);
  pushCheck(checks, "publication-fence", (disposition?.parityEligible === false || aggregate?.publicationFence?.installedBeforeActivation === true) && aggregate?.publicationFence?.finalPublishForbidden === true, aggregate?.publicationFence ?? null);
  pushCheck(checks, "zero-publish-attempts", aggregate?.publicationFence?.attemptCount === 0, aggregate?.publicationFence?.attemptCount ?? null);
  const aiValidation = validateAiEvidence(aggregate?.ai);
  pushCheck(checks, "ai-evidence", disposition?.parityEligible === false || aiValidation.pass, aiValidation.checks.filter((check) => !check.pass));
  pushCheck(checks, "aggregate-timestamps", timestampsOrdered(aggregate?.startedAt, aggregate?.finishedAt), { startedAt: aggregate?.startedAt, finishedAt: aggregate?.finishedAt });
  const pass = checks.every((check) => check.pass);
  return { pass, exitCode: pass ? 0 : 1, checks };
}

export function validateComparisonPair(pair) {
  const checks = [];
  pushCheck(checks, "pair-schema", pair?.schemaVersion === P25_LIVE_COMPARISON_SCHEMA_VERSION, pair?.schemaVersion ?? null);
  const legacy = pair?.runs?.legacy;
  const rewrite = pair?.runs?.rewrite;
  const legacyValidation = validateRunAggregate(legacy);
  const rewriteValidation = validateRunAggregate(rewrite);
  pushCheck(checks, "legacy-run", legacyValidation.pass, legacyValidation.checks.filter((check) => !check.pass));
  pushCheck(checks, "rewrite-run", rewriteValidation.pass, rewriteValidation.checks.filter((check) => !check.pass));
  const pairCreatedAt = Date.parse(pair?.createdAt);
  pushCheck(checks, "pair-created-after-runs", Number.isFinite(pairCreatedAt) &&
    pairCreatedAt >= Date.parse(legacy?.finishedAt) && pairCreatedAt >= Date.parse(rewrite?.finishedAt), {
    pairCreatedAt: pair?.createdAt ?? null,
    legacyFinishedAt: legacy?.finishedAt ?? null,
    rewriteFinishedAt: rewrite?.finishedAt ?? null,
  });
  pushCheck(checks, "pair-label", pair?.label === legacy?.identity?.label && pair?.label === rewrite?.identity?.label, { pair: pair?.label ?? null, legacy: legacy?.identity?.label, rewrite: rewrite?.identity?.label });
  pushCheck(checks, "pair-url", pair?.normalizedUrl === legacy?.identity?.normalizedUrl && pair?.normalizedUrl === rewrite?.identity?.normalizedUrl, { pair: pair?.normalizedUrl ?? null, legacy: legacy?.identity?.normalizedUrl, rewrite: rewrite?.identity?.normalizedUrl });
  pushCheck(checks, "pair-build-variant", legacy?.identity?.build?.variant === rewrite?.identity?.build?.variant, { legacy: legacy?.identity?.build?.variant, rewrite: rewrite?.identity?.build?.variant });
  pushCheck(checks, "pair-profile", legacy?.identity?.profile?.fingerprint === rewrite?.identity?.profile?.fingerprint, { legacy: legacy?.identity?.profile?.fingerprint, rewrite: rewrite?.identity?.profile?.fingerprint });
  pushCheck(checks, "pair-browser", legacy?.identity?.browser?.fingerprint === rewrite?.identity?.browser?.fingerprint, { legacy: legacy?.identity?.browser?.fingerprint, rewrite: rewrite?.identity?.browser?.fingerprint });
  pushCheck(checks, "candidate-disposition-equivalence", sameJson(legacy?.candidateDisposition, rewrite?.candidateDisposition), { legacy: legacy?.candidateDisposition ?? null, rewrite: rewrite?.candidateDisposition ?? null });
  const legacyDocument = comparableDocumentFor(legacy);
  const rewriteDocument = comparableDocumentFor(rewrite);
  const documentsEquivalent = Boolean(
    legacyDocument && rewriteDocument &&
    legacyDocument.normalizedUrl === rewriteDocument.normalizedUrl &&
    isSha256(legacyDocument.comparableFingerprint) &&
    legacyDocument.comparableFingerprint === rewriteDocument.comparableFingerprint
  );
  const recordedDocumentEvidence = pair?.documentEquivalence;
  pushCheck(checks, "document-equivalence", documentsEquivalent && recordedDocumentEvidence?.equivalent === true &&
    recordedDocumentEvidence?.legacy?.fingerprint === legacyDocument?.fingerprint &&
    recordedDocumentEvidence?.legacy?.comparableFingerprint === legacyDocument?.comparableFingerprint &&
    recordedDocumentEvidence?.legacy?.normalizedUrl === legacyDocument?.normalizedUrl &&
    recordedDocumentEvidence?.rewrite?.fingerprint === rewriteDocument?.fingerprint &&
    recordedDocumentEvidence?.rewrite?.comparableFingerprint === rewriteDocument?.comparableFingerprint &&
    recordedDocumentEvidence?.rewrite?.normalizedUrl === rewriteDocument?.normalizedUrl,
  { recorded: recordedDocumentEvidence ?? null, legacyDocument, rewriteDocument });
  const bothAiCurrent = legacy?.ai?.mode === "measured-current-run" && rewrite?.ai?.mode === "measured-current-run";
  pushCheck(checks, "ai-parity-not-masqueraded", pair?.aiParity?.claimed !== true || (bothAiCurrent && legacy.ai.parityEligible === true && rewrite.ai.parityEligible === true), { legacy: legacy?.ai, rewrite: rewrite?.ai, claimed: pair?.aiParity?.claimed });
  const candidatePair = legacy?.candidateDisposition?.parityEligible === true && rewrite?.candidateDisposition?.parityEligible === true;
  pushCheck(checks, "ai-current-comparable", !candidatePair || bothAiCurrent, { candidatePair, legacyMode: legacy?.ai?.mode, rewriteMode: rewrite?.ai?.mode });
  const cardinalityEquivalent = CARDINALITY_KEYS.every((key) =>
    legacy?.probes?.cardinality?.[key] === rewrite?.probes?.cardinality?.[key]);
  pushCheck(checks, "cardinality-parity", !candidatePair || cardinalityEquivalent, {
    legacy: legacy?.probes?.cardinality ?? null,
    rewrite: rewrite?.probes?.cardinality ?? null,
  });
  pushCheck(checks, "border-parity", !candidatePair || sameUnorderedRecords(legacy?.probes?.borders, rewrite?.probes?.borders), {
    legacy: legacy?.probes?.borders ?? null,
    rewrite: rewrite?.probes?.borders ?? null,
  });
  pushCheck(checks, "layer-parity", !candidatePair || sameUnorderedRecords(legacy?.probes?.layers, rewrite?.probes?.layers), {
    legacy: legacy?.probes?.layers ?? null,
    rewrite: rewrite?.probes?.layers ?? null,
  });
  pushCheck(checks, "gesture-semantic-parity", !candidatePair || exactGestureSemantics(legacy?.probes?.markingGestures, rewrite?.probes?.markingGestures), {
    legacy: legacy?.probes?.markingGestures ?? null,
    rewrite: rewrite?.probes?.markingGestures ?? null,
  });
  const p95Checks = relativeP95Checks(legacy, rewrite);
  pushCheck(checks, "relative-p95-parity", !candidatePair || p95Checks.every((check) => check.pass), p95Checks);
  pushCheck(checks, "comparison-projection", sameJson(pair?.comparison?.cardinality?.legacy, legacy?.probes?.cardinality) &&
    sameJson(pair?.comparison?.cardinality?.rewrite, rewrite?.probes?.cardinality) &&
    sameJson(pair?.comparison?.markingGestureTiming?.legacy, legacy?.probes?.markingGestures?.timing) &&
    sameJson(pair?.comparison?.markingGestureTiming?.rewrite, rewrite?.probes?.markingGestures?.timing) &&
    sameJson(pair?.comparison?.frames?.legacy, legacy?.frames) &&
    sameJson(pair?.comparison?.frames?.rewrite, rewrite?.frames),
  pair?.comparison ?? null);
  pushCheck(checks, "zero-publish-attempts", (legacy?.publicationFence?.attemptCount ?? -1) === 0 && (rewrite?.publicationFence?.attemptCount ?? -1) === 0, { legacy: legacy?.publicationFence?.attemptCount, rewrite: rewrite?.publicationFence?.attemptCount });
  const pass = checks.every((check) => check.pass);
  return { pass, exitCode: pass ? 0 : 1, checks };
}

export function validateComparisonMatrix({ pairs, buildVariant }) {
  const checks = [];
  pushCheck(checks, "matrix-build-variant", BUILD_VARIANTS.includes(buildVariant), buildVariant ?? null);
  const values = Array.isArray(pairs) ? pairs : [];
  const labels = values.map((pair) => pair?.label ?? null);
  const knownLabels = new Set(CANDIDATE_MATRIX.map((candidate) => candidate.label));
  const unexpectedLabels = labels.filter((label) => !knownLabels.has(label));
  const duplicateLabels = [...new Set(labels.filter((label, index) => labels.indexOf(label) !== index))];
  pushCheck(checks, "known-matrix-labels", unexpectedLabels.length === 0, unexpectedLabels);
  pushCheck(checks, "unique-matrix-labels", duplicateLabels.length === 0, duplicateLabels);

  if (buildVariant === "debug") {
    pushCheck(checks, "debug-has-no-parity-pairs", values.length === 0, labels);
    const pass = checks.every((check) => check.pass);
    return { pass, exitCode: pass ? 0 : 1, checks, missingEligible: [], failedLabels: pass ? [] : labels };
  }

  const pairResults = values.map((pair) => {
    const candidate = CANDIDATES_BY_LABEL.get(pair?.label);
    const validation = validateComparisonPair(pair);
    const recordedDispositionEligible = pair?.runs?.legacy?.candidateDisposition?.parityEligible === true &&
      pair?.runs?.rewrite?.candidateDisposition?.parityEligible === true;
    const expectedOverall = validation.pass ? (recordedDispositionEligible ? "passed" : "n/a") : "failed";
    const urlCoherent = Boolean(candidate) && (() => {
      try { return normalizeLiveUrl(candidate.url) === pair?.normalizedUrl; } catch { return false; }
    })();
    return {
      label: pair?.label ?? null,
      pass: validation.pass &&
        pair?.validation?.pass === true &&
        pair?.validation?.exitCode === 0 &&
        pair?.overall === expectedOverall &&
        pair?.runs?.legacy?.identity?.build?.variant === buildVariant &&
        pair?.runs?.rewrite?.identity?.build?.variant === buildVariant &&
        urlCoherent,
      validation,
      urlCoherent,
      expectedOverall,
      recordedOverall: pair?.overall ?? null,
    };
  });
  pushCheck(checks, "validated-matrix-pairs", pairResults.every((result) => result.pass), pairResults.filter((result) => !result.pass));
  const observedLabels = new Set(labels);
  const missingEligible = CANDIDATE_MATRIX
    .filter((candidate) => candidate.eligibility === "candidate" && !observedLabels.has(candidate.label))
    .map((candidate) => candidate.label);
  pushCheck(checks, "complete-eligible-matrix", missingEligible.length === 0, missingEligible);
  const authorityProjection = (pair) => ({
    legacyHead: pair?.runs?.legacy?.identity?.build?.source?.head ?? null,
    legacyBundle: pair?.runs?.legacy?.identity?.build?.bundle?.inventoryDigest ?? null,
    rewriteHead: pair?.runs?.rewrite?.identity?.build?.source?.head ?? null,
    rewriteTree: pair?.runs?.rewrite?.identity?.build?.source?.tree ?? null,
    rewriteStatus: pair?.runs?.rewrite?.identity?.build?.source?.statusDigest ?? null,
    rewriteBundle: pair?.runs?.rewrite?.identity?.build?.bundle?.inventoryDigest ?? null,
    profile: pair?.runs?.rewrite?.identity?.profile?.fingerprint ?? null,
    browser: pair?.runs?.rewrite?.identity?.browser?.fingerprint ?? null,
  });
  const authorities = values.map(authorityProjection);
  pushCheck(checks, "single-matrix-authority", authorities.length > 0 && authorities.every((authority) => sameJson(authority, authorities[0])), authorities);
  const publishAttemptCount = values.reduce((sum, pair) => sum +
    (pair?.runs?.legacy?.publicationFence?.attemptCount ?? 0) +
    (pair?.runs?.rewrite?.publicationFence?.attemptCount ?? 0), 0);
  pushCheck(checks, "matrix-zero-publish-attempts", publishAttemptCount === 0, publishAttemptCount);
  const pass = checks.every((check) => check.pass);
  return {
    pass,
    exitCode: pass ? 0 : 1,
    checks,
    missingEligible,
    failedLabels: pairResults.filter((result) => !result.pass).map((result) => result.label),
    publishAttemptCount,
  };
}
