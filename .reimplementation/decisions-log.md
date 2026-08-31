# Reimplementation Decisions Log

This is the verbatim record of the architect-led Q&A that produced the reimplementation
contract and design. It is the provenance for every decision in `plan.md`,
`contract-invariants.md`, `architecture.md`, and `remote-api.md`.

- **Architect / decision-maker:** the repository owner.
- **Role of this agent:** investigate, verify understanding with the architect, and execute the
  architect's decisions. Nothing here was decided unilaterally.
- **Method:** interactive single/multi-choice Q&A, topic by topic (T1–T12). Each claim was
  verified (confirmed / corrected / rejected) before moving on.

---

## Doctrine (confirmed)

- `.copilot/architecture/reflex-arc-plan.md` is the **canonical target architecture**; the rewrite
  realizes it cleanly from scratch. The current coexistence of the old "dictation" model and the
  new "signal" model is accidental complexity to eliminate.
- **Reflex-arc closed loop:** the BRAIN is the highest authority — it observes (folds facts/sensations
  into a per-tab snapshot), decides, and emits **discrete, sequenced, provenance-tagged, consumed-once
  signals**. It does **not** micro-orchestrate individual buttons/curtains/copy/timers/countdowns.
  Each LAYER is an autonomous "organ" running a deterministic FSM with a predefined transition table
  and a **complete memorized presentation matrix per state** ("muscle memory"); between signals it
  cannot move; it acts on the brain's signal and reports sensations back.

---

## T1 — Domain model & vocabulary — LOCKED

> **Amended by A2 / D13:** identity is now `(environmentKey, siteId)` and candidate storage uses
> the GraphQL-derived relative `pageKey`. Observed origins are informational; Hub-delegated GraphQL
> owns canonical property facts.

- **CORRECTED — Property identity** = the backend `siteId` returned by a GraphQL query given the raw
  URL. **No** frontend base-URL normalization / longest-match speculation. Base URL is a backend
  **attribute** only (the frontend never computes/normalizes/matches it).
- **CORRECTED — the marking model is inclusion-centric:**
  - Only **inclusions** have an implicit/explicit split: implicit inclusion = the computed content
    baseline (visible, markable, direct-text), not stored; explicit inclusion = the user's Alt rescue,
    stored.
  - There is **no "implicit exclusion"** concept. All exclusions are **exceptions** (per-element rows)
    that carve holes out of the inclusion baseline. One unified kind: created by a user toggle **or**
    automatically at the initial/branch recalculation (default taxonomy + CSS/AI selectors). Auto ones
    are "not special."
  - The **immutable excluded-tags list** is a separate, permanent, DOM-independent blanket rule
    (never included / markable / a row).
- **VERIFIED wire schema** (from `src/background/ai-run-orchestrator.ts`): top-level
  `{ baseUrl, renderMode, defaultExclusionSelectors = immutable tags [IMG INPUT NOSCRIPT SELECT TITLE
  STYLE SCRIPT TEMPLATE IFRAME VIDEO SVG], pages[] }`; per page `{ url, renderedHtml (always),
  rawHtml (ONLY when renderMode='static'), renderedXPaths: [{ xpath, excluded, explicit? }] }`. Every
  include/exclude row carries an `explicit` flag; immutable tags ride as a separate list.
- **CORRECTED — re-derivation is branch-scoped + action-triggered only.** It runs at (1) the initial
  calculation and (2) the exact branch a user just toggled, incorporating that toggle. There is **no
  global/periodic re-derivation**, so a user decision can never be re-applied over — the old
  "blank element" bug was an illegitimate global re-derivation (config-merge / full rebuild), forbidden.
- **CONFIRMED:** candidate-only marking; toggleable-default tag list (FOOTER FORM LABEL NAV HEADER
  DIALOG ASIDE BUTTON), LINK in neither, case-insensitive; SelectorSet seeds a fresh page once then
  defers; submission = enumerated visible-text includes + shallow-boundary excludes; editing session
  is session-scoped, recomputed fresh on enable, dirty only on explicit toggle; render mode via
  capture-with-JS then reload-JS-disabled; exactly one reveal/freeze ritual per page visit.

## T2 — Marking-interaction invariants — LOCKED

- **CONFIRMED:** `deriveMarkMode` precedence `disabled > passthrough(Space) > include(Alt) >
  exclude(default)`; Shift orthogonal breadth modifier; click reads `event.altKey`;
  blur/visibility/navigation reset held-modifier latches. Exclude **drills** (nearest self-markable,
  past excluded ancestors); include (Alt) **reaches in** + forms a **closed boundary** + always submits
  included even when hidden/nested; include/exclude mutually exclusive per element; Space passthrough is
  the only path to hidden content. Self-markable = visible ∧ ¬immutable ∧ ¬chrome ∧ (owns-direct-text ∨
  structural-boundary); structural boundary = section/article/card-group/list/table/toggleable-default,
  rejecting shallow shells; hover is O(1).
- **CORRECTED — Shift widening:** a grouping ancestor qualifies iff it has **≥2 direct descendants that
  are themselves eligible widening targets** (each holds multiple textual markable content). It
  qualifies **regardless of width** — the old full-width-wrapper rejection caused false negatives and is
  removed. The grouping ancestor owns no direct textual markable content itself. Shift **climbs** through
  successive qualifying grouping ancestors to the **broadest** that still groups ≥2 eligible targets,
  stopping before the first non-qualifying ancestor / page shell.

## T3 — Submission invariants — LOCKED

- **CONFIRMED:** enumerated visible-text includes + shallow-boundary excludes (descendant under a
  submitted excluded ancestor omitted unless explicitly included; non-textual implicit nodes omitted;
  `/html[1]` and `/html[1]/body[1]` never rows). XPaths purely positional (`/tag[index]`, no id/class),
  computed after marking sync against the same sanitized DOM saved as `renderedHtml` (extension UI /
  automation roots / stripped nodes never count as siblings), continuous through flattened open shadow
  boundaries. Submission visibility geometry = page-HEIGHT counts (below-fold included), mobile-WIDTH
  clips (out-of-width excluded); CSS clamp with a visible preview → included; genuine hidden
  (display:none / visibility:hidden / opacity:0 / zero-area / interaction-gated) → excluded; one shared
  "user-visible" definition across live isVisible, save isVisibleForSubmission, and silent-highlight
  retention. Shadow DOM flattened to real DOM (Googlebot parity); open roots inlined; closed roots
  skipped; extension's own shadow root never captured.

## T4 — Session lifecycle invariants — LOCKED

> **Amended by A2 / D14–D16 and the 2026-08-31 owner ruling:** the historical full-property
> request below is superseded by a singular current-page partial upsert. Save returns only a
> commit outcome; one distinct Load then supplies the complete authoritative shape. The AI
> corpus remains multi-page and self-contained because the AI endpoint is stateless.

- **CONFIRMED:** AI-fresh gate — after any marking change, Run AI must re-run before Save enables; any
  post-AI edit drops back to dirty and re-requires a run; marking cannot be disabled until Save or
  Discard. Save uploads exactly the current page plus property-wide selectors to `/save`. Its response
  is commit acknowledgement only; a separate `/load` fetches the backend's complete newest shape and
  atomically replaces local configuration before `saved` lands in silent. No mutable session rows,
  suggestions, draft, or pre-Load snapshot are merged into or retained after that successful Load. Fresh-session
  — every enable re-seeds fresh from defaults+selectors, wiping any stale draft so the page never starts
  dirty; any navigation/reload (same page/property or not) disables marking.
- **CORRECTED — Discard** throws away the session's uncommitted edits and returns to the **clean,
  freshly-computed baseline** (the same defaults + CSS/AI-selector seed a fresh enable produces), from
  the property config `/load` provided. It does **not** restore a prior "saved user-markings" draft.
  Marking stays active and clean. (Re-fetch vs cached `/load` = a data-authority implementation detail.)

## T5 — Reveal/freeze + device emulation — LOCKED

- **CONFIRMED:** exactly ONE reveal/freeze per page visit; page-content-only (extension UI keeps its own
  animation/timers); scroll top→bottom with ≤1 lazy expansion (suppression at 50% of initial height),
  freeze at the absolute bottom, restore scroll under freeze; freeze survives per-subsystem resumes,
  lifts fully only on navigation; deferred timer/rAF callbacks flushed on resume. Silent-highlight AND
  reveal/freeze activate only after real editor activation (never passive page-load); silent overlays
  never capture page clicks; same freeze active in both marking + silent modes. Device emulation forced
  mobile 412×960 (submission viewport); desktop preview 1920×1080 a distinct feature-gated toggle; scale
  clamped 0.25..1; reconciled on load; re-cleared after navigation on silent detach; active for Save.
  Render-mode inspection = capture rendered (JS on) → reload JS-disabled → capture static → restore JS;
  no-JS hold tracked + always cleared; reconnecting-after-inspection status suppresses the 70s loss
  countdown.

## T6 — Property lock — LOCKED

> **Amended by A2 / D20–D23:** retain this section as original provenance. The binding model now
> separates `editorSessionId` from fenced `lockToken`, qualifies renewal by focused/non-idle
> presence, gives candidate suspensions a 10-minute grace, and permits explicit recovery polling.

- **CORRECTED — identity:** the BACKEND issues a unique lock identity for the property; the page persists
  it to the current tab's storage to hold the lock. On a lock-lease / handoff event the backend
  invalidates the old identity and issues a fresh one to the new holder (previous holder → passive). The
  frontend does **not** generate the identity or run cloned-tab UUID rotation — the backend owns issuance
  + rotation. (Supersedes the old frontend "stable sessionStorage client-id + cloned-tab rotation.")
- **CONFIRMED:** claim/passivity — immediate editor claim on landing on an eligible candidate (doesn't
  wait for marking); first grantee is editor; all other clients for the property are passive (locked UI),
  even the same user. Timings (**backend-authoritative**): heartbeat 30s (only if interacted <30 min);
  connection-loss 70s; off-candidate 70s (→release_lock); cross-property cooldown 30s (→release prior
  session); port-disconnect dispose grace 70s (tab close bypasses → immediate release); passive-observer
  release 60s. Connectivity = WebSocket state + independent HTTP reachability probes. Editor is single
  source of truth; passive→editor promotion fetches upstream once + fully replaces + stops `/load` until
  save; passive observers `/load` ≤1/min. "Extension context invalidated" terminal; ordinary disconnect
  resets UI + reconnects. Same-user "Continue editing here" transfer (+"…anyway" discards prior draft);
  takeover suggest accept/reject; transfer state shown to both parties.

## T7 — Authority & presentation — LOCKED

- **DECISION:** re-derive the signal vocabulary + per-layer FSM state sets **cleanly** from the confirmed
  invariants; use `reflex-arc-plan.md` Phase 1–3 tables as reference only, not verbatim.
- **CONFIRMED (with nuance):** popup + content always render from ONE consistent state and never
  independently derive-and-disagree (marking-enabled / curtain / gate) — but this is a **guarantee**, not
  a mandate for a single shared orchestration core; organs stay autonomous, kept consistent via the
  brain's signals. No flicker on transient churn; every block self-explains (an enabled control carries an
  empty blocked-reason); every inbound command → exactly one reply (success or structured failure), never
  dropped; data-affecting content commands gated by baseUrl-match + config-present + lock-permits-marking +
  not-reconciliation-pending, + activity ping on success; page-world commands behind a fixed allow-list
  (ARM, SET_MOTION_PAUSED, SET_LAZY_LOADING_SUPPRESSED, DESTROY) + nonce handshake (replies match nonce +
  originating command).

## T8 — Open contract questions — DECIDED

- **Closed shadow roots:** the closed-shadow host is treated as excluded/unmarkable/uncaptured (like
  immutable) but rendered with a **distinct overlay style** (a new category, visually separate from
  immutable) so the editor sees it's an unreachable region.
- **SPA navigation:** detect non-navigating URL changes (pushState/replaceState/hashchange) and **force a
  full page reload** so the standard reveal/freeze + fresh capture re-runs — **while the extension is
  active on the page.**
- **Lock-timing ownership:** **backend-authoritative** — the backend owns lease expiry + countdown
  deadlines; the client mirrors/displays them.
- **Two known bugs** (empty `/save` payload; post-discard authority race): design out **structurally**
  (backend-authoritative save + branch-scoped derivation + reflex-arc single-authority +
  one-reply-per-command); standard test coverage is sufficient.

## T9 — Scope & delivery strategy — DECIDED

- **Delivery:** BIG-BANG clean rewrite in a fresh tree. Old codebase = reference only (inspiration +
  solutions to already-solved hard problems) + isolated self-contained reusable snippets (to save
  reasoning/tokens). NO logic / architecture / contracts carried over wholesale. Behavioral contract comes
  from this verified Q&A + first principles.
- **Preservation:** the behavioral contract = the verified invariant register (corrected T1–T8). The only
  intended behavior changes are the decided improvements (full in-shadow marking + deep-capture,
  SVG-immutable, CSS-clamp-include, closed-shadow overlay, backend-issued lock identity, SPA force-reload,
  the corrected inclusion-centric marking model, the two bugs designed out).
- **Stack:** keep WXT (MV3 build) + TypeScript + React (side-panel/popup) + IndexedDB + Vitest.
- **Schema:** add Zod (or similar) as the single schema source (types + normalization + runtime
  validation from one definition).

## T10 — Core internals — DECIDED

- **Brain state:** fold observed facts into a per-tab snapshot (for observation + deciding) AND emit
  sequenced, consumed-once signals as the cross-realm contract.
- **MV3 suspension:** primary = keep-alive mechanisms during active work; fallback = persist durable facts
  + rehydrate + re-derive volatile authority; cross-realm messages idempotent-by-sequence (lost wake =
  safe replay).
- **Data authority:** backend-authoritative + ephemeral active-session working state. Saved
  configuration is fully sourced and atomically replaced only by `/load`; `/save` is a commit
  boundary, never an adoption boundary. A successful post-Save Load destroys the mutable session
  without merging or preserving local session data.
- **Marking derivation:** minimal canonical mark set → one pure evaluation pass ("nearest-marked-ancestor
  decides each node") → both overlay classification + submission rows; branch-scoped incremental recompute;
  delete prune-on-toggle + scoped-splice + the parity audit.

## T11 — Boundaries & integration — DECIDED

- **Presentation:** each layer is an autonomous reflex-arc FSM organ with a complete per-state memory
  matrix, driven by brain signals; no legacy local re-derivation, no dual PopupState/ViewState bags; one
  store per organ + derived selectors.
- **Messaging:** one typed bus for all realm-to-realm RPC + events (bg/content/popup/page transports);
  legacy popup→background request protocol migrated onto it + deleted. Property-lock WebSocket stays
  separate (talks to the remote hub) but its bg↔popup state relay moves onto the bus. Page-world (MAIN)
  relay = a PAGE bus transport keeping its nonce handshake + fixed allow-list.
- **content/core.ts split:** extract page-stabilization (freeze/reveal/emulation/render-mode),
  curtain/busy presentation, and snapshot capture into their own subsystems; the marking engine keeps only
  target-resolution + classification + xpath/shadow-flatten + overlay + mark store + submission.
- **Page-world:** one plain-`.js` MAIN-world program for both `executeScript` injection + the
  document_start bridge; drop the byte-locked TS pair + parity test + `@ts-expect-error` tax — after a
  quick MV3/CSP check confirms it's allowed.
- **Constants:** treat ALL current constant values as contract.
- **Backend ownership:** the USER owns the config + property-lock backend (REST `/load`, `/save`; lock
  WS/HTTP) — confirmable directly. AI (`/get_selectors`) + GraphQL (`urlSearchInfo`, `propertyPageTypes`,
  `cssInfo`, `updateScrapingConditions`) are owned by a **separate team**. _(Sourcing refined in Amendment A1.)_
- **API source of truth:** pin the exact request/response schemas from the current client code; the user
  confirms the config/lock parts directly; the AI/GraphQL parts are pinned-from-client.
  **➤ SUPERSEDED by Amendment A1 (below):** AI/GraphQL/accounts are LOCKED to current (conform exactly, no
  verification); config/lock are a DESIGN TARGET (define the ideal schema, adapt the backend).

## T12 — Plan packaging — DECIDED

- **Deliverable:** full make-plan (`plan.md`) + supporting docs (`contract-invariants.md`,
  `architecture.md`, `remote-api.md`, `decisions-log.md`).
- **Branch:** `rewrite/reimplementation-plan`. **Directory:** `.reimplementation/`. **Push:** commit +
  push the branch only (no PR).

---

## Amendment A1 (post-sign-off) — API sourcing model per surface

**Supersedes the T11 "Backend ownership" + "API source of truth" bullets.** Architect direction after the
initial deliverable was pushed:

- **AI (`/get_selectors`), GraphQL (`urlSearchInfo`, `propertyPageTypes`, `cssInfo`,
  `updateScrapingConditions`), and accounts (`validate`/`login`) are LOCKED to the CURRENT code.** The
  rewrite conforms to exactly what the client sends/parses today. There is **no separate-team dependency
  and no verification gate** — these schemas are authoritative as-is.
- **The config server (`/load`, `/save`, `/remove`, page-type/render-mode assists) and the property-lock
  hub are OWNED by the architect; define the MOST SUITABLE (ideal) schema and ADAPT THE BACKEND to it.**
  Concretely: `/load` returns a `baseUrl` attribute + per-page unified `rows[]` `{xpath, excluded,
  explicit?}`; `/save` accepts/returns the same unified snapshot (no `xpaths`/`submissionXpaths`/
  `includeXpaths`/`selectorSuppressedXpaths` split); the lock hub issues + rotates the lock `identity`
  (backend-issued, invalidate-old/issue-fresh on lease); lease timers are backend-authoritative.
- **Two former open items are RESOLVED by this:** (a) the base-URL data source — base URL is now a
  config-`/load` attribute on the OWNED surface (no GraphQL schema-ADD needed); the legacy
  `normalizeBaseUrlFromDomainName` derivation is dropped. (b) the `/save` row-shape reconciliation — the
  OWNED backend is adapted to the single unified `rows[]` shape.
- **Remaining external items** reduce to: the OWNED config/lock backend adaptation (the architect's own
  work, gates cutover not design) + the MV3/CSP page-world spike + the SPA force-reload scope confirm.

---

## Amendment A2 (post-study Q&A) — partial save, GraphQL authority, fencing, and publication

**Binding record:**
[`study/qa-decisions-save-contract.md`](./study/qa-decisions-save-contract.md). It supersedes
conflicting T1/T4/T6/T8/T10/T11 and Amendment A1 details. The important corrections are:

- Identity is `(environmentKey, siteId)` and candidate pages use GraphQL-derived relative
  `pageKey` values. GraphQL, not observed URL origins or config `/load`, owns canonical property
  facts.
- The Hub calls GraphQL with the exact client JWT through an environment allowlist and classifies
  GraphQL payloads independently of misleading HTTP status codes.
- `/save` is structurally singular: current page + domain-wide selectors. It is a partial upsert,
  preserves absent pages, and returns the complete authoritative snapshot. The whole marked-page
  corpus is used for AI only.
- Successful complete candidate feeds drive fenced reconciliation. Disappearing keys delete
  markings; type relabels preserve them; cross-type duplicate keys block the property without
  mutation. Empty page types are silently non-actionable.
- Every mutation is idempotent and guarded by a backend-rotated fencing token. A stale but
  untransferred editor session may reacquire; an actual transfer destroys the old draft.
- Candidate removal and feed conflict suspend/preserve an active draft and recover via 15-second
  client-driven Hub checks plus a 10-minute loss-of-presence grace. Save is never auto-replayed.
- A hidden/forgotten tab does not renew the property lock. Qualifying presence requires the visible
  selected tab, focused browser window, and a non-idle user.
- The Hub owns the complete Send-to-Lynx transaction and advances
  `submittedSelectorsFingerprint` only after definitive GraphQL success.
- Final normalized domain-wide selector values are the semantic product. Do not add a marking-corpus
  calculation-basis fingerprint or stale selectors solely because instrumental markings changed.
