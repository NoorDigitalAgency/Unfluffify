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
