# P26 expert-loop remediation — EL-01-R1

**Status:** APPROVED FOR EXECUTION. The user selected architecture option 1 on
2026-08-30. This plan enters `run-plan` from clean, synchronized `re-write`
commit `8e7e4854`. Successful execution is authorized to commit and push normally;
deployment, authoritative production Save, and final Lynx publication are not
authorized.

## 1. Goal

Close every product-owned release blocker carried forward from the skipped
initial `EL-01` expert audit, without weakening the rewrite's authority,
extraction, consent-suppression, performance, or publication contracts. The
result must eliminate the always-on/forgeable MAIN-world bridge, bound remote
work and parse failures, restore truthful interaction state and accessibility,
stabilize exact emulation and performance gates, reduce avoidable package
weight, and pass an independent criterion-by-criterion conformance check on the
exact pushed source before the next full expert audit begins.

## 2. Loop ledger and evidence identity

- **Outer audit:** `EL-01` (initial audit deliberately reused at the user's
  request; no duplicate initial audit).
- **Entering audit source:** `d70b8bb3`; workflow-skill commits after that audit
  do not change product behavior. Execution starts at `8e7e4854`.
- **Remediation revision:** `EL-01-R1`.
- **Branch/upstream:** `re-write` / `origin/re-write`, synchronized `0/0` at
  plan creation; tracked worktree clean.
- **Findings in scope:** `EL-01-F001` through `EL-01-F014` below.
- **Conformance rule:** acceptance criteria in section 10 are append-only once
  implementation begins. Evidence and status may be added; any changed product
  decision requires `EL-01-R2` and must preserve this revision.
- **Historical plan:** the complete P25 plan remains preserved in Git at
  `d70b8bb3` and in the linked `.reimplementation/p25-*` reports. This file is
  the only active execution plan.

### Entering finding register

| ID | Severity | Confirmed release gap |
|---|---:|---|
| `EL-01-F001` | Critical | `page-world.content.ts` installs MAIN-world hooks at `document_start` on every URL before property authority exists. |
| `EL-01-F002` | Critical | Lifecycle commands cross page-observable `window.postMessage("*")`; a fixed public runtime marker exposes control/teardown. |
| `EL-01-F003` | High | Content List focus plus smooth virtual scrolling can form a permanent scroll/remount loop and lose focus. |
| `EL-01-F004` | High | JSON transport requests have no cancellation/deadline and blindly parse all response text as JSON. |
| `EL-01-F005` | High | Cross-property handoff copy and enabled controls can contradict action authority. |
| `EL-01-F006` | High | The first mobile transition can acknowledge a non-contract viewport before later settling to 412×960. |
| `EL-01-F007` | High | Alt-include followed by exact clear can remain falsely dirty and require an unnecessary AI rerun. |
| `EL-01-F008` | High | Operator endpoint settings accept HTTP and structurally unsafe stage values. |
| `EL-01-F009` | High | The complete JWT is placed in the WebSocket URL query string. |
| `EL-01-F010` | High | Supported-Chrome truth is undeclared; offscreen detection can race or use an unavailable API. |
| `EL-01-F011` | High | Modal dialogs lack a complete focus trap, inert background, initial focus, and trigger restoration. |
| `EL-01-F012` | Medium | P25 can fail because P14 crosses the strict threshold by sub-millisecond harness noise despite an isolated pass. |
| `EL-01-F013` | Medium | Marking copy, raw failure/detail text, menu/listbox/context-menu keyboard behavior, labels, focus, and minimum target sizing are inconsistent. |
| `EL-01-F014` | Medium | The package retains avoidable duplicate/oversized assets and hostile-bridge, focus, request, emulation, and cleanup regressions lack explicit coverage. |

## 3. Current facts

- `wxt.config.ts` declares `<all_urls>`, `scripting`, `sidePanel`, `offscreen`,
  and debugger permissions, but no `minimum_chrome_version`.
- `src/entrypoints/page-world.content.ts` imports the generated program in the
  MAIN world at `document_start` and relays through `createPageTransport()`.
- `src/messaging/transports/page.ts:createPageTransport()` and
  `src/entrypoints/content-loader.content.ts:requestStabilizationPageCommand()`
  use page-visible message traffic.
- `src/page-world/program.ts:installPageWorldProgram()` currently publishes
  `__unfluffifyPageWorldRuntime__`, owns the lifecycle queue, and can already
  return typed command results internally.
- `src/background/index.ts:startRewriteBackground()` already tracks exact
  main-frame `tabId`, `documentId`, normalized URL, navigation epoch, consent
  tombstones, and managed `page.context` authority. It is the correct admission
  point for a document lease.
- `src/messaging/realms.ts:applicationContract` is the typed runtime contract
  shared by content and background.
- `src/popup/sections/PreviewRowList.tsx:PreviewRowList()` updates the virtual
  window from scrolling and calls both `focus()` and smooth `scrollIntoView()`
  on every relevant render.
- `src/background/services.ts:createFetchJsonTransport()` calls bare `fetch`,
  has no signal/deadline, and calls `JSON.parse(text)` without a shape guard.
- `src/lynx/transport.ts:JsonRequest` has no deadline or abort contract.
- `src/lock/ws.ts:buildPropertyLockWssUrl()` appends `?token=<JWT>`; the current
  server-side authentication protocol is not implemented in this repository.
- `src/background/render-emulation-runtime.ts:createRenderEmulationRuntime()`
  serializes CDP writes but treats command completion as posture proof.
- `src/entrypoints/popup/main.tsx:runSessionTransition()` fences polling and
  `applySessionEmulationResult()` adopts the returned `active` bit.
- `src/lynx/ai-job.ts:markMarkingEdit()` sets `pendingChanges: true`
  unconditionally even when the canonical fingerprint returns to the baseline.
- `src/storage/settings.ts:ConnectionSettingsSchema` uses generic URL/string
  schemas rather than HTTPS/host-only policy.
- `src/background/index.ts:ensureOffscreenDocument()` depends on optional
  `offscreen.hasDocument()` and has no cross-caller single flight.
- `src/ui/transient-surface-manager.ts:createTransientSurfaceManager()` owns
  transient stacking/outside/Escape behavior but does not own modal focus.
- `src/public/logo.png` is a 1360×961, 1.12 MB UI logo; the full Material Design
  icon CSS is 421 KB and its font is 403 KB for a bounded product icon subset.
- The P14 threshold is a product contract and must not be raised. P25 must gain
  deterministic isolation/headroom instead.

## 4. Decisions already made

1. **Authority-gated capability RPC (user-selected option 1).** No static
   MAIN-world page program may run before a background-authoritative managed
   property decision. Background owns one lease per exact main document.
2. Each lease uses a cryptographically random endpoint key and 256-bit
   capability stored only in extension realms/session storage. The page program
   exposes no fixed marker, page event, DOM marker, or `postMessage` channel.
3. Commands execute with `chrome.scripting.executeScript({ world: "MAIN",
   target: { tabId, documentIds: [...] }, func, args })`; the dispatcher validates
   the exact capability and returns a typed result directly.
4. Admission fails closed on sender realm, main frame, tab, document, normalized
   URL, navigation epoch, managed context, and consent registration. Identity
   changes invalidate the lease before any command.
5. Intentional consent suppression remains PASS and unchanged: suppressed UI
   stays hidden and excluded from overlays, Content List, captures, AI, Save,
   and publication payloads.
6. No performance, parity, accessibility, or security threshold may be weakened.
7. Chrome 116 is the minimum supported browser because `sidePanel` is shipped.
8. Remote calls use operation deadlines. AI polling respects its existing job
   deadline; normal authority calls use 15 seconds unless a shorter deadline is
   supplied.
9. Production endpoints are HTTPS-only. Loopback HTTP is allowed only in a
   compile-time debug build. `stageBase` is a hostname, never URL/path/query/
   credential.
10. WebSocket authentication cannot assume an unproven remote handshake. P26
    adds a typed secure credential carrier and removes URL credentials from the
    default production path. Missing authority support fails closed with
    truthful UI. A query-token fallback is allowed only for debug loopback.
11. Deployment, production mutation, authoritative Save, and final Lynx
    publication remain out of scope.

## 5. Open questions

None. The architecture fork was answered with option 1. WebSocket server
capability is discovered/proved and fails closed; it is not guessed by client.

## 6. Non-goals

- Do not alter selector payload schemas, extraction semantics, Todo completeness,
  or publication fencing.
- Do not make suppressed blocking UI visible or extractable.
- Do not remove Googlebot Smartphone identity, 412×960 marking, 1920×1080 silent
  desktop, reveal/freeze, motion/lazy suppression, or closed-shadow support.
- Do not add a broad page-facing bridge, fixed secret name, public debug marker,
  DOM event, or page-visible nonce as a shortcut.
- Do not render every Content List row or raise P14/P25 thresholds.
- Do not force-push, rebase, deploy, Save, or publish selectors.

## 7. Implementation phases

### P26-01 — Document-bound MAIN-world capability runtime

**Findings:** `F001`, `F002`, hostile-bridge coverage from `F014`.

**Files:** `src/page-world/program.ts`, new
`src/background/page-world-capability-runtime.ts`, `src/background/index.ts`,
`src/messaging/realms.ts`, `src/messaging/contract.ts`,
`src/entrypoints/content-loader.content.ts`; retire
`src/entrypoints/page-world.content.ts` and
`src/messaging/transports/page.ts`; update generator/package/build provenance and
page-world/content/background tests.

**Steps**

1. Export a self-contained serializable installer accepting random endpoint key
   and capability. Store one non-enumerable/non-configurable/non-writable
   dispatcher; closure state validates capability, command, and generation.
2. Preserve command serialization, terminal preemption, reinjection transfer,
   closed-shadow ownership, motion/timer restoration, and idempotent destroy.
3. Add the background lease service around exact `tabId+documentId+URL+epoch`;
   persist only in `storage.session`, never logs or page state.
4. Install only after exact `page.context` is managed/current. Unknown,
   non-candidate, unregistered, and unrelated pages receive no executeScript.
5. Route every lifecycle command through background; recheck authority before
   and after install/invoke and fail stale when navigation wins.
6. Recover the exact lease after worker restart; if dispatcher proof fails,
   retire it and install one replacement. Invalidate on navigation/unregister/
   tab close.
7. Remove fixed marker, relay strings, window message handling, and static MAIN
   manifest entrypoint.

**Focused validation**

```bash
pnpm vitest run tests/src/background/page-world-capability-runtime.test.ts \
  tests/src/page-world/program.test.ts tests/c4-content-entrypoint.test.ts \
  tests/page-motion-freeze-bridge.test.ts tests/build-artifact-parity.test.ts \
  tests/manifest-permissions.test.ts
pnpm check
pnpm build
```

**Fallback:** if Chrome 116 cannot exact-target a document, stop and record a
blocker. Never restore a page-visible relay or all-URL MAIN script.

### P26-02 — Bounded typed remote transport

**Findings:** `F004`, request/error coverage from `F014`.

**Files:** `src/lynx/transport.ts`,
`src/background/services.ts:createFetchJsonTransport`, AI/config/account call
owners, `src/lynx/ai-job.ts`; service/AI/account tests.

**Steps**

1. Add optional caller signal and absolute deadline, compose with an internal
   abort controller, choose the earlier deadline, and clear timers in `finally`.
2. Return stable timeout/cancel/network/invalid-response outcomes and human-safe
   UI copy; keep raw detail debug-only.
3. Empty body becomes null. Valid JSON is parsed. Non-JSON success is invalid;
   non-JSON failure keeps HTTP status and bounded diagnostic text.
4. Polling remains single-flight and starts no request after job deadline.

**Validation:** `pnpm vitest run tests/src/background/services.test.ts
tests/src/lynx/ai-job.test.ts tests/src/lynx/accounts.test.ts`.

**Fallback:** retain response-domain adapters if needed, never unbounded fetch or
blind parse.

### P26-03 — Truthful lock transition and secure credential carrier

**Findings:** `F005`, `F009`.

**Files:** `src/lock/ws.ts`, `src/lock/client.ts`, lock construction in
`src/background/services.ts`, `src/lock/view.ts`, popup lock presentation/action
admission, lock/popup/orchestration tests.

**Steps**

1. Production URL is `wss://<host>/property-lock` with no credential in URL,
   history, errors, or logs; only debug loopback may use URL-token compatibility.
2. Require advertised one-time ticket or acknowledged first auth frame before
   subscribe/queued traffic; rotate credentials inside authenticated channel.
3. Absent/rejected capability closes and projects `unavailable`; never retry a
   query JWT in production.
4. Use one typed lock-action readiness projection. During handoff, banner,
   toggle, tooltip, reason, and action all say pending/unavailable. Enable only
   for exact property and editor session.

**Validation:** `pnpm vitest run tests/src/lock/lock.test.ts
tests/src/lock/copy.test.ts tests/src/popup/presentation.test.ts
tests/src/popup/entrypoint.test.ts tests/orchestration-property-lock-scenario.test.ts`.

**Fallback:** missing production server support is an explicit external blocker;
keep fail-closed and never ship URL JWT leakage.

### P26-04 — Exact emulation acknowledgement and reversible freshness

**Findings:** `F006`, `F007`.

**Files:** `src/background/render-emulation-runtime.ts`,
`src/content/stabilization/emulation.ts`, emulation schema,
`src/entrypoints/popup/main.tsx`, `src/lynx/ai-job.ts`, content/popup signal path,
and corresponding tests.

**Steps**

1. After CDP writes, prove exact inner viewport, media, touch/pointer, DPR/scale,
   and identity. Retry the same serialized posture once after a browser frame.
2. Return active only for exact 412×960 mobile or 1920×1080 desktop proof;
   mismatch restores prior posture and gives reason-specific failure.
3. Preserve reload/polling fences so stale restoration cannot become final writer.
4. Compare current canonical normalized decision fingerprint with the fresh
   fingerprint. Returning to baseline restores fresh locally; true differences
   remain immediately stale.

**Validation:** render-emulation, stabilization, popup transition/entrypoint,
AI-job, and signal-cursor test suites.

**Fallback:** never acknowledge requested values without measured proof.

### P26-05 — One-shot Content List focus and modal focus ownership

**Findings:** `F003`, `F011`, accessibility part of `F013`.

**Files:** `src/popup/sections/PreviewRowList.tsx` and CSS,
`src/ui/transient-surface-manager.ts`/React hook, dialog surfaces in
`src/popup/App.tsx`, preview/transient/app/P17/P18 tests.

**Steps**

1. Handle each `projectionId+focusedRowId` occurrence once. Move virtual window,
   focus with `preventScroll`, and scroll only when outside visible bounds using
   bounded non-smooth viewport scrolling.
2. Ignore programmatic scroll that maps to the held window; never oscillate.
   Preserve stable keys, Enter/Space, focus emphasis, two-way routing, and target
   unavailable truth.
3. Add modal root, initial/return focus, background inert state, Tab trap, exact
   cleanup, and trigger/fallback restore. Menus remain non-modal with roving
   focus and Escape-to-trigger.

**Validation:** preview-row-list, transient-surface-manager, app tests plus
`pnpm performance:p17:smoke` and `pnpm performance:p18:smoke`.

**Fallback:** retain bounded virtualization; if target focus cannot be proved,
show a truthful unavailable state rather than reintroduce animation loops.

### P26-06 — Settings safety, Chrome floor, and offscreen single flight

**Findings:** `F008`, `F010`.

**Files:** `src/storage/settings.ts`, settings UI/consumers, `wxt.config.ts`,
generated manifest expectations, and extracted/existing offscreen owner with
settings/manifest/startup/offscreen tests.

**Steps**

1. Normalize endpoints on save: HTTPS, no credentials/fragment, bounded path;
   debug loopback may use HTTP. `stageBase` is an IDNA hostname without scheme/
   path/query/credential; only debug loopback may use a port.
2. Return field-specific errors before persistence and never send a token to an
   invalid/changed profile.
3. Declare minimum Chrome 116 and align build/test targets.
4. Make offscreen creation single-flight. Use `runtime.getContexts` at the
   compatibility floor and `hasDocument` only when available. Re-prove one exact
   context after duplicate/create errors before success.

**Validation:** settings, background startup, offscreen, manifest tests and
production build.

**Fallback:** legacy unsafe settings become explicit invalid state; do not
grandfather them silently.

### P26-07 — Production copy, keyboard contracts, and error hygiene

**Findings:** remaining `F013`.

**Files:** `src/popup/App.tsx`, popup/content copy, relevant CSS, popup header
menu, theme listbox, page context menu, Todo heading, and error adapters/tests.

**Steps**

1. Copy states actual contract: plain click only clears an existing mark; Shift
   creates/expands exclusion; Alt creates explicit inclusion; right-click offers
   contextual operations.
2. Implement Arrow/Home/End/Escape/Enter/Space and truthful roles for menus,
   listboxes, context menus, and Content List; preserve visible focus.
3. Replace internal tokens/raw exceptions in production UI with human copy;
   structured detail remains behind `__UF_DEBUG_BUILD__`.
4. Give controls at least 24×24 CSS pixel hit boxes and correct Todo/header ARIA.

**Validation:** app, presentation, lock-copy, and marking-interaction tests.

**Fallback:** keep internal canonical names; never expose them for snapshot
convenience.

### P26-08 — Deterministic performance gate and package hygiene

**Findings:** `F012`, asset/package part of `F014`.

**Files:** P14/P25 gate/orchestration/contracts; optimize `src/public/logo.png`;
replace full Material icon payload with bounded generated subset or local SVG
components; build/package budget tests.

**Steps**

1. Run P14 inside P25 with a fresh child/browser/profile, deterministic warm-up,
   no observer, and complete prior-child teardown. Attribute only contract work
   and retain every accepted sample.
2. Require three consecutive clean composite P25 passes; thresholds unchanged.
3. Downsample logo to at most 2× rendered dimensions with transparent quality.
   Ship used glyphs/vectors once, not hashed plus public duplicates.
4. Gate: logo ≤150 KB, icon payload ≤150 KB, production package ≤3 MB, and no
   duplicate file >100 KB unless allowlisted with runtime reason.

**Validation:** P14/P25 contract and bundle/package tests, build, then three
consecutive `pnpm performance:p25` runs.

**Fallback:** revert visually defective asset optimization; never relax
performance thresholds or discard samples.

### P26-09 — Integrated validation and headed acceptance

**Findings:** coverage part of `F014`; all-finding regression closure.

**Files:** add hostile/unrelated and exact-managed scenarios to P20/P25 or a P26
gate; update `.copilot/knowledge.md` only for durable facts; append evidence here.

**Steps**

1. Run focused suites, production/debug builds, and full automated gate.
2. Run P14, P15, P16, P17, P18, P20, P23, P25 on exact source; P25 passes three
   consecutive composites after P26-08.
3. Use repository `live-round`/`live-browser` only. Prove no MAIN install on an
   unrelated URL; on valid candidates exercise inspection, marking modifiers/
   clear, AI failure/retry without production mutation, Content List routing,
   silent highlight, reveal/freeze/lazy, consent, emulation, Discard, navigation/
   reopen, accessibility, and console/network cleanup.
4. Do not authoritative-Save or publish. Use local/mock mutation authority and
   prove zero production publication attempts.
5. `review-push`, commit intended files, push normally, reindex after commit and
   push, and verify clean `0/0` sync.
6. Independently check every `AC-*` on the pushed commit. Red/partial/blocked
   product-owned criteria create `EL-01-R2`; only APPROVED starts `EL-02`.

**Full validation**

```bash
pnpm verify
pnpm build:debug
pnpm performance:p14
pnpm performance:p15
pnpm performance:p16
pnpm performance:p17
pnpm performance:p18
pnpm performance:p20
pnpm performance:p23
pnpm performance:p25
```

**Fallback:** diagnose each live failure as product, harness, site, observer, or
external authority. Never count BLOCKED/N/A/NOT TESTED as PASS.

## 8. Test matrix

| Layer | Required proof |
|---|---|
| Unit/source | Capability rejection/fencing, transport timeout/cancel/non-JSON, lock auth/copy, emulation proof/rollback, reversible fingerprint, virtual focus, modal trap, endpoint validation, offscreen single flight, production copy/assets. |
| Integration | Managed context→lease→freeze command, navigation invalidation, worker recovery, AI cleanup, handoff/action authority, popup reopen, debug/production separation. |
| Build/package | No static MAIN script/public relay; Chrome 116; required assets only; size/duplicate budgets; production/debug builds. |
| Browser gates | Applicable P14–P25 gates, three consecutive P25 composites, unchanged thresholds. |
| Headed unrelated | Zero MAIN mutation before/without managed authority; hostile calls rejected. |
| Headed managed | Exact emulation, freeze, consent/extraction hygiene, responsive overlays, one-shot list focus, retry cleanup, no Save/publication. |
| Accessibility | Modal containment/restore/inert, keyboard patterns, truthful roles/names/status, ≥24px targets, visible focus. |
| Security/privacy | No URL JWT, unsafe endpoint, public runtime/relay, capability leak, suppressed/debug payload artifact, or raw credential/error log. |

## 9. Regression risks

- Late MAIN installation may miss early closed roots: content requests authority
  at document start and an early-closed-root fixture must pass; failure blocks.
- Worker restart may orphan state: session lease proves/resumes exactly or
  retires and installs one replacement; multiple generations are forbidden.
- Patched page intrinsics may contaminate MAIN execution: installer captures
  primitives and hostile-patch tests; unprovable invocation fails closed.
- Deadlines may terminate slow AI: each request is bounded by the existing
  absolute job lifecycle and reports its actual failing stage.
- Secure WebSocket support may be absent: truthful fail-closed protects JWT;
  never add silent production fallback.
- Viewport proof may loop: one retry, generation checks, and prior rollback bound it.
- Freshness reversion must not erase edits: compare canonical normalized rows and
  explicit ownership, not action counts or painted overlays.
- Modal trapping may conflict with menus: only top modal traps/inerts; ephemeral
  stack behavior remains.
- Asset subsetting may omit a glyph: derive used-icon inventory and render-check.
- Gate stabilization may hide slowness: thresholds and samples remain immutable;
  only setup isolation and attribution change.

## 10. Append-only acceptance criteria

- `AC-01` No production manifest MAIN script runs on `<all_urls>`; unrelated,
  unknown, and non-candidate pages receive zero page-world installation.
- `AC-02` Every managed command is admitted by exact background document/URL/
  epoch authority; navigation, unregister, and close invalidate it.
- `AC-03` Production exposes no fixed runtime marker, relay, DOM marker,
  `postMessage` command, or capability in page-visible/logged state; wrong
  capability has zero effect.
- `AC-04` Managed reveal/freeze, lazy/motion/timer suspension, closed-shadow,
  destroy, and restart recovery retain exact terminal/cleanup contracts.
- `AC-05` Every remote request is cancellable/deadline-bound; empty, malformed,
  JSON, and non-JSON responses become typed outcomes with terminal cleanup.
- `AC-06` Production WebSocket URLs/logs contain no JWT; subscription waits for
  secure auth and missing support fails closed explicitly.
- `AC-07` Cross-property pending state has one truthful banner/control/action
  projection; forbidden action is never visually enabled.
- `AC-08` Emulation acknowledges only after exact 412×960 or 1920×1080 measured
  posture including media/touch/identity; failure restores prior posture.
- `AC-09` Alt include then exact clear returns to fresh within one local signal
  cycle; a real difference invalidates Save/List immediately.
- `AC-10` Content List handles focus occurrence once, never loops scroll/remount,
  retains keyboard focus, routing, and unavailable-target truth.
- `AC-11` Every modal traps focus, inerts background, initializes/restores focus,
  and cleans all close paths; menus/listboxes/context menus pass keyboard rules.
- `AC-12` Unsafe endpoints/stage values fail before persistence/credential use;
  Chrome 116 is declared; concurrent offscreen calls prove one document.
- `AC-13` Production copy describes plain/Shift/Alt/right-click truth, hides raw
  internals, uses truthful ARIA/visible focus, and ≥24×24 hit boxes.
- `AC-14` P14/P25 thresholds are unchanged and three consecutive full P25
  composites pass cleanly.
- `AC-15` Package meets logo/icon/total/duplicate budgets without visual/glyph loss.
- `AC-16` `pnpm verify`, debug build, applicable P14–P25 gates, security/payload,
  and headed unrelated/managed workflows pass on exact pushed source with zero
  unauthorized Save/publication attempts.
- `AC-17` Consent suppression remains PASS: suppressed nodes paint no stale
  overlay and enter no List/capture/AI/Save/publication artifact.
- `AC-18` Final branch is clean and synchronized `0/0`; independent conformance
  is `APPROVED` before `EL-02`.

## 11. Todo chain

Stored in `.temp/run-plan-session.sqlite`:

1. `p26-capability-runtime`
2. `p26-bounded-transport` → 1
3. `p26-lock-security-truth` → 2
4. `p26-emulation-freshness` → 3
5. `p26-focus-accessibility` → 4
6. `p26-settings-compatibility` → 5
7. `p26-copy-keyboard-hygiene` → 6
8. `p26-performance-package` → 7
9. `p26-integrated-acceptance` → 8
10. `p26-review-push` → 9
11. `p26-conformance-check` → 10

## 12. EL-01-R1 conformance result

**Verdict:** `APPROVED` on implementation commit
`3d28d2a080a71a97cf0f6cc60c6e94f31d4bc916` (`re-write`). The tracked
worktree was clean and synchronized with `origin/re-write` before this
append-only ledger update. No authoritative Save or Lynx publication occurred.

The secure WebSocket counterpart is Hub `develop` commit
`6b38ef0cf447f32991287075d1c606e9b886aad7`, released successfully as
`v2026.11-alpha.15` and `v2026.11-beta.15`. The live development endpoint
reported that exact SHA.

| Criterion | Result | Current evidence |
|---|---|---|
| `AC-01` | PASS | Manifest/source parity and unrelated-authority gates prove no production MAIN-world installation on unmanaged pages. |
| `AC-02` | PASS | Capability-runtime, document-generation, navigation, close, and worker-recovery tests pass. |
| `AC-03` | PASS | Production build, hostile capability tests, and headed payload inspection contain no public relay, marker, extension artifact, or credential. |
| `AC-04` | PASS | Stabilization/page-world suites and headed Humanova activation reached true bottom, froze lazy loading/motion, and restored the initial position. |
| `AC-05` | PASS | Typed transport timeout, cancellation, malformed/non-JSON, AI deadline, and terminal-cleanup tests pass. |
| `AC-06` | PASS | Production WebSocket URL is tokenless; Hub first-frame bearer authentication, rotation, rejection, deadline, duplicate-frame, and legacy-header tests pass; headed lock authority recovered against the deployed Hub. |
| `AC-07` | PASS | Lock transition, pending-state, popup projection, and forbidden-action tests pass; headed controls became truthful after authenticated authority. |
| `AC-08` | PASS | Exact emulation tests and headed measurements prove 412×960 marking and 1920×1080 silent desktop posture with rollback coverage. |
| `AC-09` | PASS | Marking tests and trusted headed gestures prove plain no-op/unmark, Shift expansion, Alt inclusion, context actions, and exact clean restoration. |
| `AC-10` | PASS | P17/P25 and headed Humanova prove semantic rows, native Space activation, retained focus, row→page, page→row, and unavailable-target truth. |
| `AC-11` | PASS | Modal/transient-surface, roving-focus, keyboard, inertness, and restore-path suites pass. |
| `AC-12` | PASS | Settings validation, Chrome 116 manifest, offscreen single-flight, and startup compatibility suites pass. |
| `AC-13` | PASS | Production copy/accessibility tests and headed Content List inspection prove truthful modifier guidance, human technical labels, names, focus, and target sizing. |
| `AC-14` | PASS | P14 thresholds remain unchanged; three consecutive P25 composites pass on the implementation commit. |
| `AC-15` | PASS | Package, icon subset, logo, duplicate, and production-size budget tests pass. |
| `AC-16` | PASS | `pnpm verify` (1,540 tests), production/debug builds, applicable P14–P25 gates, and repository-live-browser Humanova workflow pass with zero Save/publication attempts. |
| `AC-17` | PASS | Consent remains intentionally suppressed; headed payload contained zero consent UI/suppression artifacts, zero extension artifacts, and zero inline script/style/noscript source bytes. |
| `AC-18` | PASS | Implementation commit is pushed, worktree is clean/synchronized, and this independent conformance pass is `APPROVED`. |

All `EL-01` product-owned findings mapped into `EL-01-R1` are resolved. No
criterion is failed, partial, blocked, or untested, and no significant
correctness, race, security/privacy, accessibility, performance, or cleanup
regression attributable to the remediation remains. Per `expert-loop`, the next
state is a fresh full-product outer audit, `EL-02`, on the pushed ledger HEAD.

# EL-02-R1 — Preview authority and bounded signal terminality

## 1. Audit basis and verdict

The fresh `EL-02` outer audit ran on extension commit
`fe583857b4e71758c1a5c1bde185a1dd84f43081` after the approved `EL-01-R1`
ledger. It reused the complete prior product surface inventory, rechecked the
exact automated baseline, and then exercised the Arno candidate in the headed
repository `live-browser`. No authoritative Save or Lynx publication occurred.

**Outer-audit verdict:** `NOT APPROVED — REMEDIATION REQUIRED`.

| Finding | Severity | Observed evidence | Root cause |
|---|---:|---|---|
| `EL-02-F001` | High | Silent mode visibly offered **Show Content List** with 16 saved selectors, but the trusted action immediately reported “no saved selectors are available for this page.” | `showPreview` gates the silent action with transient brain-presentation selectors while the button and silent page projection use the authoritative property configuration. Two selector sources therefore contradict each other in one occurrence. |
| `EL-02-F002` | High | An exact trusted Exit Preview click left Arno in Preview beyond the 20-second workflow deadline. A separate debug occurrence remained indefinitely at the operator `context` stage. | Popup/content signal pulls use the runtime bus without a request deadline. `createSignalCursor` correctly serializes work, but one never-settling transport request strands that pull and every trailing pull. `reportPopupFactAndPull` starts its nominal deadline only after the unbounded first pull, and Preview Exit performs another unbounded prerequisite pull before its bounded retries. |

The exact Arno run that proved `EL-02-F002` is
`output/playwright/p25-live-comparison/runs/2026-08-31T06-09-36-043Z-1573d430-rewrite-arno`.
Its row-to-page and page-to-row routing both passed before Exit Preview failed;
two-way Content List routing is therefore not reclassified as defective. A
later successful exit proves the defect is occurrence-sensitive, not absent.

## 2. Binding decisions and non-goals

- The property configuration controller remains the authority for selectors in
  silent mode. Post-AI preview continues to use the exact local brain
  presentation for the active run.
- Each operator occurrence reads one stable presentation snapshot. A control
  cannot be enabled from one snapshot and then rejected from another.
- Every internal command request terminalizes as either a valid reply or a typed
  `REQUEST_TIMEOUT` failure. Late replies/rejections are consumed and ignored;
  they cannot mutate a retired occurrence.
- Signal pulls use a short explicit deadline so a serialized cursor queue always
  advances. The general bus default remains long enough for legitimate commands
  and is overrideable per request.
- A named whole-operation timeout begins before the first signal pull. Preview
  Exit retains occurrence/binding fences, bounded retries, visible failure copy,
  and mechanical state-neutral restoration.
- No endpoint, payload schema, public extension permission, selector semantics,
  consent suppression, marking contract, Save behavior, or Lynx publication
  contract changes are in scope.

## 3. Implementation sequence

### EL-02-R1-01 — One authoritative silent selector snapshot

**Finding:** `EL-02-F001`.

**Files:** `src/entrypoints/popup/main.tsx` and popup entrypoint/source-contract
tests.

1. Capture the presentation once when Preview begins.
2. Resolve silent selectors from `currentPropertyConfiguration()` and post-AI
   selectors from that captured presentation.
3. Use the same resolved selector snapshot for the empty guard and downstream
   preview occurrence; preserve all binding and projection revision fences.
4. Add a regression in which presentation selectors are empty while the current
   property has saved selectors: the enabled action must request rows and open.

### EL-02-R1-02 — Bus-level typed request deadlines

**Finding:** `EL-02-F002`.

**Files:** `src/messaging/bus.ts`, `tests/src/messaging/bus.test.ts`, and affected
type consumers.

1. Add `requestTimeoutMs` to bus defaults and `timeoutMs` to an individual
   request. Validate a finite positive duration and fall back to the bounded
   default.
2. Race every local or transported command request against that deadline and
   return a structured `REQUEST_TIMEOUT` failure containing the effective
   duration.
3. Clear timers on every terminal path. Attach handlers to the underlying
   request so late resolution/rejection is consumed but cannot replace the
   already returned timeout result.
4. Prove default and per-request deadlines, successful pre-deadline replies,
   late resolve/reject hygiene, local-handler coverage, and disposal safety.

### EL-02-R1-03 — Recoverable signal queue and whole-operation budgets

**Finding:** `EL-02-F002`.

**Files:** `src/messaging/rewrite-signals.ts`,
`src/entrypoints/popup/main.tsx`, content signal-pull consumer, popup signal
cursor/entrypoint/preview-exit tests.

1. Give rewrite signal pulls an explicit short deadline and allow callers to
   pass the remaining occurrence budget.
2. Start `reportPopupFactAndPull`'s deadline before reporting/pulling; each wait
   and pull receives only the remaining budget. A timeout returns `false`
   truthfully instead of leaving an operation pending.
3. Bound Preview Exit's prerequisite reconciliation pull before entering its
   existing three-attempt loop. Retain the terminal check after a lost reply.
4. Prove that a timed-out serialized pull releases the queue, the trailing pull
   consumes the next signal once, and a trusted exit occurrence terminalizes or
   presents its reason-specific failure inside the workflow deadline.

### EL-02-R1-04 — Integrated validation and conformance

1. Run focused bus, signal cursor, preview exit, popup entrypoint, content, and
   source-contract suites.
2. Run `pnpm verify`, production and debug builds, and the applicable P17, P20,
   and P25 browser/performance gates without changing thresholds.
3. Run the repository `live-browser`/`live-round` exact headed workflow on all
   valid candidate pages: Ledigajobb, DPJ, Aleris, Acne Specialisten, Assist24,
   Arno, ArkivIT, Teknikhallen, and Humanova. Acapedia (403), the 3D Prima
   candidate URLs (404), and Bigbag (no candidate) remain truthful N/A unless
   their external status changes.
4. Re-prove inspection, exact render posture, consent/extraction hygiene,
   marking modifiers and clear, AI, Content List open and two-way routing,
   silent highlighting, reveal/freeze/lazy restoration, Preview Exit, Discard,
   payload/console cleanliness, and zero Save/publication attempts.
5. Review intended changes, commit and push normally, reindex the exact commit,
   verify clean `0/0` synchronization, then independently check every criterion
   below. Any failed/partial/blocked product-owned criterion creates
   `EL-02-R2`; only `APPROVED` starts `EL-03`.

## 4. Append-only acceptance criteria

- `EL02-AC-01` Silent Preview derives both action truth and the empty-selector
  guard from the authoritative current property configuration; post-AI Preview
  remains tied to the active presentation occurrence.
- `EL02-AC-02` Every bus command request has a finite deadline and returns typed
  `REQUEST_TIMEOUT` on expiry; late settlement is harmless and produces no
  unchecked rejection.
- `EL02-AC-03` One timed-out signal pull cannot strand the cursor queue; a
  trailing pull runs, advances from the current cursor, and consumes each signal
  at most once.
- `EL02-AC-04` `reportPopupFactAndPull` budgets its complete operation, including
  the initial pull, and returns false on deadline or binding retirement.
- `EL02-AC-05` Preview Exit remains single-flight and occurrence-fenced, and
  reaches a terminal state or visible reason-specific failure inside the exact
  browser workflow deadline.
- `EL02-AC-06` Content List semantic keyboard behavior, row-to-page and
  page-to-row routing, silent overlays, and locked selector/payload contracts do
  not regress.
- `EL02-AC-07` Consent suppression remains active and suppressed, invisible,
  extension, script/style/noscript, and debug artifacts enter no marking row,
  Content List, capture, AI, Save, or publication payload.
- `EL02-AC-08` `pnpm verify`, production/debug builds, applicable P17/P20/P25
  gates, and all externally available headed candidates pass on the exact pushed
  commit with unchanged thresholds and zero unauthorized Save/publication.
- `EL02-AC-09` Final branch is clean and synchronized `0/0`; independent
  conformance is `APPROVED` before the next outer audit.

## 5. Regression risks and fallbacks

- A universal deadline that is too short could terminate valid long-running
  commands. Keep a conservative bounded bus default and use the short override
  only for signal pulls and occurrence-local reconciliation.
- A timeout race can leak a timer or surface a late rejection. Centralize the
  race, clear on both sides, and test resolve/reject after timeout.
- Reading configuration after an await could cross a binding. Capture it only
  after exact context binding and retain the existing occurrence fences.
- A failed prerequisite pull can hide a signal that already closed Preview.
  Recheck local terminal state before retries and after every attempt.
- Browser/site/harness failures remain classified by evidence. N/A, BLOCKED,
  PARTIAL, and NOT TESTED never count as PASS.

## 6. Todo chain

1. `el02-selector-authority`
2. `el02-bus-deadlines` → 1
3. `el02-signal-budget` → 2
4. `el02-focused-regressions` → 3
5. `el02-automated-gates` → 4
6. `el02-headed-matrix` → 5
7. `el02-review-push` → 6
8. `el02-conformance` → 7

## 7. EL-02-R1 conformance result

**Verdict:** `NOT APPROVED — EL-02-R2 REQUIRED` on implementation commit
`f19fc2e2626fea5ddcf6858d0890db32307846a1` (`re-write`). The commit was
pushed and synchronized `0/0`. `pnpm verify` passed 1,554 tests; production and
debug builds passed; P17 passed 19/19, P20 passed 4/4, and the complete P25
composite passed all P14/P15/P16/P17/P18/P20/P23 children on clean tracked
source. No authoritative Save or Lynx publication occurred.

The clean exact-source headed Arno conformance proved `EL02-AC-01`: silent
**Show Content List** opened in 51 ms with 75 rows from the saved property
configuration even though the transient presentation selectors were empty.
It then disproved terminal Preview restoration. One trusted Exit occurrence
produced three `preview.exit.requested` signals and a visible reason-specific
failure after the bounded retries, but remained in `exit_restoring` with
**Restoring page** visible.

Debug inspection isolated the page/popup split at the same signal cursor:

- popup: `silent_preview → exit_restoring`, last processed exit request `#8`;
- content: `boot`, `lastConsumedSeq: 8`, managed Arno authority, editor lock,
  inactive marking, valid silent selector rows;
- the cold content organ had never received a preceding `marking.disabled` or
  `session.navigated` edge, so it consumed `preview.opened` and all exit-request
  sequences while retaining `boot`; it therefore never owned the
  `exit_restoring` transition that reports the sole `preview-exited` fact.

This remaining failure is not a transport starvation defect. R1's deadlines
worked as designed: the action terminalized visibly inside its budget. The
defect is cold-realm organ initialization/coherence hidden by fixtures that
always supplied `marking.disabled` before a silent Preview.

| Criterion | Result | R1 conformance evidence |
|---|---|---|
| `EL02-AC-01` | PASS | Exact-source Arno silent Content List opened from authoritative saved selectors with an empty transient selector presentation. |
| `EL02-AC-02` | PASS | Focused bus suites and the complete verify/gate run prove typed deadlines, late-settlement hygiene, and disposal. |
| `EL02-AC-03` | PASS | Signal-cursor regressions pass and the headed failed exit completed all three retries instead of stranding the queue. |
| `EL02-AC-04` | PASS | Whole-operation budget tests pass; the headed occurrence returned its visible bounded failure. |
| `EL02-AC-05` | FAIL | The headed occurrence did not reach a restored terminal state; visible failure alone is insufficient while the page remains blocked in `exit_restoring`. |
| `EL02-AC-06` | PARTIAL | Saved silent projection and prior exact routing pass; the aborted custom route probe selected an unavailable first row and did not complete this occurrence's two-way proof. |
| `EL02-AC-07` | PASS | The exact headed sample retained zero invisible consent paints, zero extension payload artifacts, and no console failures. |
| `EL02-AC-08` | PARTIAL | All automated gates pass, but the headed candidate matrix cannot pass while Preview Exit remains non-terminal. |
| `EL02-AC-09` | FAIL | R1 is independently not approved; the implementation commit is synchronized but cannot close EL-02. |

# EL-02-R2 — Cold content-organ authority hydration and terminal Preview restore

## 1. Remediation verdict and scope

`EL-02-R2` repairs the exact cold-realm coherence gap found by R1 conformance.
The content realm's local physical default is silent: marking is inactive and
no Preview exists. Once a current managed page context or a validated retained
property shield lease grants DOM authority, `boot` must adopt that truthful
silent baseline before consuming session signals. Sequence ownership remains
with the brain; hydration does not mint a signal, advance the cursor, invent
marking state, or override any non-boot session.

No selector, marking, consent, endpoint, payload, Save, publication, emulation,
or public permission contract changes are in scope.

## 2. Implementation sequence

### EL-02-R2-01 — Authority-fenced cold-realm baseline

**Finding:** `EL-02-F003` — managed cold content can consume a silent Preview
occurrence while remaining in `boot`, preventing content-owned restoration.

**Files:** content organ/entrypoint and focused tests.

1. Add one explicit content-organ bootstrap operation that changes only `boot`
   to `silent`, preserves `lastConsumedSeq`, and is idempotent for every other
   state.
2. Invoke it only when `resumeInteractionShieldAuthority` adopts either a
   definitive managed page context or a validated retained property-scoped
   shield posture. Unmanaged, terminal, stale-generation, and failed context
   paths remain boot/fail-open.
3. Recompute the complete content presentation immediately from the hydrated
   state. Existing callers retain physical rendering and lifecycle fences.
4. Do not infer post-AI, marking, Preview, dirty, or lock state locally. All
   subsequent state still arrives through sequenced brain signals.

### EL-02-R2-02 — Exact missing-edge regressions

1. Unit-prove boot-to-silent hydration, cursor preservation, and idempotence for
   every non-boot content state.
2. Add an entrypoint regression with managed authority and the production-cold
   sequence `preview.opened(origin=silent) → preview.exit.requested`, deliberately
   omitting `marking.disabled` and `session.navigated`.
3. Prove the page reaches `silent_preview`, retires its projection before
   restoration, reports exactly one `preview-exited` content fact, and returns
   to `silent` when the resulting terminal signal arrives.
4. Prove unmanaged/terminal context never hydrates or resurrects page authority.

### EL-02-R2-03 — Validation, exact headed conformance, and review

1. Run focused content-organ, content-entrypoint, popup Preview Exit, bus, and
   signal suites.
2. Run `pnpm verify`, production/debug builds, P17, P20, and the full P25
   composite with unchanged thresholds.
3. Repeat the exact-source repository `live-browser` Arno occurrence from a
   cold content realm: saved silent Content List, semantic row routing both
   directions, trusted Exit, and restored silent selector posture. Capture the
   popup and content state before open, during Preview, and after Exit.
4. Continue the externally available candidate matrix only after that root
   reproducer passes. Use Ledigajobb, DPJ, Aleris, Acne Specialisten, Assist24,
   Arno, ArkivIT, Teknikhallen, and Humanova; classify externally unavailable
   candidates truthfully. Perform no authoritative Save or Lynx publication.
5. Review only intended changes, commit and push normally, reindex the exact
   commit, verify clean synchronized `0/0`, then independently check every
   cumulative EL-02 criterion. Any failure creates `EL-02-R3`; only unanimous
   PASS closes EL-02 and permits the next outer audit.

## 3. Append-only R2 acceptance criteria

- `EL02-R2-AC-01` Current managed/retained property authority hydrates only a
  cold content `boot` state to `silent`, preserves its cursor, and never changes
  a non-boot state.
- `EL02-R2-AC-02` Unmanaged, terminal, stale, or failed context cannot hydrate
  the content organ or restore DOM authority.
- `EL02-R2-AC-03` A cold managed sequence with no synthetic
  `marking.disabled`/navigation edge accepts silent Preview, owns Exit,
  reports one `preview-exited` fact, and restores the page to `silent`.
- `EL02-R2-AC-04` Preview projection/hover is retired before interactions
  resume; saved silent overlays and two-way row routing remain correct.
- `EL02-R2-AC-05` The exact headed Arno trusted Exit reaches terminal silent
  state within the existing deadline with no failure toast or blocked curtain.
- `EL02-R2-AC-06` All cumulative `EL02-AC-01` through `EL02-AC-09` pass on the
  exact pushed source, including the full candidate matrix and zero unauthorized
  Save/publication attempts.

## 4. Regression risks and fallbacks

- Hydrating on mere popup command receipt could grant authority to an unmanaged
  page. The bootstrap stays inside the existing managed/retained authority
  adoption function, after exact page/lifecycle validation.
- Hydration could overwrite a restored marking/run occurrence. The pure helper
  is strictly `boot`-only and preserves every non-boot object by identity.
- A local bootstrap must not become a second state authority. It establishes
  only the cold realm's physically true silent baseline; every session edge and
  cursor advance remains brain-owned.
- A fixture that includes `marking.disabled` would conceal the original defect.
  The production-sequence regression explicitly forbids that signal.

## 5. Todo chain

1. `el02-r2-content-baseline`
2. `el02-r2-cold-preview-regression` → 1
3. `el02-r2-focused-validation` → 2
4. `el02-r2-full-gates` → 3
5. `el02-r2-headed-root-reproducer` → 4
6. `el02-r2-headed-candidate-matrix` → 5
7. `el02-r2-review-push` → 6
8. `el02-r2-conformance` → 7

## 6. EL-02-R2 conformance result

**Verdict:** `NOT APPROVED — EL-02-R3 REQUIRED` on implementation commit
`fb005629085b98369a07bcbdd06187f6b065815a`.

R2's scoped cold-realm repair is correct. Focused tests passed `115/115`,
`pnpm verify` passed `1555/1555`, production and debug builds completed, P17
passed `19/19`, P20 passed `4/4`, and the unchanged full P25 composite passed
all seven children. The exact headed Arno occurrence also proved the missing
edge: content began in `silent` at cursor 3, accepted saved silent Preview as
`silent_preview` at cursor 4, and returned to unblocked `silent` at cursor 6.
The production Content List then passed native-keyboard row activation,
corresponding smooth row-to-page focus, trusted page-to-row routing, and
terminal Exit. No Save or publication request was made.

The broader cumulative check nevertheless exposed two independent marking
coherence failures before the candidate matrix could continue:

| Finding | Severity | Exact evidence | Root cause |
| --- | --- | --- | --- |
| `EL-02-F004` | High | After a Shift exclusion and plain unmark returned Arno to `dirty: false`, the content organ remained `pre_ai_dirty` while the popup correctly returned to its clean posture. | The popup transition consumes `markings.changed.payload.dirty`, remembers whether the clean origin was pre- or post-AI, and handles net-zero edits. The content transition ignores that payload and always moves a clean state to `pre_ai_dirty`. |
| `EL-02-F005` | High | The exact Arno Shift interaction updated content in 60 ms, but the popup did not enable Discard/project dirty state for 4,639 ms, violating the one-second local projection contract. | The background observes the brain decision synchronously but keeps `signals.available` behind durable-fact persistence inside the tab lifecycle queue. Slow persistence therefore delays the first notification and also blocks a following unmark fact. |

One apparent Preview page-target failure was rejected as a product finding. The
probe clicked again while the intentional smooth row route had temporarily
retired highlights. Reusing P25's bounded focus-correlation wait proved the
expected fade/restore behavior and both routing directions.

| Criterion | Result | Evidence |
| --- | --- | --- |
| `EL02-R2-AC-01` | PASS | Boot-only hydration and cursor/idempotence unit coverage passed. |
| `EL02-R2-AC-02` | PASS | Terminal/unmanaged entrypoint fences remained boot and passed focused/full suites. |
| `EL02-R2-AC-03` | PASS | The no-`marking.disabled`, no-navigation regression terminalized with exactly one content-owned exit fact. |
| `EL02-R2-AC-04` | PASS | Arno projection retirement, smooth focus restore, and semantic two-way routing passed after applying the intended bounded scroll wait. |
| `EL02-R2-AC-05` | PASS | Exact production Arno cold Preview restored `silent` without a toast or curtain. |
| `EL02-R2-AC-06` | FAIL | `EL-02-F004` and `EL-02-F005` violate cumulative marking/state responsiveness, so the remaining candidate matrix is fenced until R3. |

# EL-02-R3 — Net-clean marking parity and immediate ordered signal projection

## 1. Remediation verdict and scope

R3 repairs the two cumulative failures discovered by R2 conformance without
changing selector semantics, marking target resolution, visual expansion,
consent, endpoints, payloads, Save, publication, emulation dimensions, or
public permissions. The brain remains the sole signal producer. Durable facts
remain ordered and must settle before terminal tab cleanup, but their storage
latency may not delay an already-produced in-memory signal or serialize later
interactive facts behind I/O.

## 2. Implementation sequence

### EL-02-R3-01 — Symmetric net-clean content state

**Finding:** `EL-02-F004`.

1. Give the content state the same pre-/post-AI clean-origin memory already
   owned by the popup state.
2. On `markings.changed`, consume `payload.dirty`: a dirty edit records its
   clean origin; a net-clean edit returns `pre_ai_dirty` to that exact origin.
   Running and reconciling semantics remain monotonic exactly as in the popup.
3. Establish/clear the clean-origin field on marking enable, successful AI,
   discard, disable, navigation, and terminal save as appropriate.
4. Unit-prove pre-AI and post-AI mark/unmark round trips, run/reconcile behavior,
   cursor monotonicity, and post-AI Preview acceptance after a reverted edit.

### EL-02-R3-02 — Ordered durability outside the interactive lifecycle lane

**Finding:** `EL-02-F005`.

1. After an authorized fact is synchronously observed by the brain, notify the
   popup and content consumers before waiting on durable storage.
2. Move fact persistence to a per-tab, thunk-based single-flight tail. Keep the
   message event alive until its own durable write settles, but release the tab
   lifecycle lane first so a following toggle can produce and publish its
   signal immediately.
3. Drain that persistence tail before terminal tab cleanup forgets brain/tab
   state. Reject facts admitted after terminal cleanup begins; preserve current
   document, consent, navigation, and source-instance fences.
4. Prove with deferred persistence that dirty and net-clean availability events
   arrive in order before either write resolves, persistence itself remains
   ordered, and cleanup waits for the admitted tail without resurrecting facts.

### EL-02-R3-03 — Exact interaction and integration regressions

1. Add popup/background integration coverage showing a marking toggle projects
   dirty controls from the event path without an authority refresh or 500 ms
   backstop, and a net-clean toggle restores the clean controls the same way.
2. Extend content entrypoint coverage through
   `post_ai_clean → pre_ai_dirty → post_ai_clean → preview_open` and prove
   physical presentation follows the restored state.
3. Correct the live evidence probe to treat `markedCount` as its documented
   monotonic user-toggle count and use `dirty`, fingerprint, and toggle sequence
   for current-marking assertions. Retain P25's smooth-scroll focus wait.

### EL-02-R3-04 — Validation and cumulative conformance

1. Run focused content-organ, content-entrypoint, background startup/lifecycle,
   brain-decision, popup entrypoint, bus, and interaction suites.
2. Run `pnpm verify`, production/debug builds, P17, P20, and full P25 with
   unchanged thresholds.
3. Repeat exact-source headed Arno from silent Preview through marking default,
   Shift expansion, plain unmark, Alt inclusion, AI, two-way Content List,
   freshness, Discard, silent restore, payload hygiene, and console checks.
4. Continue Ledigajobb, DPJ, Aleris, Acne Specialisten, Assist24, ArkivIT,
   Teknikhallen, and Humanova only after Arno passes. Classify unavailable
   properties truthfully. Make no authoritative Save or Lynx publication.
5. Review, commit and push normally, reindex the exact commit, prove clean
   synchronized `0/0`, and independently adjudicate every cumulative EL-02
   criterion. Any failure creates R4; only unanimous PASS permits EL-03.

## 3. Append-only R3 acceptance criteria

- `EL02-R3-AC-01` Content and popup independently reach the same clean origin
  after a net-zero pre- or post-AI marking round trip.
- `EL02-R3-AC-02` A current authorized marking signal is available to both
  consumers without waiting for durable fact storage, and consecutive toggles
  remain ordered.
- `EL02-R3-AC-03` Durable writes are single-flight and ordered; terminal cleanup
  drains admitted work and no terminal/stale fact is resurrected.
- `EL02-R3-AC-04` Exact headed dirty and net-clean popup projections each
  terminalize within one second while visual marking remains responsive.
- `EL02-R3-AC-05` P17, P20, P25, full verification, builds, exact Arno, and the
  externally available candidate matrix pass with zero Save/publication calls.
- `EL02-R3-AC-06` Every cumulative `EL02-AC-*`, R2, and R3 criterion passes on
  the exact pushed and indexed source.

## 4. Regression risks and fallbacks

- Publishing before persistence must not make the brain non-authoritative. The
  notification is emitted only after `brain.observe`; it announces an existing
  sequenced signal and carries no alternate decision.
- Releasing lifecycle serialization must not reorder storage. A dedicated
  per-tab thunk tail owns durable ordering and is drained by cleanup.
- A stale content document must never gain the fast path. Existing exact
  sender/document/consent checks remain inside the lifecycle fence before brain
  observation.
- Net-clean restoration must remember post-AI provenance. Falling back blindly
  to pre-AI would make valid selectors disappear after an edit is reverted.

## 5. Todo chain

1. `el02-r3-net-clean-content-state`
2. `el02-r3-ordered-fact-durability` → 1
3. `el02-r3-focused-regressions` → 2
4. `el02-r3-full-gates` → 3
5. `el02-r3-headed-arno` → 4
6. `el02-r3-headed-candidate-matrix` → 5
7. `el02-r3-review-push-index` → 6
8. `el02-r3-conformance` → 7

## 6. Marking contract lock (reconfirmed before implementation)

The following interaction rules are normative for R3 and must be covered by
unit, integration, and headed evidence: disabled marking is inert; plain click
only clears an existing explicit mark; Shift creates/widens exclusion; Alt
creates explicit inclusion; Shift+Alt keeps inclusion precedence; Meta/Ctrl
remain link-navigation modifiers; context-menu actions are target-scoped;
invisible, consent, extension, source, closed-shadow, and immutable-default
nodes are ineligible; explicit boundaries own descendants; hover and click use
the same composed target resolution and overlays restore after scroll/resize;
and marking facts/payloads contain only valid user decisions. Any divergence
is a new R3 finding and blocks approval.

## 7. EL-02-R3 authority review

**Verdict:** `REJECTED BEFORE COMMIT — SUPERSEDED BY EL-02-R4`.

The deterministic operator Q&A on 2026-08-31 proved that R3's proposed
net-clean restoration and its initial marking lock were based on an incorrect
contract. Acceptance criteria remain preserved above for audit history, but
they must not ship:

- `EL-02-F004` is withdrawn as a product defect. Content remaining dirty after
  a visually net-zero toggle was correct; the popup/fingerprint path that
  returned clean is the actual divergence.
- `EL-02-F005` remains confirmed and carries into R4 unchanged: durable fact
  persistence delayed the locally decided marking signal by 4,639 ms.
- The uncommitted net-clean content changes and tests are invalidated. The
  uncommitted ordered-persistence work may carry forward only after R4 focused
  race tests prove it against monotonic dirt and cleanup.

# EL-02-R4 — Approved marking, ephemeral session, payload, and Save→Load contract

## 1. Goal

Implement the complete operator-approved 2026-08-31 marking contract while
preserving the rewrite's reflex-arc authority, branch-scoped performance,
mobile extraction posture, immutable taxonomy, property fences, and safe Save.
The result must make gesture targeting, visual projection, active-session state,
AI corpus construction, backend persistence, and authoritative adoption one
coherent workflow without restoring a second local authority.

## 2. Verified current facts and findings

| Finding | Severity | Verified owner and divergence |
| --- | --- | --- |
| `EL-02-F005` | High | `src/background/index.ts` awaits durable fact persistence inside the per-tab lifecycle lane before `signals.available`; exact Arno projection took 4,639 ms. |
| `EL-02-F006` | High | `src/content/marking/engine.ts:resolveAtPoint`, `resolve.ts:resolveTarget`, `store.ts:applyToggle`, and the content click handler enforce unmark-only plain input, closed explicit-inclusion ancestry, and incorrect expanded-descendant ownership. |
| `EL-02-F007` | Medium | `content-loader.content.ts` installs a capture-phase `contextmenu` handler and `marking/interaction.ts` renders a custom menu; `input-firewall.ts` also suppresses native context menus. |
| `EL-02-F008` | High | Content dirt compares the current canonical fingerprint to a clean fingerprint; popup/content organs consume `dirty:false` as net-clean. This contradicts monotonic dirty after the first successful mutation. |
| `EL-02-F009` | High | Hidden rows are synthesized without explicit payload posture; hidden explicit includes can paint ghost geometry; consent nodes are removed from the bridge, rendered/static HTML, and submission instead of receiving hidden exclusion coverage. |
| `EL-02-F010` | High | Save can directly adopt `config.save` response state and retain recovery-local authority before a definitive `config.load`; the approved boundary is Save once, then Load the newest complete backend shape and replace local state. |

Overlay scroll/resize fade already has a rewrite implementation in
`marking/renderer.ts:setScrolling` and the engine's viewport transaction. R4
must regression-prove and preserve it; it is not a presumed defect.

## 3. Locked decisions and non-goals

- `MARKING_AND_HIGHLIGHTING_LOGIC.md` section **Approved session,
  interaction, and submission authority** is normative. The matching authority
  amendment in `.reimplementation/rewrite-legacy-decision-spec.md` wins over
  historical parity notes.
- Three mutable states only. Plain toggles the individual state; Shift changes
  breadth; Alt toggles individual explicit inclusion and wins over Shift.
- Expanded-boundary removal rehydrates descendants without provenance. An
  explicit included descendant is independent; Alt may move a mixed-text
  parent's include to its child atomically.
- No extension `contextmenu` listener or custom marking menu. Meta/Ctrl add no
  marking semantics.
- UI visibility and payload disposition remain separate. Hidden targets never
  paint/interact, preserved explicit decisions survive, and otherwise mutable
  hidden targets produce payload-only explicit exclusions.
- Immutable ancestry is absolute and has no XPath rows; AI receives the exact
  hardcoded immutable selector list separately. Consent is UI-ineligible but
  receives truthful hidden-exclusion coverage in HTML/rows.
- Dirty is monotonic for an active session. No mutable session state survives
  successful Save or approved dismissal. Run AI is stateless and receives the
  complete property corpus. Save is singular; Load is complete-replace.
- Do not change endpoint schemas, permissions, taxonomy tags, emulation
  dimensions, property identity/fences, Lynx publication gates, or production
  selector publication. Headed validation performs no authoritative Save or
  Lynx publication.

## 4. Implementation sequence

### EL-02-R4-01 — Contract authority and executable regression matrix

1. Reconcile `MARKING_AND_HIGHLIGHTING_LOGIC.md`, the rewrite decision spec,
   `.copilot/knowledge.md`, `.copilot/plan.md`, README, and this ledger.
2. Replace focused tests that encode superseded unmark-only, closed-include,
   custom-menu, net-clean, consent-strip, ghost-geometry, and direct-adoption
   behavior. Keep all unrelated safeguards.
3. Add a table-driven transition matrix for plain/Shift/Alt × implicit include,
   explicit include, explicit exclude, expanded boundary, ordinary expanded
   descendant, and explicitly included expanded descendant. Include Alt-over-
   Shift and Meta/Ctrl-neutral cases.

### EL-02-R4-02 — Canonical target and mutation semantics

1. In `src/content/marking/resolve.ts` and `engine.ts`, make unmodified pointer
   resolution select the individual eligible target while retaining exact
   explicit-include clearing and expanded ownership metadata. Shift resolves
   the approved widen target; Alt never inherits Shift and may inspect below a
   mutable exclusion or explicit-inclusion parent.
2. In `store.ts`, implement atomic operations for: implicit↔explicit exclusion;
   explicit include→default/unmarked; expanded boundary removal/rehydration;
   ordinary expanded descendant drill; preserved explicit-inclusion exception;
   and mixed-text parent-include→child-include transfer.
3. Keep branch evaluation single-flight and scoped. Hover, acknowledgement, and
   mutation must use the same bridge generation and target occurrence.
4. Remove the marking context-menu implementation/listener and let native
   `contextmenu` pass through the content firewall.

### EL-02-R4-03 — UI-ineligible versus payload-covered DOM

1. Split extension chrome/immutable ancestry from consent/visibility UI
   ineligibility in `dom-view.ts`, target indexes, hit testing, and renderer.
   Consent and hidden elements remain unavailable to UI but present in the
   sanitized page model when they are page-authored content.
2. Make payload evaluation emit an otherwise mutable hidden textual target as
   `{ excluded:true, explicit:true }` without inserting that generated row into
   the canonical session set. A preserved explicit include/exclude wins over
   visibility; expanded and immutable ancestry apply the approved omission
   precedence.
3. Stop deleting page-authored consent subtrees from rendered/static AI HTML.
   Strip only extension-authored attributes/styles/UI and retain XPath alignment.
   Immutable roots/descendants remain omitted as rows and the exact immutable
   selector list remains separately schema-validated.
4. Prove hidden explicit decisions never paint ghost geometry and reappear with
   the same decision if the element becomes visible again.

### EL-02-R4-04 — Monotonic ephemeral session and authoritative Save→Load

1. Replace fingerprint-based dirt with a monotonic successful-mutation latch.
   `markContentMainClean` may record AI freshness but cannot reset session dirt.
   Popup/content organs treat every decided marking-change edge as dirty; run
   completion may become AI-current without making the session unmodified.
2. Prove clean disable, dirty-confirmed disable, dirty-cancel, Discard,
   approved/cancelled navigation, AI success/failure, Save failure, and Save
   success. Dismissal removes all decisions; failures preserve the exact active
   session.
3. After the one fenced `config.save` succeeds, invalidate the property-load
   cache and issue one authoritative `config.load`. Adopt only that complete
   newest shape before silent highlighting and terminal `session.saved`.
   Load/adoption failure enters explicit committed-recovery without retrying
   Save or retaining the old session as authority.
4. Prove each AI request is one self-contained complete candidate corpus and
   causes no AI-side/local draft persistence; other pages come from the latest
   loaded authoritative property data and current page uses the active session.

### EL-02-R4-05 — Immediate ordered signal projection

1. Retain `brain.observe` as decision authority, publish `signals.available`
   immediately afterward, and serialize durable facts in a separate per-tab
   tail rather than the interactive lifecycle lane.
2. Keep the reporting message alive for its admitted durable write; drain the
   tail before terminal cleanup and reject post-terminal/stale-document facts.
3. Prove dirty edges arrive in order before deferred writes settle, durable
   writes remain ordered, and popup dirty controls project in ≤1 second.

### EL-02-R4-06 — Validation and expert-loop conformance

1. Run focused marking resolver/store/evaluator/renderer/content-entrypoint,
   popup/content organ, configuration, Save, background lifecycle, consent,
   capture, submission, and firewall suites.
2. Run `pnpm verify`, production/debug builds, P14, P17, P20, and full P25 on
   the exact source.
3. Use repository `live-browser`/`live-round` only. Prove exact Arno first, then
   every externally available candidate property: gesture matrix, hover/cursor,
   native right click, expansion rehydration, Alt transfer, hidden/consent
   payload evidence, monotonic dirt, AI corpus, Discard, scrolling fade/restore,
   Content List, and console/network hygiene. Make no Save/publication call.
4. Review, commit intended files, reindex, push normally, reindex again, prove
   `0/0`, and independently adjudicate every cumulative criterion. Rejection
   creates R5; approval starts a fresh outer expert-check.

## 5. R4 acceptance criteria

- `EL02-R4-AC-01` Every cell in the gesture/state matrix produces the approved
  target, mutation, hover, cursor, rehydration, and payload result.
- `EL02-R4-AC-02` Native right click is never intercepted and hidden/ineligible
  targets never paint or accept UI marking.
- `EL02-R4-AC-03` Hidden explicit decisions survive; otherwise mutable hidden
  targets emit payload-only explicit exclusions; immutable ancestry and expanded
  omission precedence are exact; consent page HTML/coverage remains aligned.
- `EL02-R4-AC-04` Dirt becomes true on the first successful mutation and remains
  true until successful Save or approved dismissal, across AI and visual undo.
- `EL02-R4-AC-05` Run AI sends one stateless complete-property corpus. Save emits
  one current-page mutation, then one authoritative Load complete-replaces local
  state before silent acknowledgement; failure paths preserve or explicitly
  fence state without duplicate mutation.
- `EL02-R4-AC-06` Marking signals project within one second independently of
  durable storage, whose ordering/cleanup guarantees remain proven.
- `EL02-R4-AC-07` Focused/full/build/browser gates and exact headed candidate
  evidence pass on the pushed indexed source with zero authoritative
  Save/publication calls.
- `EL02-R4-AC-08` Every cumulative EL-02 criterion not explicitly superseded by
  the approved 2026-08-31 authority passes; no significant regression remains.

## 6. Todo chain

1. `el02-r4-contract-regressions`
2. `el02-r4-target-mutation-semantics` → 1
3. `el02-r4-payload-visibility-separation` → 2
4. `el02-r4-session-save-load` → 3
5. `el02-r4-ordered-signal-projection` → 4
6. `el02-r4-focused-full-gates` → 5
7. `el02-r4-headed-arno-matrix` → 6
8. `el02-r4-headed-candidate-matrix` → 7
9. `el02-r4-review-push-index` → 8
10. `el02-r4-conformance` → 9

## 7. R4 execution evidence — 2026-08-31

- Focused interaction-shield regression: 25/25 passed, including the native
  presentation-boundary wheel fallback and visual-viewport owner retention.
- Focused popup/content Preview regressions passed for silent-origin retention,
  semantic routing, and debug-highlight page→row precedence.
- Exact repo `live-browser` Arno evidence (no Save or Lynx publication): mobile
  marking at 412×960; desktop silent preview at 1920×1080; one 720 px wheel
  packet moved exactly 720 px; silent/marking roots faded, retained identity,
  repositioned, and restored; consent remained suppressed with no ghost marking
  overlays.
- Gesture workflow: plain exclusion/restoration, Alt inclusion, expanded
  ownership/rehydration, Alt-over-Shift, native context menu, and monotonic dirt
  were exercised. A visually net-zero pair remained dirty as required.
- Stateless Run AI completed on Arno in 8.9 s and auto-opened 117 detected rows.
  Post-AI edit invalidated Save and Content List and re-enabled Run AI in 32 ms.
  Confirmed Discard kept marking active, rebuilt the clean default/selector
  baseline, and retained no session decision.
- Content List: semantic buttons, accessible names, focus/pointer equality,
  Enter/Space activation, page→virtualized-row focus, and row→page emphasis all
  passed in marking preview. A follow-up audit found that `silent_preview`
  incorrectly triggered `clearSilentSelectors`, and debug XPath rectangles then
  stole page clicks. Both root causes are fixed and the fresh debug bundle kept
  16 silent overlays mounted while page→row focused exact row 216 and matched
  its XPath; focus and pointer painted the same 380×16 target.
- Fresh production-bundle Arno verification retained exactly 16 silent layers
  across opening Content List, projected 96 semantic rows, routed the painted
  380×16 target to row 216, and gave pointer focus, keyboard focus, and Enter
  activation the same target. No Save or Lynx publication was attempted.
- Contract audit corrected one stale sentence that described Save as a complete
  property upload. Binding authority is now explicit everywhere: Save carries
  one current page plus property-wide selectors; a distinct Load complete-
  replaces local configuration and destroys the active mutable session without
  merging or preserving any local draft.
- Full pre-commit verification passed: 147 files / 1,557 tests, production WXT
  build, seven manifest assertions, and the separate debug build. Dirty-source
  browser acceptance was semantically complete: P14 192 scenarios with zero
  semantic/budget/activation/mutation-pressure/input-long-task failures; P15
  36/36; P16 13/13; P17 19/19; P18 14/14; P20 4/4; P23 25/25. Their aggregate
  source-identity result remains intentionally red until this source is
  committed.
- Final strict review found one traversal edge: `history.back/forward/go` could
  conservatively prompt on a fragment-only destination. Current Chrome now
  delegates traversals to the Navigation API's exact destination; the fallback
  wrapper remains only where Navigation is unavailable. Focused page-world
  coverage passes 33/33 and proves fragment traversal stays in-session while a
  rejected path change is synchronously prevented.
- Remaining: rerun the full suite after final documentation synchronization,
  commit/push the reviewed source, execute clean-source P14–P25 (including
  consecutive P25), complete the candidate live round, and issue the next
  independent expert-check verdict.

# EL-02-R5 — Render-mode recovery harness terminalization

## 1. Entering conformance finding

`EL-02-F011` (Medium, release-evidence blocker) was reproduced twice on the
exact pushed `277d5b841be64787da6c885be6b993ec9873c77a` production bundle during the
Arno candidate round. Both Render Inspection stages passed, but P25's
`ensurePopupSessionView` timed out before activation. The product was not stuck:
one independently dispatched real `#render-mode-cancel` pointer activation
restored the retained JavaScript mode and returned to silent view. The harness
instead treated the intermediate disabled-control acknowledgement as permission
to loop and activate the still-visible Cancel control again, restarting the
product-owned recovery until the 45-second deadline.

The failed and isolation artifacts are retained under
`.temp/expert-loop-r5-harness-defect/`. Both guarded runs recorded zero final
publication attempts.

## 2. Root cause and locked scope

- Root cause: `scripts/performance/p25-live-comparison.mjs` combines a redundant
  retained-mode pre-proof with a generic recovery loop. After a Cancel click is
  acknowledged, `render-mode-cancel` remains visible and enabled while the
  retained-mode inspection finishes, so the generic loop can click it again.
- Product Render Inspection, its retained-mode restoration, paint
  acknowledgement, and Cancel semantics are unchanged.
- Lock takeover/continue/discard recovery remains multi-step and retryable; the
  pending-terminal rule applies specifically to Render-mode exit actions.
- No Save, `/publish`, endpoint, payload, extension permission, or public UI
  change is in scope.

## 3. Executable delta plan

### EL-02-R5-01 — Single-dispatch Render-mode exit

1. Remove the harness-side retained-mode pre-proof. Cancel already owns the
   required retained-mode restoration and document proof.
2. After one trusted Render-mode exit activation, wait through its intermediate
   disabled-control state until the normal session toggle is visible and
   actionable, the deadline expires, or an explicit terminal failure appears.
3. Never redispatch the same Render-mode exit while that terminal wait is
   pending. Preserve the existing acknowledgement/race loop for lock recovery.

### EL-02-R5-02 — Regression and exact live proof

1. Add executable harness-contract coverage proving the retained-mode pre-proof
   is absent, Render Cancel uses one terminal wait, and generic lock recovery is
   still present.
2. Run the focused P25 workflow-probe tests, `pnpm verify`, production/debug
   builds, full P25, and the source-identity checks required by the final diff.
3. Commit and push normally, then rerun exact-source Arno through both Render
   Inspection modes and activation. Acceptance requires one Cancel dispatch,
   successful return to the session, 412×960 marking posture, and zero Save or
   publication requests.
4. Resume the remaining valid-candidate live matrix only after Arno passes.

## 4. Append-only R5 acceptance criteria

- `EL02-R5-AC-01` Two successful Render Inspection modes followed by session
  recovery produce exactly one real Render-mode exit activation and reach the
  normal session before the bounded deadline.
- `EL02-R5-AC-02` No harness-side retained-mode inspection is dispatched before
  Cancel; the product remains the sole owner of retained-mode restoration.
- `EL02-R5-AC-03` Lock recovery acknowledgement, races, and multi-step actions
  retain their existing behavior and regression coverage.
- `EL02-R5-AC-04` Focused/full/build/P25 gates pass on the exact committed source,
  and headed Arno passes through activation with zero `/save` and `/publish`
  requests before the candidate matrix resumes.

## 5. Todo chain

1. `el02-r5-render-exit-terminal-wait`
2. `el02-r5-harness-regression` → 1
3. `el02-r5-focused-full-gates` → 2
4. `el02-r5-review-push` → 3
5. `el02-r5-headed-arno` → 4
6. `el02-r5-candidate-matrix` → 5
7. `el02-r5-conformance` → 6

# EL-02-R6 — Consent-preserving live-probe XPath alignment

## 1. Entering conformance finding

`EL-02-F012` (Medium, release-evidence blocker) was exposed after R5 fixed the
Render-mode recovery path. Exact-source Arno passed preflight, both inspections,
and activation, then `marking-visual` falsely reported 12 painted invisible
sources. The retained screenshot proves the boundaries were visibly aligned to
real header, breadcrumb, heading, paragraph, link, image, and product content.
The source IDs all failed only in P25's `resolveBridgeXpath`.

Root cause is confirmed in `scripts/performance/p25/live-probes.mjs`: its bridge
resolver and XPath generator still remove `[data-uf-consent-hidden]` nodes from
sibling traversal. R4 deliberately changed the authoritative bridge and payload
contract to retain page-authored consent DOM as hidden exclusion coverage.
Removing those nodes in the probe shifts every following sibling index and
misclassifies valid visible paint as unresolved. Evidence is retained under
`.temp/expert-loop-r6-probe-defect/`; the guard recorded zero Save and
publication attempts.

## 2. Locked scope and delta plan

1. Include page-authored consent-hidden nodes when resolving and generating
   bridge XPath sibling indices. Continue excluding extension-authored roots,
   WXT roots, browser automation containers, and Unfluffify UI.
2. Preserve UI ineligibility: `bridgeXpathForElement` must still return no
   gesture target for a consent-hidden node or any composed descendant.
3. Update the executable fake-DOM regression so a consent sibling occupies its
   truthful bridge index, later visible targets resolve at the shifted index,
   and consent targets remain rejected.
4. Run focused live-probe and P25 contracts, full verification, production/debug
   builds, review/push, and full clean-source P25. Restart the repo live browser
   on the exact pushed source and rerun Arno from both inspections through
   marking visual before resuming the candidate workflow.

## 3. R6 acceptance criteria

- `EL02-R6-AC-01` Bridge resolution counts consent-hidden page DOM in XPath
  traversal and resolves the visible post-consent sibling to the exact source.
- `EL02-R6-AC-02` Consent-hidden nodes and descendants remain unavailable as
  marking gesture targets despite their truthful bridge presence.
- `EL02-R6-AC-03` Exact-source Arno reports zero unresolved/invisible painted
  sources while preserving visible marking boundaries and 412×960 posture.
- `EL02-R6-AC-04` Focused/full/build/P25 gates pass on the synchronized commit,
  with zero Save and publication attempts in headed validation.

## 4. Todo chain

1. `el02-r6-consent-bridge-probe`
2. `el02-r6-focused-regression` → 1
3. `el02-r6-full-gates` → 2
4. `el02-r6-review-push` → 3
5. `el02-r6-headed-arno` → 4
6. `el02-r6-candidate-matrix` → 5
7. `el02-r6-conformance` → 6

# EL-02-R7 — Freeze-safe gesture evidence terminalization

## 1. Entering conformance findings

The exact-source Arno rerun on `c80d7d29` passed preflight, both Render
Inspection modes, activation, and marking visual. This closes R6's consent/XPath
failure: all 12 previously unresolved visible boundaries resolved correctly.
The next `marking-gestures` stage exposed two evidence-harness defects and
stopped with zero Save or publication attempts.

- `EL-02-F013` (Medium, release-evidence blocker): the acknowledged Shift action
  settled as the correct exact explicit exclusion for the cursor position, but
  `waitForGestureAcknowledgement` recomputed its returned assertion without the
  already proven expected owner XPath. The serialized assertion therefore
  became null and contradicted the canonical target delta and interaction
  acknowledgement.
- `EL-02-F014` (Medium, release-evidence blocker): compact-frame completion is
  owned only by page `requestAnimationFrame`. Reveal/freeze is explicitly
  allowed to suspend page-owned animation callbacks, so a completed physical
  action can leave the collector marked unfinished and turn an installed Long
  Task observer into `unknown` evidence.

The anomalous approximately one-second dispatch figures are not accepted as a
product diagnosis. On the same visible, focused, normal-windowed 412×960 page,
standalone mutable clicks measured about 1–2 ms. The exact compact collector
reproduction measured 1–24 ms, completed with 60 Hz active-frame samples, and
reported zero Long Tasks. The R7 rerun must nevertheless re-prove the complete
stage from a fresh browser.

## 2. Locked scope and delta plan

1. Preserve `expectedAcknowledgementXpath` in every settled and timeout
   `markingAssertion` result. Exact Shift boundaries remain valid where the
   legacy widening ladder keeps the meaningful target exact; ancestor results
   must still prove increased breadth.
2. Give the compact collector an explicit idempotent finalizer in its isolated
   world. The page rAF loop may finalize normally; otherwise, after the
   observer-owned action/tail wait, the harness invokes that finalizer
   synchronously to close bounds, filter Long Tasks, disconnect the observer,
   and mark the evidence complete. It must not fabricate rAF or compositor
   frames.
3. Add regressions for exact-owner Shift serialization, timeout serialization,
   natural rAF completion, and observer-clock completion while page rAF is
   suspended. Retain fail-closed behavior when observer installation or timing
   bounds are genuinely absent.
4. Run focused tests, full verification, production/debug builds, review/push,
   exact-source P25, and a fresh headed Arno workflow. Resume the candidate
   matrix only after marking gestures and all later safe stages pass with zero
   Save and publication attempts.

## 3. R7 acceptance criteria

- `EL02-R7-AC-01` A Shift action whose authoritative owner equals the clicked
  target serializes an exact explicit exclusion; an ancestor owner serializes
  an explicit exclusion with increased breadth.
- `EL02-R7-AC-02` A naturally frozen page cannot leave an installed Long Task
  observer in an indeterminate state after the physical action and observer
  tail have ended.
- `EL02-R7-AC-03` Forced finalization preserves actual frame cardinality and
  timing, creates no synthetic frame, and still fails closed for missing
  observers or invalid bounds.
- `EL02-R7-AC-04` Exact-source Arno passes marking gestures with responsive
  target-keyed acknowledgements, finite Long Task evidence at or below 50 ms,
  native browser context menu behavior, and zero Save/publication attempts.

## 4. Todo chain

1. `el02-r7-shift-assertion-owner`
2. `el02-r7-freeze-safe-finalizer` → 1
3. `el02-r7-focused-regressions` → 2
4. `el02-r7-full-gates` → 3
5. `el02-r7-review-push` → 4
6. `el02-r7-headed-arno` → 5
7. `el02-r7-candidate-matrix` → 6
8. `el02-r7-conformance` → 7

# EL-02-R8 — Cross-organ Preview readiness before row interaction

## 1. Goal

Make every Content List row physically operable from its first actionable
frame. The popup may project rows only as non-interactive preparation until the
bound content organ has consumed the exact Preview-open signal; once the UI
offers row interaction, native focus/hover, Enter/Space, pointer activation,
row-to-page routing, and page-to-row routing must all address the same current
projection occurrence without waiting for the 500 ms backstop.

## 2. Current facts

- Exact-source Arno on `14af0f41b666e0fa6905aee2215634cd84e141af`
  passed P25 preflight, both Render Inspection modes, activation, marking
  visual, marking gestures, marking scroll fade, and marking resize in three
  consecutive guarded occurrences. Every publication guard stopped with zero
  Save and zero publication attempts.
- `src/entrypoints/popup/main.tsx:showPreview()` stages and adopts a projection,
  reports `preview-opened`, waits only for the popup brain state, and renders.
  `src/entrypoints/content-loader.content.ts:previewInteractionActive()` accepts
  Preview target commands only after the content organ independently consumes
  `preview.opened`. Its typed availability event and 500 ms backstop can trail
  the popup.
- `src/popup/sections/PreviewRowList.tsx` correctly renders targetable rows as
  native semantic buttons and native Space produces trusted `keydown`, `keyup`,
  and `click`. It currently has no cross-organ readiness input, so an otherwise
  targetable row is enabled during the popup/content acknowledgement gap.
- The focused headed reproduction activated `11. Kontakta oss. Excluded` with
  trusted native Space. The row retained DOM focus, but the page produced zero
  focus targets for three seconds and the popup selected no row. This is a
  product-owned race, not a keyboard-event or semantic-button failure.
- The content command `syncContentSignals` already drains the content signal
  scheduler and returns `organName`, `runSessionId`, and `lastConsumedSeq`.
  `syncContentRunGeneration()` already demonstrates a binding-fenced, bounded
  request/retry pattern for this command.
- The earlier Exit Preview timeout was a probe artifact: one trusted dispatch
  restored Marking successfully. Arno's saved silent list contains 96 truthful
  disabled consent rows and no enabled row, so silent two-way routing is `N/A`
  for that authority occurrence rather than a product failure. The prior silent
  fade miss began 76 ms after Preview exit while the deliberately faded restore
  transition was still settling; the evidence runner must wait for its visible
  baseline before injecting a new scroll.
- `codebase-memory-mcp` indexing and search were attempted for this exact HEAD
  and returned `Transport closed`; the source and tests above were therefore
  inspected through the repository-authorized targeted fallback.

## 3. Decisions already made

- The popup and content organs remain independently authoritative; no direct
  popup-only claim may substitute for content's physical Preview readiness.
- `syncContentSignals` is the existing internal acknowledgement boundary. No
  public endpoint, backend payload, extension permission, Save/Load contract,
  or AI corpus changes are needed.
- A row that has no visible page target remains present, disabled, and labeled
  with its truthful reason. An all-disabled list is valid but cannot count as a
  two-way-routing pass.
- Preview opening remains local and must not add an authority refresh. The
  500 ms poll remains a correctness backstop, not the primary acknowledgement.
- Save continues to commit exactly once and a distinct Load complete-replaces
  local authority. Run AI remains stateless and whole-property. R8 must not
  alter any marking, hidden-element, consent, payload, or publication decision.

## 4. Open questions

None. The existing typed content-signal acknowledgement supplies the required
architecture and the observed race determines the behavior.

## 5. Non-goals

- Do not change selector computation, Content List taxonomy, virtualization,
  row labels, hidden-target eligibility, consent suppression, marking gestures,
  silent selector authority, or Preview exit ownership.
- Do not adopt Save responses, preserve local mutable drafts, change the
  stateless AI request, Save, Load, Lynx, or Hub interfaces, or perform a real
  Save/publication during live acceptance.
- Do not weaken trusted-input, row-target correspondence, fade, or exact-source
  acceptance to make the live workflow pass.

## 6. Implementation phases

### EL-02-R8-01 — Binding-fenced content Preview acknowledgement

**Files:** `src/entrypoints/popup/main.tsx`,
`tests/src/popup/entrypoint.test.ts`.

1. Add one popup-local Preview-targeting readiness occurrence that is reset on
   binding change, Preview close, and every new Preview open.
2. Add a bounded helper based on the existing `syncContentSignals` delivery
   pattern. It must accept only `preview_open` for a post-AI Preview or
   `silent_preview` for a silent Preview on the exact current binding, with a
   consumed signal sequence at least as new as that Preview-open occurrence.
3. After the popup observes `preview-opened`, synchronously drain the content
   organ and set readiness only from that exact acknowledgement. Never infer
   readiness from a timer, projection presence, or popup state alone.
4. Keep a failed/late/mismatched occurrence non-interactive and expose one
   truthful warning; a later current poll may retry, but an old reply may never
   unlock a new binding or Preview occurrence.
5. Gate outbound row hover/activation and inbound page-focused rows on the same
   readiness occurrence.

**Focused validation:**
`pnpm vitest run tests/src/popup/entrypoint.test.ts`.

**Fallback rule:** if exact content acknowledgement cannot be obtained, retain
Preview exit and truthful failure UI but never enable row interaction.

### EL-02-R8-02 — Truthful non-interactive preparation UI

**Files:** `src/popup/App.tsx`,
`src/popup/sections/PreviewRowList.tsx`,
`tests/src/popup/app.test.ts`,
`tests/src/popup/sections/preview-row-list.test.ts`.

1. Thread the exact readiness flag into the Preview surface and row list.
2. While readiness is pending, mark the Preview region busy, use explicit
   page-comparison preparation copy, and disable otherwise targetable row
   buttons. Preserve the row's semantic label and add a truthful pending reason.
3. Once acknowledged, restore the existing pointer/focus emphasis and native
   Enter/Space activation without adding custom keyboard emulation.
4. Preserve existing target-unavailable reasons with higher specificity than
   the temporary readiness reason.

**Focused validation:**
`pnpm vitest run tests/src/popup/app.test.ts tests/src/popup/sections/preview-row-list.test.ts`.

**Fallback rule:** if readiness is false or absent in an entrypoint occurrence,
rows fail closed; Preview exit remains available.

### EL-02-R8-03 — Exact regression and live acceptance

**Files:** `tests/src/popup/entrypoint.test.ts`,
`tests/src/popup/sections/preview-row-list.test.ts`, and only if a reusable
contract seam is required, `scripts/performance/p25/workflow-probes.mjs` plus
`tests/p25-workflow-probes.test.ts`.

1. Add a delayed-content regression proving the popup may show only a pending,
   disabled list before content reaches the matching Preview organ; no emphasis
   or activation command may be sent during that interval.
2. Resolve the matching content acknowledgement and prove the same native row
   becomes actionable and routes. Prove a stale acknowledgement after exit,
   re-open, or binding change cannot unlock the new occurrence.
3. Preserve target-unavailable disabled rows and existing production/debug
   text separation and virtualization bounds.
4. Correct the ignored live evidence wrapper to require trusted Preview open
   and exit clicks, treat an all-disabled authoritative list as routing `N/A`,
   retain exact row-activation evidence, and wait for a visible restored silent
   baseline before the scroll-fade probe. These artifacts remain out of commits.
5. Run focused tests, `pnpm verify`, production/debug builds, full P25, review,
   normal commit/push, then restart the repository live browser on the exact
   pushed source and rerun guarded Arno end to end.

**Focused validation:**
`pnpm vitest run tests/src/popup/entrypoint.test.ts tests/src/popup/app.test.ts tests/src/popup/sections/preview-row-list.test.ts tests/p25-workflow-probes.test.ts`.

**Fallback rule:** any trusted first-action routing failure or already-faded
probe baseline rejects R8; do not reclassify it as latency or `N/A` unless the
row itself is truthfully disabled.

## 7. Test matrix

- Unit/source: readiness occurrence lifecycle, exact expected content organ,
  timeout/no-receiver/malformed/mismatched outcomes, stale binding/Preview
  replies, disabled preparation rows, accessible copy, target-unavailable
  precedence, native semantic button retention, virtualization bounds.
- Integration: post-AI and silent Preview opening, content signal drain before
  row commands, immediate keyboard activation, hover/focus, row-to-page and
  page-to-row routing, exit/reopen, popup reopen, and no remote authority poll.
- Repository: `pnpm verify`, `pnpm build:debug`, and `pnpm performance:p25` on
  the exact final source.
- Headed: fresh `pnpm browser:live https://arno.eu/collections/katting`, all
  official guarded P25 stages, stateless AI, immediate trusted Space route,
  inverse page route, post-AI freshness under one second, Discard, desktop
  silent posture, truthful all-disabled silent list, stable-baseline fade and
  restore, resize, checklist fence, and zero Save/publication attempts.

## 8. Regression risks

- A readiness flag that is not occurrence-fenced could unlock stale rows after
  navigation or reopen. Reset and verify it with the same binding and Preview
  origin used by the controller.
- Waiting for content could reintroduce a slow/open spinner. Render immediate
  preparation feedback and use the existing event-driven drain with bounded
  retry rather than waiting for the remote authority lane.
- Disabling pending rows could erase permanent missing-target truth. Permanent
  target-unavailable reasons win and remain visible.
- A Preview-open failure could strand the page shield. Keep content-owned exit
  and existing bounded restoration semantics; never claim local completion.
- Poll-driven projection refresh must not flip readiness or re-enable an old
  projection after exit.

## 9. Acceptance criteria

- `EL02-R8-AC-01` No Content List row is actionable until the exact bound
  content organ acknowledges `preview_open` or `silent_preview` at or beyond
  that Preview occurrence's signal sequence; pending rows and copy are truthful
  and Preview exit remains operable.
- `EL02-R8-AC-02` On the first actionable frame, a trusted native Space on an
  enabled row produces the matching page focus/scroll target, and a trusted
  page target focuses the matching virtualized row.
- `EL02-R8-AC-03` No timeout, malformed reply, no-receiver result, navigation,
  exit/reopen, or delayed old acknowledgement can unlock a later occurrence.
- `EL02-R8-AC-04` An all-disabled list of hidden/no-area targets remains a valid
  truthful list with routing `N/A`; it never counts as a two-way-routing pass.
- `EL02-R8-AC-05` Silent scroll-fade evidence starts from a visible stable
  baseline, then proves fade, reposition/recompute, and restore; no acceptance
  depends on sampling the prior exit transition mid-fade.
- `EL02-R8-AC-06` Focused/full/build/P25 gates pass on the synchronized commit,
  and a clean headed Arno run passes every applicable safe workflow contract
  with zero Save and publication attempts.
- `EL02-R8-AC-07` R8 changes no Save→Load, stateless-AI corpus, marking,
  consent, hidden-payload, selector, or publication contract.

## 10. Todo chain

1. `el02-r8-preview-content-ack`
2. `el02-r8-pending-row-ui` → 1
3. `el02-r8-focused-regressions` → 2
4. `el02-r8-full-gates` → 3
5. `el02-r8-review-push` → 4
6. `el02-r8-headed-arno` → 5
7. `el02-r8-candidate-matrix` → 6
8. `el02-r8-conformance` → 7

# EL-02-R9 — Occurrence-fenced repeat page-to-row focus

## 1. Goal

Make every trusted page-highlight activation refocus its matching Content List
button, including a second activation of the same stable row after DOM focus has
moved elsewhere. Stable row identity must continue to preserve projection and
virtualization state; interaction occurrence identity must independently prove
that a new focus request was handled.

## 2. Current facts

- Exact-source DPJ on pushed commit `9e8fdfddb46a26c80a28030cf1ddb516980a025e`
  passed preflight, both Render Inspection modes, activation/network, marking
  visual, exact gestures, scroll fade, and resize.
- Its post-AI Content List opened with 96 rows. Trusted keyboard row activation
  routed row 561 to the matching page highlight. The evidence runner then moved
  popup focus to Exit Preview and physically activated the same matching page
  target.
- Content emitted the inverse route and the popup retained row 561 as selected,
  but `document.activeElement` remained outside the row. The two-second terminal
  proof therefore failed with `domFocusedRowName: null`.
- `src/entrypoints/popup/main.tsx` projects inbound `preview.focused` as only a
  stable `previewFocusedRowId`. Repeating the same row ID calls `render()` but
  does not change the child input.
- `PreviewRowList` suppresses an already handled focus key composed only from
  projection ID and row ID. That is correct for render churn, but it incorrectly
  collapses two distinct trusted page activations of the same row.
- The run-lifetime network guard stopped cleanly with dynamic coverage, zero
  Save attempts, zero publication attempts, and no guard errors.

## 3. Decisions

- Keep stable row IDs, projection identity, row selection, and bounded
  virtualization unchanged.
- Add popup-local monotonic identity to each accepted inbound page-focus event.
  This is ephemeral UI occurrence state, not marking/session persistence.
- A rerender, projection refresh, poll, or unchanged prop must not repeat focus;
  a new accepted `preview.focused` event must, even for the same row ID.
- Readiness, binding, page URL, projection ID, and targetability fences remain
  prerequisites. A stale or unready event cannot increment the occurrence.
- No endpoint, Save→Load, stateless-AI, payload, marking, consent, selector, or
  publication contract changes.

## 4. Implementation phases

### EL-02-R9-01 — Carry explicit focus-request identity

**Files:** `src/entrypoints/popup/main.tsx`, `src/popup/App.tsx`,
`src/popup/sections/PreviewRowList.tsx`.

1. Increment a popup-local focus-request occurrence for every accepted
   `preview.focused` event and reset its visible request with Preview retirement.
2. Thread the occurrence beside the stable row ID into `PreviewRowList`.
3. Include the external occurrence in the handled-focus key. Preserve the
   existing single-handle behavior for ordinary React rerenders and keyboard
   roving focus.
4. Clear local keyboard focus ownership when a newer external occurrence
   arrives so page interaction has explicit precedence.

### EL-02-R9-02 — Regression and exact-source acceptance

**Files:** `tests/src/popup/entrypoint.test.ts`,
`tests/src/popup/sections/preview-row-list.test.ts`, and authority documentation.

1. Prove two accepted same-row page-focus events produce two distinct request
   occurrences, while stale/unready events produce none.
2. Prove the focus key changes for a new external occurrence but stays stable
   across unrelated rerenders.
3. Run focused tests, `pnpm check`, `pnpm verify`, debug build, and clean P25.
4. Commit/push, restart the repository live browser from the exact clean source,
   and rerun guarded DPJ. Require DOM focus on the matching same row, successful
   exit, the remaining workflow checks, and zero Save/publication attempts.

## 5. Regression risks

- Incrementing on rejected events could revive stale projections. Increment
  only after all existing readiness and projection fences pass.
- Using object identity alone could refocus on every render. Use an explicit
  monotonic scalar occurrence.
- External focus could fight keyboard navigation. A newer page occurrence wins;
  normal rerenders and polls do not.
- Virtualized off-window rows still require the existing two-render focus plan;
  occurrence identity must survive the window adjustment render.

## 6. Acceptance criteria

- `EL02-R9-AC-01` Two trusted page activations targeting the same current row
  yield distinct accepted focus occurrences and each focuses its semantic row
  button, even when focus moved to Exit Preview between them.
- `EL02-R9-AC-02` Unready, stale binding, stale page URL, stale projection, and
  retired Preview events never advance or apply a focus request.
- `EL02-R9-AC-03` Polling and projection rerenders cannot replay a handled focus
  occurrence; bounded virtualization and native row keyboard behavior remain
  unchanged.
- `EL02-R9-AC-04` Focused/full/build/P25 gates pass on the committed source.
- `EL02-R9-AC-05` A fresh guarded DPJ workflow proves same-row inverse routing,
  exit/restore, remaining safe workflow contracts, and zero Save/publication
  attempts.

## 7. Todo chain

1. `el02-r9-focus-occurrence`
2. `el02-r9-focused-regressions` → 1
3. `el02-r9-full-gates` → 2
4. `el02-r9-review-push` → 3
5. `el02-r9-headed-dpj` → 4
6. `el02-r9-candidate-matrix` → 5
7. `el02-r9-conformance` → 6

# EL-02-R10 — Replacement-document authority acknowledgement and exact inverse-focus proof

## 1. Goal

Remove the nondeterministic first marking-activation refusal after a real
replacement document and make the headed Content List oracle accept both
different-row and repeated-same-row page activations only when the semantic row
button actually owns DOM focus. Preserve every Save→Load, stateless property-wide
AI, marking, payload, consent, selector, and publication contract.

## 2. Current facts

- A clean production DPJ run on pushed commit
  `d4ca038ad5dbb72344a3ce3eaeab9b1b87e827fd` passed preflight and both Render
  Inspection modes, then failed its first desktop-to-mobile marking activation.
  The panel remained in `Preparing marking` for about 12.6 seconds and returned
  the production-safe generic copy for an internal refusal. The network guard
  recorded zero Save and publication attempts.
- On the same resulting document, once content authority had settled, a second
  activation passed and returned interaction-ready marking with a prepared,
  bottom-frozen reveal occurrence. A second clean guarded run also passed every
  official marking stage. The failure is therefore a startup race, not a DPJ
  marking-engine or reveal/freeze incompatibility.
- A replacement content realm first runs `page.context`. A transient response
  can leave `interactionShieldAuthorityActive` false while
  `pageContextProbedUrl` remains equal to the current URL. Command-time
  `resumeConsentSuppression` waits for that first bind but re-probes only when
  consent registration itself requests one. A managed command can consequently
  overtake property/shield authority and return `property-authority-unavailable`
  or `consent-registration-failed` even though the next occurrence succeeds.
- R9's production code passed direct trusted live probes for both a different
  row and the same already-selected row after focus was moved to Exit Preview.
  In both cases the matching semantic button regained DOM focus.
- The ignored candidate wrapper still rejects a valid repeated-same-row
  occurrence because it requires a different row name, while also falling back
  to selected-row state. That oracle can both reject real success and accept a
  stale selection; the full workflow therefore stopped despite the direct R9
  proof.

## 3. Decisions

- A managed content command may perform one explicit current-page context
  re-probe when the completed document-start bind still has no interaction
  shield authority. It does not retry the user action, cross a lifecycle or URL
  fence, synthesize authority, or loop on a failing backend.
- Keep consent lifecycle registration and property/shield authority distinct.
  The helper still fails closed on a terminal consent lifecycle, changed
  lifecycle generation, changed page URL, unmanaged result, or a second
  unavailable authority result.
- Add actionable production-safe copy for the two command-time authority
  refusal codes. Debug builds retain the raw internal value.
- Page-to-row acceptance requires the matching row button in
  `document.activeElement`. Selected-row state is supporting display state, not
  occurrence evidence. A same row ID is valid because R9 supplies a monotonic
  focus occurrence; no different-name requirement remains.
- Keep the guarded candidate runner's Save/publication fence and exact-source
  provenance. No acceptance retry may hide an activation refusal.

## 4. Implementation phases

### EL-02-R10-01 — One bounded authority re-probe

**Files:** `src/entrypoints/content-loader.content.ts`,
`tests/c4-content-entrypoint.test.ts`.

1. After the initial page-context queue and consent resume settle, detect the
   exact case where the current lifecycle still lacks interaction-shield
   authority.
2. Clear only the current page-context probe memo, perform one queued
   current-page re-probe, and retain all existing lifecycle, route, consent, and
   page-URL fences.
3. Let activation, silent transition, and silent-selector commands use that
   common acknowledgement path. If the second authoritative resolution remains
   unavailable, return the existing refusal without further retries.
4. Add regressions for transient-first/managed-second success, two failures
   remaining failed and bounded, navigation/lifecycle mismatch remaining stale,
   and an already-authoritative command causing no extra context request.

### EL-02-R10-02 — Actionable refusal copy

**Files:** `src/popup/copy.ts`, `tests/src/lock/copy.test.ts`.

1. Map `property-authority-unavailable` to truthful page-binding recovery copy.
2. Map `consent-registration-failed` to truthful consent-protection recovery
   copy.
3. Preserve generic sanitization for unknown internal tokens and raw diagnostic
   detail only in debug builds.

### EL-02-R10-03 — Exact inverse-focus acceptance

**Files:** `scripts/performance/p25/workflow-probes.mjs`,
`tests/p25-workflow-probes.test.ts`, and the ignored live workflow wrapper.

1. Add a reusable predicate that accepts page-to-row routing only when the
   current `domFocusedRow` corresponds to the physically clicked page target.
2. Prove a repeated same-row occurrence passes when DOM focus returned after it
   had moved away; prove selected-only stale state fails; prove a different
   matching row passes and a mismatched focused row fails.
3. Use the predicate in the guarded live wrapper and remove its contradictory
   different-row-name condition and selected-row fallback.

### EL-02-R10-04 — Gates, commit, and clean headed rerun

1. Run focused content, popup-copy, and workflow-probe tests, then `pnpm check`,
   `pnpm verify`, `pnpm build:debug`, P17 smoke, and a clean full P25 gate.
2. Review the diff, commit, push, restart `pnpm browser:live` from the exact clean
   commit, and rerun the guarded DPJ workflow.
3. Require first-attempt marking activation, all official stages, both distinct
   and same-row DOM-focus proofs, the remaining safe workflow, and zero Save or
   publication attempts before continuing the candidate matrix.

## 5. Regression risks

- An unconditional context refresh would reintroduce remote latency on every
  action. Re-probe only after the existing bind completed without local
  property/shield authority, and cap it at one occurrence.
- A stale transient response must not revive authority after navigation,
  unregister, or property exit. Preserve the existing lifecycle and route
  generations before and after the queued probe.
- Using selected state as the focus oracle can accept an event that never
  arrived. Require DOM focus and readable target correspondence.
- Requiring a different row ID invalidates R9's explicit repeated-occurrence
  contract. Treat row identity and interaction occurrence as separate facts.
- More detailed operator copy must not expose exception text, tokens, URLs,
  extension IDs, or implementation internals.

## 6. Acceptance criteria

- `EL02-R10-AC-01` A replacement document whose first page-context result lacks
  property/shield authority gets exactly one current-page re-probe; a managed
  second result lets the original activation complete without a second click.
- `EL02-R10-AC-02` Two unavailable results, terminal consent, changed lifecycle,
  changed route, or changed page URL stay failed and never loop or synthesize
  authority.
- `EL02-R10-AC-03` Production reports actionable safe copy for known authority
  failures and still sanitizes unknown internal/exception detail.
- `EL02-R10-AC-04` Page-to-row passes only with corresponding semantic-button
  DOM focus. Both different-row and repeated-same-row occurrences pass; stale
  selection alone fails.
- `EL02-R10-AC-05` Focused/full/build/P17/P25 gates pass on the synchronized
  commit, and a fresh guarded DPJ workflow passes first activation and the full
  applicable workflow with zero Save/publication attempts.
- `EL02-R10-AC-06` R10 changes no persistence boundary: Save remains the only
  backend write, Load completely replaces local property state, and every AI
  call remains stateless with the complete property page/HTML corpus.

## 7. Todo chain

1. `el02-r10-authority-reprobe`
2. `el02-r10-refusal-copy` → 1
3. `el02-r10-focus-oracle` → 2
4. `el02-r10-focused-regressions` → 3
5. `el02-r10-full-gates` → 4
6. `el02-r10-review-push` → 5
7. `el02-r10-headed-dpj` → 6
8. `el02-r10-candidate-matrix` → 7
9. `el02-r10-conformance` → 8

# EL-02-R11 — Pre-acquired page-world capability and hot-command proof

## 1. Entering conformance finding

R10 is rejected by exact-source headed evidence. Commit
`09e5c69bad63aa6f105e080d5ef5f769e91c4612` passed `pnpm verify` (147 files,
1,567 tests), production/debug builds, P17 19/19, and clean aggregate P25 with
all seven children. A fresh guarded DPJ run then passed preflight and both
Render Inspection modes but failed the first marking activation after about
11.2 seconds. The publication fence recorded zero Save or publication attempts.

The R10 authority hypothesis was falsified. A non-editing raw `preparePageVisit`
reproduced `page-visit-stabilization-failed` while an external editor lock was
left untouched. Isolated-world console evidence identified exact page-world
timeouts: the first occurrence timed out `ARM`; later incomplete occurrences
timed out `SET_LAZY_LOADING_SUPPRESSED` and `RECONCILE`. In contrast, eight
ordinary MAIN-world executions took 0.7–2.2 ms, and the already-installed exact
capability completed direct probe/reconcile/arm/destroy in 1–2 ms and lazy lock
in 12.7 ms. The page runtime and Chrome injection are healthy after acquisition;
the defect is that the first background-mediated capability acquisition is
inside the same three-second deadline as the lifecycle command, and every hot
command redundantly re-probes the installed lease.

After the diagnostic browser restarted, DPJ reported `Locked by
rojan.gh@noordigital.com`. No Take over action was used. The read-only
preparation and timing probes do not require editor authority and performed no
Save, AI, or publication mutation.

## 2. Decisions

- Capability installation/recovery and lifecycle command execution are distinct
  acknowledgements with distinct bounded deadlines. A ritual explicitly acquires
  the exact current-document runtime before starting the short command deadline.
- A lease installed and proved by the current worker is trusted only inside that
  worker and exact identity. It does not need a probe before every command.
  A lease restored from `storage.session` after worker restart is unproved and
  must pass one exact-document probe before becoming memory-proved.
- Command execution retains authorization immediately before invocation and
  rechecks it after invocation. Navigation, generation, document, URL, consent,
  and terminal fences are unchanged; no page-visible transport returns.
- A command remains self-healing when callers omit explicit acquisition: it may
  install or recover the exact lease once, then invoke. It must not issue a
  redundant probe for an already proved in-memory lease.
- No retry loop, synthetic success, threshold relaxation, Save, Load, AI corpus,
  selector, marking, consent, or publication change is permitted.
- Known acquisition/command timeout outcomes receive phase-specific, safe
  operator copy. Raw exception detail remains debug-only.

## 3. Implementation phases

### EL-02-R11-01 — Proven in-memory lease lifecycle

**Files:** `src/background/page-world-capability-runtime.ts`,
`tests/src/background/page-world-capability-runtime.test.ts`.

1. Distinguish leases loaded from current-worker memory from leases recovered
   from session storage.
2. Probe a recovered lease exactly once; mark it proved only after the exact
   identity remains authorized. Install a replacement when recovery proof fails.
3. Let an exact proved in-memory lease skip the probe. Keep one pre-invocation
   and one post-invocation authority proof around every command.
4. Prove a cold command installs once and invokes once, consecutive hot commands
   each perform one command invocation and zero probes, a restarted worker probes
   once, stale identity executes nothing, and concurrent acquire/command remains
   serialized.

### EL-02-R11-02 — Separate acquisition acknowledgement

**Files:** `src/entrypoints/content-loader.content.ts`,
`tests/c4-content-entrypoint.test.ts`, page-world lifecycle tests.

1. Add a bounded exact-current-page acquisition helper using the existing typed
   `pageWorld.acquire` command and a dedicated 15-second installation/recovery
   deadline.
2. At the start of `runActivationStabilization`, after authority and identity
   capture but before `RECONCILE`, await acquisition and fail closed on stale,
   unavailable, timeout, navigation, or lifecycle change.
3. Start the existing short command deadline only after acquisition is proved.
   Keep the longer `SET_MOTION_PAUSED` and terminal-destroy bounds unchanged.
4. Add delayed-cold-acquire coverage proving an installation that exceeds three
   seconds does not make the following ARM fail, plus stale and unavailable
   acquisition coverage proving no lifecycle command runs.

### EL-02-R11-03 — Truthful failure evidence

**Files:** `src/entrypoints/content-loader.content.ts`, `src/popup/copy.ts`,
relevant content/copy tests and knowledge documents.

1. Preserve an internal acquisition-versus-command failure token through the
   ritual outcome instead of collapsing every exception to a generic
   stabilization failure.
2. Map only the known safe token families to actionable page-preparation copy;
   retain unknown-token and exception sanitization.
3. Record debug-only acquisition start/acknowledged/rejected and command phase so
   future evidence identifies the failing boundary without monkeypatching.

### EL-02-R11-04 — Gates and exact headed proof

1. Run focused capability/content/copy tests, `pnpm check`, `pnpm verify`,
   production/debug builds, P17, and clean full P25.
2. Review, commit, push, and launch the exact clean production bundle with the
   repository `live-browser` skill.
3. Once DPJ editor authority is naturally available, rerun the guarded workflow
   with no activation retry. Require both inspection modes, first activation,
   prepared bottom-frozen ritual, every remaining workflow stage, and zero Save
   or publication attempts.
4. Continue the remaining externally available candidate matrix. Never take over
   an external lock; classify it as external when it does not clear naturally.

## 4. Acceptance criteria

- `EL02-R11-AC-01` Cold exact-document capability installation/recovery has its
  own bounded acknowledgement and cannot consume the following command's
  three-second deadline.
- `EL02-R11-AC-02` Every proved hot command performs one MAIN-world command
  invocation with no redundant probe; a restarted worker probes exactly once.
- `EL02-R11-AC-03` Pre/post identity authorization remains fail-closed across
  navigation, generation, URL, consent terminalization, and runtime loss.
- `EL02-R11-AC-04` Acquisition and command failures remain phase-distinguishable
  in debug evidence and actionable but sanitized in production.
- `EL02-R11-AC-05` Focused/full/build/P17/P25 gates pass on the pushed source,
  and fresh DPJ first activation passes without a retry and with zero
  Save/publication attempts.
- `EL02-R11-AC-06` Save still writes one current page, authoritative Load fully
  replaces local state, and every stateless AI call still carries the complete
  property page/HTML corpus.

## 5. Todo chain

1. `el02-r11-proven-lease-runtime`
2. `el02-r11-explicit-acquire` → 1
3. `el02-r11-failure-evidence-copy` → 2
4. `el02-r11-focused-regressions` → 3
5. `el02-r11-full-gates` → 4
6. `el02-r11-review-push` → 5
7. `el02-r11-headed-dpj` → 6
8. `el02-r11-candidate-matrix` → 7
9. `el02-r11-conformance` → 8

## 6. Implementation checkpoint — prepublication

R11 now separates exact-document runtime acquisition from lifecycle commands.
The background retains one in-memory proof per exact hot lease, probes a lease
recovered after worker restart exactly once, executes each hot command once
between pre/post authority checks, and keeps stale leases discoverable for the
ordered terminal cleanup owner. Definite unavailable, retired, or rejected
endpoints fail the current action and are forgotten so only a later action may
install a replacement. The content ritual performs a bounded 15-second
`pageWorld.acquire` before the first short `RECONCILE`/`ARM` deadline and carries
typed acquisition-versus-command reasons through to safe popup copy. Raw errors
and lifecycle stages are debug-only; the production bundle contains none of the
new debug/error strings.

Current exact-worktree evidence:

- Focused capability/content/copy suite: 3 files, 44 tests, all PASS.
- `pnpm check`: PASS.
- `pnpm verify`: 147 files and 1,575 tests PASS; production build and all seven
  generated-manifest checks PASS.
- `pnpm build:debug`: PASS; debug lifecycle evidence retained while the
  production build proves it absent.
- P17 smoke: 19/19 PASS.
- Dirty-source P25 preflight: all seven P14/P15/P16/P17/P18/P20/P23 children
  PASS. This is regression evidence only, not the required clean-source seal.
- Codebase graph refresh/search remains externally unavailable because the MCP
  transport closes on every call; targeted source/test inspection was used as
  the documented fallback.

No Save, Load, AI-corpus, selector, marking, consent, endpoint, permission, or
publication owner changed. Save remains the only backend write, persists one
current page plus the property-wide selectors, and supplies no local authority;
the distinct subsequent Load complete-replaces local property state. Every AI
request remains stateless and carries the complete property page/HTML corpus.
No Save, takeover, Lynx publication, release, or deployment was attempted.

Still pending before R11 conformance: clean committed full P25, normal push and
`0/0` proof, exact production headed DPJ first activation with no retry once its
editor lock is naturally available, the remaining eligible candidate matrix,
and independent criterion-by-criterion adjudication.

# EL-02-R12 — Literal Load replacement and readiness-fenced Content List proof

## 1. Entering conformance findings

R11 commit `88f35b813c33b539c6582f447d1ccf513431bbd7` is synchronized
with `origin/re-write` and passes the full automated gate set. Exact production
headed DPJ evidence now passes both Render Inspection modes and the first
marking activation on its first attempt, proving R11's page-world acquisition
repair. The guarded run made zero Save or publication attempts.

The later safe workflow exposed two independent R12 findings:

| Finding | Severity | Exact evidence and owner |
| --- | --- | --- |
| `EL-02-F017` | High | `applyBackendLoad` conditionally carries `pendingRenderModeDraft` across a successful 200 Load when the revision identity is unchanged. The approved contract requires every successful Load to complete-replace local property state with no draft, session row, suggestion, or pre-Load mutable state preserved beside it. |
| `EL-02-F018` | Medium | Content List rows first painted 41 ms before the exact content-organ interaction acknowledgement. The live workflow sampled that deliberate preparation gap, classified all 96 disabled rows as terminally untargetable, and immediately tried Exit. Three-second frame sampling later proved one stable Preview root and Exit control with 30 enabled rows; one settled trusted Exit click succeeded. The gate conflates projection first paint with interaction readiness and its element-owned click witness can lose the diagnostic if a control is replaced between arming and dispatch. |

The DPJ AI request contained one page because the complete authoritative DPJ
snapshot currently contains exactly one persisted page (`/`, homepage). The
current live page correctly replaced that stored occurrence, so no persisted
page or HTML was omitted and the stateless whole-property corpus contract did
not fail.

## 2. Locked decisions

- A validated backend 200 is a literal atomic replacement. It always clears a
  pending local render-mode draft, even if property revision and render-mode
  timestamp happen to match the prior baseline. Transport/auth/validation
  failures remain non-authoritative and may leave the pre-existing local state
  untouched. The documented first-configuration render-mode exception remains
  limited to an authoritative 404.
- Cached projection of an already adopted configuration is not another remote
  Load. It may expose an active-session pending choice until explicit Refresh,
  worker recovery, or the mandatory post-Save remote Load replaces it.
- Content List projection first paint and target interaction readiness are
  separate facts. First paint retains its <=1-second performance criterion;
  physical row routing begins only after the Preview root reports its exact
  interaction-ready acknowledgement.
- Trusted activation remains one real browser input per configured attempt. Its
  witness belongs at document capture scope and accepts only an event whose
  composed path contains the exact current logical control (or its associated
  label). This preserves proof across a same-control React replacement without
  accepting an unrelated click or synthesizing success.
- No endpoint, payload schema, permission, selector, marking, consent, Save,
  stateless-AI, or publication contract changes are allowed.

## 3. Implementation phases

### EL-02-R12-01 — Complete-replace backend adoption

**Files:** `src/background/services.ts`,
`tests/src/background/property-authority.test.ts`, and authority documentation.

1. Remove successful-200 retention and projection of
   `pendingRenderModeDraft` from `applyBackendLoad`.
2. Store only backend-presence metadata plus any independently detected
   integrity warning after adoption; the parsed `ConfigSnapshot` is the sole
   property configuration baseline.
3. Prove identical-revision and advanced-revision 200 responses both clear the
   draft, while transport/auth/invalid outcomes preserve existing recovery
   state and a 404 retains only its documented first-configuration render mode.

### EL-02-R12-02 — Readiness-fenced Content List evidence

**Files:** `scripts/performance/p25/workflow-probes.mjs`,
`scripts/performance/p25-live-comparison.mjs`,
`tests/p25-workflow-probes.test.ts`, and the ignored safe live wrapper.

1. Capture Preview `aria-busy`, exact interaction readiness, and enabled-row
   count without changing public production UI.
2. Preserve row first-paint timing, then wait separately for the exact
   interaction-ready terminal before any row-to-page or page-to-row probe.
3. Move trusted click witnessing to document capture scope, bind it to the
   current logical control and associated label through the composed path, and
   clean the witness after every terminal path.
4. Add regression coverage for projection-ready/targeting-pending separation,
   same-control replacement, unrelated-click rejection, and unchanged strict
   one-dispatch evidence.

### EL-02-R12-03 — Gates and resumed headed workflow

1. Run focused property-authority and workflow-probe suites, then `pnpm check`,
   `pnpm verify`, debug build, P17, and clean full P25.
2. Review the exact diff, commit, push, refresh the graph if available, and
   prove `HEAD == @{u}` with ahead/behind `0/0` and a clean worktree.
3. Launch the exact production commit through repository `live-browser`; rerun
   guarded DPJ from a fresh marking session. Require separate first-paint and
   ready acknowledgements, both two-way routes, settled Exit, freshness,
   Discard, silent posture, fade/restore, and zero Save/publication attempts.
4. Resume the remaining externally available candidate matrix, then perform an
   independent criterion-by-criterion expert-check. Any failed criterion opens
   R13; only a complete pass may approve the rewrite.

## 4. Acceptance criteria

- `EL02-R12-AC-01` Every successful backend 200 clears all pending local
  render-mode draft state and adopts exactly the returned complete snapshot;
  failed/non-authoritative reads do not masquerade as replacement.
- `EL02-R12-AC-02` Content List first paint remains measured independently and
  <=1 second, while row interaction is attempted only after exact readiness.
- `EL02-R12-AC-03` A trusted activation witness survives same-logical-control
  replacement but rejects unrelated or untrusted clicks and never fabricates a
  successful event.
- `EL02-R12-AC-04` Focused/full/build/P17/P25 gates pass on the synchronized
  source, and guarded DPJ completes every applicable safe workflow stage with
  zero Save/publication attempts.
- `EL02-R12-AC-05` Save remains one current-page commit followed by a distinct
  complete-replace Load, and every stateless AI request still overlays the live
  current page onto every persisted authoritative page/HTML occurrence.
- `EL02-R12-AC-06` Independent cumulative conformance finds no unresolved R11
  or R12 regression before the candidate matrix proceeds.

## 5. Todo chain

1. `el02-r12-load-complete-replace`
2. `el02-r12-content-list-readiness` → 1
3. `el02-r12-focused-regressions` → 2
4. `el02-r12-full-gates` → 3
5. `el02-r12-review-push` → 4
6. `el02-r12-headed-dpj` → 5
7. `el02-r12-candidate-matrix` → 6
8. `el02-r12-conformance` → 7

## 6. Implementation checkpoint — prepublication

R12 now treats every validated 200 Load as literal replacement: it adopts the
returned complete snapshot and writes backend-presence/integrity metadata only,
never a pending render-mode draft. Identical-revision and advanced-revision
loads both clear the draft; auth, transport, and validation failures remain
non-authoritative and preserve recovery posture. Cached projection before a new
remote read remains distinct from Load.

The P25 popup probe now records Content List first paint separately from exact
interaction readiness. Rewrite readiness is the Preview root's
`aria-busy=false`; legacy receives only the narrow enabled-row fallback needed
for implementation-neutral comparison. Row routing cannot begin during the
preparation gap. Trusted control activation is witnessed at document capture
scope, but only a trusted event whose current composed path contains the exact
logical control or associated label is accepted; unrelated and synthetic
events remain rejected and the witness is cleaned on every terminal path.

Current exact-worktree evidence:

- Focused property-authority/workflow-probe suite: 2 files, 64 tests PASS.
- `pnpm check`: PASS.
- `pnpm verify`: 147 files and 1,578 tests PASS; production build and all seven
  generated-manifest checks PASS.
- `pnpm build:debug`: PASS.
- P17 smoke: 19/19 PASS.
- Dirty-source P25 smoke: all seven P14/P15/P16/P17/P18/P20/P23 children PASS.
- The first sandboxed verify/P17 attempts failed only because loopback/browser
  infrastructure was denied (`listen EPERM` / Playwright CLI exit); the same
  canonical commands passed with their required local execution permission.
- Codebase graph access remains externally unavailable because the MCP
  transport closes; targeted source/test inspection is the documented fallback.

No Save, Load request, AI run, takeover, publication, release, or deployment was
performed by R12 validation. The existing R11 headed session proved first
activation and zero Save/publication attempts; a fresh exact-commit browser run
remains required after review, commit, push, and clean P25.

# EL-02-R13 — Final backend authority lock and activation diagnosis

## 1. Final operator authority clarification — 2026-09-01

The operator reconfirmed the persistence boundary before the next expert-loop
slice. The configuration backend is the durable property/page owner. Save
commits exactly the current page plus property-wide selectors; its response is
acknowledgement only and must never become local configuration. A separate
fresh Load fetches the backend's newest complete shape and atomically replaces
local configuration, preserving or reconciling no active-session, draft,
cached pre-Save, or pre-Load state. Non-authoritative Load failure is not a
replacement. The AI endpoint remains completely stateless: every call receives
the entire newest loaded property corpus, with the live current-page occurrence
overlaid once, and no previous job or request contributes memory.

This is a clarification of the locked contract, not authorization to change an
endpoint or payload schema. Its focused startup regression proves that Save
emits one current-page mutation and exposes no response configuration, while
the following fresh Load supplies the only adopted shape.

## 2. Entering conformance findings — exact fresh DPJ evidence

R12 commit `d1e3de04a5faad51d76837cf801b8fec3ef3acdd` and the final
authority-contract commit `dafba50a25c23b801c87c031616791ec9e8ae164` pass
their automated gates and are synchronized with `origin/re-write`. A fresh
repository-managed headed DPJ run then reproduced the first-page ritual failure
without Save, AI, takeover, publication, release, or deployment.

Debug-only lifecycle evidence split the failing hot `ARM` occurrence into its
actual owners:

- exact acquisition completed and the immediately preceding hot `RECONCILE`
  completed in 6 ms;
- `ARM` pre-authorization completed in 5 ms;
- the one exact-document MAIN-world `ARM` invocation completed successfully in
  1,016 ms;
- the post-invocation `webNavigation.getFrame` proof then waited 3,027 ms;
- content's unchanged three-second command deadline expired during that final
  proof, queued `DESTROY`, and reported `page-world-command-timeout`, although
  `ARM` had already succeeded in the correct document;
- the background finally settled the `ARM` operation after 4,050 ms.

The later official activation stage passed only after the failed automatic
occurrence had cleared and a new preparation occurrence could run. It therefore
does not satisfy the first-occurrence/no-retry acceptance criterion.

| Finding | Severity | Exact defect and owner |
| --- | --- | --- |
| `EL-02-F019` | Critical | A hot page-world command is physically admitted and executed against Chrome's exact `documentIds` target, but success is withheld behind a second asynchronous `webNavigation.getFrame` round trip. A slow post-proof can outlive the caller's command deadline, manufacture a timeout after successful mutation, and start cleanup against a valid exact-document session. |
| `EL-02-F020` | High | `runPageVisitRitual` returns the same opportunistic page-load promise to a real marking activation. If that in-flight occurrence fails, the user action inherits the failure even when the exact document and editor authority remain current; no activation-strength consolidated follow-up is admitted. |
| `EL-02-F021` | Critical | Fresh DPJ debug evidence recorded silent selector `store-evaluate` stages of 62.6 s, 90.4 s, and 90.9 s, followed by 6–8 s repeats, while candidate indexing and silent paint stayed at 10–27 ms. `selectorSeedForBridge` serially runs every selector through `Element.matches` for every bridge node, and every identical silent-authority projection unconditionally rebuilds and re-evaluates the store. This is the direct owner of minute-scale silent-highlight and activation latency on dense properties. |

The first cold authorization also exposed a 2,223 ms session-storage read, but
it remained inside the separate 15-second acquisition phase and did not cause
this failure. R13 does not hide that evidence or relax either timeout.

## 3. Locked remediation decisions

- Exact Chrome `documentIds` targeting remains the physical execution boundary:
  a command for document A cannot execute in replacement document B.
- Full asynchronous authorization remains mandatory before acquiring,
  recovering, probing, or installing an exact page-world lease. It continues to
  verify the physical main frame and durable consent tombstone before admitting
  page-world authority.
- A proved hot command receives non-yielding pre- and post-invocation retained-
  authority checks instead of another physical browser/storage round trip. The
  checks require the same managed authority object/generation, main document,
  normalized URL, non-pending navigation state, active tab session, and absence
  of the process-local consent terminal tombstone. Every navigation,
  unregister, cleanup, and authority replacement updates one of those facts
  synchronously before asynchronous cleanup begins.
- If retained authority changes while an invocation is in flight, success is
  still withheld and the exact lease remains available to the ordered terminal
  cleanup owner. Runtime loss and poisoned capabilities retain their existing
  fail-closed behavior.
- The three-second hot-command deadline is unchanged. R13 removes the proved
  blocking work rather than accepting slower interaction.
- Page-load remains an opportunistic single occurrence. A real marking
  activation that arrives while that occurrence is pending shares a successful
  result. If it fails while the exact identity and authority remain current,
  all concurrent activation callers share exactly one stronger follow-up
  occurrence. Stale identity, deactivation, navigation, or a failed stronger
  occurrence does not recurse or retry.
- Activation is acknowledged only after the successful occurrence is fully
  prepared, bottom-frozen, current, and no curtain owns input. There is no
  synthetic acknowledgement or success inference.
- The approved Save → distinct fresh Load replacement contract and stateless
  whole-property AI corpus contract remain byte-for-byte out of scope, as do
  endpoint schemas, permissions, marking decisions, selectors, consent
  suppression behavior, and Lynx publication.
- Selector seeding preserves exact ordered selector attribution, document-scoped
  `:scope` behavior, open-shadow element semantics, invalid-selector isolation,
  exclusion-first/inclusion-wins precedence, and the resulting canonical rows.
  It may compile bounded comma groups so a non-matching element performs one
  selector-engine call per group rather than one call per selector; an exact
  positive group is then resolved in original order.
- Reapplying the same selector set to the same clean bridge generation is an
  idempotent projection, not new authority work. The engine may reuse that
  exact selector-derived store/index. Any bridge generation change, selector
  change, user toggle/clear, or non-selector refresh invalidates the reuse key.

## 4. Implementation phases

### EL-02-R13-01 — Exact retained-authority hot path

**Files:** `src/background/page-world-capability-runtime.ts`,
`src/background/index.ts`, and
`tests/src/background/page-world-capability-runtime.test.ts`.

1. Split the capability runtime's authority input into an asynchronous physical
   admission proof and a synchronous retained-authority predicate.
2. Keep physical authorization around lease acquisition/recovery/installation.
   For a proved hot command, run retained-authority checks immediately before
   and after its one exact-document MAIN-world invocation, with no
   `getFrame`/session-storage wait in the hot response path.
3. Preserve generation, URL, main-document, navigation-pending, consent
   terminal, tab termination, poisoned-runtime, and ordered-retirement fences.
4. Retain debug-only phase timing so live evidence can prove which owner ran;
   production builds must not expose diagnostic lifecycle copy.
5. Add regressions proving hot commands do not call the asynchronous authority
   provider, recovered/cold leases still do, pre/post retained-authority loss
   withholds success, and one exact `documentIds` invocation remains the only
   page mutation.

### EL-02-R13-02 — Activation-strength occurrence consolidation

**Files:** `src/entrypoints/content-loader.content.ts` and
`tests/c4-content-entrypoint.test.ts`.

1. Give pending page-visit occurrences an explicit request strength while
   preserving exact document/URL/lifecycle identity.
2. Let marking activation reuse a successful pending page-load occurrence. If
   the weaker occurrence rejects while identity and editor/shield authority are
   still current, schedule one stronger activation occurrence and share it
   across all concurrent activation callers.
3. Do not follow up stale, navigated, deactivated, or already activation-
   strength failures. Clear every pending/follow-up owner on both fulfillment
   and rejection.
4. Add deterministic tests for successful join, weak-failure → one successful
   follow-up, concurrent caller coalescing, stale identity rejection, and no
   unbounded retry.

### EL-02-R13-03 — Bounded idempotent selector projection

**Files:** `src/content/marking/engine.ts` and
`tests/src/content/marking/dom-bridge.test.ts`.

1. Compile each ordered inclusion/exclusion selector list into bounded valid
   selector groups once per seed transaction. Test the combined group for each
   bridge element and resolve individual selector attribution only for a
   positive group; preserve the narrow owner-document `:scope` compatibility
   proof and per-selector invalid isolation.
2. Track an exact selector-projection key containing selector order/content,
   bridge generation, and clean selector-derived state. Make an identical
   silent projection a no-op for seeding/evaluation/indexing while still
   allowing the caller's current render/posture acknowledgement.
3. Invalidate the key on structural/presentation bridge adoption, explicit
   toggle/clear, selector change, and every refresh that is not itself seeded
   by that exact selector set.
4. Split debug timing so selector matching and store evaluation are separately
   visible. Add operation-count regressions over a dense synthetic bridge,
   duplicate-projection no-op tests, invalid/`:scope`/shadow/precedence parity,
   and mutation invalidation tests.

### EL-02-R13-04 — Automated and headed acceptance

1. Run focused capability/content regressions and `pnpm check`, followed by
   `pnpm verify`, production/debug builds, P17, and clean full P25.
2. Review only intended source/test/plan changes, commit, push normally, refresh
   the code graph, and prove clean ahead/behind `0/0`.
3. Launch the exact production commit through repository `live-browser` on DPJ.
   From a fresh document, exercise the automatic ritual and the first real
   activation without a retry. Require one successful `ARM`, no timeout-driven
   `DESTROY`, prepared bottom freeze, responsive marking, correct mobile
   posture, and clean restoration/discard behavior.
4. Re-run both Render Inspection modes and the applicable safe P25 workflow
   stages with the publication guard active. Do not run AI with live HTML unless
   the operator separately authorizes that payload egress; do not Save or
   publish.
5. Resume the remaining externally available candidate matrix and perform an
   independent cumulative expert-check. Any failed criterion opens R14; only a
   complete pass can approve the rewrite.

## 5. Acceptance criteria

- `EL02-R13-AC-01` A proved hot command performs one exact-document MAIN-world
  invocation and zero asynchronous physical authorization calls in its response
  path; the separate acquire/recovery path retains full physical authorization.
- `EL02-R13-AC-02` Pre- and post-invocation retained-authority loss across
  generation, URL, main document, pending navigation, consent terminalization,
  or tab cleanup withholds success and preserves ordered retirement.
- `EL02-R13-AC-03` The reproduced DPJ `ARM` acknowledgement completes within
  the unchanged three-second command deadline even when a later physical
  `getFrame` call would be starved; no timeout cleanup is emitted after a
  successful command.
- `EL02-R13-AC-04` A real activation joining a successful weaker occurrence
  performs no duplicate ritual. A failed weaker occurrence produces exactly
  one shared stronger follow-up, while stale or stronger failures produce none.
- `EL02-R13-AC-05` Marking activation is acknowledged only after an exact
  prepared/current/bottom-frozen terminal with input released and no curtain.
- `EL02-R13-AC-06` Selector projection preserves exact classifications and
  selector attribution while reducing negative matching from
  elements × selectors to elements × bounded groups; an identical clean
  selector/bridge projection performs no second seed/evaluation/index pass.
- `EL02-R13-AC-07` Fresh headed DPJ has no multi-second selector-match,
  store-evaluate, candidate-index, or silent-render stage, and silent
  highlighting becomes interactive within its established one-second bound.
- `EL02-R13-AC-08` Focused/full/build/P17/P25 gates pass on synchronized source,
  and fresh headed DPJ first activation passes without retry, Save, AI,
  takeover, or publication.
- `EL02-R13-AC-09` Save still commits exactly one current page plus property-
  wide selectors, its response remains acknowledgement-only, the distinct
  authoritative Load completely replaces local state, and every stateless AI
  call still carries the full newest loaded property page/HTML corpus with the
  live current-page occurrence overlaid once.

## 6. Todo chain

1. `el02-r13-retained-authority-runtime`
2. `el02-r13-activation-followup` → 1
3. `el02-r13-selector-projection-hotpath` → 2
4. `el02-r13-focused-regressions` → 3
5. `el02-r13-full-gates` → 4
6. `el02-r13-review-push` → 5
7. `el02-r13-headed-dpj` → 6
8. `el02-r13-candidate-matrix` → 7
9. `el02-r13-conformance` → 8

## 7. Implementation checkpoint — 2026-09-01

- `EL-02-R13-01` is implemented. Proved hot commands now use synchronous
  retained-authority fences around one exact-document invocation; cold and
  recovered acquisition retain physical frame and durable consent proof. The
  pre-commit review additionally separated cold candidate admission from hot
  retained authority: an awakened MV3 worker may reconstruct only missing
  navigation facts from an exact physical frame proof, while known pending or
  mismatched facts still fail closed. Its startup regression proves the first
  installation succeeds and the following hot command performs no frame read.
- `EL-02-R13-02` is implemented. A failed weaker page-load occurrence admits
  exactly one current activation-strength follow-up shared by concurrent
  callers; the deterministic race regression passes.
- `EL-02-R13-03` is implemented. Selector parsing is isolated once, negative
  matching uses bounded ordered groups, a per-bridge seed is reused, and an
  identical clean projection skips seed/store/index work. Toggle, clear,
  selector changes, and bridge refreshes invalidate the appropriate shortcut.
- Focused evidence is green: the final four-suite R13 run passes `205/205`, the
  dense 200-node/97-selector corpus stays below 1,000 `Element.matches` calls,
  and `pnpm check` passes. The uninterrupted full `pnpm verify` passes all
  `1,582/1,582` tests, the production build, and all `7/7` manifest checks; the
  debug build also passes.
- Runtime commit `94d6a5e4d` is pushed to `origin/re-write`; the reviewed runtime
  tree was clean and synchronized at ahead/behind `0/0` for browser acceptance.
  Clean-source P14 passes all `192/192` scenarios with zero semantic, budget,
  activation, mutation-pressure, or input-long-task failures. P17 passes all
  `19/19` checks. P25 is complete and passes all seven retained children: P14,
  P15, P16, P17, P18, P20, and P23, with no missing or failed gate.
- Fresh headed DPJ evidence, the remaining candidate matrix, and cumulative
  conformance remain open under `EL-02-R13-04`.

# EL-02-R14 — Ctrl expansion, mutable-boundary ownership, and truthful preview

## 1. Entering expert-check findings — exact Aleris evidence

R13's automated gates and the safe DPJ/Aleris workflow checks remain useful,
but the operator's close visual review exposed a marking-contract divergence
that blocks production readiness and supersedes every remaining Shift-based
interaction statement. The approved modifier authority is now exact:

- **Ctrl** is the sole exclusion-expansion modifier.
- **Alt** is the sole explicit-inclusion modifier and wins over Ctrl when both
  are held.
- **Shift has no marking meaning at all.** Shift neither creates nor modifies
  any marking behavior, including expanded exclusions. Shift-held hover and
  click are byte-for-byte equivalent to unmodified hover and click on an
  expanded exclusion's border, interior, removal, and descendant-rehydration
  paths.
- Meta has no marking meaning and right-click remains the native browser menu.

Fresh headed Aleris evidence on
`/mage-tarm/kapselendoskopi/forberedelser/` confirmed two additional failures:

| Finding | Severity | Exact defect and owner |
| --- | --- | --- |
| `EL-02-F022` | Critical | The content input pipeline, hover identity, resolver vocabulary, P14/P18/P25 probes, popup copy, README, and expert-check skill all assign expansion to Shift and leave Ctrl inert. This is a complete end-to-end inversion of the approved modifier contract. |
| `EL-02-F023` | Critical | A painted expanded exclusion is not independently hoverable or toggleable at its literal visible boundary when its composed descendant path is also present. `resolveAtPoint` accepts a painted owner only when that owner is absent from the candidate path, so the 412 px-wide Aleris boundary renders as a permanent red block while hover/click resolve only descendants. |
| `EL-02-F024` | High | Content List can present descendants covered by the same broad exclusion as included and actionable. Aleris row 28 targeted a paragraph physically contained by `/html[1]/body[1]/main[1]/div[2]/div[1]`, even while that ancestor was the visible exclusion owner. `buildPreviewProjection` reconstructs defaults/selectors instead of using the active canonical session when selector-projection identity has been invalidated, permitting list state to diverge from the marking surface. |

No Save, AI request, takeover, Lynx publication, release, or deployment was
performed while collecting this evidence. A stale external property lock
prevented an additional debug projection after the production reproduction;
R14 therefore requires deterministic Aleris-shaped provenance tests rather
than weakening or taking over that lock.

## 2. Locked interaction and projection decisions

- The semantic expansion flag is `Ctrl && !Alt`. Shift is never read by the
  marking subsystem and has no effect on expanded exclusions. Ctrl+Alt takes
  the Alt individual-inclusion path.
- Unmodified input—including input with Shift held—uses the ordinary mutable
  toggle contract. Every visible mutable marking can be hovered and toggled in
  every applicable state.
- A pointer within the actual painted border band of an exclusion or other
  explicit mutable decision resolves that exact boundary for unmodified/Ctrl
  exclusion interaction. The border owner wins even when its descendant is in
  the native hit path. The interior of an expanded exclusion remains open to
  ordinary descendant targeting.
- Alt bypasses expanded-exclusion boundary ownership completely. It paints and
  toggles only the eligible individual inclusion target, including the approved
  mixed-text parent/child ladder; immutable ancestry remains absolute.
- Boundary identity is part of hover reuse. Moving from an expanded boundary's
  interior to its border (or back) cannot reuse a stale descendant/owner hover,
  even when `elementsFromPoint` returns the same physical stack.
- Removing an exact expanded boundary rehydrates descendants from defaults.
  Clicking an ordinary descendant dissolves the ancestor, rehydrates the
  branch, and creates the descendant exclusion; clicking an explicit-included
  descendant removes only that inclusion and preserves the ancestor.
- Content List is a projection of the current canonical session whenever that
  session is newer than selector projection because of an operator mutation.
  A structural DOM refresh is not such a mutation: active-session decisions
  rebind through surviving Element identity, while silent mode reapplies its
  selector authority. A genuinely different projection request may build an
  isolated selector baseline without mutating either authority.
- Preview traversal uses the same shallow-boundary rule as submission: an
  excluded ancestor is the one row/target for its covered branch, and covered
  descendants do not appear as included/actionable rows unless a valid explicit
  inclusion independently rescues that exact descendant.
- Hidden/invisible targets remain unpainted and non-interactive. Their already
  approved payload-only coverage, immutable-selector list, ephemeral session,
  stateless whole-property AI corpus, Save acknowledgement, and distinct fresh
  Load complete-replacement contracts remain unchanged.

## 3. Implementation phases

### EL-02-R14-01 — Contract authority and Ctrl input pipeline

1. Replace marking-only Shift state with Ctrl state in the trusted content
   listener, hover identity, engine parameter names/comments, test runtime, and
   P14/P18/P25 physical probes. Do not alter Shift+Tab accessibility behavior.
2. Make every click/hover calculate expansion as `ctrlKey && !altKey`; keydown,
   keyup, blur, visibility loss, pointer movement, cursor state, leading-paint
   decisions, deduplication, and acknowledgement must share that value.
3. Update production copy, README, the normative marking documents, and the
   repository expert-check skill to say Ctrl expansion, Alt inclusion with
   Alt-over-Ctrl precedence, Shift inert, Meta inert, and native right-click.
4. Add trusted-entrypoint regressions for plain, Shift, Ctrl, Alt, Ctrl+Alt,
   Meta, key transitions without pointer movement, and reset paths.

### EL-02-R14-02 — Literal mutable-boundary hit authority

1. Add a generation-fenced renderer query for the actual painted mutable
   boundary band. It uses retained fragment geometry and deterministic layer/
   depth ordering; it never scans canonical owners or treats an expanded
   boundary's full interior as its boundary.
2. In exclusion resolution, accept that exact current mutable owner before
   descendant/widening resolution for both ordinary and Ctrl input. Preserve
   the existing full-rect owner fallback only for genuine painted coverage
   where the owner's composed path is absent.
3. Include boundary-owner identity in hover reuse so border↔interior motion
   repaints immediately while stable motion inside one semantic target remains
   frame-coalesced.
4. Add broad Aleris-shaped and fragmented/overlap tests proving: plain and
   Shift hover/click the exact boundary; Ctrl toggles the exact boundary; Alt
   ignores it; interior plain targets a descendant; interior Ctrl widens; and
   removal/descendant/explicit-inclusion rehydration remains exact.

### EL-02-R14-03 — Canonical Content List shallow coverage

1. Select the current store's canonical marks when the active session has
   invalidated selector-projection identity; retain the isolated requested-
   selector baseline only when it represents a different clean authority.
2. Make preview traversal terminal below excluded or immutable coverage except
   for a valid explicit inclusion that must be represented independently.
   Preserve closed-shadow/light-child behavior and selector attribution.
3. Add evaluator and engine regressions for an Aleris-shaped broad exclusion,
   active-session expansion, saved selector exclusion, explicit-inclusion
   rescue, immutable omission, hidden rows, row availability, and two-way
   routing. No covered descendant may be labeled Included or enabled.

### EL-02-R14-04 — Gates, headed acceptance, and conformance

1. Run focused marking/evaluator/content/popup/P14/P18/P25 tests and `pnpm
   check`, then `pnpm verify`, production/debug builds, P17, and clean full P25.
2. Review the exact diff, commit, push normally, refresh the code graph, and
   prove clean upstream ahead/behind `0/0` before browser acceptance.
3. Launch the exact production commit through repository `live-browser` on
   Aleris. With trusted input, prove literal-boundary hover/toggle for plain,
   Shift, and Ctrl; prove interior descendant behavior; prove Alt and Ctrl+Alt
   individual inclusion; and prove Content List shallow coverage and two-way
   routing. Make no AI, Save, takeover, publication, release, or deployment.
4. Re-run the safe DPJ workflow and resume all externally available candidate
   pages. Any failed criterion opens R15. Only a complete cumulative
   expert-check can approve production readiness.

## 4. Acceptance criteria

- `EL02-R14-AC-01` Ctrl alone expands exclusions; Alt alone explicitly includes;
  Ctrl+Alt equals Alt; Shift and Meta are byte-for-byte equivalent to ordinary
  marking input in target, hover, mutation, dirt, and payload result.
- `EL02-R14-AC-02` Every visible mutable boundary, including a viewport-wide
  expanded exclusion, has a responsive hover and exact toggle. Border and
  interior resolve differently where required without a document-scale scan.
- `EL02-R14-AC-03` Exact boundary removal, ordinary descendant drilling,
  explicit-included descendant clearing, and default rehydration produce the
  approved canonical rows with no expansion provenance.
- `EL02-R14-AC-04` Alt never highlights or toggles an expanded boundary as a
  boundary, immutable descendants remain unavailable, and Ctrl+Alt never enters
  widening.
- `EL02-R14-AC-05` Content List and page presentation derive from one current
  canonical occurrence. An excluded branch contributes one shallow exclusion
  row; no covered descendant is falsely Included/actionable, except a valid
  explicit inclusion represented independently.
- `EL02-R14-AC-06` Existing hover/marking latency, scroll fade/reposition,
  hidden-geometry, reveal/freeze, consent, payload, session, Save→Load, and
  stateless AI contracts remain green.
- `EL02-R14-AC-07` Focused/full/build/P17/P25 gates pass on synchronized source,
  and fresh headed Aleris plus DPJ acceptance passes without forbidden external
  mutations.

## 5. Todo chain

1. `el02-r14-contract-ctrl-input`
2. `el02-r14-boundary-authority` → 1
3. `el02-r14-preview-shallow-coverage` → 2
4. `el02-r14-focused-regressions` → 3
5. `el02-r14-full-gates` → 4
6. `el02-r14-review-push` → 5
7. `el02-r14-headed-aleris` → 6
8. `el02-r14-headed-dpj-candidates` → 7
9. `el02-r14-conformance` → 8

## 6. Implementation checkpoint — 2026-09-01

- `EL-02-R14-01` is implemented. The trusted input path, hover identity,
  runtime probes, product copy, normative contract, and expert-check authority
  now use `Ctrl && !Alt` for exclusion breadth. Alt wins Ctrl+Alt; Shift and
  Meta are inert. The entrypoint regression proves Shift-held hover/click is
  dispatched through the exact ordinary-exclusion path.
- `EL-02-R14-02` is implemented. A generation-fenced, spatially indexed query
  recognizes only the literal painted mutable border band. That exact boundary
  owns ordinary/Ctrl exclusion input even when a descendant wins Chromium's
  composed hit stack; Alt bypasses it, the interior remains descendant-
  targetable, and boundary identity fences hover reuse. The Aleris-shaped
  412-pixel-wide regression proves hover, plain/Shift equivalence, Ctrl, Alt,
  removal, and default rehydration.
- `EL-02-R14-03` is implemented. A mutated session invalidates the materialized
  Preview snapshot without adding projection work to the pointer path, and the
  next Content List request derives from the current canonical store. Excluded
  branches project one shallow owner plus only an independently valid explicit-
  inclusion rescue; ordinary, immutable, and technical siblings beneath that
  coverage are omitted.
- Focused evidence is green: the nine-suite contract run passes `394/394`, the
  final evaluator/engine/entrypoint rerun passes `197/197`, JavaScript syntax
  checks for the updated P24/P25 runners pass, `git diff --check` is clean, and
  `pnpm check` passes. The unrestricted full `pnpm verify` passes all
  `1,586/1,586` tests, the production build, and all `7/7` manifest checks; the
  debug build also passes. The pre-commit P14 run passes all `192/192` semantic,
  budget, activation, mutation-pressure, and input-long-task checks; its only
  rejected criterion is the intentionally dirty source identity, so the clean
  source-identity rerun remains after the review commit.
- The post-commit clean P14 rerun passes all `192/192` checks, including source
  identity. P17 then exposed a real structural-reprojection ambiguity: bridge
  invalidation was being treated as proof that the mutable session owned the
  Content List. The repair now tracks operator mutation separately, rebases
  explicit decisions and exact-boundary unexcludes through surviving Element
  identity, recomputes defaults, and reapplies selector authority only for
  silent presentation. Focused marking tests pass `157/157`; the final full
  `pnpm verify` passes `1,589/1,589`, the production build, and `7/7` manifest
  checks; the debug build also passes. Dirty-source P14 passes all `192/192`
  semantic/performance checks and dirty-source P17 passes all `19/19` required
  browser checks; their only rejected criterion is source identity, so clean-
  source reruns follow the repair commit.
- Exact-source acceptance after repair is green. P14 passes all `192/192`
  scenarios with zero semantic, budget, activation, mutation-pressure, or
  input-long-task failures
  (`acceptance-2026-09-01T10-30-40-479Z.json`). P17 passes all `19/19` checks on
  a clean source set (`acceptance-2026-09-01T10-37-58-831Z.json`, SHA-256
  `b1c844226f1db5f739bf14dcd547b15321b2a09c965e2eeece63b28afd5b4926`). The
  complete P25 composite passes P14, P15, P16, P17, P18, P20, and P23 with no
  missing or failed child (`acceptance-2026-09-01T10-50-06-308Z.json`). The
  headed Aleris and remaining candidate acceptance rounds remain the next R14
  evidence boundary.

# EL-02-R15 — Frozen Preview selector authority and silent shallow coverage

## 1. Entering expert-check finding — exact headed Aleris contradiction

R14's clean automated gates and literal-boundary interaction repair remain
valid. The headed Aleris acceptance on
`/mage-tarm/kapselendoskopi/forberedelser/` proves plain and Shift hover are
identical, plain and Shift boundary clicks remove the same expanded exclusion
and rehydrate the same defaults, Ctrl retains exclusion authority, Alt does not
highlight the expanded boundary, and Ctrl+Alt is identical to Alt.

The same run exposed a new production blocker:

| Finding | Severity | Exact defect and owner |
| --- | --- | --- |
| `EL-02-F025` | Critical | Silent presentation paints `/html[1]/body[1]/main[1]/div[2]/div[1]` as `uf-silent-excluded`, while Content List row 10 presents its descendant `.../h1[1]` as Included and row activation focuses that descendant. The saved property configuration contains exclusions and no explicit-inclusion rescue for this branch. `showPreview` calculates the exact silent saved-selector set but discards it; `PopupPreviewController` independently re-derives selectors through a presentation callback and does not freeze selector authority across the preview occurrence or recovery. The painted page and list can therefore project different selector generations. |

No AI request, Save, takeover, Lynx publication, release, or deployment was
performed. Screenshots and exact DOM evidence were captured before the managed
live browser was stopped.

## 2. Root contract

1. One Preview occurrence owns one immutable selector snapshot. The opening
   projection, polling refresh, stale-row recovery, row emphasis, and row
   activation must all remain fenced to that occurrence and snapshot.
2. Silent Preview receives the complete selector set loaded from backend
   configuration. Post-AI Preview receives the current authoritative AI/session
   selector set. Presentation flags are not allowed to choose a competing
   selector authority after the origin is known.
3. A selector exclusion is one shallow Content List boundary. Descendants are
   absent unless the canonical projection contains an independently valid
   explicit inclusion. Default, technical, immutable, and merely selector-
   matched descendants do not become actionable rescue rows.
4. Selector snapshots are copied at the boundary. Caller mutation, polling,
   configuration refresh, or a later preview cycle cannot mutate an active
   occurrence in place.

## 3. Implementation plan

### EL-02-R15-01 — Make selector authority explicit and occurrence-frozen

1. Remove the controller's ambient selector callback as an opening authority.
2. Require the caller to pass the exact selector snapshot into the opening
   candidate. Carry a defensive copy on the candidate and adopt it only when
   that candidate wins its owner/epoch/revision fences.
3. Retain the adopted snapshot for polling and stale-target recovery within the
   same Preview occurrence. Clear it on Preview exit and binding replacement.
4. Make `showPreview` pass the selector set it already resolves from the known
   silent/post-AI origin. Make restored/open projection refresh pass an explicit
   origin-derived snapshot only when the controller has no adopted occurrence.

### EL-02-R15-02 — Prove shallow saved-selector projection end to end

1. Add controller regressions proving an explicit opening selector snapshot is
   transported and remains frozen when the ambient presentation changes.
2. Strengthen the popup silent-preview integration test so the presentation
   selector set deliberately disagrees with backend configuration and the
   `preview.project` request must still carry the backend snapshot on opening
   and recovery.
3. Add an Aleris-shaped engine regression proving a saved broad exclusion emits
   one excluded owner and no default descendants, including after structural
   refresh.
4. Keep the valid explicit-inclusion rescue contract and two-way row targeting
   covered without weakening any P17/P25 catalog or performance threshold.

### EL-02-R15-03 — Gates, publish, and headed conformance

1. Run focused controller, popup-entrypoint, evaluator, and marking-engine tests;
   then `pnpm check`, `pnpm verify`, production/debug builds, clean P17, and the
   complete unchanged-threshold P25 composite.
2. Review, commit, push, and prove exact upstream synchronization before headed
   acceptance.
3. Relaunch the exact production commit with repository `live-browser` on the
   Aleris candidate. Re-prove the modifier matrix and require Content List to
   show the broad exclusion as one shallow owner with no included descendant or
   descendant focus target.
4. Resume DPJ and the remaining safe candidate matrix only after Aleris passes.
   Any new contradiction opens R16; do not approve by narrowing evidence.

## 4. Acceptance criteria

- `EL02-R15-AC-01` The opening `preview.project` request contains the exact
  origin-selected selector snapshot; silent mode uses loaded backend authority.
- `EL02-R15-AC-02` Polling and stale-row recovery reuse the adopted immutable
  selector snapshot until Preview exits or the binding changes.
- `EL02-R15-AC-03` An excluded owner suppresses every non-rescued descendant in
  Content List and in page/list two-way targeting.
- `EL02-R15-AC-04` Existing explicit-inclusion rescue, revision, race, keyboard,
  and target-occurrence fences remain green.
- `EL02-R15-AC-05` Focused/full/build/P17/P25 gates pass on synchronized source
  with unchanged thresholds.
- `EL02-R15-AC-06` Fresh headed Aleris evidence passes both the modifier matrix
  and silent shallow-coverage proof without AI, Save, takeover, publication,
  release, or deployment.

## 5. Run-plan todo order

1. `el02-r15-selector-authority` → 0
2. `el02-r15-shallow-regressions` → 1
3. `el02-r15-full-gates` → 2
4. `el02-r15-review-push` → 3
5. `el02-r15-headed-aleris` → 4
6. `el02-r15-headed-dpj-candidates` → 5
7. `el02-r15-conformance` → 6

## 6. Implementation checkpoint — 2026-09-01

- The controller no longer owns an ambient selector callback. Each opening
  candidate carries a defensive copy of the exact origin-selected selectors,
  and the winning candidate freezes that authority for polling and stale-row
  recovery until Preview exit or binding replacement.
- Silent Preview now explicitly uses the loaded backend configuration while
  post-AI Preview uses the current presentation selectors. The Aleris-shaped
  regression proves a saved broad exclusion remains one shallow Content List
  owner before and after structural refresh.
- The operator's final modifier correction is locked: Shift is entirely inert
  and has no effect even on expanded exclusions. Runtime hover/click resolution
  does not read `shiftKey`; the trusted-entrypoint and Aleris-shaped boundary
  regressions prove the Shift path is identical to unmodified input.
- Focused preview/popup/marking tests pass `244/244`; `pnpm check` and the full
  `pnpm verify` pass all `1,591/1,591` tests, the production build, and all
  `7/7` manifest checks. The debug build passes. Dirty-source P17 passes every
  one of its `19/19` functional browser checks and rejects only source identity;
  P25 correctly stops at its required-clean preflight. Exact-commit P17 and P25
  remain required immediately after the reviewed implementation commit.

# EL-02-R16 — Render Inspection intent across startup authority adoption

## 1. Entering expert-check finding — exact headed Acne startup race

R15's exact automated gates and headed Aleris acceptance remain valid. A fresh
production-bundle Acne run reached preflight while the popup still reported
`Property lock pending` and had not yet adopted the stored property
configuration. The operator-visible Render Inspection controls were active, so
the trusted `With JavaScript` action began. The delayed authoritative config
load then restored the backend render mode and Silent view, ejecting the
operator from the in-flight inspection. P25 correctly rejected the occurrence:
the final mode was authoritative, but the requested inspection lifecycle was no
longer observable and therefore could not be claimed as paint-acknowledged.

No AI request, Save, takeover, Lynx publication, release, or deployment was
performed. The persistent publication fence recorded zero attempts and zero
errors.

## 2. Root contract

1. An operator action on either Render Inspection control is an explicit request
   to remain in the Render mode view. That intent must be recorded synchronously,
   before context, Todo, lock, config, reload, or inspection awaits begin.
2. A delayed same-binding authoritative response may update the confirmed render
   mode, selectors, revisions, lock, and Todo state, but it must not replace the
   operator's active Render Inspection view or erase its exact generation's
   lifecycle projection.
3. Ordinary explicit exits remain authoritative. Cancel and successful commit
   may leave Render mode; a real binding/document fence may retire the old
   occurrence. Merely finishing startup authority adoption may not.
4. Acceptance must continue requiring an observed inspection lifecycle and
   paint acknowledgement. A backend-restored mode alone is not inspection proof.

## 3. Implementation plan

### EL-02-R16-01 — Pin operator inspection intent before asynchronous work

1. In the Render Inspection action path, synchronously promote the current view
   to the explicit `render-mode` request before its first await.
2. Preserve any pending radio choice while inspecting; the load buttons compare
   page views and must not silently decide or clear the later commit choice.
3. Keep cancellation, commit, rebinding, and durable inspection-generation
   fences unchanged.

### EL-02-R16-02 — Prove delayed authority cannot eject the operator

1. Add an entrypoint regression with a deferred `config.load`: start an
   inspection while the property configuration is unresolved, adopt an exact
   paint-acknowledged inspection, then release the backend configuration.
2. Require the backend mode/config to be adopted while the popup remains in
   Render mode and continues to expose the exact inspected JavaScript view.
3. Retain existing tests proving Cancel exits an established Render mode and
   stale-document inspection authority is rejected.

### EL-02-R16-03 — Gates, publish, and resumed headed acceptance

1. Run the focused popup entrypoint/view tests, `pnpm check`, `pnpm verify`,
   production/debug builds, clean P17, and the complete unchanged-threshold P25
   composite.
2. Review, commit, push, and prove exact upstream synchronization before headed
   acceptance.
3. Re-run the exact no-egress Acne workflow from a freshly re-registered service
   worker. Both Render Inspection modes must terminalize as paint-acknowledged;
   then complete the corrected trusted pointer/keyboard Content List proof.
4. Resume Assist24, Arno, ArkivIT, Teknikhallen, and Humanova. Any new exact
   contradiction opens the next remediation iteration; external locks fail
   closed without takeover.

## 4. Acceptance criteria

- `EL02-R16-AC-01` Inspecting either render mode synchronously pins the explicit
  Render mode view before any asynchronous authority or reload work.
- `EL02-R16-AC-02` A delayed same-binding `config.load` adopts its complete
  authoritative state without closing or replacing the active inspection
  occurrence.
- `EL02-R16-AC-03` The inspected view remains backed by the exact
  paint-acknowledged lifecycle; a restored backend mode is never substituted as
  proof.
- `EL02-R16-AC-04` Cancel, commit, navigation, document, and binding fences retain
  their existing behavior.
- `EL02-R16-AC-05` Focused/full/build/P17/P25 gates pass on synchronized source
  with unchanged thresholds.
- `EL02-R16-AC-06` Fresh headed Acne acceptance passes both render modes and the
  safe workflow with zero AI, Save, takeover, or final-publication attempts.

## 5. Run-plan todo order

1. `el02-r16-render-intent` → 0
2. `el02-r16-focused-full-gates` → 1
3. `el02-r16-review-push` → 2
4. `el02-r16-headed-acne` → 3
5. `el02-r16-candidate-matrix` → 4
6. `el02-r16-conformance` → 5

# EL-02-R17 — Render-view boundaries, Preview annotation parity, and page-label scope

## 1. Entering expert-check findings — operator-observed contract corrections

R16 remains a valid startup-intent repair, but the resumed operator review
identified five presentation-boundary defects that supersede any assumption
that both Render Inspection buttons should expose the same page-inspection
surface:

1. `With JavaScript` is a JavaScript-on refresh, not a reveal/freeze or visible
   page-inspection occurrence. It must not activate marking, selector
   highlighting, a page curtain, or an input shield. Reloading also releases any
   freeze owned by the replaced document.
2. Render mode is a presentation-suspended view. Leaving it must run one exact
   reveal/freeze occurrence and only after that occurrence is prepared may
   Silent highlighting be projected.
3. Consent suppression remains property-scoped and continuous in every mode and
   transition, including JavaScript-on refresh, JavaScript-off inspection,
   reveal/freeze, Marking, Silent, and Content List.
4. Content List page annotations must use the Silent visual vocabulary whether
   Preview originated in Silent or Marking. Those annotations and semantic list
   rows remain the two directions of one clickable/focusable target mapping.
5. The fixed page-top ownership label is absent for a stable editable owner. It
   is present only for a passive/non-owner, an owner in an actual loss/transfer/
   warning boundary, or a non-candidate page.

No AI request, Save, takeover, Lynx publication, release, or deployment is
authorized by this remediation or its browser acceptance.

## 2. Root contract

1. Entering Render mode establishes an exact-document presentation-suspension
   lease. It parks Silent/Marking paint without terminating consent suppression
   or mutating the stored selector posture.
2. A JavaScript-on render test retains the durable generation/document paint
   proof needed to know its reload completed, but that proof is headless: no
   inspection curtain, page-input shield, reveal/freeze, marking paint, or
   Silent paint is exposed. A JavaScript-off test retains the guarded inspection
   curtain contract.
3. Retained shield posture, page-context adoption, and popup authority polling
   may adopt configuration while Render mode is open, but none may project
   Silent highlighting until the explicit exit transaction completes.
4. Render-mode exit is ordered and fenced: restore/reload JavaScript if needed;
   keep the popup in Render mode; run reveal/freeze; require a prepared current
   document occurrence; then leave Render mode and apply the current
   authoritative Silent selector set. Failure or stale identity leaves the view
   presentation-suspended and visible to retry.
5. `applySilentSelectors` rejects while a render-view suspension or page-visit
   ritual owns the document. Consent suppression is resumed independently and
   is never cleared by those presentation gates.
6. Preview presentation is a reversible renderer mode. It hides interactive
   Marking classifications, paints every visible projected row with the Silent
   included/excluded/immutable vocabulary, retains focus emphasis and page/list
   activation, and restores the exact prior Marking or Silent presentation on
   exit.
7. Content lock projection suppresses a supplied banner whenever
   `lockRole=editor` and `canEdit=true`. Every blocked editor and every passive,
   unknown, or non-candidate projection retains its appropriate banner.
8. Device emulation is a durable Chrome Debugger posture, not a repeated popup
   side effect. Mobile is always 412×960 and desktop is always 1920×1080, while
   the CDP display scale is recomputed from the visible tab viewport as the
   smaller width/height fit ratio. The complete simulated screen must remain
   visible with no clipped bottom. Same-mode refresh/poll traffic must not
   rewrite exact metrics, viewport/window changes must re-fit without passing
   through an opposite posture, and an operator-detached debugger must
   immediately reassert the currently held mobile or desktop posture.

## 3. Implementation plan

### EL-02-R17-01 — Make JavaScript-on reload headless and fence Render presentation

1. Add a content-owned Render-view suspension state and an explicit popup-to-
   content entry command. Park paint and local shield leases without clearing
   consent or durable selector authority; reject destructive entry over an
   active Marking session.
2. Adopt a replacement document's exact render-inspection generation before
   retained Silent posture. Mark the Render-view suspension before retained
   selectors can schedule paint.
3. Extend the render-inspection paint controller so JavaScript-on generations
   acknowledge the exact visible document through frames/guarded starvation
   proof without mounting a curtain or acquiring the render-inspection input
   shield. Keep the full curtain proof for JavaScript-off generations.
4. Gate popup authority projection and content-side retained/application paths
   while Render mode or reveal/freeze owns presentation.

### EL-02-R17-02 — Serialize Render exit as reveal/freeze then Silent

1. Make page preparation return a typed prepared/rejected result instead of a
   delivery-only boolean.
2. Keep `requestedView=render-mode` through JavaScript restoration and the full
   page-visit ritual so slow polling cannot paint Silent underneath it.
3. Only after a current prepared ritual may Set, Cancel, or an explicit
   configuration exit release the Render-view lease, change views, invalidate
   the Silent paint cache, and apply the authoritative selectors.
4. Add exact ordering, failure, stale-binding, already-frozen, and no-selector
   regressions. Require no marking/highlight/curtain/shield on the JavaScript-on
   reload and continuous consent suppression on every branch.

### EL-02-R17-03 — Give Content List one Silent annotation language

1. Add a renderer Preview-presentation state that suppresses Marking
   classification/hover/interaction layers while leaving Silent annotation and
   focus layers available.
2. Materialize Silent included/excluded/immutable annotations from the exact
   adopted Preview projection, so the painted clickable corpus and semantic row
   corpus share identity.
3. Repaint that Preview surface on structural projection refresh and make page
   hit testing ignore suppressed Marking boxes.
4. On Preview retirement, clear focus and Preview annotations, then restore the
   exact prior Marking presentation or authoritative Silent presentation without
   changing mutable decisions.

### EL-02-R17-04 — Scope the page-top label to ownership boundaries

1. Normalize content lock authority so a stable editable owner never receives a
   visible page banner even if an obsolete upstream banner bit is present.
2. Preserve banners for passive/unknown roles, non-candidates, transfers,
   disconnect/expiry warnings, takeover, and every blocked owner state.
3. Add projection and content-surface tests for both sides of the boundary.

### EL-02-R17-05 — Restore durable fit-to-viewport Chrome emulation

1. Port the useful legacy scale contract into the serialized background CDP
   authority: obtain the current visible tab dimensions and clamp
   `min(tabWidth/deviceWidth, tabHeight/deviceHeight)` to the supported scale
   range on every real posture transition or viewport refit.
2. Keep one held target posture per tab. Suppress redundant same-mode writes
   from popup startup, authority refresh, and repeated page-context requests;
   exact already-held posture is acknowledged without another metrics rewrite.
3. Monitor browser-window bounds and debugger detach events. Recompute/reassert
   the same target in the per-tab queue, preserving the epoch fence so stale
   mobile/desktop work can never become the final writer. A transient debugger-
   ownership refusal retains that exact target and retries with bounded backoff;
   it never forgets the target or falls through to the opposite default mode.
4. Prove that a 412×960 mobile screen and 1920×1080 desktop screen both fit in
   shorter/narrower visible viewports, that resizing changes only scale, that a
   user detach reasserts the held target, and that polling/reload races produce
   no opposite-mode or scale-1 flash.

### EL-02-R17-06 — Gates, publish, and headed acceptance

1. Run focused render-inspection, popup-entrypoint, content-entrypoint, marking-
   engine/renderer, Preview, lock, and consent tests; then `pnpm check`,
   `pnpm verify`, production/debug builds, clean P17, and unchanged-threshold
   P25.
2. Review all R16/R17 source changes, commit, push, and prove exact upstream
   synchronization before browser acceptance.
3. Restart the repository watcher and use only `.github/skills/live-browser` on
   Acne first. Prove JavaScript-on is refresh-only/headless, JavaScript-off keeps
   its guarded inspection, exit orders reveal/freeze before Silent, consent is
   continuously hidden, Content List uses Silent annotations with two-way
   targeting, and a stable owner has no page-top label.
4. Resume the remaining safe candidate matrix only after Acne passes. Preserve
   the external-lock fail-closed fence and zero-egress constraints.

## 4. Acceptance criteria

- `EL02-R17-AC-01` `With JavaScript` replaces the document with scripts enabled
  and exposes no reveal/freeze, inspection curtain, page-input shield, Marking,
  or Silent annotation surface.
- `EL02-R17-AC-02` A prior freeze is gone after the JavaScript-on reload; leaving
  Render mode then completes one current reveal/freeze before Silent paint.
- `EL02-R17-AC-03` Neither retained posture nor fast/slow polling can activate
  Silent highlighting during Render mode or reveal/freeze.
- `EL02-R17-AC-04` Consent elements remain suppressed in every page mode and at
  every tested transition without entering extraction presentation.
- `EL02-R17-AC-05` Content List uses Silent visual annotations from both Silent
  and Marking origins, with page-to-row and row-to-page activation/focus intact.
- `EL02-R17-AC-06` Stable editable owners have no page-top banner; non-owner,
  owner-loss/warning, and non-candidate cases retain it.
- `EL02-R17-AC-07` R16's delayed-authority view pin and all existing modifier,
  payload, reveal, performance, race, P17, and P25 contracts remain green.
- `EL02-R17-AC-08` Fresh headed acceptance records zero AI, Save, takeover,
  final-publication, release, and deployment attempts.
- `EL02-R17-AC-09` Mobile remains exactly 412×960 and desktop exactly 1920×1080,
  with CDP scale equal to the clamped two-axis visible-viewport fit; the bottom
  and right edge of the simulated device are visible.
- `EL02-R17-AC-10` Repeated context/popup polling over an exact held posture emits
  no redundant `Emulation.setDeviceMetricsOverride` and causes no size flash.
- `EL02-R17-AC-11` Browser-window resizing re-fits the current posture without an
  intermediate opposite mode; debugger cancellation immediately reasserts the
  same held posture, and a transient ownership conflict keeps retrying that
  exact posture without a neutral, opposite-mode, or scale-1 write.

## 5. Run-plan todo order

1. `el02-r17-render-suspension` → 0
2. `el02-r17-exit-ordering` → 1
3. `el02-r17-preview-presentation` → 2
4. `el02-r17-page-label` → 3
5. `el02-r17-fit-emulation` → 4
6. `el02-r17-focused-full-gates` → 5
7. `el02-r17-review-push` → 6
8. `el02-r17-headed-acne` → 7
9. `el02-r17-candidate-matrix` → 8
10. `el02-r17-conformance` → 9

# EL-02-R18 — Keep hidden decisions payload-only and Preview strictly visible

## 1. Entering expert-check finding — hidden Content List leakage

R17's render boundaries, Silent annotation language, ownership label, and
fit-to-viewport debugger emulation passed focused, full, and headed Acne
acceptance. The same headed run exposed a new release blocker in the Content
List: consent-suppressed and otherwise unpaintable targets were retained as
visible disabled rows such as `Target has no visible page area`.

That behavior violates the approved marking/payload contract. An element that
is hidden, clipped, covered, detached, zero-box, or otherwise visually
unavailable must not appear in Marking, Silent highlighting, Preview
annotations, or Content List. Its absence from user presentation must not erase
its payload decision: otherwise mutable hidden content is emitted as an
effective explicit exclusion, and an explicit inclusion that later becomes
hidden remains an explicit inclusion. Immutable selectors remain the separate
AI-only selector list and immutable descendants remain omitted.

No AI request, Save, takeover, Lynx publication, release, or deployment is
authorized by this remediation or its browser acceptance.

## 2. Root contract

1. Preview is a user-presentation projection, not the submission ledger. A row
   is eligible for Preview only while its exact element is connected,
   renderable, visually visible, scroll-reachable, and paint-reachable when it
   intersects the viewport.
2. The content-owned projection is the primary authority and omits unavailable
   targets before exposing row text, classifications, focus identities, list
   counts, or Silent Preview annotations.
3. The popup independently rejects any unavailable row received from an older,
   stale, or racing content generation. Hidden rows never consume ordinals,
   virtual-list height, accessible-set counts, focus navigation, debug detail,
   or disabled explanatory UI.
4. Preview filtering never mutates canonical marks or `EvaluationResult`. AI
   snapshot construction continues to use the independent submission
   evaluation and full sanitized static/dynamic HTML, not Preview rows.
5. An otherwise mutable hidden occurrence with owned direct text remains an
   effective explicit exclusion in `renderedXPaths`. A previously explicit
   inclusion remains explicit when it later becomes hidden. Immutable roots and
   descendants and descendants covered by the shallowest expanded exclusion
   remain omitted according to the approved payload contract.
6. Consent suppression remains continuous. Suppressed DOM and its valid payload
   coverage remain available to submission, while no suppressed target is
   exposed through any user-facing marking or Preview surface.

## 3. Implementation plan

### EL-02-R18-01 — Filter unavailable targets at the content projection boundary

1. In `buildPreviewProjection`, calculate live target availability before
   materializing a row and omit every unavailable occurrence.
2. Continue assigning the same projection occurrence/revision semantics to the
   resulting visible corpus. Preview annotations, two-way targeting, counts,
   and list rows all consume this one filtered identity set.
3. Keep activation and emphasis live-availability checks as race fences even
   for rows that were visible when projected.

### EL-02-R18-02 — Add popup defense without exposing hidden diagnostics

1. Add a pure user-visibility predicate for Preview rows and filter the adopted
   list before row indexing, virtualization, focus planning, accessible counts,
   debug projection, and rendering.
2. Preserve the existing content-organ readiness gate for otherwise visible
   rows, but render no disabled hidden row and no hidden-target reason in either
   production or debug UI.
3. If all received rows are unavailable, show the ordinary `No visible content
   detected` empty state.

### EL-02-R18-03 — Prove UI/payload separation

1. Replace tests that deliberately exposed clipped, covered, off-canvas, and
   zero-box technical rows with assertions that they are absent from Preview
   and cannot be emphasized or activated.
2. Extend the consent integration proof so the same suppressed element is
   absent from Preview while its sanitized HTML and explicit exclusion remain
   in the submission snapshot.
3. Prove an explicit inclusion that becomes hidden is absent from Preview and
   all paint, yet survives unchanged in submission rows.
4. Add popup production/debug regressions with mixed visible/unavailable input,
   exact visible ordinals and `aria-setsize`, bounded virtualization, and no
   unavailable text, reason, button, or focus target.

### EL-02-R18-04 — Gates, publish, and resumed headed acceptance

1. Run focused domain, marking-engine, popup Preview, and entrypoint tests;
   `pnpm check`; `pnpm verify`; production/debug builds; clean P17; and the full
   unchanged-threshold P25 composite.
2. Review the exact R18 diff, commit, push, refresh the code graph, and prove
   exact upstream synchronization before browser acceptance.
3. Restart repository live-browser and repeat the no-egress Acne Content List
   workflow. Require zero hidden consent/menu/modal rows, exact visible list/
   page annotation identity, working two-way targeting, continuous suppression,
   and no regression in 412×960/1920×1080 full-screen fit.
4. Resume the remaining safe candidate matrix only after Acne passes. External
   property locks fail closed and no prohibited request is attempted.

## 4. Acceptance criteria

- `EL02-R18-AC-01` No target whose current status is `unavailable` is present in
  the content Preview projection or Preview annotation renderer input.
- `EL02-R18-AC-02` The popup independently omits unavailable rows from all
  production/debug rendering, ordinals, counts, virtualization, and focus.
- `EL02-R18-AC-03` Consent-suppressed hidden content remains absent from every
  user-facing surface while its sanitized HTML and effective explicit exclusion
  remain in the AI snapshot.
- `EL02-R18-AC-04` A mutable explicit inclusion that becomes hidden remains an
  explicit inclusion in submission and remains wholly absent from UI paint and
  Content List.
- `EL02-R18-AC-05` Immutable and expanded-exclusion descendant omission,
  separate immutable-selector delivery, full-page HTML coverage, and all other
  approved marking/payload semantics remain unchanged.
- `EL02-R18-AC-06` Visible Preview rows retain semantic buttons, exact
  accessible names, keyboard/pointer emphasis, page/list two-way activation,
  and source-occurrence fences.
- `EL02-R18-AC-07` Focused/full/build/P17/P25 gates pass on synchronized source
  with unchanged thresholds.
- `EL02-R18-AC-08` Fresh headed Acne acceptance records zero AI, Save, takeover,
  final-publication, release, and deployment attempts.

## 5. Run-plan todo order

1. `el02-r18-content-projection` → 0
2. `el02-r18-popup-defense` → 1
3. `el02-r18-payload-separation` → 2
4. `el02-r18-focused-full-gates` → 3
5. `el02-r18-review-push` → 4
6. `el02-r18-headed-acne` → 5
7. `el02-r18-candidate-matrix` → 6
8. `el02-r18-conformance` → 7

# EL-02-R19 — Make debugger posture durable, continuously fitted, and flicker-free

## 1. Entering expert-check findings — emulation authority and physical fit

R18's hidden-content projection passed its focused, full, and headed Acne
acceptance, but cumulative production readiness is rejected. Headed evidence
and a rewrite-versus-legacy source audit confirmed that the simulated device can
briefly change mode or scale and can become larger than the physical tab after
the side panel or browser viewport changes. The lower or right portion of the
device can consequently be unreachable even though the emulated CSS viewport
still reports the correct 412×960 or 1920×1080 dimensions.

The debugger implementation is the correct rendering authority, but its desired
posture currently exists only in background-process memory, the popup can trust
an independent stale cache, viewport refits observe browser-window bounds but
not side-panel geometry, and the final safety fit is clamped to a 0.25 minimum.
A Manifest V3 worker restart, popup reopen, debugger detach, or tab-viewport
change can therefore expose an intermediate default/opposite posture or a
clipped device. This round repairs that root authority rather than masking the
flash in page CSS.

No AI request, Save, takeover, Lynx publication, release, or deployment is
authorized by this remediation or its browser acceptance.

## 2. Root contract

1. Chrome debugger device emulation remains the sole authority for mobile and
   desktop simulation. Mobile is exactly 412×960; desktop is exactly 1920×1080;
   DPR, touch, pointer/media, user-agent, and page-scale contracts remain exact.
2. Each managed tab has one durable desired posture containing the mode,
   maximum requested scale, and monotonically fenced revision. It is persisted
   in `chrome.storage.session` before the first transition write and hydrated
   before any cold worker decides a default. Explicit clear/tab removal is the
   only normal path that forgets it.
3. The background posture is authoritative. Popup state is a projection and
   must query/verify the background even when its local cache appears exact.
   Worker restart, popup close/reopen, navigation, polling, or restoration may
   never substitute mobile for a held desktop posture or vice versa.
4. The physical visible tab rectangle, including side-panel occupancy, is the
   fit boundary. At all settled points,
   `deviceWidth * deviceScaleFactor <= tabWidth` and
   `deviceHeight * deviceScaleFactor <= tabHeight`; both the bottom and right
   device edges remain visible and interactive.
5. The user preference scale is bounded normally, but the final safety fit may
   go below the preference minimum when required by the physical tab. It must
   remain positive and protocol-safe and may never be rounded upward into
   clipping.
6. Browser-window bounds, side-panel open/close, popup viewport resize, tab
   activation/navigation, debugger detach, and a low-frequency verification
   backstop all request a coalesced refit. Shrink-to-fit is immediate; expansion
   waits for a short stable trailing edge so resize bursts do not produce scale
   oscillation.
7. A same-mode refit changes only device metrics scale when identity, input,
   touch, media, and dimensions already prove exact. It preserves the target
   revision and never clears emulation, writes the opposite mode, writes a
   neutral viewport, or transiently writes scale 1.
8. If the user or another debugger detaches the extension, the exact held mode
   is immediately reasserted with bounded retry. A stale transition, hydration,
   resize event, or retry may not become the final writer after a newer revision.

## 3. Implementation plan

### EL-02-R19-01 — Persist and hydrate the authoritative tab posture

1. Add a typed session repository for per-tab emulation posture with schema
   validation, revision fencing, list/clear support, and explicit test seams.
2. Persist a transition's intended posture before CDP mutation, adopt it only
   after proof, restore the prior record on a failed transition, and remove it
   on explicit clear or tab teardown.
3. Hydrate tab posture before page-context decisions, detach recovery, and
   background current-state responses. Never use the mobile fallback while a
   durable desktop record exists.

### EL-02-R19-02 — Separate transition, verification, and scale-only refit

1. Split full posture writes from same-mode refits. Refit obtains `tabs.get`
   dimensions, computes an unclipped two-axis safety scale, and writes only
   `Emulation.setDeviceMetricsOverride` when the proven posture is otherwise
   exact.
2. Add per-tab refit coalescing with immediate shrink and stable trailing
   expansion. Collapse side-panel/window resize bursts and reject stale work at
   every await boundary using the posture revision/epoch.
3. Extend proof to validate the physical fit inequality in addition to CDP
   dimensions, scale, page scale, identity, media, and touch state.

### EL-02-R19-03 — Make every UI lifecycle project background authority

1. Add internal typed `current` and `refit` messaging outcomes. A popup-local
   applied mode can optimize rendering but cannot bypass background
   verification.
2. Observe popup/side-panel viewport changes with a coalesced refit request;
   feature-detect background side-panel open/close events and retain browser-
   window bounds as an independent trigger.
3. Keep desktop-preview preference and marking transitions serialized through
   the background target. Startup, reload, navigation, failed activation,
   disable, and popup reopen must preserve or deliberately change exactly one
   target without an intermediate mode.

### EL-02-R19-04 — Add deterministic cold-start, resize, and no-flicker proofs

1. Add storage-repository and runtime regressions for cold hydration, durable
   desktop/mobile restoration, failed-transition rollback, tab removal, and
   stale revision rejection.
2. Cover short/narrow physical viewports below the previous 0.25 floor,
   side-panel open/close/resize, resize bursts, immediate shrink, trailing
   expansion, scale-only CDP writes, and exact bottom/right fit inequalities.
3. Cover popup stale-cache/current verification and concurrent poll,
   navigation, detach, and resize races. Assert the command log contains no
   opposite-mode, neutral, scale-1, or redundant full-posture frame.

### EL-02-R19-05 — Gates, publish, and headed acceptance

1. Run focused storage, emulation-runtime, policy, messaging, popup-entrypoint,
   startup, and stabilization tests; then `pnpm check`, `pnpm verify`, both
   builds, clean P17, and the full unchanged-threshold P25 composite.
2. Review the exact R19 diff, commit, push, refresh the code graph, and prove
   exact upstream synchronization before browser acceptance.
3. Restart repository live-browser on Acne. Cycle mobile and desktop repeatedly,
   resize the browser and side panel, close/reopen the popup, reload/navigate,
   and cancel debugger ownership. Sample frames and CDP command history to prove
   the held mode never flashes or changes size incorrectly and the entire device
   remains visible and interactive.
4. Repeat the safe fit/no-flicker proof on one desktop-dominant and one tall or
   dynamic candidate before resuming the remaining zero-egress matrix. External
   locks fail closed and prohibited requests remain at zero.

## 4. Acceptance criteria

- `EL02-R19-AC-01` A cold background or popup restart hydrates and reapplies the
  exact durable mobile/desktop posture before any fallback decision.
- `EL02-R19-AC-02` Every settled mobile frame is 412×960 and every settled
  desktop frame is 1920×1080, with both physical fit inequalities satisfied,
  including physical viewports that require a scale below 0.25.
- `EL02-R19-AC-03` Side-panel and browser resize bursts never expose a clipped,
  neutral, opposite-mode, or scale-1 frame; shrinking is protected immediately
  and growth converges once stable.
- `EL02-R19-AC-04` Exact same-mode refits issue at most one coalesced metrics
  write and do not churn UA, touch, media, page scale, or reload the document.
- `EL02-R19-AC-05` Popup caches cannot suppress authority verification, and all
  session transitions preserve a single serialized background target.
- `EL02-R19-AC-06` Debugger detach/cancel, transient ownership refusal,
  navigation, polling, and stale async work restore only the held target with
  bounded retry and revision fencing.
- `EL02-R19-AC-07` Focused/full/build/P17/P25 gates pass on synchronized source
  with unchanged thresholds and no marking, payload, Preview, consent, reveal,
  or ownership regression.
- `EL02-R19-AC-08` Fresh headed acceptance proves whole-device visibility at the
  bottom-right edge and records zero AI, Save, takeover, final-publication,
  release, and deployment attempts.

## 5. Run-plan todo order

1. `el02-r19-durable-posture` → 0
2. `el02-r19-viewport-refit` → 1
3. `el02-r19-popup-authority` → 2
4. `el02-r19-regressions` → 3
5. `el02-r19-full-gates` → 4
6. `el02-r19-review-push` → 5
7. `el02-r19-headed-acne` → 6
8. `el02-r19-candidate-matrix` → 7
9. `el02-r19-conformance` → 8

## 6. R19 execution evidence — 2026-09-01

- The desired posture is now durable per tab in `chrome.storage.session`, and
  every transition is revision/epoch fenced before CDP mutation. Cold-worker
  desktop restoration, rollback, teardown, and stale-write regressions pass.
- The physical safety fit uses both axes and may fall below 0.25. Same-mode
  resize work is immediate on shrink, trailing on expansion, coalesced, and
  metrics-only when the complete debugger posture remains authoritative.
- A live acceptance probe found one additional half-posture edge: Chromium does
  not emit `chrome.debugger.onDetach` when the owning extension voluntarily
  detaches. Browser-owned detach/cancel still uses the immediate event path, but
  a silently missing attachment could leave a cached scale proof after touch,
  media, and UA overrides had fallen away. `chrome.debugger.getTargets` is now
  the independent, page-scheduler-free authority on refit/current checks; a
  disagreement invalidates all cached proof and reapplies the complete held
  posture. The hot healthy path still emits zero CDP commands.
- Full verification passes: 148/148 files, 1,614/1,614 tests, production WXT
  build, and 7/7 manifest assertions. The six sandbox-only failures were exact
  `listen EPERM` loopback restrictions; the required outside-sandbox rerun is
  fully green.
- Fresh repository `live-browser` Acne evidence proves exact mobile 412×960 and
  desktop 1920×1080 identities. A frame probe around deliberate attachment loss
  observed desktop native fallback for two 16 ms samples and exact desktop at
  60 ms with no mobile frame; mobile observed one native sample at 39 ms,
  viewport recovery at 60 ms, and complete touch/coarse identity at 64 ms.
  Five rapid shrink/grow reversals produced one uninterrupted 412×960,
  touch-enabled run across all 30 samples.
- With the physical tab only 570×445, `captureVisibleTab` returned the complete
  824×1920 mobile device buffer and complete 3840×2160 desktop buffer (host DPR
  2), proving the bottom and right device edges remain present rather than
  clipped. No AI request, Save, takeover, Lynx publication, release, or
  deployment was attempted.
- The final authority fence is committed/pushed as
  `0e9f2b277197150791035a0fb7cfaff7cf84996d`; local and upstream are exactly
  synchronized and the code graph is refreshed at 124,114 nodes / 243,934
  edges.
- Tall/dynamic Aleris acceptance retained one exact 412×960/touch/coarse state
  across 31 frame samples and five resize reversals on a 5,280px document; its
  complete device capture was 824×1920 and silent attachment-loss recovery was
  complete at 49 ms.
- Desktop-heavy 3DPrima acceptance retained one exact 412×960/touch/coarse
  state with 412px document width across 32 samples and five resize reversals
  on an 8,333px document; its complete device capture was 824×1920 and
  attachment-loss recovery was complete at 176 ms on the busier page. Both
  properties projected unavailable editing controls fail-closed, so no takeover
  was attempted. AI, Save, Lynx publication, release, and deployment remained
  at zero.
- R19 conformance verdict: **PASS**. AC-01 through AC-08 reconcile exactly
  against source, focused/full/build/P17/P25 gates, synchronized commit identity,
  and fresh Acne/Aleris/3DPrima browser evidence. The emulation remediation is
  approved with no unresolved R19 blocker.
- The expert-loop proceeds to a new independent audit. R19 completion is not, by
  itself, a claim of whole-product production readiness.

# EL-02-R20 — Keep fast polling local and preserve stable scale convergence

## 1. Entering expert-check finding — `EL-02-F026`

The independent post-R19 audit rejects whole-product production readiness even
though exact-current automated evidence is clean. Three consecutive P25
acceptance passes completed on synchronized HEAD
`8c1d34317646ee9b770d847e31d4647684ae261c`; every P14, P15, P16, P17, P18,
P20, and P23 child gate passed with clean source identity and clean process
teardown.

Fresh repository `live-browser` observation on Acne nevertheless proved a
Medium emulation-stability defect. An unchanged popup emits
`emulation.current` every approximately 500 ms alongside the intended local
`signals.pull`. The source path is
`pollFastSignalsOnce -> handleBoundContext -> ensureSessionEmulation ->
verifySessionEmulation -> emulation.current`. Background `current()` then reads
debugger attachment and physical tab authority and permits an immediate scale
expansion.

The behavior is visible under continuous geometry movement. Starting from a
settled 500px-tall browser window and mobile scale `0.317708`, the audit grew
the window through ten 40px steps spaced 80 ms apart. The stable trailing-edge
contract should have retained the smaller scale until movement ended, but the
fast authority tick expanded it to `0.526042` at 397 ms while the resize was
still in progress; it reached the settled `0.734375` at 897 ms. This is the
reported temporary size/zoom flicker in a deterministic form.

No AI request, Save, takeover, Lynx publication, release, or deployment was
attempted during this audit or authorized by R20.

## 2. Root contract

1. The 500 ms fast lane is extension-local. On an unchanged binding it may
   resolve the retained tab, pull brain signals, and maintain an already-open
   Preview projection; it may not query debugger attachment, physical window
   authority, configuration, authentication, lock, Todo, inspection, or AI
   resume state.
2. Initial binding, replacement-tab binding, and same-tab navigation are not
   unchanged fast ticks. They must establish the exact held posture before the
   new binding proceeds. Navigation still clears the obsolete document posture,
   deactivates the old content session, and applies the intended mode.
3. The 15-second single-flight authority lane remains the idle posture
   backstop. Popup creation/recreation, explicit Refresh, render-mode work,
   marking/preview transitions, AI preflight, navigation, and other operations
   that require current authority may verify immediately.
4. Browser window/side-panel geometry events remain the responsive fit signal.
   Shrink-to-fit is immediate. Scale growth is allowed only after the existing
   stable trailing interval, regardless of whether the mismatch was discovered
   by a geometry event, `current()` verification, or a coalesced trailing run.
5. Browser-owned debugger detach/cancel remains immediate. Independent
   `chrome.debugger.getTargets()` verification remains authoritative on the
   slow/current/refit paths and must still restore the complete held identity
   after silent attachment loss.
6. Removing redundant verification may not weaken mode serialization, durable
   posture hydration, popup stale-cache recovery, exact 412x960/1920x1080
   dimensions, two-axis physical fit, or revision/epoch fencing.

## 3. Implementation plan

### EL-02-R20-01 — Separate unchanged binding from authority verification

1. Give `handleBoundContext` an explicit internal emulation-authority policy.
   Its default continues to verify the background posture for authority and
   operator paths; the fast poll requests binding-change-only enforcement.
2. A binding-change-only call skips `ensureSessionEmulation` only when
   `bindToTab` reports the exact binding unchanged. Initial binding, a different
   tab, and same-tab URL/document navigation still perform the full posture
   sequence.
3. Keep signal pulling and open-Preview structural maintenance in the fast lane,
   and keep the existing single-flight/trailing authority scheduler unchanged.

### EL-02-R20-02 — Make all growth obey the stable trailing edge

1. Change the background `current()` mismatch path to request a normal refit,
   not an expansion-authorized refit. A smaller required scale still applies
   immediately; a larger fitted scale schedules one stable trailing run.
2. Preserve full reassertion when attachment truth or posture identity is stale.
   A missing debugger attachment is not a scale expansion and must continue to
   restore metrics, page scale, touch, media, and UA immediately.
3. Preserve per-tab operation serialization and stale held-posture checks at
   every asynchronous boundary.

### EL-02-R20-03 — Add cadence and convergence regressions

1. Extend popup polling tests so repeated unchanged 500 ms ticks add zero
   `emulation.current` calls, while a due 15-second authority refresh adds one
   and remains single-flight.
2. Retain and strengthen the same-tab navigation proof that a fast observation
   of a new URL clears and reapplies the target posture.
3. Add runtime fake-timer coverage showing `current()` applies a safety shrink
   immediately but defers growth until 120 ms of stable geometry and emits one
   scale-only metrics write with no UA, touch, media, opposite-mode, or scale-1
   churn.

### EL-02-R20-04 — Gates, synchronization, and headed proof

1. Run focused popup and emulation-runtime tests, `pnpm check`, `pnpm verify`,
   production/debug builds, clean P17, and the unchanged-threshold P25
   acceptance composite.
2. Review the exact R20 diff, commit, push, refresh the code graph, and prove
   exact upstream synchronization before browser acceptance.
3. Restart repository `live-browser` on Acne. Instrument extension-local bus
   traffic, require zero idle `emulation.current` calls across several fast
   ticks, repeat the 80 ms stepped slow-resize trace, and prove scale stays at
   the safe smaller value until the stable trailing edge.
4. Repeat the no-flicker/full-device proof on Aleris and 3DPrima `/se`; external
   ownership remains fail-closed and all prohibited request counts remain zero.

## 4. Acceptance criteria

- `EL02-R20-AC-01` Five or more unchanged fast ticks emit `signals.pull` as
  required but zero additional `emulation.current`, `emulation.apply`, or
  `emulation.refit` requests.
- `EL02-R20-AC-02` A due 15-second authority cycle performs at most one posture
  verification, remains single-flight, and retains the one-load-per-binding
  configuration contract.
- `EL02-R20-AC-03` Initial/replacement binding and same-tab navigation establish
  the intended exact posture; no new document proceeds by relying on the
  unchanged-binding optimization.
- `EL02-R20-AC-04` Every scale decrease needed for physical fit is immediate;
  every scale increase waits for stable trailing geometry and coalesces to one
  scale-only metrics write.
- `EL02-R20-AC-05` Verification, geometry, and detach races emit no opposite
  mode, neutral posture, transient scale 1, or redundant full identity frame.
- `EL02-R20-AC-06` Silent attachment loss and browser-owned detach still restore
  the complete exact held mobile/desktop posture with bounded retry.
- `EL02-R20-AC-07` Focused/full/build/P17/P25 gates pass on synchronized source
  with unchanged thresholds and no marking, payload, Preview, consent, reveal,
  render-mode, ownership, or publication regression.
- `EL02-R20-AC-08` Headed Acne/Aleris/3DPrima evidence proves whole-device fit,
  stable resize convergence, and zero AI, Save, takeover, final-publication,
  release, and deployment attempts.

## 5. Run-plan todo order

1. `el02-r20-fast-lane` -> 0
2. `el02-r20-stable-current` -> 1
3. `el02-r20-regressions` -> 2
4. `el02-r20-focused-full-gates` -> 3
5. `el02-r20-review-push` -> 4
6. `el02-r20-headed-acne` -> 5
7. `el02-r20-candidate-matrix` -> 6
8. `el02-r20-conformance` -> 7

## 6. R20 execution evidence — 2026-09-01

- The unchanged-binding fast lane now calls `handleBoundContext` with an
  explicit `binding-change-only` policy. All authority, publication, operator,
  startup, and navigation call sites retain the default verification policy;
  a changed binding still performs the complete posture sequence before work
  proceeds.
- Background `current()` now uses the ordinary refit path. A fitted-scale
  decrease remains immediate, while an increase returns the verified safe
  posture and schedules one expansion after the 120 ms stable trailing edge.
  Missing attachment truth still takes the independent full-reassert path.
- Focused verification passes 98/98 popup/emulation tests. The new regressions
  prove five unchanged fast callbacks add zero posture checks, a due authority
  cycle adds exactly one, navigation still clears/applies, verification shrink
  is immediate, and verification growth emits one trailing metrics-only write.
- Required full verification passes outside the filesystem/network sandbox:
  148/148 files, 1,615/1,615 tests, production build 1.63 MB, debug build
  1.64 MB, and 7/7 manifest assertions. The sandbox-only run had the known six
  `listen EPERM 127.0.0.1` denials plus one non-reproducing contended
  micro-benchmark sample; the unrestricted authoritative rerun is fully green.
- Clean-source P17 passes 19/19 with complete fixture/browser teardown. The full
  unchanged-threshold P25 composite passes every P14, P15, P16, P17, P18, P20,
  and P23 child, with accepted/stable clean source before and after, exact HEAD
  `bc2b22ebcd9f00cd2b124c3396bd73ca3113224b`, no missing/unexpected child, and
  clean process teardown.
- The implementation is committed/pushed as
  `bc2b22ebcd9f00cd2b124c3396bd73ca3113224b`; local and upstream are exactly
  synchronized. The refreshed code graph contains 134,811 nodes and 217,270
  edges.
- Fresh repository `live-browser` Acne evidence records 11 consecutive 500 ms
  `signals.pull` messages and zero posture messages in an isolated 5.5-second
  idle window. The scheduled authority cycle was independently distinguishable
  by its accompanying account/context requests. During 20 uninterrupted window
  updates at approximately 40 ms spacing, all 15 in-motion `current()` samples
  retained mobile scale `0.317708`; the pre-stable sample was unchanged and one
  post-stable sample reached `0.734375`. The page remained exact 412x960,
  touch/coarse Googlebot, non-overflowing, and the full capture was 824x1920 at
  host DPR 2. A deliberate silent detach restored the complete identity in
  126 ms.
- Aleris records 11 local ticks and zero posture messages in 5.5 seconds. Its
  20 resize completions had a maximum 47 ms gap; all 30 in-motion samples kept
  scale `0.317708`, then one settled expansion reached `0.734375`. Its 5,280px
  page remained exact 412x960/touch/coarse with a full 824x1920 capture.
- 3DPrima `/se` records the same 11/zero idle cadence. Its 20 completions had a
  maximum 48 ms gap; all 45 in-motion samples kept scale `0.317708`, followed by
  one settled `0.734375` expansion. `screen`, `outer`, `visualViewport`, root
  client, and body client dimensions remained exact 412x960 and the full
  capture was 824x1920 over an 8,333px page. Chrome exposed page-authored
  `innerWidth` inflation to 424px from hidden/fixed modal and carousel geometry,
  but it was not horizontally scrollable, no extension-owned node contributed,
  and the country/consent modal remained suppressed and non-interactive.
- Aleris and 3DPrima editing controls remained fail-closed under external
  ownership. Across all headed checks, AI, Save, takeover, Lynx publication,
  release, and deployment attempts remained zero.
- R20 conformance verdict: **PASS**. AC-01 through AC-08 reconcile exactly
  against the implementation, focused/full/build/P17/P25 evidence, synchronized
  source identity, and fresh cross-property headed proof. `EL-02-F026` is
  closed with no unresolved R20 blocker.
- The expert-loop proceeds to another independent audit. R20 closure does not,
  by itself, assert whole-product production readiness.

# EL-02-R21 — Make retained Preview polling paint-idle and payload-light

## 1. Entering expert-check finding — `EL-02-F027`

The independent post-R20 audit rejects whole-product production readiness even
though R20 itself remains accepted. Static graph tracing found that every open
Preview fast tick follows
`pollFastSignalsOnce -> ensurePreviewProjection -> preview.project ->
projectPreview -> renderPreviewPresentation -> renderSilentHighlights ->
drawSilent`. The supposedly cached branch therefore walks every projection row,
remeasures every target rectangle, and rewrites overlay geometry every 500 ms.
The source comment claiming that retained projection does not rebuild geometry
is false.

Fresh repository `live-browser` evidence on Acne version `2.0.0.730` confirms a
High performance and presentation-stability defect. In an isolated 5.5-second
window, the popup emitted 11 `preview.project` requests. Every response carried
the exact same projection ID
`preview-980ea577-96e3-41d9-a1cd-b6d9f2447204-occurrence-1` and revision `1`,
yet each request occupied 13.7–31.0 ms. With only 13 silent rectangles, the
unchanged page received 33 extension-owned style mutations in 5.7 seconds; the
opening trace recorded 120 style mutations in roughly nine seconds. The work is
document-size dependent and can steal repeated layout/paint time from pointer,
scroll, focus, and two-way Preview interaction on denser properties.

No AI request, Save, takeover, Lynx publication, release, or deployment was
attempted during this audit or authorized by R21.

## 2. Root contract

1. Opening Content List materializes one authoritative projection and paints
   its silent annotation presentation once. A retained projection with the same
   page, selector authority, projection ID, and revision is a visual no-op.
2. An unchanged 500 ms fast tick may perform one extension-local identity probe
   for list freshness. It may not clone the row corpus, walk projection rows,
   read target geometry, write overlay styles/classes, rebuild paint ownership,
   or touch remote authority.
3. Content remains the authority for structural and presentation changes.
   Marking mutations invalidate the materialized projection; DOM/presentation
   refreshes rebuild the projection and repaint the active Preview exactly once.
   The next identity probe then causes the popup to adopt the newer projection.
4. Selector changes, binding changes, document replacement, Preview close/open,
   and explicit stale-target recovery still obtain a complete authoritative
   projection. No optimization may retain rows across a different occurrence.
5. Scroll, resize, and layout movement continue through the renderer's existing
   geometry scheduler and gray fade/reposition/fade-in contract. The polling
   path must not compete with or resurrect that work.
6. Page-to-list and list-to-page targeting remain projection-ID/revision fenced.
   Active emphasis survives a structural rebase by stable row identity, and a
   removed/unavailable target continues to fail closed and recover truthfully.

## 3. Implementation plan

### EL-02-R21-01 — Add a typed identity-only Preview freshness probe

1. Add internal schemas/types for a page-fenced Preview identity request and a
   nullable response containing only `pageUrl`, `projectionId`, and `revision`.
   Register one internal `preview.current` command; this is not a Lynx/Hub API,
   payload, permission, or public extension-interface change.
2. Expose the current projection identity from the content Preview controller
   without ensuring a new engine, building rows, or rendering. A mismatched page
   fails closed.
3. Extend the popup Preview controller with an identity port. Once a projection
   and selector authority are adopted for the current owner, probe identity
   first. Return the retained local projection when identity matches; request a
   full projection only when identity is absent, newer, or belongs to another
   occurrence.

### EL-02-R21-02 — Make the content cache branch presentation-idempotent

1. In `projectPreview`, an identical materialized request returns the current
   projection without calling `renderPreviewPresentation` when the Preview
   presentation is already active.
2. Keep a defensive inactive-presentation path that arms and paints once if a
   valid retained projection ever exists without an active presentation; do not
   rely on polling as an overlay-root repair loop.
3. Preserve the existing structural refresh path that rebuilds the projection,
   repaints once, and reconciles emphasis before the popup adopts the newer
   revision.

### EL-02-R21-03 — Add idleness, freshness, and occurrence regressions

1. Add engine instrumentation coverage proving two identical projection calls
   return the same ID/revision and produce exactly one silent render total.
2. Prove a marking invalidation and a structural/presentation refresh each
   create a newer revision, render exactly once for the material change, and
   leave the following identical request paint-idle.
3. Add popup-controller tests proving a matching identity performs no full-row
   request, a newer/null/different identity performs exactly one full request,
   and stale owner/occurrence replies cannot repopulate the list.
4. Extend messaging and entrypoint tests for the typed nullable identity command
   and page mismatch behavior.

### EL-02-R21-04 — Gates, synchronization, and headed proof

1. Run focused engine/controller/messaging/entrypoint tests, `pnpm check`,
   `pnpm verify`, production/debug builds, clean P17, and the unchanged-threshold
   P25 acceptance composite.
2. Review the exact R21 diff, commit, push, refresh the code graph, and prove
   exact upstream synchronization before headed acceptance.
3. Restart repository `live-browser` on Acne. With Content List open, require at
   least ten identity probes, zero unchanged full `preview.project` requests,
   one stable ID/revision, and zero extension-owned overlay mutations during an
   idle 5.5-second window.
4. Trigger a safe local DOM/presentation change and prove one newer projection
   is adopted and painted once, followed by another mutation-free idle window.
   Repeat retained-idle and two-way targeting checks on Aleris and 3DPrima `/se`;
   external ownership remains fail-closed and prohibited egress stays zero.

## 4. Acceptance criteria

- `EL02-R21-AC-01` Ten or more unchanged Preview ticks emit only identity-sized
  freshness probes and zero full-row projection requests after initial adoption.
- `EL02-R21-AC-02` An unchanged projection causes zero renderer calls, target
  geometry reads, overlay mutations, paint-index rebuilds, and popup row-store
  updates.
- `EL02-R21-AC-03` Marking, selector, DOM, visibility, and occurrence changes
  still yield one complete authoritative projection with a strictly newer or
  different identity and exactly one corresponding presentation update.
- `EL02-R21-AC-04` Stale probes/full replies, page mismatch, Preview exit, and
  binding replacement fail closed and cannot restore an obsolete projection.
- `EL02-R21-AC-05` Two-way hover/focus/click/scroll targeting and gray
  scroll/resize fade-reposition behavior retain their exact contracts.
- `EL02-R21-AC-06` Focused/full/build/P17/P25 gates pass with unchanged
  thresholds and no marking, payload, consent, reveal, render-mode, emulation,
  ownership, or publication regression.
- `EL02-R21-AC-07` Headed Acne/Aleris/3DPrima evidence proves idle visual
  quiescence, one-update material freshness, responsive two-way interaction,
  and zero AI, Save, takeover, final-publication, release, and deployment
  attempts.

## 5. Run-plan todo order

1. `el02-r21-identity-probe` -> 0
2. `el02-r21-idempotent-render` -> 1
3. `el02-r21-regressions` -> 2
4. `el02-r21-focused-full-gates` -> 3
5. `el02-r21-review-push` -> 4
6. `el02-r21-headed-acne` -> 5
7. `el02-r21-candidate-matrix` -> 6
8. `el02-r21-conformance` -> 7

# EL-02-R22 — Make debugger emulation physically safe on every frame

## 1. Entering expert-check finding — `EL-02-F028`

The operator reports that mobile simulation can flicker, temporarily change
size, and sometimes leave the lower part of the 412×960 device outside the
visible browser viewport. This reopens physical-emulation parity even though
R19 and R20 passed their narrower automated and headed checks.

Fresh read-only Acne evidence on synchronized version `2.0.0.731` shows the
settled state is exact: the target tab is 850×705, the emulated layout is
412×960, and background authority reports scale `0.734375`. The implementation
nevertheless contains a frame-level race that can violate that settled result:

1. A full apply/reassert derives scale from one `tabs.get()` sample and writes
   device metrics before it knows whether side-panel/browser geometry changed
   between measurement and acknowledgement.
2. Physical-fit proof happens after the write. A mismatch can therefore expose
   an oversized frame before the second corrective write.
3. `chrome.debugger.onDetach` discards the verified posture, including its
   fitted scale. Reassertion retains the desired mode but recalculates from an
   unconfirmed sample, so cancel/replacement recovery can return at a larger,
   temporarily clipped scale.
4. Scale growth waits 120 ms but is not fenced to an unchanged physical-geometry
   sample. A transient larger measurement can still become the trailing writer.
5. The popup owns an independent, non-emulated side-panel height measurement,
   but does not provide it to background fitting. The prior headed proof relied
   on `captureVisibleTab`; that proves Chrome produced the complete emulated
   device buffer, not that every buffer pixel was physically displayed inside
   the headed browser window.

The rewrite already uses Chrome Debugger as the sole emulation mechanism and
retains/reasserts the exact held mobile or desktop mode. This round preserves
that architecture and fixes the missing physical-safety authority rather than
adding a CSS transform or page-owned workaround.

No AI request, Save, takeover, Lynx publication, release, or deployment is
authorized by R22 or its browser acceptance.

## 2. Root contract

1. Chrome Debugger remains the only mobile/desktop simulation authority.
   Mobile is exactly 412×960; desktop is exactly 1920×1080. Page scale, DPR,
   touch, pointer/media, and crawler identity remain part of the same proven
   posture.
2. The whole simulated screen must fit inside the user's current visible target
   tab on every acknowledged frame. Both inequalities are mandatory:
   `deviceWidth × fittedScale <= visibleWidth` and
   `deviceHeight × fittedScale <= visibleHeight`.
3. A popup/side-panel request supplies its contemporaneous non-emulated visible
   height as a conservative typed hint. Background intersects that hint with
   `tabs.get()` rather than replacing browser authority. A supplied hint may
   make the device smaller, never larger; a missing hint falls back to the real
   tab rectangle and cannot invent a larger physical viewport.
4. Each held posture durably retains its last proven fitted scale separately
   from the requested maximum. Full same-mode reassertion, navigation recovery,
   cold-worker hydration, and debugger detach/cancel start at that safe scale or
   smaller. They may not opportunistically grow it.
5. A first transition without a prior safe scale takes two bounded physical
   samples and uses the component-wise smaller rectangle plus any popup hint.
   A final pre-write sample may shrink the result. No initial metrics command
   may use scale 1 or another larger intermediate scale unless that scale already
   fits every available authority.
6. Geometry shrink is immediate and scale-only. Geometry growth requires two
   matching fit observations separated by the stable trailing interval and an
   unchanged posture/geometry generation. New resize, side-panel, hint, detach,
   navigation, or transition evidence cancels the pending expansion.
7. Post-write physical proof is an acknowledgement fence. If geometry shrinks
   during the CDP command, background performs an immediate scale-only
   correction before returning active; it does not expose success, invalidate
   the complete identity posture, or fall into full reapply churn.
8. Browser-owned/user debugger detach retains the exact held mode and immediately
   reasserts the complete posture with bounded retry. A held desktop posture
   returns desktop; a held mobile posture returns mobile. No stale worker,
   popup cache, poll, refit, or retry may write the opposite or neutral mode.

## 3. Implementation plan

### EL-02-R22-01 — Add independent physical-viewport authority

1. Extend the internal emulation apply/current/refit requests with an optional,
   strict physical viewport hint. The popup sends its actual side-panel
   `documentElement.clientHeight`/`innerHeight`; background accepts the hint only
   as a conservative minimum combined with `tabs.get()`.
2. Centralize normalized viewport sampling and fitted-scale calculation. Initial
   mode transitions take two bounded samples and the last sample immediately
   before metrics mutation can only reduce the chosen scale.
3. Keep the interface internal: no Hub/Lynx endpoint, payload, public extension
   permission, or configuration schema changes.

### EL-02-R22-02 — Persist and reinforce the last proven safe scale

1. Add an optional backward-compatible `fittedScale` to the session posture
   record. Persist it only after exact CDP and physical proof; hydrate it with
   the desired mode and maximum scale.
2. Keep a per-tab safe-scale authority after verified-cache invalidation.
   Same-mode full writes and detach/navigation recovery are capped to it. A mode
   transition retires the old mode's cap and establishes the new one only after
   proof.
3. Update the durable record after every proven scale-only shrink/growth without
   changing the target revision. Preserve epoch/revision fencing around every
   asynchronous storage and CDP boundary.

### EL-02-R22-03 — Fence expansion and correct late shrink without churn

1. Replace the single-delay expansion permission with a captured fitted-scale
   sample plus geometry generation. At the trailing edge, re-sample and expand
   only when the same fit remains current; otherwise reschedule or shrink.
2. Re-sample physical geometry immediately after metrics acknowledgement. If a
   smaller fit is now required, issue one scale-only correction and prove that
   state before active acknowledgement.
3. Distinguish physical-fit movement from loss of identity/touch/media posture.
   Physical movement must stay on the scale-only path; actual debugger loss
   still performs immediate complete held-posture reassertion.

### EL-02-R22-04 — Add regressions and truthful headed evidence

1. Add deterministic tests for stale-large initial samples, popup-height
   intersection, geometry changes between measurement/write/proof, detach with
   a retained safe scale, cold hydration, same-mode navigation, and desktop as
   well as mobile reinforcement.
2. Add fake-timer coverage for repeated resize bursts: immediate shrink, two
   matching trailing observations before growth, generation invalidation, one
   metrics-only final write, and no scale-1/opposite/full-posture frame.
3. Run focused emulation/storage/messaging/popup/startup tests, `pnpm check`,
   `pnpm verify`, production/debug builds, clean P17, and full unchanged-threshold
   P25 acceptance.
4. Review, commit, push, refresh the code graph, and prove exact upstream
   synchronization. Restart repository `live-browser` and run high-cadence
   mobile/desktop, resize, side-panel, reload, cold-worker, and deliberate
   debugger-cancel traces on Acne, Aleris, and 3DPrima `/se`. Record the actual
   physical tab rectangle and authoritative fitted scale for every frame; do not
   use full device-buffer dimensions as a substitute for physical-fit evidence.

## 4. Acceptance criteria

- `EL02-R22-AC-01` Every acknowledged mobile state is 412×960 and every
  acknowledged desktop state is 1920×1080 with both physical-fit inequalities
  true against `tabs.get()` and any fresher popup-height hint.
- `EL02-R22-AC-02` A stale-large first measurement cannot produce an oversized
  first metrics write; no transition or recovery emits a transient scale 1
  unless scale 1 physically fits.
- `EL02-R22-AC-03` The last proven fitted scale survives debugger-cache loss and
  cold-worker hydration. Detach/cancel reasserts the exact held mode at that
  scale or smaller before any later stable expansion.
- `EL02-R22-AC-04` Shrink is immediate. Growth requires two matching observations
  and an unchanged generation, is coalesced to one metrics-only write, and is
  cancelled by newer geometry or posture evidence.
- `EL02-R22-AC-05` Geometry movement after a metrics command is corrected by the
  scale-only path before active acknowledgement; it does not trigger UA, touch,
  media, page-scale, reload, opposite-mode, or neutral-posture churn.
- `EL02-R22-AC-06` Popup creation/recreation, side-panel open/close, browser
  resize, marking/mobile, silent desktop, navigation, render inspection, and
  session teardown preserve one serialized authoritative target.
- `EL02-R22-AC-07` Focused/full/build/P17/P25 gates pass with unchanged thresholds
  and no marking, payload, Preview, consent, reveal, ownership, Save, or
  publication regression.
- `EL02-R22-AC-08` Fresh Acne/Aleris/3DPrima headed traces prove the complete
  device fits throughout transition, resize, reload, and detach recovery, with
  zero AI, Save, takeover, final-publication, release, and deployment attempts.

## 5. Run-plan todo order

1. `el02-r22-viewport-authority` -> 0
2. `el02-r22-durable-safe-scale` -> 1
3. `el02-r22-generation-fence` -> 2
4. `el02-r22-regressions` -> 3
5. `el02-r22-focused-full-gates` -> 4
6. `el02-r22-review-push` -> 5
7. `el02-r22-headed-acne` -> 6
8. `el02-r22-candidate-matrix` -> 7
9. `el02-r22-conformance` -> 8

## 6. Execution evidence and conformance — 2026-09-02

### Source, regressions, and unchanged gates

- Implemented the strict popup physical-height hint, conservative background
  intersection, two-sample/final-sample transition proof, immediate late-shrink
  correction, generation-fenced stable growth, durable proven `fittedScale`,
  and bounded exact-mode debugger reinforcement.
- Focused R22 coverage passed: eight files, 166/166 tests. Runtime coverage
  passed: 37/37 tests. Final `pnpm check` passed.
- The authoritative final `pnpm verify` passed 148/148 files and 1631/1631
  tests, followed by successful production and debug builds, the clean P17
  19/19 matrix, and all seven unchanged-threshold P25 children (P14, P15, P16,
  P17, P18, P20, and P23).
- Review completed on the exact diff. Commit
  `1842e66e54975585a28a846f1d3a2779420013a0` was pushed to
  `origin/re-write`; local and upstream heads were exact before headed
  acceptance. No generated P17/P25 artifact was committed.

### Fresh repository `live-browser` evidence

All three runs used the repository launcher and production bundle. Observers
remained detached from the website target while extension-owned emulation was
active. No AI request, Save, takeover, final Lynx publication, release, or
deployment was attempted.

- **Acne:** the physical tab was 850×705. Mobile settled at 412×960 with scale
  `0.734375`; a 705→455 px physical-height shrink was already corrected on the
  first acknowledged sample to `0.4739583333333333`. Expansion retained the
  smaller safe scale until stable, then returned to `0.734375`. Across 23 mobile
  samples there were zero inactive states and zero active-fit violations.
  Desktop settled at 1920×1080 with scale `0.4427083333333333`; a 850×705→
  570×455 shrink was already corrected on the first acknowledged sample to
  `0.296875`, with stable-only return to `0.4427083333333333`. Across 19 desktop
  samples there were zero inactive states and zero active-fit violations.
  Deliberate debugger detach recovered exact mobile in 132 ms. Page reload and
  a terminated/recreated extension worker both recovered exact mobile at the
  proven safe scale. The Content List retained one projection identity and
  revision across unchanged probes and exposed semantic, keyboard-focusable
  rows.
- **Aleris** `/kirurgi/brack/aderbrack/`: the physical tab was 850×705. Each of
  the 36-sample mobile and 36-sample desktop resize traces had zero inactive
  states and zero fit violations. First shrink acknowledgements were exact at
  mobile `0.4739583333333333` and desktop `0.296875`; both modes remained
  conservatively underscaled during expansion and grew only after stability.
  Deliberate detach recovered exact mobile in 35.3 ms. The 67 semantic Content
  List rows retained one projection identity/revision across three spaced
  probes; an included row accepted native focus/click activation.
- **3DPrima** `/se/3d-skrivare-mer/tillverkare/anycubic`: the physical tab was
  850×705. Each of the 36-sample mobile and 36-sample desktop resize traces had
  zero inactive states and zero fit violations. First shrink acknowledgements
  were exact at mobile `0.4739583333333333` and desktop `0.296875`; growth was
  withheld until stable. Deliberate detach recovered exact mobile in 246.1 ms.
  The 96 semantic Content List rows retained one projection identity/revision
  across three spaced probes; an included row accepted native focus/click
  activation.

### R22 acceptance reconciliation

- `EL02-R22-AC-01` — **PASS.** Exact mode dimensions and both physical-fit
  inequalities held for every acknowledged headed sample.
- `EL02-R22-AC-02` — **PASS.** Deterministic stale/missing/late geometry tests
  prove no oversized initial write; every headed first shrink acknowledgement
  was already exact and no scale-1 transition occurred.
- `EL02-R22-AC-03` — **PASS.** Unit coverage plus Acne reload/cold-worker and all
  three detach traces prove the safe scale and exact held mode survive loss.
- `EL02-R22-AC-04` — **PASS.** Shrink was immediate; expansion remained capped
  until generation-fenced stability, with fake-timer command-log coverage for
  coalescing and cancellation.
- `EL02-R22-AC-05` — **PASS.** Late physical movement stayed on the scale-only
  correction path; command-log tests exclude UA, touch, media, page-scale,
  opposite-mode, and neutral-posture churn.
- `EL02-R22-AC-06` — **PASS.** Focused lifecycle tests, P16/P20/P23, and fresh
  popup, mode-switch, resize, reload, detach, worker-recreation, Preview-exit,
  and launcher-teardown runs preserve one serialized authoritative target.
- `EL02-R22-AC-07` — **PASS.** Every mandatory focused/full/build/P17/P25 gate
  passed at unchanged thresholds.
- `EL02-R22-AC-08` — **PASS.** Acne, Aleris, and 3DPrima headed traces prove
  complete fit through transition, shrink, stable growth, detach, plus Acne
  reload/cold-worker recovery, with zero prohibited egress or deployment.

**R22 verdict: APPROVED.** The observed mobile flicker/clipping divergence is
closed at the extension's acknowledgement boundary. This does not approve the
whole rewrite for production; the expert-loop continues with the remaining
cross-feature findings and a fresh independent audit.

# EL-03-R1 — Separate JavaScript reload from inspection and hard-fence reveal paint

## 1. Goal

Make the Render view and post-Render transition match the approved product
contract exactly: **With JavaScript** performs only an enabled-JavaScript page
reload under the already-held Render-view presentation lease; only **Without
JavaScript** performs a curtain-backed paint inspection. Leaving Render view
then performs the ordinary reveal/lazy-load/freeze ritual before Silent
highlighting can paint. Any already-materialized marking, Silent, or Preview
annotations are physically suppressed for the complete ritual. Preserve the
already-correct consent, Preview, ownership-label, marking, and debugger-device
emulation behavior.

## 2. Entering expert-check evidence and findings

The EL-03 audit ran from synchronized `re-write` commit
`c1f47eec31c1d8f084860ee797445feef8a109d7` with a clean tracked worktree and a
repository `live-browser` production bundle on the Aleris candidate page
`/kirurgi/brack/aderbrack/`.

### `EL-03-F001` — High — With-JavaScript is still a headless paint inspection

- `src/entrypoints/popup/main.tsx:loadRenderModeView()` sends both buttons to
  `renderInspectionController.start()`.
- `src/content/render-inspection-curtain.ts:ensureMounted()` avoids the visible
  curtain for JavaScript-on, but `schedulePaintAcknowledgement()` still runs two
  animation frames (or the one-second fallback), reports inspection lifecycle
  stages, and terminates as `paint-acknowledged`.
- `restoreJavascriptView()` likewise refuses to regard the JavaScript reload as
  restored until that inspection result arrives. Headed evidence showed a
  plain-looking reload, but the popup remained busy for the headless proof.
- This contradicts the locked contract. JavaScript-on is a reload-only view: it
  must not run reveal/freeze, mount a curtain, inspect paint, schedule a paint
  fallback, or activate marking/Silent/Preview annotations. A document-identity
  acknowledgement may retain the durable cross-document Render-view lease, but
  it is not a paint inspection.

### `EL-03-F002` — Medium — reveal owns logical suppression but not a physical annotation lease

- `src/entrypoints/content-loader.content.ts:runActivationStabilization()` sets
  `pageInspectionActive` before reveal and clears it after the terminal cleanup.
  `applySilentSelectors()` and durable Silent adoption correctly refuse new
  presentation while that flag or a pending ritual is active.
- `src/content/marking/overlay.ts` already defines
  `.uf-page-inspection-active` to suppress every annotation layer, but
  `src/content/marking/renderer.ts:setRootState()` cannot set that class and no
  caller drives it. Thus a previously materialized root is protected only by
  control flow; a retained/stale paint can remain visible throughout a renewed
  reveal/freeze ritual.
- The common headed Render-exit path happened to park the surface and painted
  Silent only after preparation, so this is a latent but real lifecycle gap,
  not evidence that the user's rule is optional.

### Audited user-reported cells that currently pass

- Consent suppression is resumed before Render-view suspension and remains
  effective in every tested view. Aleris Cookiebot candidates were hidden,
  non-interactive, and absent from extension presentation.
- `renderPreviewPresentation()` sets Preview presentation and CSS exposes only
  Silent/focus layers; marking layers are hidden. Aleris produced 67 semantic
  button rows, silent-style page annotations, and working list-to-page focus and
  scroll activation.
- Aleris's large expanded exclusion boundary highlighted and toggled at its
  edge with plain click, highlighted/toggled under Ctrl expansion semantics,
  ignored Alt, and treated Shift as inert. Content List headings suspected to
  be descendants were proved to be siblings outside the excluded subtree.
- Stable editable ownership emitted no page banner. Banner projection remains
  limited to non-owner, ownership-loss, and non-candidate states.
- R22 emulation is already present on this exact head: Chrome Debugger is the
  only device authority; held mode and last safe scale are durable; debugger
  cancellation is reasserted; shrink is immediate and stable growth is fenced.
  The prior headed matrix proved the full 412x960 or 1920x1080 screen fit every
  acknowledged frame. EL-03 will re-run that proof because it is a user-visible
  release contract, not because a second emulation rewrite is justified.

No AI request, Save, takeover, final Lynx publication, release, deployment, or
production configuration mutation occurred during EL-03 diagnosis.

## 3. Decisions already made

1. **With JavaScript** enables script execution and reloads the current page.
   It performs no reveal/freeze and no paint inspection. The replacement
   document remains presentation-suspended while Render view is open.
2. **Without JavaScript** retains the durable exact-document curtain, two-frame
   paint proof, guarded one-second starvation fallback, and
   `paint-acknowledged` terminal contract.
3. Leaving Render view first restores JavaScript when necessary, then runs the
   full reveal/lazy-load/freeze preparation, and only after successful
   preparation adopts Silent highlighting.
4. No Marking, Silent, or Preview annotation is visible or interactive inside
   Render view or while reveal/freeze is active. The physical layer lease is
   authoritative even if an annotation root was materialized earlier.
5. Consent elements remain suppressed on every candidate page in every mode.
6. Content List annotations use Silent styling and clickable two-way sync in
   both Silent and Marking entry paths.
7. The page label is absent for a stable owner on a candidate page; it appears
   only for a non-owner, during ownership loss, or on a non-candidate page.
8. Mobile/desktop emulation retains the R22 Chrome Debugger contract: exact
   device dimensions, complete physical fit, durable exact-mode reinforcement,
   immediate safe shrink, and generation-fenced stable growth.

There are no open product or architecture questions.

## 4. Non-goals

- Do not change Hub/Lynx endpoints, AI/configuration payloads, public extension
  permissions, candidate-page rules, consent selector policy, marking decision
  semantics, Preview row semantics, owner-lock authority, or publication gates.
- Do not weaken or replace the JavaScript-off curtain/fallback proof.
- Do not add CSS/page-owned viewport simulation or alter the R22 debugger
  device presets, identity posture, safe-scale persistence, or resize cadence.
- Do not invoke AI, Save, takeover, Lynx publication, release, deployment, or a
  production mutation in automated or headed acceptance.

## 5. Implementation phases

### EL-03-R1-01 — Give JavaScript reload a typed non-paint terminal path

Files and symbols:

- `src/messaging/render-inspection.ts`
- `src/messaging/realms.ts:applicationContract`
- `src/background/render-inspection-runtime.ts`
- `src/background/index.ts:startRewriteBackground`
- `src/content/render-inspection-curtain.ts:createRenderInspectionCurtain`
- `src/entrypoints/content-loader.content.ts:ensureRenderInspectionCurtain`
- `src/entrypoints/popup/main.tsx:restoreJavascriptView`

Steps:

1. Add the terminal reason `reload-acknowledged` and a typed
   `renderInspection.ackReload` document-fenced command. Keep the existing
   durable occurrence, navigation/document identity, deadline, and Render-view
   presentation lease; this is an internal compatibility extension, not a new
   external interface.
2. Add background `acknowledgeReload()` beside `acknowledgePaint()`. It may
   terminalize only the exact adopted occurrence when `javascriptEnabled` is
   true. Conversely, paint acknowledgement must reject a JavaScript-on
   occurrence, and reload acknowledgement must reject a JavaScript-off one.
   Identity mismatch remains `stale`; mode mismatch is a typed stale/rejected
   result and never clears the current occurrence.
3. Extend the content lifecycle controller with an `onReloadReady` callback.
   For JavaScript-on adoption, remove/avoid every curtain node and observer,
   skip animation frames, skip the paint fallback, skip curtain lifecycle
   stages, and invoke reload-ready as soon as the authoritative replacement
   document root is connected. Keep exact identity and deadline fencing.
4. Send `renderInspection.ackReload` through a generation/document-fenced
   content helper and reconcile its exact terminal response just as safely as
   paint acknowledgement.
5. Update `restoreJavascriptView()` to accept only an exact terminal
   JavaScript-on `reload-acknowledged` occurrence (or an already inactive
   JavaScript-on state where restoration is not needed). Static inspection
   success remains `paint-acknowledged`.

Expected intermediate state: the With-JavaScript button still survives reload
and keeps every extraction annotation parked, but creates no inspection curtain,
frame work, or fallback and becomes ready on replacement-document adoption.

Focused validation:

```bash
pnpm vitest run tests/src/content/render-inspection-curtain.test.ts tests/src/background/render-inspection-runtime.test.ts tests/src/background/render-inspection-startup.test.ts tests/src/popup/render-mode-inspection.test.ts tests/src/popup/render-inspection-controller.test.ts tests/src/popup/entrypoint.test.ts tests/c4-content-entrypoint.test.ts
```

Fallback rule: do not remove the durable occurrence to make the test green; if
the replacement document can paint extraction annotations before Render exit,
retain the occurrence and repair the reload-ready identity handshake.

### EL-03-R1-02 — Drive the physical reveal annotation-suspension lease

Files and symbols:

- `src/content/marking/renderer.ts:setRootState`
- `src/content/marking/engine.ts:AuthoritativeMarkingEngine`
- `src/entrypoints/content-loader.content.ts:renderContentSurface`
- `src/content/marking/overlay.ts`

Steps:

1. Add a narrow renderer/engine operation that toggles
   `uf-page-inspection-active` on the existing trusted overlay root without
   rebuilding rows, selectors, targets, geometry, or the paint index.
2. Reconcile that operation from the authoritative physical-ritual state:
   `pageInspectionActive || pageWorldCleanupFenceNonce !== "" ||
   renderModeViewActive`. Set it before any reveal movement and retain it
   through failure cleanup; clear it only after the exact cleanup fence is gone
   and Render view has exited.
3. Keep Preview presentation and scroll fade classes orthogonal. Page
   inspection wins visually over all Marking, Silent, Preview, hover, focus, and
   interaction layers, and none of those layers becomes pointer-active under
   the curtain.
4. Ensure creating or reusing an engine while the ritual flag is held adopts
   the physical suppression state immediately, so no late materialization can
   flash one annotation frame.

Expected intermediate state: logical guards still prevent new Silent adoption,
and every retained/new annotation root is physically invisible for the full
reveal/freeze/cleanup interval without a geometry rebuild.

Focused validation:

```bash
pnpm vitest run tests/src/content/marking/marking.test.ts tests/src/content/marking/dom-bridge.test.ts tests/c4-content-entrypoint.test.ts tests/p23-frozen-presentation-contract.test.ts
```

Fallback rule: if adding the class causes overlay reconstruction or changes
marking decisions, stop and expose only a root-state setter; do not route this
through `renderMarking()` or `renderSilentHighlights()`.

### EL-03-R1-03 — Pin the reported behavior matrix with regressions

Files:

- the focused test files above
- `tests/src/popup/app.test.ts`
- `tests/src/background/render-emulation-runtime.test.ts`
- `tests/p25-live-probes.test.ts` only if an existing assertion needs the new
  reload terminal reason

Cases:

1. JavaScript-on adoption emits exactly one reload acknowledgement and zero
   curtain, `requestAnimationFrame`, paint-fallback, `ackPaint`, reveal, freeze,
   marking, Silent, or Preview action.
2. JavaScript-off still requires the mounted last-root full-viewport curtain,
   two frames or the guarded fallback, and exact `paint-acknowledged` terminal.
3. Stale/mismatched reload acknowledgements cannot terminalize a newer
   generation; JS-on cannot use paint ACK and JS-off cannot use reload ACK.
4. Render exit orders `preparePageVisit` completion before one Silent selector
   application. Failure retains Render-view suspension and paints no partial
   Silent surface.
5. A pre-existing Marking, Silent, and Preview root receives the inspection
   class before reveal movement, stays hidden through freeze and cleanup retry,
   and clears once after successful cleanup; selector/row/geometry render counts
   remain unchanged by the toggle.
6. Consent remains active for JS-on, JS-off, reveal, Marking, Silent, and
   Preview paths. Stable-owner candidate banner remains absent; the three
   sanctioned banner states remain covered.
7. Preview from either entry path keeps semantic buttons, Silent-style page
   annotations, and bidirectional activation. Aleris expanded exclusion
   descendants remain omitted from Preview unless they independently qualify.
8. R22 tests retain exact mobile/desktop dimensions, physical-fit inequalities,
   detach reinforcement, immediate shrink, and stable-only growth.

Focused validation is the union of Phase 1/2 commands plus:

```bash
pnpm vitest run tests/src/popup/app.test.ts tests/src/background/render-emulation-runtime.test.ts
```

### EL-03-R1-04 — Full gates, publication, and headed acceptance

1. Run focused tests, `pnpm check`, authoritative `pnpm verify`, production and
   debug builds, clean P17, and the full unchanged-threshold P25 composite.
2. Review the exact diff, update `.copilot/knowledge.md` with the reusable split
   reload/inspection and physical reveal-paint contracts, commit only intended
   source/tests/docs, push `re-write` without force, refresh the graph, and prove
   exact local/upstream synchronization.
3. Restart repository `live-browser` on Aleris and at least Acne plus 3DPrima
   `/se`. Run With-JavaScript and Without-JavaScript separately. Record command,
   curtain, overlay-root, lifecycle, scroll, freeze, consent, banner, Preview,
   and console/network observations at high cadence.
4. Exit Render view and prove visible reveal/freeze completes before Silent
   annotations appear. Repeat from a pre-materialized Silent/Preview root and
   require zero annotation visibility during the ritual.
5. Recheck Aleris expanded boundary plain/Ctrl/Alt/Shift behavior, semantic
   Content List two-way sync, stable-owner label absence, and consent hiding.
6. Re-run R22 mobile/desktop posture, physical fit, resize, and deliberate
   debugger-cancel recovery on the same exact build. Observers must remain
   detached from the target while extension-owned emulation is active.

## 6. Test matrix

| Layer | Required proof |
|---|---|
| Schema/messaging | `ackReload` is exact-document typed; incompatible mode ACKs fail closed |
| Background | durable JS reload terminalizes as `reload-acknowledged`; static paint proof is unchanged |
| Content unit | JS-on schedules no paint machinery; physical reveal class toggles without redraw |
| Popup | With-JavaScript/restoration uses reload result; Render exit remains prepare-then-Silent |
| Integration | replacement-document suspension, consent, stale generations, cleanup retry, no overlay flash |
| Full repository | `pnpm check`, `pnpm verify`, production/debug build, P17, complete P25 |
| Headed candidate | Aleris/Acne/3DPrima Render, reveal, Preview, consent, banner, marking, emulation, console/network |

## 7. Regression risks and protections

- **Cross-document annotation flash:** removing the durable session entirely
  would let the replacement document start normal presentation. Retain the
  durable Render-view lease and change only its JS-on completion proof.
- **Static inspection weakening:** mode-gate both ACK handlers and retain every
  curtain coverage/fallback assertion for JS-off.
- **Stuck Render exit:** reconcile reload terminal identity before preparation;
  every failure remains visible and retains suspension instead of partially
  exiting.
- **Overlay rebuild/performance:** the reveal lease changes one root class only;
  regression tests pin zero row/geometry rebuild.
- **Consent/ownership drift:** keep those existing authorities untouched and
  re-run their live/source cells.
- **Device flicker regression:** do not modify R22 code without contradictory
  evidence; repeat its high-cadence fit/cancel proof on the final build.

## 8. Acceptance criteria

- `EL03-R1-AC-01` With-JavaScript produces one enabled-JavaScript reload and an
  exact `reload-acknowledged` document terminal, with zero reveal/freeze,
  curtain, animation-frame paint proof, fallback, or annotation activation.
- `EL03-R1-AC-02` Without-JavaScript still ends only through exact
  `paint-acknowledged` proof from the full-viewport visible interactive curtain,
  using normal frames or the guarded starvation fallback.
- `EL03-R1-AC-03` No incompatible/stale ACK can clear or terminalize the current
  generation, and every failure/cancellation/restoration path leaves scripts on
  and presentation state truthful.
- `EL03-R1-AC-04` Leaving Render view completes reveal/lazy-load/freeze and
  cleanup before the first Silent annotation appears. Any retained/new Marking,
  Silent, Preview, hover, focus, or interaction layer is physically hidden for
  the complete ritual and restored exactly once afterward.
- `EL03-R1-AC-05` Consent is hidden in every mode; Content List annotations use
  Silent styling and bidirectional semantic-button sync; stable owners on
  candidate pages see no label; sanctioned banner states remain intact.
- `EL03-R1-AC-06` Aleris expanded exclusions preserve approved plain/Ctrl/Alt
  behavior with Shift/Meta inert, and Preview does not fabricate inclusion rows
  beneath exclusion coverage.
- `EL03-R1-AC-07` R22 emulation remains exact and physically fitted on every
  acknowledged mobile/desktop frame; resize cannot clip, and deliberate
  debugger cancellation immediately reinforces the held mode at a safe scale.
- `EL03-R1-AC-08` Focused/full/build/P17/P25 gates pass on the exact pushed
  source with no AI, Save, takeover, final publication, release, deployment, or
  production mutation.
- `EL03-R1-AC-09` The final commit is pushed and synchronized; an independent
  criterion-by-criterion conformance audit approves every acceptance criterion
  before EL-04 begins.

## 9. Todo chain

1. `el03-r1-reload-contract` -> 0
2. `el03-r1-reveal-paint-lease` -> 1
3. `el03-r1-regression-matrix` -> 2
4. `el03-r1-focused-full-gates` -> 3
5. `el03-r1-review-push` -> 4
6. `el03-r1-headed-aleris` -> 5
7. `el03-r1-headed-candidate-matrix` -> 6
8. `el03-r1-conformance` -> 7

# EL-03-R2 — Make slow Render restoration and exit preparation authoritative

## 1. Goal

Remove the slow-replacement race found by the R1 headed acceptance pass. A
valid JavaScript-on replacement must not be abandoned by a popup watchdog
before the durable background occurrence reaches its own terminal deadline,
and Render exit must not ask for reveal/freeze until the exact replacement
document has recovered the same property and editor authority. The successful
path remains restore JavaScript, reveal/lazy-load/freeze, then one Silent
projection; every failed or stale path remains presentation-suspended in the
Render view with a visible reason.

## 2. Entering expert-check evidence

The exact pushed production build at
`0a693e28a3a64a7342109270d66ddd566ebf2cd0` passed the R1 automated matrix and
the primary Aleris contracts. The fresh headed Acne candidate then exposed two
connected release blockers.

### `EL-03-F003` — Critical — popup watchdog expires before durable authority

- `src/background/render-inspection-runtime.ts` gives the authoritative
  occurrence 30 seconds to terminalize.
- `src/popup/render-mode-inspection.ts` gives the popup observer only 20
  seconds. `createPopupRenderInspectionController.start()` races the entire
  start-and-poll transaction against that shorter timer, publishes “The page
  reload timed out,” invalidates its local observer epoch, and returns while
  the background occurrence is still legitimate.
- On Acne, JavaScript restoration later reached the exact replacement document
  and the page was complete at 412x960, but `restoreJavascriptView()` had
  already inspected the abandoned local projection and returned false. Render
  mode stayed open and the exit ritual never began.
- A presentation observer must never declare a durable occurrence timed out
  before the durable authority can do so.

### `EL-03-F004` — High — Render exit can outrun replacement property authority

- `preparePageAfterRenderMode()` sends `preparePageVisit` immediately after
  JavaScript reload confirmation. The replacement content script can already
  acknowledge document identity while its property/lock authority is still
  being re-established.
- `preparePageVisit` correctly refuses reveal/freeze while
  `interactionShieldAuthorityActive` is false, but the popup performs no
  exact-binding readiness wait or retry. It therefore leaves Render mode open
  after a transient `property-authority-unavailable`/receiver gap even when the
  same replacement document becomes authoritative moments later.
- Headed status after the failed exit showed `renderModeViewActive: true`,
  `ritual: null`, zero scroll movement, zero annotations, and a complete page.
  Sending the same typed preparation after authority recovery succeeded with
  `lazyExpansions: 1`, `frozenAtBottom: true`, document height growth from
  11,489 to 12,359 px, and scroll restoration to 0. The next ordinary Cancel
  then projected Silent and exited. The reveal engine is not the cause; the
  popup handoff is.

### `EL-03-F005` — Critical — a silently lost debugger lease leaves a clipped hybrid viewport

- The emulation runtime reinforces a delivered `chrome.debugger.onDetach`
  event and checks `debugger.getTargets()` inside explicit `current`/`refit`
  operations. It has no standing attachment reconciliation while a posture is
  held. Chromium also does not deliver `onDetach` when the extension-side
  debugger session is silently dropped, a case the source comments acknowledge.
- Fresh repository `live-browser` evidence reproduced the missing path on
  Aleris. Before the drop, mobile was exact: attached, 412x960 layout/screen/
  visual viewport, DPR 1, and fitted scale `0.734375` inside an 850x705 physical
  tab. After a silent detach, storage still held that exact mobile target, but
  the page remained detached for more than 2.5 seconds with desktop screen
  metrics 1920x1080, DPR 2, and only a 397x945 visual viewport. The bottom and
  right edges were therefore no longer represented by the active visual
  viewport even though the stale layout dimensions still said 412x960.
- Idle authority polling did not recover the debugger. A later explicit mode
  transition reattached and restored exact mobile, proving the durable target
  and CDP writer are sound; the missing component is continuous ownership and
  physical-fit enforcement.
- This reopens the prior R22 headed approval. Exact settled samples and
  event-delivered detach tests did not cover a silent ownership loss, so they
  could not justify the stronger product claim that the complete device stays
  visible continuously.

### Retained passing evidence

- JavaScript-on produced zero curtain or annotation nodes on Aleris and Acne.
- JavaScript-off retained its exact `paint-acknowledged` path.
- Aleris Preview exposed 67 semantic buttons, Silent-style annotations, and
  working list-to-page plus page-to-list focus.
- The Aleris broad exclusion painted and highlighted at its literal boundary;
  plain click removed it and rehydrated defaults. The remaining modifier sample
  was correctly rejected when Hub authority went unavailable rather than being
  misreported as product evidence.
- Consent remained hidden and stable owners had no page label.
- Aleris and Acne held exact 412x960 mobile geometry. Acne transitioned through
  durable revisions mobile 1 -> desktop 2 -> mobile 3; desktop was exact
  1920x1080 at fitted scale 0.4427083 and mobile at 0.734375. Deliberate debugger
  detach recovered both modes without an opposite-mode terminal frame.
- No AI, Save, takeover, Lynx publication, release, deployment, or production
  mutation occurred.

## 3. Decisions

1. Define one shared durable inspection timeout. The popup observer watchdog
   must exceed it by a bounded grace interval; background authority remains the
   only source of terminal truth.
2. A popup watchdog may release controls and report a problem, but
   `restoreJavascriptView()` may proceed only after re-observing an exact
   JavaScript-on `reload-acknowledged` terminal. It may never infer success from
   elapsed time, page appearance, or an inactive record that contradicts the
   held replacement identity.
3. Before `preparePageVisit`, wait for `getContentMainStatus` on the same tab,
   normalized URL, environment, site, and unblocked editor authority. Fence the
   wait on the captured binding occurrence.
4. Treat a missing receiver and `property-authority-unavailable` during the
   bounded replacement bootstrap as retryable. Consent failure, navigation,
   property change, explicit lock blocking, ritual failure, or an expired
   readiness deadline remains terminal and keeps Render presentation parked.
5. Invoke the expensive ritual once after readiness. Silent projection remains
   strictly after a successful preparation response and never runs during the
   readiness wait or reveal/freeze.
6. Treat mobile/desktop emulation as a standing debugger lease, not a completed
   command. While a posture is held, a browser-owned watchdog must verify
   attachment without scheduling page-main-thread work. A silent loss triggers
   one serialized reassertion of the exact held mode at the last proven safe
   fitted scale; delivered detach remains the immediate path.
7. The same watchdog may read browser-owned tab geometry and request an
   immediate scale-only shrink when the proven device no longer physically
   fits. It may not opportunistically grow, rewrite an already exact posture,
   change modes, clear emulation, or run a page proof on every tick. Intentional
   `clear()`/tab removal cancels the watchdog before debugger release.

There are no open product or architecture questions.

## 4. Implementation phases

### EL-03-R2-01 — Align popup observation with durable inspection authority

Files:

- `src/messaging/render-inspection.ts`
- `src/background/render-inspection-runtime.ts`
- `src/popup/render-mode-inspection.ts`
- `src/popup/render-inspection-controller.ts`
- focused controller/inspection tests

Steps:

1. Move the 30-second durable occurrence duration to the shared internal
   render-inspection contract while preserving the background export used by
   existing tests.
2. Derive the popup watchdog from that duration plus explicit grace. Pin the
   invariant in tests so a future edit cannot make the observer shorter than
   the authority again.
3. Add a delayed replacement regression whose exact reload terminal arrives
   after 20 seconds but before the durable deadline. It must remain busy,
   adopt `reload-acknowledged`, and never publish the timeout detail.
4. Preserve bounded fail-open behavior for a genuinely hung port or a durable
   timeout terminal; do not turn the watcher into an unbounded wait.

### EL-03-R2-02 — Fence Render-exit preparation on replacement authority

Files:

- `src/popup/emulation-reload-transition.ts` or a narrowly named shared
  replacement-readiness helper
- `src/entrypoints/popup/main.tsx:preparePageAfterRenderMode`
- focused helper and popup entrypoint tests

Steps:

1. Reuse the exact normalized tab/URL/property readiness predicate already
   proven for replacement-document emulation transitions.
2. Capture the current binding and expected managed property, poll typed
   `getContentMainStatus` through the single content-message wrapper, and
   proceed only when environment/site match and `lockBlocked === false`.
3. If the receiver or property authority is transiently unavailable, retry
   inside one bounded readiness occurrence. Abort immediately on binding or
   identity change. Emit one reason-specific warning on terminal failure.
4. Send one `preparePageVisit` after readiness. If the narrow authority race is
   still reported, perform one trailing readiness reconciliation before the
   deadline; never overlap or duplicate a running ritual.
5. Retain the Render-view physical no-annotation lease until preparation and
   Silent acknowledgement both succeed.

### EL-03-R2-03 — Enforce the debugger posture as a continuous lease

Files:

- `src/background/render-emulation-runtime.ts`
- focused runtime/startup/emulation tests

Steps:

1. Add one bounded per-tab browser-ownership watchdog for every hydrated or
   newly held posture. Coalesce it with the existing per-tab operation queue and
   cancel it on release/removal before any intentional detach.
2. Probe `debugger.getTargets()` and physical `tabs.get()` geometry only. A
   missing attachment immediately invalidates stale proof and reasserts the
   exact held mode at its safe fitted scale; a physical-fit violation performs
   an immediate scale-only shrink. Exact attached posture is a read-only tick.
3. Retain the existing bounded ownership-conflict retry and durable target.
   Never allow the watchdog, popup cache, navigation, or refit work to install
   an opposite/neutral posture or an oversized scale.
4. Pin the live failure: silently drop attachment without firing `onDetach`,
   leave the tab idle, and require autonomous exact recovery. Also cover normal
   delivered detach, desktop recovery, clear/remove cancellation, concurrent
   transitions, physical shrink, exact idle command quiescence, and timer
   cleanup.

### EL-03-R2-04 — Regression, full gates, and headed revalidation

1. Add entrypoint regressions for slow reload success, transient replacement
   authority, no-receiver recovery, binding change, terminal preparation
   failure, one ritual, and prepare-before-Silent ordering.
2. Re-run the complete R1 focused matrix, `pnpm check`, `pnpm verify`,
   production/debug builds, clean P17, and the full unchanged-threshold P25.
3. Review, commit, push `re-write`, refresh the graph, and prove exact upstream
   synchronization.
4. Repeat Aleris, Acne, and 3DPrima `/se` with repository `live-browser`.
   Require first-attempt Render exit after static inspection, bottom proof,
   scroll restoration, zero annotation paint during the ritual, then Silent.
5. Re-run Content List two-way sync, consent/banner checks, exact mobile and
   desktop fit, transition revisions, delivered debugger-detach recovery, and
   the newly pinned silent-detach recovery without any operator follow-up.

## 5. Acceptance criteria

- `EL03-R2-AC-01` The popup watchdog is strictly longer than the durable
  inspection deadline and a terminal arriving between the former 20-second
  boundary and 30 seconds is adopted without a timeout warning.
- `EL03-R2-AC-02` A genuine durable timeout, hung port, stale generation, or
  identity change remains bounded, visible, fail-open for JavaScript, and
  presentation-suspended in Render view.
- `EL03-R2-AC-03` Render exit waits for the exact replacement tab/URL/property
  editor authority and recovers a transient no-receiver or authority gap
  without operator retry.
- `EL03-R2-AC-04` Exactly one reveal/lazy-load/freeze ritual runs after
  readiness, reaches/freeze-proves the bottom, restores the starting scroll,
  and completes before one Silent selector projection.
- `EL03-R2-AC-05` Consent remains hidden and every Marking, Silent, Preview,
  hover, focus, and interaction annotation remains physically absent during
  Render view, readiness waiting, and the entire ritual.
- `EL03-R2-AC-06` Existing Aleris marking/Preview contracts and R22 exact fitted
  412x960/1920x1080 posture, resize fencing, and detach reinforcement remain
  unchanged.
- `EL03-R2-AC-07` Focused/full/build/P17/P25 gates and fresh Aleris/Acne/
  3DPrima headed evidence pass on the exact pushed commit with zero prohibited
  egress or production mutation.
- `EL03-R2-AC-08` An independent cumulative EL-03 audit approves every R1/R2
  criterion before the next outer expert-check iteration.
- `EL03-R2-AC-09` A silently lost debugger attachment is detected and repaired
  autonomously while idle. Mobile returns to exact 412x960 and desktop to exact
  1920x1080 at the last safe fitted scale or smaller; clear/removal never
  resurrects a released posture, and an exact idle lease emits no CDP writes.

## 6. Todo chain

1. `el03-r2-durable-watchdog` -> 0
2. `el03-r2-exit-authority` -> 1
3. `el03-r2-emulation-lease` -> 2
4. `el03-r2-regression-matrix` -> 3
5. `el03-r2-focused-full-gates` -> 4
6. `el03-r2-review-push` -> 5
7. `el03-r2-headed-matrix` -> 6
8. `el03-r2-conformance` -> 7

# EL-03-R3 — Make ordinary Silent highlighting a single presentation vocabulary

## 1. Goal

Remove the ordinary-Silent double paint discovered during the exact R2 headed
acceptance run. Silent mode must expose only its three approved dashed layers —
immutable, content, and excluded — even while the engine retains and refreshes
classification geometry for allocation-free restoration. Content List keeps the
same Silent vocabulary plus its focus layer; Marking and AI comparison remain
unchanged. Preserve the now-passing Render and continuous debugger-emulation
contracts.

## 2. Entering evidence and finding

The exact pushed R2 production build at
`49594d49bba236cca7dbed7c8a7726434bb952e5` passed the full automated matrix and
the high-cadence Aleris Render/emulation checks:

- mobile settled at exact 412x960 and physically fit 960 CSS px into the 705 px
  tab height at scale 0.734375;
- desktop settled at exact 1920x1080 and fully fit the tab;
- a silent debugger detach autonomously recovered exact mobile in about 149 ms,
  while delivered detach retains the immediate event path;
- a physical shrink applied a conservative safe scale before acknowledgement,
  and growth waited for the stable trailing fence;
- Chrome emitted one intermediate compositor sample while replacing metrics,
  but the retained overlay root was already opacity-zero and the final
  acknowledged frame was exact and unclipped.

### `EL-03-F006` — High — ordinary Silent paints retained Marking classifications

- Headed Aleris evidence after exiting Content List showed the ordinary root
  without `uf-preview-presentation`. Its hard/default/saved/session layers and
  its Silent layers all had opacity 1.
- A captured visible frame showed solid mutable/exclusion borders underneath
  the dashed Silent selector borders. Content List did not reproduce the defect
  because `.uf-preview-presentation` already hides classification layers.
- `renderCurrent()` and progressive/branch maintenance intentionally retain and
  refresh classification nodes even when `interactiveMarkingRendered` is false.
  This is a performance optimization, not presentation authority.
- `renderSilent()` paints Silent rows but sets no root presentation state. The
  approved contract names exactly three ordinary-Silent layers, so retained
  classifications must remain allocated but must not paint.

No AI request, Save, takeover, Lynx publication, release, deployment, or
production mutation occurred during this diagnosis.

## 3. Decisions and non-goals

1. Add a distinct `uf-silent-presentation` root state. It controls paint only;
   unlike Preview it does not change Preview hit routing or focus semantics.
2. Ordinary Silent hides hard/default/saved/AI/session/hover/interaction/focus
   layers and exposes only `silent-immutable`, `silent-content`, and
   `silent-excluded`.
3. Content List continues to use `uf-preview-presentation`; a Preview opened
   from Silent may carry both classes, with Preview retaining focus visibility.
4. Marking and explicit read-only/AI-comparison rendering clear the ordinary
   Silent state before classification paint. Silent overlays deliberately armed
   over an interactive comparison do not hide the comparison classifications.
5. Classification nodes and geometry stay retained. Do not clear, recreate, or
   re-evaluate them merely to switch presentation.
6. Do not change marking decisions, selector seeding, payloads, consent,
   candidate rules, interaction shielding, Preview projection/routing, Render,
   emulation, backend interfaces, or public permissions.

## 4. Implementation phases

### EL-03-R3-01 — Add the orthogonal ordinary-Silent presentation state

Files:

- `src/content/marking/overlay.ts`
- `src/content/marking/renderer.ts`
- `src/content/marking/engine.ts`

Steps:

1. Add `uf-silent-presentation` to the overlay grammar and renderer root-state
   union, plus a renderer setter that only toggles the root class and retires
   transient hover/acknowledgement paint when entering.
2. Add CSS that hides every non-Silent layer under ordinary Silent. Keep the
   three Silent layers visible and unfiltered. Preview rules remain later/more
   specific so focus is visible in Content List, and page-inspection precedence
   remains final and absolute.
3. Have `renderSilent()` reconcile the class from
   `!interactiveMarkingRendered`. Have `renderMarking()` and `renderReadOnly()`
   clear it before classification rendering. Preview retirement re-enters the
   correct origin presentation through the existing retained-state path.
4. Reset renderer-local Silent presentation state on disposal while retaining
   classification DOM during ordinary mode switches.

### EL-03-R3-02 — Pin presentation and restoration regressions

Files:

- `tests/src/content/marking/marking.test.ts`
- `tests/src/content/marking/dom-bridge.test.ts`
- any directly affected P17/P23 source-contract test

Cases:

1. The overlay grammar includes `uf-silent-presentation`; its CSS exposes only
   the three Silent layers, gives Preview focus precedence, and leaves
   page-inspection suppression last.
2. Ordinary `renderSilentHighlights()` sets Silent presentation without
   clearing retained classification nodes; later structural/geometry work does
   not remove the class.
3. Entering Marking clears Silent presentation before paint and restores the
   retained interactive vocabulary without rebuilding the bridge.
4. Silent -> Content List -> Silent preserves Silent-only presentation and focus
   behavior. Marking -> Content List -> Marking never adopts ordinary Silent.
5. An intentionally interactive comparison with Silent overlays keeps its
   classification layers visible.

Focused validation:

```bash
pnpm vitest run tests/src/content/marking/marking.test.ts tests/src/content/marking/dom-bridge.test.ts tests/src/content/preview-controller.test.ts tests/p17-browser-preview-contract.test.ts tests/p23-frozen-presentation-contract.test.ts
```

### EL-03-R3-03 — Full gates, publication, and headed conformance

1. Run focused tests, `pnpm check`, authoritative `pnpm verify`, production and
   debug builds, clean P17, and the full unchanged-threshold P25 composite.
2. Review the exact diff until clean, update durable knowledge with the
   retained-DOM/presentation distinction, commit intended files only, push
   `re-write` without force, refresh the graph, and prove 0/0 synchronization.
3. Re-run repository `live-browser` on Aleris, Acne, and 3DPrima `/se`.
   Ordinary Silent must show dashed-only presentation; Content List must remain
   Silent-style and bidirectional from both origins; Marking must restore
   immediately and retain scroll/resize fade behavior.
4. Recheck With-JavaScript, Without-JavaScript, Render exit ordering, consent,
   stable-owner label absence, exact 412x960/1920x1080 geometry, full physical
   fit, resize, and debugger-detach reinforcement on the exact pushed build.

## 5. Acceptance criteria

- `EL03-R3-AC-01` Ordinary Silent paints only `silent-immutable`,
  `silent-content`, and `silent-excluded`; every retained classification,
  hover, focus, and interaction layer is physically non-painting.
- `EL03-R3-AC-02` The mode switch changes root presentation only: retained
  classification nodes, semantic decisions, bridge identity, geometry cache,
  and paint index are not rebuilt or discarded.
- `EL03-R3-AC-03` Content List remains Silent-style and bidirectional from both
  Silent and Marking, with focus visible; exit restores the exact origin mode.
- `EL03-R3-AC-04` Marking and interactive comparison retain their approved
  classifications and latency, including immediate hover/toggle response and
  shared scroll/resize fade.
- `EL03-R3-AC-05` R1/R2 Render, consent, ownership-label, exact emulation,
  complete physical fit, resize, and detach-reinforcement criteria remain green.
- `EL03-R3-AC-06` Focused/full/build/P17/P25 gates and the three-property headed
  matrix pass on the exact pushed commit with zero prohibited mutation.
- `EL03-R3-AC-07` An independent cumulative EL-03 conformance audit approves
  R1-R3 before the next outer expert-check iteration.

## 6. Todo chain

1. `el03-r3-silent-presentation` -> 0
2. `el03-r3-regressions` -> 1
3. `el03-r3-full-gates` -> 2
4. `el03-r3-review-push` -> 3
5. `el03-r3-headed-conformance` -> 4

# EL-03-R4 — Make held device emulation physically atomic and continuously fitted

## 1. Goal

Eliminate every exposed intermediate, detached, stale-scale, or physically
clipped device frame while preserving Chrome debugger device emulation as the
sole viewport authority. Mobile must continuously hold the intended 412x960
device and desktop the intended 1920x1080 device, scaled so the complete device
screen fits inside the user's actually visible tab viewport. If Chrome or the
user drops the debugger posture, immediately reassert the currently intended
mobile or desktop mode. A page frame may become visible only after exact
document identity, layout, input/media identity, page scale, and physical-fit
proof all agree.

## 2. Entering evidence and root cause

The exact pushed R3 build at
`ccc423d366c55d2cbfae2b3a20dc6768a404892d` settles correctly, but a repository
`live-browser` Aleris run exposed three user-visible atomicity gaps:

- desktop-to-mobile briefly reported 412x960 screen/layout dimensions while
  `visualViewport` was only about 401.95x936.59 at scale 1.025; exact 412x960 at
  scale 1 arrived roughly 18–37 ms later. In that frame the bottom 23.4 CSS px
  of the intended device were not visible;
- shrinking the 1280x900 browser window to height 650 reduced the page tab from
  705 to 455 physical px about 10.7 ms before the fitted compositor scale moved
  from 0.734375 to 0.473958. The former scale physically required 705 px and
  was therefore clipped during the gap;
- a silent debugger detach exposed a distorted 397x945 visual viewport for
  roughly 75 ms before the 250 ms lease backstop reattached and re-proved exact
  412x960.

The final held state remained correct and the durable mode record remained
mobile. Direct CDP trials proved that command reordering, explicit
`screenWidth`/`screenHeight`, positions, and the experimental viewport override
do not remove Chrome's inserted 1.025 compositor/meta-viewport frame. The
existing marking root does fade out on resize, but the page remains visible,
and annotation restoration currently remains hidden for about two seconds then
fades for roughly another second. This is presentation latency, not proof.

No AI request, Save, takeover, Lynx publication, deployment, backend write, or
production mutation occurred during this diagnosis.

## 3. Decisions and non-goals

1. Keep `chrome.debugger`/CDP device metrics, touch, media, UA, durable held
   posture, generation fencing, and exact proof as the emulation authority. Do
   not replace it with CSS transforms, responsive-window resizing, or a second
   viewport implementation.
2. Add a pre-mounted content-side emulation transition guardian. An explicit
   transition must make the guardian fully opaque, interactive, full-viewport,
   last in the document root, and paint-proven before the first visible CDP
   write. While a posture is held, synchronous `resize` and `visualViewport`
   listeners arm the already-composited guardian before an unexpected geometry
   frame can paint.
3. Chrome's unavoidable intermediate geometry may exist internally, but no
   mismatched or physically clipped **page-content frame** may be exposed. The
   guardian releases only for the matching lifecycle generation after the
   background proves the complete intended posture and physical fit and the
   content side observes two matching presentation frames.
4. Requested transitions use a short deliberate fade into the guardian and a
   short fade out after proof. Unexpected detach/shrink safety activates
   immediately. Do not show a spinner for sub-second geometry repair and do not
   reuse Render inspection or reveal/freeze presentation semantics.
5. Keep the posture armed after settlement while leaving the guardian
   non-painting and non-interactive. Clear removes both debugger posture and
   guardian authority. Stale generations, released sessions, hidden documents,
   missing receivers, and terminal failures must never release a newer guard.
6. Reassert the durable intended mode. A user cancellation while desktop is
   intended restores desktop; while mobile is intended it restores mobile.
   Never infer a generic mobile fallback from marking state or a detached
   debugger.
7. A physical resize may retain a smaller already-safe scale while growth
   settles, but shrink is corrected immediately. Page content is released only
   when `deviceWidth * fittedScale <= visibleTabWidth` and
   `deviceHeight * fittedScale <= visibleTabHeight`; the complete bottom and
   right edges must be visible.
8. The desktop-preview control represents confirmed state, exposes a bounded
   busy transition, and rolls back on failure. It must not claim a new mode
   before exact proof or persist a failed request.
9. This cycle does not change marking decisions, selector/payload contracts,
   consent, Render modes, backend/public APIs, extension permissions, or device
   dimensions.

## 4. Implementation phases

### EL-03-R4-01 — Add the retained transition guardian and lifecycle contract

Files:

- a focused content module under `src/content/`
- `src/entrypoints/content-loader.content.ts`
- internal message/lifecycle types in the existing emulation or messaging seam
- focused content tests

Steps:

1. Implement one allocation-stable guardian root with hostile-page-resistant
   fixed/full-viewport/max-z presentation, no page-derived content, and explicit
   `idle`, `guarding`, `settling`, and `released` states.
2. `begin(generation, mode, cause)` mounts/moves it last, suppresses every
   extension annotation plane, blocks page input, and acknowledges only after
   two frames prove visible opaque coverage. Hidden documents wait for
   `visibilitychange`; a bounded inability to prove coverage reports failure
   without pretending the transition is safe.
3. While a mode remains armed, window and visual-viewport resize listeners
   synchronously enter safety presentation. They never activate when no posture
   is held.
4. `settle` accepts only the current generation/mode, checks exact 412x960 or
   1920x1080 layout and visual scale 1, refreshes interaction/annotation
   geometry while still covered, waits two matching frames, then smoothly
   retires paint and input capture. `release` invalidates all generations and
   removes listeners/root state.
5. Expose debug-only lifecycle evidence (generation, cause, stage, measured
   geometry, coverage result) for frame-level browser gates without adding a
   production UI or network surface.

### EL-03-R4-02 — Couple every debugger mutation to proof-owned presentation

Files:

- `src/background/render-emulation-runtime.ts`
- `src/background/index.ts`
- `src/content/stabilization/emulation.ts` only if the typed CDP boundary needs
  a lifecycle hook
- storage/message contracts and background tests

Steps:

1. Add an injected, best-effort content-presentation delivery seam returning
   typed `ready`, `no_receiver`, or `failed` outcomes. Expected missing receivers
   remain consumed; a present receiver's rejected coverage is debug evidence
   and may not be treated as a guarded write.
2. Give each held posture a monotonic presentation generation. Explicit apply,
   reassert, mode restore, actual scale-only refit, and clear bracket their first
   and last visible debugger mutations with matching begin/settle/release
   notifications. Retry and rollback paths either settle a proven restored
   posture or retain safety coverage; all terminal cleanup lives in `finally`
   paths.
3. Make window-bound changes signal transition intent before queued measurement.
   If the old fitted posture still fits, settle it immediately and keep growth
   generation-fenced; if it no longer fits, take the immediate scale-only shrink
   path and release only after fresh physical proof.
4. Reduce the browser-only silent-attachment watchdog interval from 250 ms to a
   low-overhead 50 ms while keeping delivered `debugger.onDetach` immediate and
   the exact idle path write-free. Both paths reassert the retained mode.
5. Keep final physical proof authoritative and conservative across tab viewport,
   non-emulated panel height hint, late shrink correction, navigation, worker
   restart, and concurrent transition invalidation.

### EL-03-R4-03 — Make popup state and annotation restoration transactional

Files:

- `src/entrypoints/popup/main.tsx`
- `src/content/marking/engine.ts` and/or its geometry scheduler
- focused popup and marking tests

Steps:

1. Treat desktop/mobile selection as requested-versus-confirmed state. Disable
   duplicate toggles while the serialized transition owns the tab, persist/log
   only success, and restore the prior checkbox/mode on every failure or stale
   binding.
2. Ensure every marking-enable, marking-disable, Save-to-Silent, reload, and
   desktop-preview transition uses the same background-owned guardian lifecycle;
   popup close or slow authority refresh may not strand or bypass it.
3. After exact settlement, refresh viewport-dependent shields and annotation
   geometry under the guardian, cancel stale scroll/layout fade timers, and
   restore the correct Marking/Silent/Content List presentation within the
   guardian's bounded retirement. Do not leave annotations invisible for the
   current two-to-four-second tail.
4. Preserve suitable gray marking boundaries during ordinary user scroll/resize
   and the existing stable-edge recompute/reposition contract; the opaque
   guardian is only for unproven device geometry.

### EL-03-R4-04 — Regression, clean gates, publication, and headed proof

1. Add deterministic tests for pre-write paint acknowledgement, Chrome's
   1.025 intermediate frame, exact matching-generation release, hidden-document
   waiting, stale/released generations, no receiver, rollback, same-mode
   detach reinforcement, immediate shrink, settled growth, and zero idle CDP
   writes.
2. Extend the repository browser contract with frame samples proving that no
   page-content frame is visible while geometry or physical fit is wrong, and
   that both full device edges are visible at release.
3. Run focused tests, `pnpm check`, authoritative `pnpm verify`, production and
   debug builds, clean P17, and full unchanged-threshold P25.
4. Review the exact diff, update durable knowledge, commit intended files only,
   push `re-write` without force, refresh the graph, and prove 0/0 sync.
5. Re-run repository `live-browser` on Aleris, Acne, and 3DPrima `/se`: sample
   desktop/mobile transitions frame by frame, shrink/grow the physical window,
   detach the debugger through delivered and silent paths, and verify exact
   412x960/1920x1080 layout, visual scale 1, full physical fit, intended-mode
   reinforcement, prompt annotation restoration, and clean console/network
   behavior. Perform no AI, Save, takeover, Lynx, deployment, or backend write.

## 5. Acceptance criteria

- `EL03-R4-AC-01` Every extension-requested metrics mutation begins only after a
  current guardian has two-frame proof of full opaque interactive coverage; no
  intermediate mismatched page frame is user-visible.
- `EL03-R4-AC-02` Unexpected resize or debugger loss activates the retained
  guardian synchronously, repairs the retained mobile/desktop posture, and does
  not expose clipped content before exact settlement.
- `EL03-R4-AC-03` At release, mobile is exactly 412x960 and desktop exactly
  1920x1080 with DPR/page scale/input/media/UA identity correct, and the complete
  device rectangle physically fits the visible tab in both axes.
- `EL03-R4-AC-04` Delivered detach is repaired immediately; silent detach is
  detected on the 50 ms browser-owned lease without evaluating the page; idle
  exact posture produces no debugger writes or presentation churn.
- `EL03-R4-AC-05` Window shrink never exposes an oversize device, growth does
  not oscillate, stale refits cannot overwrite a newer mode, and the retained
  intended mode—not marking state—is always reinforced.
- `EL03-R4-AC-06` Desktop-preview UI and persistence change only after proof,
  roll back visibly on failure, and reject duplicate/stale transitions.
- `EL03-R4-AC-07` Correct Marking/Silent/Content List annotations are measured
  under cover and restored promptly after settlement; ordinary gray scroll/
  resize fade behavior remains intact.
- `EL03-R4-AC-08` Existing R1-R3 Render, reveal/freeze, consent, ownership,
  marking, payload, Preview, and Silent-only presentation contracts remain green.
- `EL03-R4-AC-09` Focused/full/build/P17/P25 gates and fresh headed Aleris/Acne/
  3DPrima evidence pass on the exact pushed commit with zero prohibited mutation.
- `EL03-R4-AC-10` An independent cumulative EL-03 conformance audit approves
  R1-R4 before the expert-loop begins its next outer audit.

## 6. Todo chain

1. `el03-r4-transition-guardian` -> 0
2. `el03-r4-runtime-lifecycle` -> 1
3. `el03-r4-popup-restoration` -> 2
4. `el03-r4-regression-matrix` -> 3
5. `el03-r4-focused-full-gates` -> 4
6. `el03-r4-review-push` -> 5
7. `el03-r4-headed-conformance` -> 6
8. `el03-r4-cumulative-audit` -> 7

## 7. Implementation and pre-publication evidence

Implemented on `re-write` from entering commit
`ccc423d366c55d2cbfae2b3a20dc6768a404892d`:

- added one retained document-start emulation transition guardian with exact
  generation/mode fencing, two-frame paint proof, hostile-root repair, bounded
  hidden/starved-document behavior, synchronous viewport safety, under-cover
  annotation settlement, and debug-only lifecycle history;
- separated an ungranted-begin `abort` from terminal `release`, so a failed or
  lost newer handshake restores the prior opaque/idle generation and can never
  tear down an older safety guard;
- made the guardian presentation seam mandatory for all production emulation
  runtime construction and bracketed full apply, rollback/restore, refit,
  debugger-detach recovery, startup recovery, navigation recovery, and clear;
- retained exact 412x960 mobile and 1920x1080 desktop layout/screen identity,
  bounded desktop visual-viewport scrollbar tolerance, final physical-fit
  proof, conservative immediate shrink, generation-fenced stable growth, and
  the currently intended mode across delivered or silent debugger detach;
- reduced the browser-owned silent-detach backstop to 50 ms while preserving a
  zero-write exact idle path, narrowed the retained content observer to only
  root/guard invalidation edges, and disconnected it completely while exact
  and transparent;
- made desktop-preview state transactional and confirmed-only, removed late
  popup viewport repaint commands, and terminalized stale marking geometry
  timers beneath the opaque plane before release;
- made a refused guarded navigation clear retain the prior proven posture and
  continue replacement-document reconciliation instead of aborting the page
  binding; and
- fenced content-originated immediate refit requests to the current main
  document and added typed `presentation_unavailable` propagation.

Pre-publication automated evidence on 2026-09-02:

- focused guardian/runtime/startup/content regression set: 125/125 passed;
- popup/navigation regression set: 71/71 passed;
- authoritative `pnpm verify`: 149/149 files and 1673/1673 tests passed,
  production build passed, generated manifest contract 7/7 passed;
- `pnpm build:debug`: passed; and
- `git diff --check`: passed.

Clean-commit P17/P25 provenance gates, non-force push/0:0 proof, headed
repository `live-browser` conformance, and the cumulative EL-03 expert-check
remain mandatory before production approval. No AI, Save, takeover, Lynx,
deployment, backend write, or production mutation was used for R4 evidence.

Clean-commit automated release evidence on 2026-09-02:

- implementation commit `20eb6cf027920c0e694be28afdbab6501b13edfe`;
- clean P17: 19/19 checks passed with `cleanSourceSet: true`
  (`output/playwright/p17-preview/acceptance-2026-09-02T07-31-03-467Z.json`);
- the first clean full P25 attempt correctly failed because one of 192 P14
  scenarios observed a single 243 ms long task in the large-page rewrite
  marking-scroll input window; all P14 timing summaries, semantics, source
  identity, cardinality, and the other six P25 children passed;
- the unchanged-threshold standalone P14 reproduction then passed all 192
  scenarios with zero semantic, budget, activation, mutation-pressure, or
  input-long-task failures
  (`output/playwright/p14-marking-performance/acceptance-2026-09-02T07-50-36-508Z.json`);
- a fresh unchanged-threshold full P25 orchestration subsequently passed its
  deterministic warm-up and all seven retained children—P14, P15, P16, P17,
  P18, P20, and P23—with `complete: true`, no missing children, and no failed
  children
  (`output/playwright/p25-parity/acceptance-2026-09-02T08-10-07-123Z.json`);
  no performance budget or validator was weakened to obtain the pass; and
- the generated gate outputs remain disposable evidence and are excluded from
  the intended source commit.

Normal push/0:0 synchronization, headed repository `live-browser` conformance,
and cumulative EL-03 adjudication remain mandatory before production approval.

# EL-03-R5 — Make guardian repair idempotent under real CSSOM normalization

## 1. Goal

Remove the real-browser main-thread starvation introduced by R4's retained
emulation transition guardian without weakening its opaque paint/input fence,
hostile-page repair, exact-generation lifecycle, or continuous-fit behavior.
The guard must remain safe when Chromium canonicalizes requested inline CSS
tokens, and its MutationObserver must never recursively consume the guard's own
repair writes.

## 2. Entering evidence and root cause

The exact pushed R4 source at
`c487b58c29ce71f089ee20e27450a989a8cce4f0` passed `pnpm verify`, clean P17,
an unchanged-threshold standalone P14 reproduction, and a fresh complete P25.
The first required repository `live-browser` launch then failed reproducibly on
both Aleris `/kirurgi/brack/aderbrack/` and Acne `/` before the operator surface
could open:

- the website target stopped answering even a trivial CDP `Runtime.evaluate`;
- `chrome.scripting.executeScript` from the otherwise responsive extension
  worker consequently timed out and the launcher's exact tab binding failed;
- Chrome reported the page target as debugger-detached, excluding an external
  debugger ownership race; and
- the retained guardian observes its own `style` attribute, while
  `setImportantStyle()` compares requested lexical values directly with
  CSSOM-normalized values. Chromium serializes values such as `inset: 0` as
  `0px`, so a scheduled repair writes the same style again, queues another
  observer delivery, and repeats through the microtask checkpoint without
  yielding the page main thread.

The unit fake returned requested style strings verbatim and required manual
observer delivery, so it could not reproduce the browser normalization/self-
notification cycle. The production launcher correctly exposed this gap; it
must not be bypassed or given looser timeouts. No AI, Save, takeover, Lynx,
deployment, backend write, or production mutation occurred.

## 3. Implementation plan

### EL-03-R5-01 — Make presentation repair canonical and self-suppressing

Files:

- `src/content/emulation-transition-guardian.ts`
- focused guardian tests

Steps:

1. Track the last browser-serialized inline-style snapshot together with the
   logical presentation state that produced it. Skip style writes only when
   both still match; a hostile edit or logical opacity/input transition must
   rebuild the authoritative style and refresh the snapshot.
2. Run observer-triggered repair with mutation observation disconnected, then
   re-arm the narrow document/root/guard subscriptions after the repair. Own
   style, attribute, and last-child writes may not enqueue a recursive repair.
3. Preserve synchronous viewport guarding, exact opaque coverage checks,
   begin/settle/abort/release generation fencing, transparent-idle observer
   disconnection, and last-in-root repair.

### EL-03-R5-02 — Reproduce the real browser failure in regression coverage

1. Make the guardian harness able to canonicalize CSS zero values as a browser
   CSSStyleDeclaration does and to deliver observed guard mutations
   automatically.
2. Prove a transitioning begin reaches `paint-proven` with a bounded number of
   repair/style writes rather than an unbounded microtask chain.
3. Prove hostile style/root tampering still repairs to full opaque interactive
   maximum-z coverage, and ordinary unrelated page-subtree mutations remain
   unobserved.

### EL-03-R5-03 — Validate, publish, and resume headed acceptance

1. Run focused guardian/content/background tests, `pnpm check`, authoritative
   `pnpm verify`, debug build, clean P17, standalone P14, and full unchanged-
   threshold P25 on a clean commit.
2. Review the exact diff, record truthful evidence, commit intended files only,
   push `re-write` normally, refresh the graph, and prove upstream 0/0.
3. Launch the exact pushed production bundle through repository `live-browser`
   on Aleris, Acne, and 3DPrima `/se/3d-skrivare-mer/tillverkare/anycubic`.
   Require a responsive page/operator surface, exact mobile/desktop device and
   full physical fit, guarded shrink/growth and debugger-loss recovery, prompt
   annotation restoration, and clean console/network behavior. Perform no AI,
   Save, takeover, Lynx, deployment, or backend write.

## 4. Acceptance criteria

- `EL03-R5-AC-01` Browser-normalized CSS values cannot cause recursive guardian
  repair or website main-thread starvation.
- `EL03-R5-AC-02` Observer-triggered repair is finite, self-write-suppressed,
  and still restores hostile style/root damage before acknowledging coverage.
- `EL03-R5-AC-03` All R4 atomicity, exact geometry, physical-fit, generation,
  rollback, and idle-zero-churn contracts remain green.
- `EL03-R5-AC-04` Focused/full/build/P17/P14/P25 gates pass unchanged on exact
  committed source.
- `EL03-R5-AC-05` Fresh Aleris, Acne, and 3DPrima repository-live-browser runs
  complete the safe headed matrix on exact pushed source.
- `EL03-R5-AC-06` Cumulative EL-03 conformance is independently approved before
  the outer expert-check may declare production readiness.

## 5. Todo chain

1. `el03-r5-guardian-idempotency` -> 0
2. `el03-r5-browser-normalization-tests` -> 1
3. `el03-r5-focused-full-gates` -> 2
4. `el03-r5-review-push` -> 3
5. `el03-r5-headed-conformance` -> 4
6. `el03-r5-cumulative-audit` -> 5

## 6. Implementation and pre-push evidence (2026-09-02)

Implementation commit:

- `7d1b596278f5583f78fe0a9f6d2a5269681f9690` —
  `fix: make guardian repairs browser-idempotent`

Automated evidence on the exact clean commit:

- guardian regression suite: 17/17 tests passed, including browser-style zero
  normalization, automatic/coalesced guard mutation delivery, finite repair,
  hostile inline-style repair, and unrelated-subtree zero-churn coverage;
- focused content/background regression set: 198/198 tests passed;
- `pnpm check`: passed;
- `pnpm verify`: passed with 149 test files and 1,675 tests, followed by the
  production build and 7/7 generated-manifest permission checks;
- `pnpm build:debug`: passed;
- clean P17: 19/19 checks passed with `cleanSourceSet: true`
  (`output/playwright/p17-preview/acceptance-2026-09-02T08-39-36-273Z.json`);
- standalone P14: 192 scenarios passed with zero semantic, budget,
  activation, mutation-pressure, input-long-task, cardinality, or environment
  failures
  (`output/playwright/p14-marking-performance/acceptance-2026-09-02T08-47-45-716Z.json`);
- the first complete P25 attempt was rejected by strict parity even though all
  seven component artifacts were functionally green: one of 16 relative-p95
  checks, large-fixture silent activation, measured rewrite 228.2 ms versus
  legacy 194.2 ms and a 203.91 ms limit. An unrelated repository's browser was
  consuming substantial host CPU during that run. The result is retained here
  as a rejected timing outlier, not counted as release evidence; no threshold
  or source change followed;
- after that unrelated workload ended and only newly generated artifacts were
  removed, a fresh full P25 rerun passed unchanged. Its warm-up and all seven
  children validated, with complete order, no missing/failed child, and clean,
  stable source provenance
  (`output/playwright/p25-parity/acceptance-2026-09-02T09-21-12-887Z.json`).

Repository `live-browser` diagnostic evidence on the same source tree before
the commit (no source change occurred between the build and commit):

- the Aleris candidate page and real side panel opened responsively, eliminating
  the previously repeatable page-main-thread starvation;
- mobile was exact 412x960 at scale 0.734375 in an 850x705 visible tab;
- mobile -> desktop reached exact 1920x1080 in 129 ms at fitted scale
  0.4427083333333333, with no unsafe sampled frame;
- desktop -> mobile reached exact geometry in 220 ms; the one transient
  page-scale sample was fully covered by the opaque, interactive, last-in-root,
  maximum-z guard;
- resizing the visible tab to 570x455 produced the exact height-fitted mobile
  scale 0.4739583333333333 and restoring it returned exactly to 0.734375;
- deliberate debugger detach was observed at 26 ms, reattachment at 76 ms,
  exact mobile restoration at 96 ms, and transparent release at 375 ms, with
  zero unsafe sampled frames; and
- hostile style mutation during guarding was repaired within 35 ms without
  recursion; the deliberately disturbed transition failed safely back to the
  prior exact mobile posture.

These results satisfy `EL03-R5-AC-01` through `EL03-R5-AC-04`. Normal push,
0:0 synchronization, exact-pushed-build Aleris/Acne/3DPrima headed conformance,
and the cumulative EL-03 audit remain mandatory before production approval.

# EL-03-R6 — Prove mobile geometry against the interactive viewport

## 1. Goal

Stop the debugger attach/apply/reject/detach loop exposed by 3DPrima pages that
use classic scrollbars. A correctly fitted 412x960 mobile device must remain
stable when scrollbar gutters make `window.innerWidth`/`innerHeight` larger
than the actual interactive viewport, without weakening any proof against a
clipped, zoomed, oversized, desktop, or otherwise inexact device.

## 2. Entering evidence and root cause

The exact pushed R5 production build at
`dd02a0dc3d26998bd80cc29239c2b9a08907efaa` passed the complete automated gate
set and fresh Aleris/Acne headed checks. The required 3DPrima
`/se/3d-skrivare-mer/tillverkare/anycubic` pass then exposed a site-dependent
emulation failure after a cross-property navigation:

- the temporary ownership-loss label appeared only during its valid countdown
  and disappeared afterward, while consent remained hidden;
- the Silent UI reported mobile preference, but the debugger initially
  remained detached and the website stayed at the physical 850x705 viewport;
- an explicit Refresh did not restore the posture, and a typed
  `emulation.apply` returned `settle-proof-failed`;
- subsequent watchdog attempts visibly alternated attached/detached posture;
  one attached sample reported scrollbar-inclusive `window.innerWidth`/
  `innerHeight` of 417x972 while `screen`, `outerWidth`/`outerHeight`,
  `visualViewport`, and `document.documentElement.clientWidth`/`clientHeight`
  were all exactly 412x960 at page scale 1; and
- the background posture verifier already treats the mobile visual viewport
  and document client viewport as authoritative, but the content-side guardian
  additionally requires scrollbar-inclusive `window.inner*` to equal the
  preset. It therefore rejects the already-correct background proof at settle,
  causing rollback and retry flicker.

The earlier Content List keyboard concern was a diagnostic false positive and
is not an R6 defect: the probe searched under a nonexistent root selector and
then focused off-screen rows. A trusted Tab into an on-screen Aleris row painted
the matching focus boundary, while trusted page clicks focused and scrolled the
correct Aleris and Acne list rows. That evidence is retained explicitly so no
unnecessary product change is made.

No AI, Save, takeover, Lynx, deployment, backend write, or production mutation
occurred.

## 3. Implementation plan

### EL-03-R6-01 — Align guardian geometry with mobile viewport authority

Files:

- `src/content/emulation-transition-guardian.ts`
- the background transition-result parser

Steps:

1. Add document-client width and height to the internal transition measurement
   so the content proof exposes the same interactive-layout authority as the
   background proof.
2. For mobile, require exact 412x960 screen, visual viewport, and document
   client viewport dimensions plus page scale 1. Retain `window.inner*` as
   diagnostic evidence but do not reject bounded browser scrollbar gutters.
3. Preserve the existing desktop rule: exact 1920x1080 layout/screen with only
   the bounded platform scrollbar allowance in its visual viewport.
4. Keep guardian coverage, two-frame paint proof, hostile-page repair,
   generation fencing, physical-fit checks, touch/pointer/UA checks, and
   rollback behavior unchanged.

### EL-03-R6-02 — Add positive and negative scrollbar regressions

1. Extend the guardian harness with independent document-client dimensions.
2. Prove a mobile settle succeeds when `window.inner*` includes realistic
   vertical and horizontal scrollbar gutters but screen, visual viewport, and
   document client viewport are exactly 412x960.
3. Prove the same settle rejects clipped or oversized visual/document-client
   dimensions, non-unit page scale, or wrong screen geometry.
4. Update background/content transition fixtures so the expanded internal
   measurement is parsed and enforced rather than silently ignored.

### EL-03-R6-03 — Validate, publish, and repeat headed acceptance

1. Run the focused guardian/background/emulation suites, `pnpm check`,
   authoritative `pnpm verify`, debug build, clean P17, standalone P14, and the
   full unchanged-threshold P25 composite.
2. Review the exact diff, commit intended files only, push `re-write` normally,
   refresh the code graph, and prove local/upstream 0/0 synchronization.
3. Start a fresh repository `live-browser` production session. Reproduce
   Aleris -> 3DPrima cross-property ownership handoff and require continuous
   exact 412x960 mobile posture after the valid ownership fence, no debugger
   churn, no visible geometry flicker, and a transparent idle guardian.
4. Repeat exact mobile/desktop/reverse transitions, physical fit, consent,
   annotation restoration, Content List keyboard/page two-way interaction, and
   console/network hygiene on Aleris, Acne, and 3DPrima. Perform no AI, Save,
   takeover, Lynx, deployment, or backend write.

## 4. Acceptance criteria

- `EL03-R6-AC-01` Classic scrollbar gutters cannot make an otherwise exact
  412x960 mobile device fail guardian settlement or enter a debugger retry loop.
- `EL03-R6-AC-02` Wrong screen, visual viewport, document client viewport, page
  scale, pointer/touch/UA posture, or physical fit still fails closed.
- `EL03-R6-AC-03` R4/R5 atomic guard, hostile-repair, generation, rollback, and
  zero-churn contracts remain unchanged.
- `EL03-R6-AC-04` Focused/full/build/P17/P14/P25 gates pass unchanged on the
  exact committed source.
- `EL03-R6-AC-05` Fresh Aleris/Acne/3DPrima repository-live-browser evidence
  proves stable fitted emulation and the retained UI/UX contracts.
- `EL03-R6-AC-06` Cumulative EL-03 conformance is independently approved before
  the outer expert-check may declare production readiness.

## 5. Todo chain

1. `el03-r6-scrollbar-geometry-authority` -> 0
2. `el03-r6-scrollbar-regressions` -> 1
3. `el03-r6-focused-full-gates` -> 2
4. `el03-r6-review-push` -> 3
5. `el03-r6-headed-conformance` -> 4
6. `el03-r6-cumulative-audit` -> 5

## 6. Implementation and pre-push evidence (2026-09-02)

The content transition measurement now carries document-client dimensions.
Mobile guardian settlement requires exact screen, visual-viewport, and
document-client 412x960 dimensions at page scale 1; scrollbar-inclusive
`window.inner*` remains reported but is no longer a false rejection authority.
Desktop's exact 1920x1080 inner/screen proof and bounded visual-scrollbar
allowance are unchanged. The background transition parser requires and
validates the expanded internal measurement.

Focused pre-push evidence:

- guardian/background/startup/content integration set: 132/132 tests passed;
- `pnpm check`: passed; and
- regression coverage accepts 417x972 scrollbar-inclusive inner geometry only
  when document-client and visual viewport remain exactly 412x960, while wrong
  document-client size, visual viewport, screen geometry, and page scale each
  remain fail-closed.

Repository `live-browser` production-build diagnostic evidence:

- the original R5 bundle reproduced 3DPrima `settle-proof-failed`, detached
  posture, and subsequent attach/detach retry churn while its interactive
  viewport was already exact;
- the R6 bundle completed a fresh Aleris -> 3DPrima cross-property navigation.
  During the loaded 3DPrima document, scrollbar-inclusive `window.inner*`
  varied through 424x988 and 434x1011 while screen, visual viewport, and
  document client viewport remained exactly 412x960 at scale 1;
- after the ordinary navigation boundary, the debugger stayed attached. The
  ownership countdown expired with one guarded settle and no repeated detach,
  and the guardian returned transparent idle;
- 3DPrima desktop reached exact 1920x1080 at fitted scale
  0.4427083333333333 in the 850x705 physical tab, and reverse mobile returned
  exact interactive 412x960 at fitted scale 0.734375;
- consent suppression retained 33 hidden and zero visible consent candidates;
  Content List used Silent presentation, became interactive with semantic rows,
  and a trusted page click focused the corresponding fourth list row; and
- no AI, Save, takeover, Lynx, deployment, backend write, or production
  mutation occurred.

Clean committed-source release evidence:

- implementation checkpoint `ccde52ca87c9c1e0bc7b351928fb41df776dc172`
  contains only the intended guardian, parser, fixture, regression, and plan
  changes;
- `pnpm verify`: passed with 149 test files and 1,680 tests, generated
  page-world/icon checks, production build, and 7/7 manifest tests;
- `pnpm build:debug`: passed;
- P17 acceptance: 19/19 checks passed from a clean source set, artifact
  `output/playwright/p17-preview/acceptance-2026-09-02T09-57-47-980Z.json`;
- standalone P14 acceptance: all 192 scenarios passed with zero semantic,
  budget, activation, mutation-pressure, or input-long-task failures, artifact
  `output/playwright/p14-marking-performance/acceptance-2026-09-02T09-58-16-676Z.json`;
- the first full P25 run was correctly rejected because one of sixteen strict
  P14 relative-p95 comparisons missed by 3.98 ms: large marking mutation
  stabilization was 329.9 ms against a 325.92 ms limit. The rewrite sample was
  effectively unchanged from the immediately preceding passing standalone run
  (330.4 ms); the paired legacy p95 moved from 316.5 to 310.4 ms. Every
  semantic, absolute-budget, long-task, provenance, cleanup, and other strict
  ratio check passed. No threshold or source changed; and
- a fresh unchanged-source P25 rerun passed all seven required children with a
  validated deterministic warm-up, complete ordering, retained child
  artifacts, and zero failures, artifact
  `output/playwright/p25-parity/acceptance-2026-09-02T10-30-21-845Z.json`.

The rejected run remains recorded rather than reclassified as a pass. Its
single non-reproducible relative comparison is bounded by the adjacent passing
standalone run and the complete unchanged rerun.

Normal push/0:0 proof, a fresh exact-pushed headed matrix, and cumulative
adjudication remain mandatory.

## 7. Exact-pushed headed conformance rejection (2026-09-02)

R6 automated and source conformance remains green, but its headed criterion is
rejected on exact pushed commit
`9eaf5320a58e6c9d7473bde2d578d54e19c44cb4`. A fresh repository
`live-browser` production run and a clean debug-gated reproduction on 3DPrima
proved a separate scheduler-starvation defect after the scrollbar fix:

- the exact managed-browser production run could eventually recover and hold
  412x960 mobile geometry for a stable sample, but a trusted popup-only Desktop
  preview click rolled back and retained mobile;
- debug launch provenance
  `3d21e21e-259b-4404-8003-9c4381b1182e`, extension
  `mfdmappjajojdcmkkmfbgocbgmlbkgaj`, tab `1926120225`, and the current
  3DPrima candidate exposed repeated `guard-paint-proof-failed` and
  `settle-proof-failed` terminals;
- failed begin results often reported `coverage: true`; an exact mobile settle
  reported `coverage: true`, `exactGeometry: true`, and still failed solely at
  paint proof;
- a trusted Desktop transition reached exact 1920x1080 inner/screen geometry,
  a 1905x1080 scrollbar-bounded document/visual viewport, opaque full coverage,
  and exact geometry, but `settle-proof-failed` rolled it back. The subsequent
  recovery attempts alternated desktop, mobile, and physical 850x705 posture;
- while the page remained `visibilityState: visible`, an isolated-world rAF
  sample measured approximately 397, 1003, 1013, 1010, 997, 26, 977, and
  1023 ms. The guardian currently requires two callbacks inside one 1000 ms
  window and separately spends another full window on its entry/retire frame;
  and
- the operator surface truthfully rolled the Desktop checkbox back and recorded
  `Device preview failed`, but that safe rollback is what makes the otherwise
  exact device visibly flicker and temporarily expose a clipped physical page.

Consent remained hidden (33 candidates, zero visible), ownership and the
owner-label rule were correct, and no AI, Save, takeover, Lynx, deployment,
backend write, or production mutation occurred. `EL03-R6-AC-05` and
`EL03-R6-AC-06` therefore remain open and feed the delta remediation below.

# EL-03-R7 — Make exact device transitions terminal under visible-frame starvation

## 1. Goal

Make the debugger-owned 412x960 mobile and 1920x1080 desktop postures switch
atomically and remain continuously fitted even when a visible website document
delivers animation frames at roughly one hertz. A valid, fully opaque,
interactive, exact-generation guard must not be rejected merely because the
second paint callback misses the deadline; an invalid, hidden, stale, clipped,
zoomed, wrongly layered, or non-interactive guard must still fail closed.

## 2. Current facts

- `src/content/emulation-transition-guardian.ts:createEmulationTransitionGuardian()`
  owns the retained page guard, generation, primary paint proof, exact geometry,
  and entry/retire transitions.
- `frame()` gives every requested frame its own `paintTimeoutMs` timer.
  `begin()` ignores the first frame result before making the guard opaque, then
  `waitForPaintProof()` requires two more real frames inside a new one-second
  window. `settle()` repeats the proof and can fail a final retire frame after
  already proving exact geometry.
- `coverage()` already proves a visible, fixed, opaque, interactive,
  maximum-z, visual-viewport-covering guard connected as the document root's
  last element. It does not by itself prove the active generation/mode/cause
  attributes.
- `src/background/render-emulation-runtime.ts:beginPresentation()` and
  `settlePresentation()` correctly refuse any non-terminal content response;
  a settle failure is mutation-possible and invokes prior-posture restoration.
- `src/entrypoints/content-loader.content.ts:ensureEmulationTransitionGuardian()`
  already exposes debug-only lifecycle history without shipping production
  diagnostics.
- `src/content/render-inspection-curtain.ts` establishes the repository pattern:
  two frames remain primary, while a one-second fallback may acknowledge only
  the exact visible identity with a connected, opaque, interactive,
  full-viewport maximum-z curtain.
- R6 geometry rules are correct: mobile authority is exact 412x960 screen,
  visual viewport, and document client viewport at scale 1; desktop remains
  exact 1920x1080 with bounded scrollbar gutters; the fitted CDP scale must keep
  the complete device screen inside the physical tab.

## 3. Decisions already made

- The user requires Chrome-debugger device emulation, continuous reinforcement
  after user/browser detach, and the whole device screen scaled to remain
  visible inside the physical browser viewport.
- Two consecutive animation frames remain the primary paint acknowledgement.
  R7 may not replace them with an unconditional timer or weaken coverage.
- The starvation fallback follows the already-approved inspection safety model:
  it is available only after the one-second primary deadline and only for the
  exact current, visible, fully covered guard identity.
- A bounded scheduling fallback may advance the cosmetic entry/retire opacity
  transition after 20 ms, but it is never itself paint proof.
- Consent suppression, marking/highlighting semantics, Render-mode behavior,
  backend payloads, Save/Load, lock authority, and Lynx publication are outside
  this delta and must not change.

## 4. Open questions

None. The required safety boundary and the user-visible outcome are determined
by the current product authority and the existing guarded-fallback precedent.

## 5. Non-goals

- Do not remove the transition guard, acknowledge before it is opaque, detach
  the durable debugger lease, focus/steal the user's browser window, or treat a
  timer callback as a rendered frame.
- Do not loosen mobile/desktop geometry, physical-fit, UA, touch, pointer,
  media, document identity, navigation, generation, or rollback checks.
- Do not change the 412x960 or 1920x1080 presets, add user-selectable scales, or
  alter marking/session/payload contracts.
- Do not perform AI, Save, takeover, Lynx, deployment, release promotion, or
  production configuration mutation during acceptance.

## 6. Implementation phases

### EL-03-R7-01 — Separate presentation turns from paint authority

Files:

- `src/content/emulation-transition-guardian.ts`
- `tests/src/content/emulation-transition-guardian.test.ts`

Steps:

1. Split the current per-call `frame()` behavior into a real-frame waiter used
   only for paint proof and a bounded presentation-turn waiter that races rAF
   with the repository's 20 ms presentation fallback.
2. Use the bounded turn for the opacity-zero to opacity-one entry and for
   starting retirement. A missing cosmetic rAF must not independently reject a
   transition; stale epoch/generation checks remain mandatory after the turn.
3. Keep a single one-second primary proof deadline per `begin` or `settle`
   phase. Preserve two consecutive real-frame coverage samples as the primary
   success path.
4. At real-frame starvation only, run two strict fallback samples separated by
   one bounded presentation turn. Each sample must prove the same epoch,
   generation, mode, cause, stage attributes, visible document, connected
   last-in-root guard, canonical inline presentation, fixed full visual-viewport
   coverage, opacity >= 0.999, active pointer boundary, maximum z-index, and,
   for settle, exact target geometry.
5. Hidden documents continue waiting for `visibilitychange`. A stale identity,
   changed epoch, missing/hostile guard, failed coverage, or inexact settle
   rejects and leaves the safety plane fail-closed.
6. Add an internal paint-proof discriminant (`none`, `frame-two`, or
   `guarded-fallback`) to the transition result and retained rollback snapshot
   so debug history and background validation identify how an acknowledgement
   was earned. Production UI and endpoint schemas remain unchanged.

Focused validation:

`pnpm vitest run tests/src/content/emulation-transition-guardian.test.ts`

Rollback rule: if the fallback cannot prove every listed condition without a
new ownership source, retain the current fail-closed implementation and stop;
do not acknowledge on elapsed time alone.

### EL-03-R7-02 — Preserve background atomicity and add starvation regressions

Files:

- `src/background/index.ts`
- `src/background/render-emulation-runtime.ts`
- `tests/src/background/render-emulation-runtime.test.ts`
- focused content/background integration and source-contract tests discovered
  by the graph

Steps:

1. Parse and validate the new proof discriminant. `beginPresentation()` and
   `settlePresentation()` accept only `frame-two` or `guarded-fallback`; missing,
   malformed, or `none` proof remains unavailable and invokes existing rollback.
2. Prove ordinary responsive frames still take the primary path, while a
   visible starved renderer succeeds only after the strict guarded fallback for
   both begin and exact settle.
3. Prove a clipped guard, hidden document, stale generation, inexact target
   geometry, hostile root/style mutation that cannot be repaired, and malformed
   proof response still fail closed.
4. Prove retire-frame starvation no longer converts an already exact,
   proof-owned posture into rollback; the guard remains input-blocking through
   its fade and ends transparent only after the bounded retire interval.
5. Re-run existing hostile-page repair, scrollbar, debugger detach/watchdog,
   physical shrink/grow, concurrent transition, and zero-idle-churn tests.

Focused validation:

`pnpm vitest run tests/src/content/emulation-transition-guardian.test.ts tests/src/background/render-emulation-runtime.test.ts tests/src/background/shield-posture-navigation-startup.test.ts tests/src/background/startup.test.ts tests/src/messaging/contracts.test.ts tests/src/popup/entrypoint.test.ts`

### EL-03-R7-03 — Exact-source gates, review, commit, and push

1. Run `pnpm check`, `pnpm verify`, and `pnpm build:debug`.
2. Run clean P17, standalone P14, and the complete unchanged-threshold P25
   composite on the exact candidate commit. Retain rejected outliers rather than
   relabeling them.
3. Perform a high-signal diff review, update durable guardian knowledge, commit
   only intended source/tests/plan/knowledge, push `re-write` normally, refresh
   the code graph after commit and push, and prove local/upstream 0/0.

### EL-03-R7-04 — Fresh headed device and cumulative conformance

1. Launch the exact pushed production build through repository `live-browser`
   on 3DPrima, Aleris, and Acne; keep website-target debugger observers detached
   during extension-owned transitions.
2. On every candidate, drive trusted popup-only mobile -> desktop -> mobile,
   Enable marking -> mobile, Disable/Discard -> retained Silent preference, and
   deliberate debugger detach/recovery. Record frame-by-frame device, scale,
   guard, checkbox/busy state, and attachment identity.
3. Require exact 412x960 and 1920x1080 geometry, fitted scale satisfying both
   physical axes, the complete device screen visible at every released frame,
   no physical/hybrid flash, no repeated attach/detach or rollback loop, prompt
   truthful controls, and a transparent idle guard.
4. Resize smaller and restore larger. Shrink must be immediate and guarded;
   growth must occur only after the retained stable trailing proof, with no
   clipped bottom or opportunistic unsafe scale increase.
5. Recheck the pending reveal/freeze suspicion from a clean owner flow: true
   bottom, lazy-growth quiet proof, return to start, no Silent paint during the
   ritual, and Silent restoration afterward. Classify it separately if it
   reproduces; do not hide it under the emulation fix.
6. Recheck consent, owner-label absence, Silent/Marking/Content List projection,
   keyboard and page/list two-way routing, console/network/message hygiene, and
   safe failure recovery. Perform no prohibited external mutation.
7. Build the criterion-by-criterion R7 and cumulative EL-03 conformance matrix.
   Any failed, partial, blocked, or not-tested required cell rejects approval and
   starts the next delta plan.

## 7. Test matrix

| Surface | Primary evidence | Required result |
| --- | --- | --- |
| responsive renderer | guardian unit chronology | two real frames; `frame-two` |
| visible starved renderer | fake timers + debug headed history | strict fallback only after deadline; `guarded-fallback` |
| invalid/starved renderer | negative guardian fixtures | no acknowledgement; guard remains fail-closed |
| background handshake | runtime/integration tests | only typed proved responses authorize or settle CDP mutation |
| geometry/fit | R4-R6 tests + headed samples | exact preset and both physical axes fully fit |
| detach/refit/concurrency | watchdog/runtime tests + headed detach | one serialized recovery, no stale mode or churn |
| full regressions | check/verify/debug/P17/P14/P25 | all unchanged gates pass on exact source |
| real workflow | 3DPrima/Aleris/Acne live-browser | no flicker, clipping, rollback loop, or hidden device bottom |
| adjacent reveal/consent/UI | headed matrix | independently truthful PASS or a new retained finding |

## 8. Regression risks

- A permissive timer acknowledgement could expose page pixels during a metrics
  mutation. Two exact fallback samples and the complete guard identity/coverage
  predicate prevent elapsed time from becoming authority.
- A late frame from an older generation could settle the wrong mode. Every
  callback and fallback rechecks operation epoch, generation, mode, and cause.
- Treating a bounded turn as paint proof could recreate the unsafe frame R4
  removed. The code and tests keep turn scheduling and proof outcomes distinct.
- Retiring without rAF could expose stale annotations. Retirement begins only
  after exact settle proof and `beforeSettle` presentation refresh, remains
  pointer-blocking through the fade, and releases after the bounded transition.
- A fallback could mask wrong scrollbar or page-scale geometry. Settle fallback
  calls the unchanged exact R6 geometry predicate.

## 9. Acceptance criteria

- `EL03-R7-AC-01` A responsive renderer still acknowledges begin and settle via
  two consecutive real frames; the fallback does not win early.
- `EL03-R7-AC-02` A visible one-hertz/starved renderer acknowledges only after
  the one-second deadline and only with two exact guarded fallback samples.
- `EL03-R7-AC-03` Hidden, stale, clipped, non-opaque, non-interactive,
  wrongly-layered, detached, inexact, or malformed-proof cases remain
  fail-closed and cannot authorize debugger mutation or retirement.
- `EL03-R7-AC-04` Missing entry/retire animation frames cannot independently
  cause rollback after strict paint authority; normal fades and input fencing
  remain intact.
- `EL03-R7-AC-05` Trusted headed mobile -> desktop -> mobile and marking/session
  transitions finish without rollback/retry churn, physical/hybrid flashes, or
  checkbox lies on 3DPrima, Aleris, and Acne.
- `EL03-R7-AC-06` Every released mobile frame is exact 412x960 and every released
  desktop frame is exact 1920x1080; fitted scale keeps the complete device width
  and height inside the current physical viewport, including resize and detach
  recovery.
- `EL03-R7-AC-07` Consent, labeling, annotations, Content List, reveal/freeze,
  console/network hygiene, and all prior R4-R6 safety contracts remain green or
  receive an explicit new finding; none is inferred from emulation success.
- `EL03-R7-AC-08` Focused/full/build/P17/P14/P25 gates pass unchanged on the exact
  committed and pushed source, and cumulative conformance is independently
  approved before production readiness.

## 10. Todo chain

1. `el03-r7-presentation-paint-separation` -> 0
2. `el03-r7-starvation-regressions` -> 1
3. `el03-r7-focused-full-gates` -> 2
4. `el03-r7-review-push` -> 3
5. `el03-r7-headed-conformance` -> 4
6. `el03-r7-cumulative-audit` -> 5

## 11. Implementation and exact-candidate evidence (2026-09-02)

Implementation checkpoint `93cd2f8e` separates cosmetic presentation turns
from transition paint authority. The guardian retains two consecutive real
animation frames as the primary proof, and only after the single one-second
phase deadline permits two strict guarded fallback samples. Results now carry
the internal `none | frame-two | guarded-fallback` discriminant; the background
rejects missing, malformed, and `none` proof before debugger mutation. Entry and
retirement animation starvation can no longer independently roll an exact
posture back to the physical viewport.

Focused and live diagnostic evidence:

- the expanded guardian/runtime/startup/content regression set passes 223/223;
- clipped coverage, hidden documents, stale generations, inexact settle
  geometry, unproved responses, and hostile presentation remain fail-closed;
- a clean repository `live-browser` debug run on the authorized 3DPrima
  candidate completed trusted mobile -> desktop -> mobile at exact 412x960 and
  1920x1080 geometry with truthful controls and no rollback;
- with the website's isolated-world `requestAnimationFrame` deliberately
  starved, trusted desktop transition begin, settle, and the trailing refit all
  completed with `paintProof: "guarded-fallback"`, exact 1920x1080 settled
  geometry, full guard coverage before mutation, and no physical/hybrid flash;
  the original frame primitive was restored immediately afterward; and
- consent suppression retained 33 hidden and zero visible consent candidates.
  No AI, Save, takeover, Lynx, deployment, backend write, or production mutation
  occurred.

Exact committed-source automated gates:

- `pnpm check`: passed;
- `pnpm verify`: passed with 149 test files and 1,686 tests, generated
  page-world/icon checks, production build, and 7/7 manifest checks;
- `pnpm build:debug`: passed;
- clean P17: 19/19 checks passed with complete teardown, artifact
  `output/playwright/p17-preview/acceptance-2026-09-02T11-16-16-711Z.json`;
- standalone P14: all 192 scenarios passed with zero semantic, budget,
  activation, mutation-pressure, or input-long-task failures, artifact
  `output/playwright/p14-marking-performance/acceptance-2026-09-02T11-16-44-900Z.json`;
  and
- full unchanged-threshold P25: deterministic warm-up and all seven retained
  P14/P15/P16/P17/P18/P20/P23 children passed with no missing or failed gate,
  artifact
  `output/playwright/p25-parity/acceptance-2026-09-02T11-36-27-513Z.json`.

Normal push/0:0 proof, exact-pushed production headed conformance, the pending
reveal/freeze adjudication, and cumulative production-readiness review remain
mandatory.

## 12. Exact-pushed R7 headed verdict (2026-09-02)

R7 is **REJECTED for production readiness** even though its intended
frame-starvation remediation and every automated gate passed. The headed run
used the repository `live-browser` against exact pushed commit `93a64a96` with
production extension version `2.0.0.756`, provenance
`729f0a5c-f093-4dec-a66a-5c6cfd70ad2d`, and no AI, Save, takeover, Lynx,
deployment, or backend mutation.

What passed:

- responsive and deliberately starved renderers both terminalized with the
  intended typed proof; exact 412x960 mobile and 1920x1080 desktop transitions
  stayed behind the opaque input guard and controls remained truthful;
- a deliberate debugger detach on Aleris was covered while the lease recovered
  in about 85 ms, returned to exact 412x960, and released after about 734 ms;
- Aleris reveal/freeze reached the true bottom within one pixel after dynamic
  growth, froze lazy loading, returned to the start, painted no Silent layer
  during motion, and restored Silent presentation afterward;
- consent remained invisible, the owner label rule held, expanded exclusions
  were hoverable and removable, Content List rows were semantic buttons, and
  keyboard plus page/list routing worked after the deliberate scroll-stability
  window; and
- Acne's With-JavaScript load performed no render inspection. Its Render exit
  reached the true bottom and returned to the original scroll position without
  painting annotations during the ritual.

Release findings retained from the same run:

### `EL-03-F007` — Critical — physical resize is neither immediate nor one transaction

- Shrinking the physical tab from 850x705 to 426x405 exposed the old fitted
  scale for about 35 ms before the guard became opaque, then performed three
  complete guard/refit/fade cycles instead of one.
- Restoring the larger viewport safely retained the smaller scale at first but
  performed about six complete cycles before increasing to the final fitted
  scale 0.734375 roughly 2.26 seconds later.
- A normal With-JavaScript reload also generated two redundant guarded refits
  without a posture change.
- Source inspection explains the churn: window-bounds, popup Window plus
  `ResizeObserver`, content viewport, and watchdog sources independently call
  `requestRefit`; each call invalidates geometry and starts presentation before
  proving that a scale change exists; trailing requests retain only the hint;
  and the debugger write's expected viewport echo can enqueue another refit.
  The popup additionally waits 40 ms before reporting the first physical
  change. R7 fixed false paint-proof rollback, not this multi-source ownership
  defect.

### `EL-03-F008` — High — popup polling can dominate Enable marking latency

- Exact production Acne activation took 10.327 seconds from disabled click to
  checked/ready UI even though only a small visible overlay set was painted.
- A clean debug repeat took 1.490 seconds. Its stage history isolated 0.993
  seconds before lock/emulation to the generic serialized signal drain;
  emulation itself took 10 ms and content activation plus presentation settle
  took 349 ms.
- The enable path remains outside `runSessionTransition` while it awaits an
  initial `pullSignals`, then `refreshLockDirective` performs another pull, and
  the terminal fact performs a third. Concurrent 500 ms polling and
  signals-available pulls share the same FIFO cursor, so an operator click can
  queue behind unrelated backstop work. P14 measures the content engine, not
  this popup transaction, and therefore did not detect the regression.

### `EL-03-F009` — High — nested Alt inclusion leaves a stale explicit ancestor

- With trusted Alt input, transferring an explicit inclusion from a textual
  parent to its painted descendant left both parent and descendant visibly
  explicit. Repeating the gesture continued to expose contradictory layers.
- `applyToggle` correctly removes the ancestor from the canonical mark set, but
  the store returns the descendant as `branchRoot`; branch-only reevaluation
  and repaint therefore never retire the removed ancestor's evaluation and
  overlay. Existing tests assert canonical rows/`hasExplicitMark` only and miss
  the rendered-layer contradiction.

3DPrima's candidate returned the site's own SQL `max_user_connections` failure
during this matrix. Its reveal/complete-workflow cell is externally **BLOCKED**,
not passed or failed. A partially loaded occurrence still passed exact device,
consent, expanded-boundary, dirty-disable, and Content List checks. The error
document also exposed a robustness concern (a Ready surface followed by a
noncanonical/stuck guard), which remains diagnostic until reproduced on a
valid document.

`EL03-R7-AC-01` through `AC-04` and the automated portion of `AC-08` pass.
`AC-05`, `AC-06`, `AC-07`, and cumulative `AC-08` fail or remain blocked.
Production readiness is therefore **NO** and the delta below is mandatory.

# EL-03-R8 — Coalesce physical refits and restore operator-critical marking semantics

## 1. Goal

Make physical resize one guarded, generation-owned transaction; make Enable
marking independent of background polling latency; and make an Alt inclusion
transfer atomically correct in canonical state, rendered annotations, Content
List projection, and payload. Preserve every approved device, reveal, consent,
session, payload, and safety contract.

## 2. Decisions and non-goals

- Chrome debugger emulation remains the authority. Mobile stays exact 412x960,
  desktop stays exact 1920x1080, and scale continues to fit both physical axes.
- Shrink is safety-critical and begins immediately. Growth remains a trailing
  stable decision. A burst owns one opaque guard lease and one final fade.
- Window, popup, content, watchdog, reload, and expected metrics-echo events
  are observations of one per-tab physical-geometry generation, not independent
  permission to repaint.
- A no-op observation must not start a guard cycle. An already-opaque content
  guard still receives a terminal acknowledgement.
- Operator actions may consume newer signals ahead of an older polling reply by
  monotonic sequence, but may not invent lock, binding, or brain state. Older
  replies become harmless stale batches.
- Alt still takes precedence over Ctrl. Shift and Meta remain inert. No
  right-click marking UI returns.
- Do not alter endpoint payload schemas, Save/Load authority, immutable or
  hidden-element payload rules, consent suppression, or production services.

## 3. Implementation phases

### EL-03-R8-01 — Make Alt transfer's affected branch truthful

Files:

- `src/content/marking/store.ts`
- `src/content/marking/engine.ts`
- `tests/src/content/marking/marking.test.ts`
- `tests/src/content/marking/dom-bridge.test.ts`

Steps:

1. Before an include mutation, find the shallowest explicit-inclusion ancestor
   that the mutation removes. Return that ancestor as the evaluation/render
   root while retaining the clicked descendant as the decision target.
2. Reevaluate and repaint the complete affected branch once, removing the old
   ancestor overlay and adding exactly one descendant explicit-inclusion layer.
3. Assert canonical rows, rendered overlay classes/XPaths, preview rows,
   captured submission rows, and repeated Alt toggles. Cover direct text plus a
   nested `<span>`/`<strong>`, expanded-exclusion descendants, and no-ancestor
   cases.

### EL-03-R8-02 — Give each physical resize burst one transition owner

Files:

- `src/background/render-emulation-runtime.ts`
- `src/background/index.ts`
- `src/content/emulation-transition-guardian.ts`
- `src/entrypoints/content-loader.content.ts`
- `src/entrypoints/popup/main.tsx`
- `src/messaging/realms.ts`
- corresponding background/content/popup contract tests

Steps:

1. Add an internal refit observation carrying source, current presentation
   generation where available, and a normalized physical-height hint. Keep it
   internal; no public endpoint or permission changes.
2. Replace the 40 ms popup debounce and UI-root-size trigger with an immediate,
   dimension-signature-deduplicated physical viewport observation. Ordinary
   popup content/layout changes must emit nothing.
3. Replace the recursive queued/trailing sets with one per-tab burst
   coordinator. It merges the latest physical dimensions and all safety flags,
   adopts one opaque presentation lease, applies every newly smaller safe scale
   immediately, and settles/fades once after terminal quiet.
4. Treat larger scale as a generation-fenced trailing candidate. Confirm the
   same final dimensions after the quiet interval, write once, prove exact
   geometry, and settle the same lease.
5. Absorb expected content viewport echoes from the coordinator's own metrics
   writes. A foreign generation, debugger detach, navigation, or genuinely new
   physical signature still schedules recovery.
6. Read physical geometry before starting presentation for popup/window/watchdog
   no-op observations. If content already raised the guard, explicitly settle
   that exact generation even when no metrics write is necessary.
7. Preserve fail-closed rollback, durable lease recovery, hostile-page guard
   repair, scrollbar bounds, and starvation proof.

### EL-03-R8-03 — Add a priority-safe Enable marking transaction

Files:

- `src/entrypoints/popup/main.tsx`
- `src/popup/signal-cursor.ts`
- `src/background/index.ts` and `src/messaging/realms.ts` only if an atomic
  report-and-decide response is required
- `tests/src/popup/entrypoint.test.ts`
- `tests/src/popup/signal-cursor.test.ts`

Steps:

1. Enter `runSessionTransition` before context/signal/lock preflight so the
   500 ms lane and signals-available backstop cannot enqueue more work ahead of
   the click.
2. Remove duplicate preflight pulls. Reuse the exact current binding and the
   returned lock directive, then perform emulation and content activation.
3. Give the terminal marking fact a priority-safe monotonic adoption path. If a
   polling reply is older, it may finish but cannot delay or overwrite the
   action result. Persist the fact asynchronously through the existing durable
   queue; do not project a locally invented brain decision.
4. Resume polling once with one trailing pass in `finally`. Preserve every
   refusal toast, binding/lock fence, failure rollback, and clean-session seed.
5. Add debug stage evidence and integration tests with stalled fast and bound
   signal polls, signals-available races, duplicate clicks, binding changes,
   lock loss, and activation refusal.

### EL-03-R8-04 — Gates, publication, and exact headed revalidation

1. Run focused marking, emulation, popup, messaging, startup, and shield tests;
   then `pnpm check`, `pnpm verify`, and `pnpm build:debug`.
2. Run clean P17, standalone P14, and unchanged P25. Add a popup-level
   activation gate because P14 alone cannot prove operator latency.
3. Review the diff, update durable knowledge, commit intended source/tests/plan,
   push `re-write` normally, refresh the graph, and prove local/upstream 0/0.
4. Repeat exact-pushed repository `live-browser` tests on Aleris and Acne plus
   3DPrima when its candidate is healthy. Perform trusted resize shrink/grow,
   mobile/desktop/mobile, detach, reload, Enable/Disable, nested Alt, expanded
   exclusion, Content List, reveal/freeze, consent, and hygiene checks. Perform
   no prohibited external mutation.
5. Independently adjudicate every R8 and cumulative EL-03 criterion. Any failed,
   partial, blocked, or untested required cell rejects production readiness and
   opens the next delta.

## 4. Acceptance criteria

- `EL03-R8-AC-01` Parent-to-descendant Alt transfer leaves exactly one explicit
  descendant in canonical state, visible layers, preview, and payload; the
  ancestor is absent immediately after the acknowledged mutation.
- `EL03-R8-AC-02` One physical shrink/grow burst produces one guard entry and
  one fade, with no old-scale released sample, clipped device bottom, redundant
  no-op cycle, or self-induced retry.
- `EL03-R8-AC-03` Shrink applies the first safe scale at the earliest observed
  physical event; growth applies exactly once after stable trailing proof. Both
  modes remain exact and fully fit both axes.
- `EL03-R8-AC-04` Detach, navigation, reload, starvation, hostile guard, and
  genuine foreign viewport changes still recover or fail closed without stale
  generation adoption.
- `EL03-R8-AC-05` On an already prepared candidate, Enable marking becomes
  checked and interaction-ready within 1,000 ms at p95 and 1,500 ms worst-case,
  even with an older poll stalled. Emulation and content presentation remain
  independently measured.
- `EL03-R8-AC-06` The action consumes one authoritative terminal decision,
  resumes one trailing poll, ignores older replies, and retains binding, lock,
  duplicate-click, and failure rollback correctness.
- `EL03-R8-AC-07` All unchanged automated gates pass and fresh Aleris/Acne/
  healthy-3DPrima headed checks retain reveal, consent, labeling, annotation,
  Content List, payload, and console/network hygiene contracts.
- `EL03-R8-AC-08` Exact normal push/0:0 synchronization and a complete
  cumulative matrix exist before any production-ready verdict.

## 5. Todo chain

1. `el03-r8-alt-transfer-projection` -> 0
2. `el03-r8-refit-burst-coordinator` -> 1
3. `el03-r8-priority-activation` -> 2
4. `el03-r8-focused-full-gates` -> 3
5. `el03-r8-review-push` -> 4
6. `el03-r8-headed-conformance` -> 5
7. `el03-r8-cumulative-audit` -> 6

# EL-03-R8 pre-publication execution ledger — 2026-09-02

## Implemented delta

- `R8-01`: inclusion transfer now returns the shallowest removed explicit
  ancestor as the affected evaluation/render branch while retaining the clicked
  descendant as the canonical target. Nested, expanded-exclusion, repeated
  toggle, overlay, Content List, and payload evidence was added.
- `R8-02`: refit entrypoints now submit typed observations to one per-tab burst
  coordinator. The coordinator measures before ordinary no-op presentation,
  adopts an already-opaque content generation, performs immediate safety
  shrink, holds growth for the stable trailing proof, and settles one lease.
  Popup UI-root observation/debounce was removed in favor of immediate physical
  height signatures.
- `R8-03`: session-transition admission now precedes marking preflight. Polling
  replies are generation-fenced, priority cursor claims are monotonic, duplicate
  pulls were removed, and the internal atomic `fact.reportAndPull` command
  returns the real brain terminal decision while durable persistence continues
  through the existing ordered queue. One local reconciliation resumes after
  the transition.

## Final-tree evidence before clean-source publication gates

- Focused marking/emulation/popup/messaging/startup/shield set: **PASS**, 9 files,
  412 tests.
- Full suite with file-level scheduling serialized because the host was under
  unrelated CPU contention: **PASS**, 149 files, 1,695 tests, 158.88 seconds.
- `pnpm lint`: **PASS**.
- `pnpm check`: **PASS**, including generated page-world/icon checks and all
  three TypeScript projects.
- Production `pnpm build`: **PASS**; generated-manifest permission contract:
  **PASS**, 7/7.
- `pnpm build:debug`: **PASS**.
- The default-concurrency test stage was also attempted twice. It produced
  non-repeatable five-second timeouts in different heavy integration files
  while unrelated desktop processes saturated the host; every timed-out file
  passed its isolated serial rerun, and the exact complete test set passed twice
  with file parallelism disabled. No deterministic assertion failure occurred.
- Pre-commit P17 behavior: **PASS**, all 19/19 required checks and complete
  cleanup. Its command correctly returned nonzero only because
  `cleanSourceSet=false` while this implementation and ledger were uncommitted.

## Review corrections

- Removed the remaining serialized signal pull from the replacement-document
  lock revalidation path so a reload cannot reintroduce the polling delay.
- Attached terminal error handling to the deliberately asynchronous durable
  fact write so persistence failure cannot become an unhandled rejection.

## Publication boundary

The clean-source P17, standalone P14, and unchanged P25 gates must be run from
the committed tree. Exact headed Aleris/Acne/healthy-3DPrima evidence and the
independent cumulative adjudication remain mandatory before a production-ready
verdict; this ledger does not predeclare that verdict.

# EL-03-R8 exact-pushed conformance rejection — 2026-09-02

R8 plan conformance is **REJECTED** on pushed commit
`ad6f545f6eb10a9e6b1595596cae022e31ea150e` (`re-write`, upstream 0:0).
The repository `live-browser` production bundle used managed Chromium only;
no AI, Save, Lynx publication, deployment, or backend mutation occurred.

- `EL03-R8-AC-02` and `EL03-R8-AC-03` fail. On HumaNova, a physical
  1279x899 -> 855x599 shrink produced one released animation frame and a 38 ms
  interval between the first popup/bounds resize observation and the first
  opaque input guard. On a current authoritative Aleris candidate, the same
  shrink produced 14 released animation frames and a 248 ms interval. The
  prior fitted mobile scale remained 0.7791667 during those intervals even
  though the eventual safe scale was 0.4666667, so the simulated 412x960 device
  could be physically clipped before protection.
- The coalescing half of R8 is proven: each shrink and growth used one guard
  generation, one posture write, and one fade; the identical-bounds no-op used
  zero guards and zero posture writes. The residual is therefore retained as
  `EL-03-F007`, not reopened churn.
- Exact source inspection identifies the remaining ordering defect:
  `executeRefitObservation` awaits debugger-attachment and `tabs.get` physical
  geometry before `beginRefitPresentation`. The Aleris trace created its new
  presentation generation about 240 ms after the bounds event. A real shrink
  is already visible while those asynchronous reads are queued.
- The R8 priority activation change has supporting live evidence: after the
  one-time HumaNova reveal/freeze preparation, a trusted disable/re-enable
  reached checked, interactive marking in 243 ms. The cold document's reveal
  preparation is retained separately and is not counted as a warm activation
  sample.
- General trusted marking gestures and native right-click behavior passed on
  HumaNova. Exact nested transfer, remaining recovery cells, the user-supplied
  property matrix, and cumulative adjudication are deferred to the delta result
  because one failed required criterion already rejects this inner loop.

Evidence:

- `.temp/expert-live-r8/2026-09-02T16-17-02-288Z-resize.json`
- `.temp/expert-live-r8/2026-09-02T16-23-18-724Z-resize.json`
- `.temp/expert-live-r8/2026-09-02T16-16-37-367Z-activate.json`
- `.temp/expert-live-r8/2026-09-02T16-19-01-636Z-gestures.json`

# EL-03-R9 — Pre-guard proven unsafe physical shrink

## 1. Goal

Close the residual `EL-03-F007` exposure window without regressing R8's single
burst ownership or no-op behavior. A bounds event that can already prove the
held device no longer fits must begin one opaque presentation lease before any
potentially delayed debugger/tab read; actual browser geometry remains the sole
authority for the scale write and terminal proof.

## 2. Decisions and non-goals

- Cache only last-proven physical tab and outer-window geometry. A new bounds
  event may derive a conservative projected tab viewport from the exact outer
  delta solely to decide whether protection must begin early.
- Projected geometry may begin/reuse the safety lease, but may never authorize
  a debugger write, a final fitted scale, or release. Fresh `tabs.get` geometry,
  exact device verification, and the existing trailing proof retain those
  authorities.
- Growth is safe at the smaller prior scale and keeps the existing trailing
  path. A duplicate event, identical bounds, or a changed non-limiting axis that
  still fits must not begin a guard or write metrics.
- If the projection is unavailable, stale, changes window ownership, or races a
  transition, fall back to the current fail-closed serialized path. Do not
  guess a tab size.
- Preserve exact 412x960 mobile and 1920x1080 desktop identity, one burst/one
  fade, expected-echo absorption, debugger recovery, navigation fences,
  hostile guard repair, permissions, public schemas, and all R8 marking work.

## 3. Implementation phases

### EL-03-R9-01 — Maintain generation-safe physical geometry baselines

Files:

- `src/background/render-emulation-runtime.ts`
- `tests/src/background/render-emulation-runtime.test.ts`

Steps:

1. Retain the latest successfully read effective physical tab viewport per tab
   and the matching normalized outer bounds per owning window. Initialize the
   outer baseline when a tab/window association is first proved; update it on
   each complete bounds event and clear both caches on release/removal.
2. For a bounds event with complete prior/current geometry, project the new tab
   viewport by applying the exact outer width/height delta to the last-proven
   tab viewport. Fence the projection by tab, window, held posture epoch, and
   positive finite dimensions.
3. Carry that projection only in the internal refit observation/coordinator.
   Merge repeated sources conservatively and never expose it through popup or
   public message schemas.

### EL-03-R9-02 — Begin the shrink lease before delayed reads

Files:

- `src/background/render-emulation-runtime.ts`
- `tests/src/background/render-emulation-runtime.test.ts`

Steps:

1. At the first coordinator execution turn, compare a current verified posture
   with the fenced projection. If it proves clipping, begin or reuse the one
   refit lease before awaiting `debugger.getTargets` or `tabs.get`.
2. Continue through the existing authoritative physical read. Apply an
   immediate scale-only shrink only from that fresh value, refresh the burst's
   exact signature, and retain one quiet settlement/fade.
3. If authoritative measurement contradicts the projection, settle the same
   lease without a metrics write. If attachment, navigation, or presentation
   ownership changes, keep the page guarded and enter the existing recovery
   path without adopting stale geometry.
4. Keep growth, popup/content observation merging, self-echo absorption, and
   identical/non-limiting no-op observations on their existing zero-guard path.

### EL-03-R9-03 — Prove ordering, failure containment, and full regression

Files:

- `tests/src/background/render-emulation-runtime.test.ts`
- affected emulation/background/browser contract tests

Steps:

1. Add a deferred `getTargets`/`tabs.get` regression showing an unsafe shrink's
   `begin` is delivered before either read resolves and before its metrics write.
2. Cover one exact scale write/lease/fade across multi-source bursts; no guard
   for identical bounds or a still-fitting non-limiting change; conservative
   contradiction settlement; missing baseline fallback; stale window/posture
   fences; detach/navigation during the pre-guard; and cache cleanup.
3. Run the focused emulation/startup/shield set, full `pnpm verify`, debug build,
   clean P17, standalone P14, and unchanged P25 on the exact final source.

### EL-03-R9-04 — Publish and repeat exact headed conformance

1. Review all intended changes, update durable knowledge and this ledger,
   commit normally, push `re-write`, and prove upstream 0:0.
2. Restart repository `live-browser` from the pushed bundle. On at least
   HumaNova and a current authoritative Aleris candidate, require zero released
   page animation/compositor samples from the first unsafe shrink observation
   through opaque guard paint, one generation/write/fade, safe trailing growth,
   and zero identical-bounds work.
3. Re-run warm Enable marking samples, nested parent-to-descendant Alt transfer,
   mobile/desktop/mobile, detach/reload, Content List, consent, reveal/freeze,
   and hygiene checks across the user-supplied property URLs. Derive candidate
   pages only from the extension's authoritative candidate controls. Keep
   unavailable/non-candidate/site-owned failures outside the pass denominator.
4. Independently adjudicate all R8/R9 and cumulative EL-03 criteria. Any failed,
   partial, blocked, or untested required cell opens the next delta and cannot
   produce a production-ready verdict.

## 4. Acceptance criteria

- `EL03-R9-AC-01` With debugger and tab reads deliberately stalled, an unsafe
  bounds shrink makes the exact current document guard opaque before either
  read resolves; no metrics write occurs until fresh physical geometry arrives.
- `EL03-R9-AC-02` Fresh headed shrink evidence contains zero released page or
  compositor samples after the first unsafe physical event, while retaining
  exactly one guard generation, one safe scale write, and one fade.
- `EL03-R9-AC-03` Growth writes once only after stable quiet. Identical bounds
  and a changed but still-fitting non-limiting axis produce zero guard entries
  and zero debugger/posture writes.
- `EL03-R9-AC-04` A wrong/missing projection, window handoff, posture change,
  detach, navigation, reload, starvation, or hostile guard cannot authorize a
  stale write or exposed release; recovery remains generation-fenced and
  fail-closed.
- `EL03-R9-AC-05` R8's Alt transfer and priority activation criteria remain
  fully passing in automated and exact-pushed headed evidence.
- `EL03-R9-AC-06` All unchanged repository/browser gates pass, the supplied
  property matrix is truthfully classified, and the exact reviewed commit is
  pushed and synchronized 0:0 before cumulative review.

## 5. Todo chain

1. `el03-r9-physical-baseline` -> 0
2. `el03-r9-early-shrink-lease` -> 1
3. `el03-r9-focused-full-gates` -> 2
4. `el03-r9-review-push` -> 3
5. `el03-r9-headed-conformance` -> 4
6. `el03-r9-cumulative-audit` -> 5

# EL-03-R9 pre-publication execution ledger — 2026-09-02

## Implemented delta

- The runtime now retains browser-proven physical tab rectangles and complete
  owning-window bounds separately from short-lived successive-event
  projections. A window handoff invalidates the old tab projection; release or
  removal retires all tab geometry and the last unused window baseline.
- A complete bounds delta is fenced to the exact tab/window/held-posture epoch.
  If that projection proves the current device would clip, the runtime begins
  or reuses the burst's opaque presentation lease before debugger-target or tab
  geometry reads. A genuine bounds occurrence with no current projection also
  guards fail-closed.
- Fresh `tabs.get` geometry remains the only scale-write and settlement
  authority. A contradicted projection settles its one lease with no metrics
  write; identical bounds and changed non-limiting geometry retain zero guard
  and zero write behavior.

## Exact-source automated evidence

- Focused runtime: **PASS**, 1 file, 62 tests. This includes independently
  deferred `debugger.getTargets` and `tabs.get`, missing-baseline fail-closed,
  contradicted projection, identical/non-limiting no-op, authoritative window
  handoff, old-window retirement, and post-clear cache retirement cases.
- Cross-module emulation/guardian/startup/marking/messaging/popup set: **PASS**,
  9 files, 437 tests.
- `pnpm lint`: **PASS**.
- `pnpm check`: **PASS**, including generated page-world/icon checks and all
  three TypeScript projects.
- Full `pnpm verify`: **PASS** at default concurrency, 149 files and 1,702
  tests, production build, and generated-manifest permission contract 7/7.
- `pnpm build:debug`: **PASS**.
- The preferred codebase knowledge-graph transport was retried during source
  discovery but remained unavailable with `Transport closed`; targeted local
  source inspection was used as the documented fallback.

## Publication boundary

The reviewed delta still requires a normal commit/push and 0:0 proof. Clean
P17, standalone P14, unchanged P25, exact-pushed headed resize/activation/Alt
checks, the supplied property matrix, and cumulative expert adjudication remain
mandatory; this ledger does not predeclare production readiness.

# EL-03-R9 exact-pushed conformance rejection — 2026-09-02

R9 plan conformance is **REJECTED** on pushed commit
`42dbedbcc708b2a870bed25b112f4620b6528eb9` (`re-write`, upstream 0:0).
The production bundle was rebuilt by repository `live-browser`; its attested
Git tree is `2be8194f5de3c80920e2fa3c0e7484b55eb23a85`. The launcher's broad
`source.clean` flag was false only because retained untracked acceptance
artifacts remain in `output/playwright`; the tracked source and upstream were
clean and identical.

- Clean P17 passed 19/19, standalone P14 passed all 192 scenarios, and P25
  passed with all seven children plus its deterministic warm-up validated.
- HumaNova passed the strict shrink/grow/no-op probe. Its 1279x899 -> 855x599
  shrink had zero released animation frames after the first bounds observation,
  one guard generation, one fitted-scale write (0.7791667 -> 0.4666667), one
  fade, and a 12 ms bounds-to-opaque interval.
- The current extension-authoritative Aleris candidate
  `/mage-tarm/kapselendoskopi/forberedelser/` failed the same required probe.
  It exposed 10 released animation frames for 181 ms after the bounds event,
  although the terminal result still had one generation, one scale write, one
  fade, and correct 0.4666667 geometry. Growth and identical-bounds behavior
  remained correct.
- The new generation was created 168 ms after the Aleris bounds timestamp.
  Because R9 creates its lease at the top of `executeRefitObservation`, before
  either browser read, this proves the remaining delay is admission behind the
  existing per-tab emulation-operation queue rather than the reads inside that
  execution. `EL-03-F007` therefore remains open with a narrower queue-admission
  root cause.

Evidence:

- `.temp/expert-live-r9/2026-09-02T17-20-14-402Z-resize.json`
- `.temp/expert-live-r9/2026-09-02T17-21-53-707Z-resize.json`
- `.temp/expert-live-r9/2026-09-02T17-21-34-218Z-snapshot.json`
- `output/playwright/p17-preview/acceptance-2026-09-02T16-59-04-997Z.json`
- `output/playwright/p14-marking-performance/acceptance-2026-09-02T16-59-31-676Z.json`
- `output/playwright/p25-parity/acceptance-2026-09-02T17-18-11-325Z.json`

# EL-03-R10 — Queue-independent physical resize admission

## 1. Goal

Make a proven-unsafe physical bounds occurrence synchronously re-arm the exact
document's retained guard through the content command lane before it joins the
per-tab emulation-operation queue. Preserve R9's authoritative geometry/write
path and one-generation burst semantics.

## 2. Decisions and non-goals

- Add a narrow guardian operation for a browser-proven physical viewport
  occurrence. It may only make the retained exact-mode document opaque and
  return its generation; it cannot mutate emulation, classify content, or
  settle/release presentation.
- The first idle occurrence advances the content-owned presentation generation.
  Repeated occurrences while the same guard is already fully opaque reuse that
  generation. A physical occurrence during a stale settle/transition re-arms
  guarding and invalidates that older paint epoch so it cannot fade over newer
  geometry.
- Background bounds admission starts this content operation immediately, outside
  `withEmulationOperation`. Its result is adopted only while the same held
  posture epoch remains current. Failed, stale, wrong-mode, unavailable, or
  malformed delivery falls back to R9's serialized fail-closed path.
- Fresh `tabs.get` remains the sole scale-write and release authority. Safe
  growth, identical bounds, and still-fitting non-limiting changes do not invoke
  the fast guard lane.

## 3. Implementation and proof phases

### EL-03-R10-01 — Add exact-document physical guard admission

Files:

- `src/content/emulation-transition-guardian.ts`
- `src/entrypoints/content-loader.content.ts`
- `src/background/index.ts`
- `src/background/render-emulation-runtime.ts`
- messaging/content/background unit tests

Steps:

1. Expose a mode-fenced synchronous guardian method that installs/repairs the
   canonical opaque input guard, advances or reuses one safe generation, clears
   stale abort authority, and never emits the ordinary viewport echo callback.
2. Route one internal `emulationViewportGuard` content command and strictly
   validate the returned guardian result before exposing only its positive
   generation to the runtime.
3. From `windows.onBoundsChanged`, invoke that lane immediately only when the
   current R9 projection requires protection. Queue the normal refit with the
   adopted generation after delivery; fence late responses by held object/epoch.
4. Retain R9 early execution guarding as the fallback/backstop and preserve
   conservative coalescing, actual-read writes, quiet growth, and cleanup.

### EL-03-R10-02 — Prove queue bypass and transition races

1. Stall an unrelated `current`/watchdog operation, fire an unsafe bounds event,
   and prove the content fast guard is invoked and opaque while the serialized
   browser read remains unresolved. After release, require adoption of exactly
   that generation, one actual-geometry scale write, and one fade.
2. Cover repeat-event generation reuse; safe/identical zero-fast-guard; failed
   delivery fallback; wrong mode/posture epoch; active begin/settle invalidation;
   navigation/disposal; and hostile-root repair.
3. Re-run focused modules, full `pnpm verify`, debug build, clean P17,
   standalone P14, and unchanged P25 on exact final source.

### EL-03-R10-03 — Publish and repeat conformance

1. Review, update durable knowledge/ledger, commit, push, and prove 0:0.
2. Rebuild through `live-browser` and require zero released shrink samples on
   both HumaNova and the authoritative Aleris candidate, with one generation,
   one actual write, one fade, safe growth, and zero no-op work.
3. Only after that blocker closes, execute the remaining activation, exact
   nested Alt transfer, recovery, Content List, reveal/freeze, consent, hygiene,
   and supplied-property matrix cells, then run independent cumulative review.

## 4. Acceptance criteria

- `EL03-R10-AC-01` An unsafe bounds event invokes an exact-mode document guard
  before an already-stalled emulation operation resolves; the page is opaque and
  input-fenced without waiting for that queue.
- `EL03-R10-AC-02` The queued refit adopts the fast guard's generation and still
  performs no write until fresh physical tab geometry proves the scale.
- `EL03-R10-AC-03` A multi-event physical burst owns one generation/fade. Safe
  growth, identical bounds, and still-fitting changes use zero fast-guard calls.
- `EL03-R10-AC-04` Stale mode/document/posture responses, delivery failure,
  navigation, detach, active transition, and hostile guard mutation cannot grant
  stale write or release authority; all failure paths remain opaque or recover.
- `EL03-R10-AC-05` Exact-pushed HumaNova and authoritative Aleris shrink traces
  contain zero released frames after the first bounds observation, while all R8/
  R9 automated and headed contracts remain passing.

## 5. Todo chain

1. `el03-r10-content-fast-guard` -> 0
2. `el03-r10-background-admission` -> 1
3. `el03-r10-race-regressions` -> 2
4. `el03-r10-full-browser-gates` -> 3
5. `el03-r10-review-push` -> 4
6. `el03-r10-headed-matrix` -> 5
7. `el03-r10-cumulative-audit` -> 6

# EL-03-R10 implementation and pre-publication proof — 2026-09-02

R10 is implemented on the working tree and its review/fix loop is clean. The
new exact-document command is a synchronous presentation-only operation; the
bounds listener launches it before `withEmulationOperation`, carries its bounded
generation promise through refit coalescing, posture-fences the result, and
retains fresh `tabs.get` as the only scale-write and release authority.

Regression proof now covers:

- synchronous idle admission, hostile-root repair, repeat-generation reuse,
  wrong-mode refusal, and invalidation of an older settle epoch without a fade;
- the shipped content command and interaction-shield reflection without an
  ordinary `emulation.refit` echo;
- the actual background typed-bus route being the first synchronous operation
  emitted by a changed unsafe bounds event;
- a deliberately stalled per-tab debugger operation, proving admission occurs
  while the queue is unresolved and the eventual refit adopts generation 88,
  performs one fresh-geometry scale write, and settles once;
- failed/repeated admission replies during coalescing, plus zero fast-guard work
  for identical or still-fitting projections.

Validation on this exact source:

- focused guardian/content/runtime/startup suite: 4 files, 137 tests passed;
- `pnpm lint`: passed;
- `pnpm check`: passed;
- `pnpm verify`: 149 files / 1,705 tests passed, production build passed, and
  generated-manifest permissions passed 7/7;
- `pnpm build:debug`: passed;
- pre-publication P17: all 19 functional checks passed, but the controller
  correctly emitted no acceptance artifact because the intended tracked source
  was not committed yet (`cleanSourceSet=false`). This is evidence only, not a
  clean-gate pass; P17, P14, and P25 must be rerun after commit/push.

No generated gate output or previously retained untracked acceptance artifact
is part of the intended commit. Exact-pushed headed HumaNova/Aleris resize proof,
the remaining supplied-property matrix, and cumulative expert adjudication are
still mandatory and no production-readiness conclusion is declared here.

# EL-03-R10 exact-pushed conformance rejection — 2026-09-02

R10 is **REJECTED** on exact pushed commit
`52783077526d86049394a64319a405ae15519429` (upstream 0:0). Clean P17 passed
19/19, standalone P14 passed all 192 scenarios, and P25 passed its validated
warm-up plus all seven children. The first headed HumaNova shrink had zero
released animation frames before opacity, one correct scale write
(`0.7791667 -> 0.4666667`), and a terminal idle guard, so the queue-independent
content command closed the original visibility interval. It nevertheless
created two presentation generations and therefore violates the one-generation
burst contract.

The trace proves the sequence: the content fast guard installed generation
`1788372295101002` with cause `viewport-change`; nine milliseconds later the
serialized refit installed independently generated
`1788372310946001` with cause `refit`. The side panel's resize observation can
enter `requestRefit` just before the background bounds callback. Once that
observation is removed from `coordinator.pending` and waits/runs in the per-tab
queue, R10's guard promise exists only on the later bounds observation and is
invisible to the already-running executor. A raw exact-document command reply
was separately captured and is fully valid (`ok`, mode `mobile`, stage
`guarding`, opaque coverage, positive generation), ruling out content coverage
or typed-response parsing as the root cause.

Evidence:

- `.temp/expert-live-r10/2026-09-02T18-05-19-763Z-resize.json`
- `.temp/expert-live-r10/2026-09-02T18-06-11-090Z-raw-fast-guard.json`
- `output/playwright/p17-preview/acceptance-2026-09-02T17-44-53-974Z.json`
- `output/playwright/p14-marking-performance/acceptance-2026-09-02T17-45-18-612Z.json`
- `output/playwright/p25-parity/acceptance-2026-09-02T18-03-59-756Z.json`

# EL-03-R11 — Shared admission at every refit presentation boundary

## Goal and decision

Publish each bounds-triggered fast-guard promise on the live per-tab refit
coordinator as well as its own observation. Every executor for that coordinator,
including an observation already detached from `pending`, must merge and
posture-fence the latest admission immediately before it creates or settles a
presentation lease. The coordinator's lifetime bounds the shared admission; a
new posture/coordinator cannot inherit it.

## Acceptance criteria

- `EL03-R11-AC-01` A side-panel/popup refit stalled before physical measurement,
  followed by an unsafe bounds event, observes the already-shrunk tab after it
  resumes and still begins with the fast guard's exact generation—never a newly
  generated lease.
- `EL03-R11-AC-02` Multiple admissions share first-valid arbitration; a lost or
  slow response cannot poison a later valid generation, and all posture/mode
  fences remain in force.
- `EL03-R11-AC-03` Presentation creation and no-op settlement both re-read the
  coordinator admission, closing arrivals that occur after an executor's first
  snapshot. One physical burst produces one generation, one write when needed,
  and one terminal settle/fade.
- `EL03-R11-AC-04` Full automated/browser gates and exact-pushed HumaNova plus
  authoritative Aleris traces pass before the wider supplied-property matrix
  resumes.

## Todo chain

1. `el03-r11-shared-admission` -> 0
2. `el03-r11-running-executor-regression` -> 1
3. `el03-r11-full-gates` -> 2
4. `el03-r11-review-push` -> 3
5. `el03-r11-headed-conformance` -> 4
6. `el03-r11-property-matrix` -> 5
7. `el03-r11-cumulative-audit` -> 6

## R11 live preflight amendment — side-panel pre-paint admission

The first dirty-source Aleris preflight proved that shared coordinator adoption
alone is insufficient. It used one generation and one correct write, but the
page released 16 animation frames for 269 ms before opacity. A 12-cycle worker
witness reproduced the mechanism: the side panel observed a shrink at
`1788373270434`, while Chromium did not dispatch the matching
`windows.onBoundsChanged` service-worker event (and therefore did not start the
content guard send) until `1788373270560`, 126 ms later. Page animation frames
continued throughout, so this was event delivery latency rather than a blocked
renderer.

R11 therefore also uses the already-open side panel's native `resize` event as
a pre-paint admission lane. It sends `emulationViewportGuard` straight to the
bound tab without an intervening `tabs.get`/query or service-worker hop, then
passes the content-measured generation to `emulation.refit`. The background
accepts that generation only from popup/content provenance and preserves the
background bounds listener as the standing fallback when no panel exists.
Bounds projections now fast-guard safe expansion only when the projection
actually changes fitted scale; this makes the popup and worker signals converge
on the same generation instead of creating a second growth lease.

Dirty-source stress evidence after both changes:

- `.temp/expert-live-r10/2026-09-02T18-31-23-860Z-resize-stress.json`: 20/20
  alternating shrink/grow occurrences passed; every occurrence had one
  generation, one write, and terminal idle; all ten shrink occurrences had zero
  released pre-opaque frames.
- `.temp/expert-live-r10/2026-09-02T18-31-31-802Z-take-worker-bounds-witness.json`:
  Chromium delayed three worker bounds deliveries by 82–94 ms, including two
  shrink occurrences; the popup lane still admitted the guard in 7–14 ms and
  the page exposed zero unsafe shrink frames.

These are diagnostic preflight artifacts, not acceptance evidence. Rename the
final harness output to R11, finish automated review, commit/push, and repeat the
headed proof from exact pushed source before closing `EL03-R11-AC-04`.

## R11 implementation and pre-publication proof — 2026-09-02

The R11 amendment is implemented and the dirty-source fix/review loop is clean.
The final design has three cooperating admission paths:

1. The side panel primes a top-frame `chrome.tabs.connect` channel during normal
   setup. On native resize it sends the narrow guard request directly to the
   document; the existing typed message is retained as a concurrent fallback.
   Obvious height shrink starts before the first browser API await, while an
   exact `windows.getCurrent` comparison covers width-only, mixed-axis, and
   growth changes. Identical bounds remain guard/refit no-ops.
2. The background publishes every worker-bounds or popup/content generation
   into one mutable, posture-owned admission. An executor already awaiting a
   slow worker candidate is woken by the first later valid content generation;
   a failed/slow candidate cannot hold that valid authority behind
   `Promise.all`. Executors re-read the shared admission at every
   pre-presentation boundary, while fresh `tabs.get` remains the only write and
   release authority.
3. If Chromium delays both the worker's guard reply and the popup-to-worker
   refit message beyond the bounded admission, a fallback `refit` begin may ask
   the document to adopt its already-opaque `viewport-change`/`refit` guard.
   The guardian returns that exact active generation, advances its replay floor
   past the speculative worker generation, re-proves opacity, and later settles
   the retained generation. It never creates a second visual entry.

Regression proof covers the direct port's exact request/reply validation,
timeout/disconnect/reconnect cleanup, popup shrink/growth ordering and identical
no-op behavior, running-executor admission publication, slow-first/valid-later
arbitration, worker fallback adoption, projection coalescing, and the guardian's
retained-generation/replay-floor lifecycle.

Validation on the current intended source:

- focused runtime/guardian/port/popup suite: 4 files / 173 tests passed;
- `pnpm verify`: 150 files / 1,712 tests passed; lint, all TypeScript projects,
  generated assets, production build, and generated-manifest permissions 7/7
  passed;
- debug/live build: passed;
- Aleris authoritative candidate 50-cycle alternating resize stress:
  `.temp/expert-live-r11/2026-09-02T19-14-25-590Z-resize-stress.json` passed;
  every occurrence used one generation, one write, and terminal idle, and all
  25 unsafe shrink occurrences had zero released frames before opacity;
- the slower Aleris shrink/grow/no-op sequence:
  `.temp/expert-live-r11/2026-09-02T19-14-56-025Z-resize.json` passed;
- pre-publication P17 exercised all 19 behavioral checks successfully and
  correctly withheld acceptance solely because the intended source is still
  uncommitted (`cleanSourceSet=false`).

The clean P17/P14/P25 gates, exact-pushed HumaNova/Aleris headed proof, supplied
17-property matrix, and cumulative expert adjudication remain pending until the
reviewed commit is pushed. No production-readiness conclusion is declared by
this pre-publication result.

# EL-03-R11 exact-pushed compositor rejection — 2026-09-02

R11 is **REJECTED** on exact pushed commit
`7edeeaa7312a11fe3b3700bb272f83e44f726b13` (upstream 0:0). Clean P17 passed
19/19, standalone P14 passed all 192 scenarios, and P25 passed its validated
warm-up plus all seven children. Exact-pushed activation completed in 640 ms,
and the slower HumaNova shrink/grow/no-op sequence passed. The strict 50-cycle
HumaNova stress nevertheless reported released animation callbacks before three
shrink guards, so it was not accepted on those aggregate results.

An independent CDP screencast then proved the defect is compositor-visible, not
a conservative harness artifact. In repeated 1279x899 -> 855x599 changes, Chrome
presented a 469x448 frame containing the stale/clipped 412x960 page before the
opaque guard on three of six sampled shrink occurrences. One representative
cycle delivered the popup resize observation at `1788378647039`, mutated the
guard opaque nine milliseconds later, but still presented stale content at
`1788378647059` before the opaque frame. The direct port fixes transport and
generation races, but it cannot retroactively cover a surface frame already
queued while the idle guard lacks a retained compositor plane.

Evidence:

- `.temp/expert-live-r11/2026-09-02T19-43-58-710Z-resize-stress.json`
- `.temp/expert-live-r11/screencast/2026-09-02T19-47-13-627Z/evidence.json`
- `.temp/expert-live-r11/screencast/2026-09-02T19-50-43-137Z/evidence.json`
- representative stale frame:
  `.temp/expert-live-r11/screencast/2026-09-02T19-50-43-137Z/0066.jpg`
- following opaque frame:
  `.temp/expert-live-r11/screencast/2026-09-02T19-50-43-137Z/0067.jpg`

# EL-03-R12 — Retained compositor safety plane

## Goal and decision

Keep the canonical, document-start transition guard mounted as a dedicated
compositor candidate for the entire held emulation posture, including its
transparent idle state. Guard admission must remain a synchronous opacity/input
flip on that retained plane; it must not require first allocating or repainting
the solid guard surface after a physical resize has already queued a frame.

This is a falsifiable rendering hypothesis, not an acceptance relaxation. CDP
screencast frames are the authority. If a promoted plane still exposes one stale
shrink frame, reject this approach and continue the architecture loop rather
than lowering the gate.

## Acceptance criteria

- `EL03-R12-AC-01` The idle guard remains mounted, visually transparent,
  non-interactive, and compositor-promoted without changing the emulated page's
  exact layout, interaction targeting, accessibility exposure, or screenshots.
- `EL03-R12-AC-02` Guarding, paint proof, settle, fade, hostile-root repair,
  suspension, release, navigation, and debugger recovery preserve their
  generation/authority contracts with no extra entry or terminal fade.
- `EL03-R12-AC-03` Exact-pushed HumaNova and Aleris each pass at least 50
  alternating physical resize occurrences with one generation/write/terminal
  lifecycle per occurrence and zero compositor-visible stale shrink frames.
- `EL03-R12-AC-04` Focused tests, full `pnpm verify`, debug build, clean P17,
  standalone P14, and P25 remain green before the 17-property matrix resumes.

## Todo chain

1. `el03-r12-compositor-plane` -> 0
2. `el03-r12-rendering-regressions` -> 1
3. `el03-r12-dirty-headed-falsification` -> 2
4. `el03-r12-full-gates` -> 3
5. `el03-r12-review-push` -> 4
6. `el03-r12-exact-headed-conformance` -> 5
7. `el03-r12-property-matrix` -> 6
8. `el03-r12-cumulative-audit` -> 7

## R12 prototype rejection — DOM promotion is insufficient

The first retained-plane prototype added `will-change: opacity` plus a 3D
transform to the permanently mounted guard and passed its focused unit suite.
It is rejected by dirty-source compositor evidence: five of ten HumaNova shrink
occurrences still presented stale page content before the guard. The guard's
DOM mutation was prompt (10–17 ms after the popup boundary), but promotion
cannot amend a physical WebContents surface frame Chrome queued before that
renderer task. The prototype was removed; R12 now continues at the browser-owned
emulation/compositor boundary, with no acceptance criterion weakened.

Evidence:

- `.temp/expert-live-r12/screencast/2026-09-02T19-56-22-683Z/evidence.json`
- representative stale frame:
  `.temp/expert-live-r12/screencast/2026-09-02T19-56-22-683Z/0002.jpg`

## R12 browser-owned prefit result — open panel passes, closed panel rejected

The next prototype moved the safety operation out of the page renderer. While
the side panel is live, its native resize boundary now admits the retained
content guard and submits one conservative scale-only
`Emulation.setDeviceMetricsOverride` command directly to Chrome in the same
task. A long-lived runtime port tells the worker which exact tab owns that
earlier boundary, preventing a duplicate worker shrink command. The serialized
background refit adopts a completed prefit only after re-proving the held
posture and fresh physical geometry; stale, growing, detached, failed, or
mode-mismatched attempts fall back to the authoritative refit path.

Dirty-source compositor falsification passes the open-panel portion of the
contract:

- HumaNova: 50 alternating occurrences / 25 shrinks, exactly one popup prefit
  per shrink, zero worker shrink duplicates, and zero non-412x960 shrink
  frames across 1,389 compositor frames;
- Aleris authoritative article: 50 alternating occurrences / 25 shrinks,
  exactly one popup prefit per shrink, zero worker shrink duplicates, and zero
  non-412x960 shrink frames across 836 compositor frames.

Evidence:

- `.temp/expert-live-r12/screencast/2026-09-02T21-10-57-456Z/evidence.json`
- `.temp/expert-live-r12/screencast/2026-09-02T21-12-16-185Z/evidence.json`

The same architecture is **REJECTED** for the approved durable posture while
the side panel is closed. In that lifecycle there is no live panel document to
receive the earlier native resize boundary. The worker submits its direct
prefit before guard allocation as soon as `windows.onBoundsChanged` arrives,
which was sufficient for HumaNova's 50-cycle run, but not deterministic on the
Aleris candidate. Six of 25 Aleris shrink occurrences exposed one 855x456
clipped frame before the worker command could affect the resized surface. The
bounds event arrived roughly 95–136 ms after the physical resize request; the
bad frame was already queued or presented within a few milliseconds of the
event. An independent OS-level recording had already confirmed that this class
of frame is user-visible rather than a screencast artifact.

An isolated-world probe also found no usable earlier page signal: the emulated
page continued to report 412x960 through `inner*`, `outer*`, `visualViewport`,
screen, document root, resize events, observers, and interval samples. A page
guard therefore cannot detect a closed-panel physical contraction before the
browser-owned surface changes, and Chrome exposes no extension pre-resize hook
for a user-driven window resize.

Closed-panel evidence:

- HumaNova control pass after command-before-guard ordering:
  `.temp/expert-live-r12/screencast/2026-09-02T21-08-19-575Z/evidence.json`
- Aleris rejection (six stale shrink frames):
  `.temp/expert-live-r12/screencast/2026-09-02T21-13-18-495Z/evidence.json`
- representative rejected frames: `0092.jpg`, `0136.jpg`, `0182.jpg`,
  `0231.jpg`, `0291.jpg`, and `0323.jpg` in that evidence directory;
- OS-level confirmation from the preceding ordering prototype:
  `.temp/expert-live-r12/x11-closed-worker/closed-worker.mkv` and
  `.temp/expert-live-r12/x11-closed-worker/bad-shrink-contact.png`.

Focused validation of the retained prototype is green (5 files / 168 tests,
targeted ESLint, TypeScript, and `git diff --check`). Full gates, publication,
the exact-pushed property matrix, and cumulative approval remain intentionally
withheld because `EL03-R12-AC-03` is not met. Continuing requires an explicit
product-contract decision: keep a live side-panel resize owner while emulation
is held; suspend/clear active emulation when that owner closes and restore it
behind a guard on reopen; or accept a best-effort closed-panel posture that
does not satisfy the current zero-frame contract.

# EL-03-R13 — Panel-owned emulation lifecycle

## Goal and approved decision

On 2026-09-03 the product owner approved the production-safe lifecycle exposed
by the R12 compositor falsification: actual browser emulation exists only while
at least one live side-panel document owns the inspected tab. The desired
mobile or silent-desktop mode remains durable for the tab session, but the last
owner's close suspends that posture and restores the browser's native geometry,
identity, touch, and media state behind the existing paint-proven transition
guard. Reopening the panel restores the retained desired posture behind the
same guard before marking interaction or annotation presentation resumes.

This supersedes only the closed-panel continuity portions of I-33, N-03,
INV-8.1, and INV-8.4. It does not relax exact emulation while the panel is live,
permit manual scale/device controls, or weaken Save/AI capture requirements.
The repository authority documents must record the amendment in the same
change so future recovery work cannot recreate a continuously active
closed-panel posture.

## Current facts and resolved design

- R12 proves the popup-owned compositor prefit is exact on both HumaNova and
  Aleris while the panel is live; only the ownerless closed-panel path fails.
  R13 retains that prefit unchanged for live owners.
- The durable emulation record gains a backward-compatible `suspended` bit.
  Missing means active for existing v1 records. A suspended record retains the
  desired mode, maximum scale, fitted safety scale, and monotonic revision but
  authorizes no debugger attach, refit, watchdog, startup/navigation recovery,
  or compositor prefit.
- The first live owner does not independently write CDP state. Normal popup
  initialization calls `emulation.current`; suspended posture reports no active
  proof, so the existing guarded `emulation.apply` transaction becomes the one
  resume writer.
- Last-owner loss is the authority to suspend. The long-lived runtime port is
  primary and supports multiple/rebound owners; native `sidePanel.onClosed` is
  an idempotent backup and may suspend only when no port owner remains.
- Suspension is serialized with every other emulation operation. It first
  obtains a paint-proven opaque guard, durably records the retained posture as
  suspended, hides annotations and pauses marking listeners without discarding
  decisions, clears CDP emulation, gives native geometry two compositor turns,
  detaches, and only then releases the guard. Failure before browser mutation
  restores the active durable/in-memory lease and presentation.
- Content receives an explicit suspension projection both in `page.context`
  and through the close transaction. Suspension is reason-scoped, so it cannot
  accidentally undo Save/sync/property-lock pauses. It hides retained Marking,
  Silent, Preview, hover, and focus paint and removes marking listeners while
  leaving the ordinary page usable. Successful guarded resume clears it before
  the opaque guard settles.
- A managed document recognized without a live owner starts native and records
  the default mobile desire directly as suspended; it must never briefly apply
  mobile merely to clear it again. A cold worker never reasserts a suspended
  record. An active legacy/recovered record discovered without an owner is
  suspended through the guarded path as soon as a current content receiver can
  provide the safety plane.
- Panel closure cancels any active Render-mode inspection first, using its
  existing token/generation-fenced fail-open path. JavaScript is restored and
  any required reload is admitted before emulation detaches. A completed AI run
  may remain locally resumable under I-26; marking decisions remain retained.
  Thus N-03 continues to survive worker/reload recovery, but no longer survives
  deliberate last-panel closure as an active debugger inspection.

There are no open product questions for this round. If Chrome destroys the
content receiver before suspension can prove the guard, R13 retains the active
durable lease and retries; it never performs an unguarded clear. Tab closure and
explicit unregister remain the existing terminal cleanup paths.

## Non-goals

- No best-effort allowance for a compositor-visible wrong frame.
- No persistent offscreen/popup surrogate, forced always-open side panel, or
  manipulation of the user's normal Chrome profile.
- No change to marking semantics, AI result ownership, backend contracts,
  consent suppression, or the supplied property set.
- No deployment. Successful `run-plan` may review, commit, and exact-push only
  after every local gate is green.

## Implementation phases

1. Amend durable posture/schema and runtime state with suspension, including
   rollback, cold-start, navigation, detach, watchdog, bounds, refit, current,
   clear, and failed-resume behavior.
2. Promote the compositor owner port to first/last-owner lifecycle authority;
   wire idempotent native close backup and token-fenced Render inspection
   cancellation before suspension.
3. Add content lifecycle projection/command, reason-scoped interaction pause,
   annotation suppression, page-context hydration, and guarded resume release.
4. Update decision spec, invariants, knowledge, marking reference, execution
   plan, and README to the approved panel-owned contract.
5. Run focused unit/contract/startup/content tests, targeted lint/typecheck,
   `git diff --check`, full `pnpm verify`, debug build, P17, P14, and P25.
6. Review the exact diff, commit/push with upstream equality proof, rebuild from
   exact pushed source, and falsify at least 50 close/native-resize/reopen cycles
   on both HumaNova and Aleris with compositor evidence.
7. Run the supplied 17-property headed matrix from exact pushed source, record
   the external 3DPrima SQL outcome truthfully, and perform the cumulative
   expert-check. Production readiness requires explicit final approval.

## Required test matrix

- Storage: legacy active v1 hydration; suspended round trip; monotonic revision
  arbitration between active/suspended writes.
- Runtime: active-to-suspended guarded clear; already-suspended no-op; default
  suspended creation; persistence/content-ack/CDP/detach failures; resume and
  failed-resume rollback; no suspended refit, prefit, watchdog, navigation,
  detach, or startup reassert; explicit clear still deletes intent.
- Ownership: first/last owner edges, duplicate binding, tab transfer, multiple
  owners, disconnect, unrelated/malformed ports, and native close ordering.
- Content: page-context suspended adoption, close command idempotence, hidden
  annotation roots, listener removal, retained dirty decisions, independent
  Save/sync pauses, guarded resume, and replacement-document behavior.
- Render inspection: active/static/dynamic/terminal/inactive states on close;
  fail-open restoration precedes emulation detach and stale close occurrences
  cannot cancel a newer session.
- Headed: open-panel R12 resize proof remains exact; last close visibly returns
  native geometry behind opacity; closed physical resize has no emulated stale
  frame because no emulation is active; reopen restores exact desired
  412x960/desktop posture before opacity releases; repeated and rapid
  close/reopen/rebind cycles end with one owner-consistent posture.

## Acceptance criteria

- `EL03-R13-AC-01` With no live panel owner, every managed tab is in a proven
  native browser posture and its durable desired emulation is suspended; no
  recovery/refit path silently reattaches the debugger.
- `EL03-R13-AC-02` Last-owner close and first-owner resume expose zero
  compositor-visible wrong-geometry frames, retain mode and marking decisions,
  and never leave annotation interaction active at native geometry.
- `EL03-R13-AC-03` Render inspection fails open before suspension and every
  persistence, receiver, debugger, navigation, worker-restart, and rapid owner
  race ends in either the prior proven active posture or proven suspended
  native posture—never an acknowledged ambiguous state.
- `EL03-R13-AC-04` Focused and full automated gates pass; exact-pushed HumaNova
  and Aleris each pass the 50-cycle compositor lifecycle proof; all reachable
  supplied properties pass the headed matrix with external outages separated
  from extension failures.
- `EL03-R13-AC-05` A fresh cumulative expert-check explicitly approves the
  exact pushed commit before the classification can change from alpha/develop.

## Todo chain

1. `el03-r13-authority-plan` -> 0
2. `el03-r13-runtime-suspension` -> 1
3. `el03-r13-owner-content-lifecycle` -> 2
4. `el03-r13-authority-docs` -> 3
5. `el03-r13-focused-validation` -> 4
6. `el03-r13-full-gates` -> 5
7. `el03-r13-review-push` -> 6
8. `el03-r13-exact-headed-lifecycle` -> 7
9. `el03-r13-property-matrix` -> 8
10. `el03-r13-cumulative-audit` -> 9

## EL-03-R13 implementation and local-gate checkpoint — 2026-09-03

The approved panel-owned lifecycle is implemented across durable posture,
background ownership, popup compositor prefit, content presentation, Render
inspection cancellation, and the repository authority documents. The retained
mobile or silent-desktop target is now stored with a backward-compatible
`suspended` bit; a suspended target authorizes no attach, refit, navigation,
watchdog, bounds, or startup reassertion. Last-owner loss completes Render
inspection fail-open first, paint-guards suspension, parks annotations and
marking input, persists the retained target, clears all CDP emulation, waits for
native compositor turns, detaches, and only then releases the guard. Popup
recreation verifies and reapplies the retained target through the ordinary
guarded transaction.

Review hardening added during this checkpoint:

- terminal suspension-release delivery is retryable without repeating CDP;
- cold-worker recovery completes a persisted suspended transaction when the
  debugger target is still attached;
- persistence, content-projection, physical-viewport, and detach failure paths
  roll back to a proved active posture or retained suspended native posture;
- owner-port reconnect, multiple-owner, tab-transfer, delivery-order, and
  native-close races are fenced;
- suspension uses a narrow per-tab lane so slow Hub/tab lifecycle work cannot
  delay a last-owner close;
- an admitted Render inspection start rechecks live owner authority before its
  first debugger write, so a close during context authorization cannot reload
  or disable scripts afterward; and
- owner return at any suspension mutation boundary retains the existing opaque
  generation and invalidates cached proof. The reopening popup's normal apply
  supersedes that guard, preventing a native/exact-posture exposure gap during
  rapid close/reopen overlap.

The required codebase-memory graph was retried first but its MCP transport was
closed, so review discovery used scoped repository reads and `rg` under the
documented fallback rule. Local evidence is green:

- focused lifecycle regression set: 7 files / 228 tests;
- targeted ESLint and the main TypeScript configuration;
- `git diff --check`; and
- full `pnpm verify`: lint, generated page-world/icons, all three TypeScript
  configurations, 152 files / 1,745 tests, production MV3 build, and 7/7
  generated-manifest tests.

This is not a production-readiness approval. Debug/P14/P17/P25 gates, exact
review/commit/push proof, HumaNova and Aleris 50-cycle compositor
falsification, the supplied 17-property matrix, and the fresh cumulative
expert-check remain open.
