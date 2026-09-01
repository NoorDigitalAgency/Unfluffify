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
