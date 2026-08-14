# Architect Q&A Amendment — Save, Reconciliation, Lock, and Publication

> **Status:** binding product and cross-repository contract, decided with the repository owner
> after the original D1–D12 study. This document supersedes every conflicting statement in
> `contract-invariants.md`, `decisions-log.md`, `remote-api.md`, `study/qa-decisions.md`, and
> `parity-plan.md` written before this amendment.
>
> **Repositories:** extension `Unfluffify@re-write`; owned backend
> `UnfluffifyHub@develop`; external GraphQL schema remains unchanged.
>
> **Date:** 2026-08-14.

This record closes the ambiguity behind the earlier sentence “make `/save` keyed per page.” It
also defines the property feed, editor lock, draft-recovery, and Lynx-publication behavior needed
to make that save contract safe. It is intentionally portable: implementation may stop and resume
without access to the Q&A transcript.

---

## D13 — Identity is environment + GraphQL property + relative candidate key

- Saved state and locks are scoped by `(environmentKey, siteId)`. A numeric `siteId` from one
  stage must never address state in another stage.
- `environmentKey` is the normalized configured stage hostname. Each Hub deployment uses an
  explicit allowlist/registry to derive the GraphQL endpoint exactly as the extension does. The
  Hub never accepts an arbitrary GraphQL URL supplied by the client.
- `siteId` and the canonical property/base-URL facts are trusted from GraphQL. The origin in an
  observed URL is informational only: scheme, credentials, host/`www`, port, and redirects must
  not create page identity or property-membership mismatches.
- A `pageKey` is the GraphQL candidate's canonical relative URL: path plus query and fragment,
  with protocol, credentials, host, and port omitted. Pages are keyed by
  `(environmentKey, siteId, pageKey)`.
- A definitive GraphQL answer that the current URL is unmanaged terminates the marking session.
  A definitive change to another `siteId` terminates the old session and classifies the new
  property afresh. Neither case migrates a draft. Auth, transport, malformed-payload, and
  ambiguous failures are not definitive property loss.

## D14 — The background owns the authoritative full corpus

- `/load` returns one complete, runtime-validated property snapshot. The extension background
  persists it by `(environmentKey, siteId)`; the side panel receives projections, not authority.
- A working draft is a separate current-session overlay. The AI corpus is the authoritative
  stored marked-page corpus with the current page's live snapshot replacing that page.
- Successful save, remove, reconciliation, and publication responses atomically replace the
  affected authoritative baseline. A genuine 404 clears it. Transport, auth, payload-validation,
  or ambiguous failures preserve the last valid baseline.
- The full corpus and completed AI output survive side-panel closure and MV3 service-worker
  restart. Page context is derived and generation-scoped; it is never a stale independent cache.

## D15 — `/save` is structurally singular and partially upserts

- A normal save request contains exactly one `page` object plus the domain-wide selector set and
  render-mode value. It does **not** contain a `pageMarkings` dictionary and does **not** upload
  the full page corpus.
- Required mutation envelope: `operationId`, `environmentKey`, `siteId`, `editorSessionId`, current
  fencing `lockToken`, and the expected property/feed revisions. `siteId: null` is structurally
  invalid.
- The page contains its canonical `pageKey`, current GraphQL page-type label, title/capture fields,
  and unified marking `rows[]`.
- The Hub upserts only that named page and preserves every page absent from the request. `/remove`
  is the only ordinary user-driven page deletion door.
- The response is the complete authoritative property snapshot, not merely the changed page. The
  extension clears the draft only after it validates and adopts that response. Save ends marking
  and lands in silent mode as D10 requires.
- The full stored corpus is used for the next AI run, never as the save request body.

## D16 — Server-owned timestamps; selectors are the semantic output

- Clients never invent persistence timestamps. The page timestamp changes only when that page is
  written. `renderModeUpdatedAt` changes only on first persistence or a real render-mode change.
- The Hub normalizes domain-wide selector sets (including duplicate/order normalization) before
  comparison. `selectorsUpdatedAt` changes only when the normalized selector values change.
- `submittedSelectorsFingerprint` means “the normalized selector set last definitively accepted by
  Lynx.” It changes only after successful `updateScrapingConditions`; ordinary save/reconcile/remove
  operations never blank it.
- Markings and marked pages are instrumental inputs. Do **not** add a calculation-basis fingerprint
  or automatically stale/clear selectors merely because candidate or marking records change. If a
  recalculation produces the same normalized selector set, neither `selectorsUpdatedAt` nor Lynx
  publication status changes. If it produces different values, the saved fingerprint changes and
  the prior submitted fingerprint correctly shows that Lynx is behind.

## D17 — The Hub owns the complete GraphQL candidate feed

- The Hub, not the extension, calls `urlSearchInfo` and `propertyPageTypes` using the exact JWT from
  the client request. It does not use a service credential, persist/log the token, or send it to an
  origin outside the environment registry. Any `x-update-token` replacement is returned for the
  extension background to adopt.
- GraphQL access is property-wide. A successful `propertyPageTypes` response is the complete feed;
  otherwise it is not evidence that the feed is empty.
- HTTP status is not authoritative because authorization failures may arrive as HTTP 500 or another
  misleading status. The Hub examines the GraphQL payload first: auth payload →
  `authentication_required`; permission payload → `access_denied`; `NotFound` →
  `property_not_found`; data plus errors → invalid partial response; malformed/non-GraphQL response →
  invalid upstream; only an unclassified failure is a Hub/upstream-service error.
- Refresh the feed before lock grant, Run AI, Save, Remove, and Send to Lynx, and during explicit
  recovery polling. Ordinary lock heartbeat alone does not refresh GraphQL.
- Persist a membership fingerprint (`pageKey` set) and assignment fingerprint
  (`pageKey -> pageType`) with the accepted complete feed.

## D18 — Deterministic candidate reconciliation

- A successful complete feed drives a lock-fenced, idempotent reconciliation. A failed, partial,
  malformed, or unauthorized response never reconciles or deletes anything.
- `pageKey` membership controls marking retention. If a key disappears, delete its stored page
  marking. If it later returns, it is an ordinary unmarked candidate unless the same still-active
  suspended draft is resumed under D20.
- Page type is only a workflow label. Moving an existing `pageKey` to another page type preserves
  rows, HTML, title, and marking timestamp and updates only its assignment metadata.
- A page type that disappears has no independent deletion power: its pages are deleted only when
  their keys disappear from the complete feed.
- A canonical `pageKey` appearing under multiple page types is a property-level
  `candidate_feed_conflict`. Persist the operational block, list the key/types and corrective action,
  and reject mutations without deleting or relabelling anything. Duplicate entries inside the same
  page type may be deduplicated. The block clears only after a later complete valid feed.
- Empty page types are ignored silently in editor workflow and completeness. They may be recorded in
  developer diagnostics. If every page type is empty, show the neutral empty-Todo note and make
  publication unavailable without sending an empty selector set.

## D19 — Shrink is permitted only with reconciliation proof

- `/save` itself never removes pages. Because the property lock excludes concurrent editors, an
  ordinary save response should not shrink the client baseline.
- A smaller authoritative response is adoptable only when it contains a newer reconciliation
  revision, the accepted complete-feed fingerprint, the exact `removedPageKeys`, and separate relabel
  metadata. The client verifies the proof against the latest accepted feed.
- Any unexplained shrink is a high-severity integrity failure: keep the last baseline and current
  draft, block further writes, and surface diagnostics. This is a tripwire for a contract bug or
  unauthorized mutation path, not a normal recovery branch.

## D20 — Drafts are session-local; candidate loss suspends them

- A draft is scoped to `(environmentKey, siteId, tabId, pageKey, markingSessionId)`. It survives side
  panel closure, service-worker restart, and temporary auth/network/feed failures only while that
  marking session remains alive.
- Successful save, explicit discard, marking-mode exit, navigation/reload, tab close, definitive
  property loss/change, or authoritative lock transfer terminates the session and deletes its local
  draft. Configuration cannot be opened mid-draft without Save or Discard, so stage changes do not
  migrate or quarantine a draft.
- If the current `pageKey` disappears, enter `suspended_candidate_removed`: keep the draft visible,
  clearly explain the reason, and disable Run AI/Save. The Hub's authoritative stored marking is still
  removed by reconciliation.
- The extension asks the Hub for recovery context every 15 seconds while the page has qualifying
  presence or is within its 10-minute recovery grace. Each request carries the current JWT; the Hub
  refreshes GraphQL and signals whether the same `pageKey` returned. Polling stops after the grace while
  inactive and restarts immediately on focus.
- If the page returns during the same session, resume the draft. A draft that had not completed AI must
  calculate before saving. If Save itself was suspended after a completed calculation and its inputs
  did not change, restore **Ready to save** but never replay the save automatically; the user clicks
  Save and sends a fresh fenced request.
- A duplicate-feed conflict uses the parallel `suspended_candidate_feed_conflict` state: preserve the
  draft, explain the conflicting assignments, poll/recover under the same timing, and then resume,
  transition to candidate-removed, or terminate according to the corrected feed.

## D21 — The property lock is a fenced, presence-qualified lease

- Every state-changing operation verifies the current opaque fencing `lockToken`. Acquire, transfer,
  and takeover rotate it; a stale token receives conflict and performs no mutation.
- A stale but untransferred lease may be renewed/reacquired by the same `editorSessionId` without
  losing its draft. Once ownership actually transfers, the previous session loses its work with no
  recovery.
- A merely open tab must not hold a property indefinitely. A lock-renewing heartbeat qualifies only
  when the property page is the visible selected tab in the focused browser window and the browser
  does not report the user idle. Hidden tabs/background windows may report liveness but do not renew.
- Navigating within the same property to a non-candidate page does not immediately surrender the lock;
  existing backend-authoritative inactivity/off-candidate deadlines apply. A candidate-removal or
  candidate-conflict suspension gets an additional 10-minute recovery grace before the ordinary
  inactivity countdown begins.
- Switching away starts that recovery grace. Returning qualifying presence cancels the grace/countdown.
  Deadline values remain backend-authoritative and are mirrored by the client.

## D22 — Same-user transfer is explicit and destructive

- Each tab/window/browser editor has a distinct `editorSessionId`; authentication identity is not
  editor-session identity.
- Another session for the same authenticated user sees **Continue here**. Accepting it rotates the
  fence and transfers immediately. The old session becomes locked and may show its own Continue here
  while the same user remains holder elsewhere; if ownership moves to another user, it becomes passive.
- Lock status/heartbeat reports only `hasUnsavedWork`, never draft content. It is true for dirty manual
  markings, completed post-AI work not successfully saved/adopted, Ready-to-save, in-flight save, and
  unknown save outcome. Saved-but-not-yet-published-to-Lynx selectors are not unsaved local work.
- If the current holder has unsaved work, Continue here shows an explicit destructive warning. Missing
  or stale draft status warns conservatively. On confirmation, the old session discards the draft,
  calculation, and pending save immediately. There is no conflict merge or lock-loss recovery.
- A save racing a transfer is serialized: either save commits first, or transfer rotates the token and
  the old save is rejected.

## D23 — Every mutation is idempotent

- Save, remove, reconciliation, selector-publication acknowledgement, and lock transfer use a common
  mutation envelope: `operationId`, `editorSessionId`, `lockToken`, and expected property/feed revision.
- Duplicate delivery returns the recorded result rather than repeating timestamps, deletion, or token
  rotation. Operation records outlive every marking/retry window and may then expire by policy.
- After a save response is lost, keep `hasUnsavedWork=true` and query/retry the same `operationId`. If
  committed, return the original authoritative result. If not committed, execute only while its fence
  remains valid. A transfer that wins rejects the old operation and triggers draft destruction.

## D24 — The Hub owns Send to Lynx

- The client sends the Hub a publication operation containing the exact JWT, environment key, current
  lock/fence, operation id, expected property/feed revision, and expected normalized saved-selector
  fingerprint.
- The Hub refreshes the complete feed; verifies authorization, lock, snapshot revision, Todo
  completeness, `cssInfo`/remote state as applicable, and selector fingerprint; then calls
  `updateScrapingConditions` with the exact delegated JWT and stage-derived GraphQL endpoint.
- Only a definitive GraphQL success atomically advances `submittedSelectorsFingerprint` and records the
  idempotent outcome. Definitive failure leaves it unchanged. An ambiguous external outcome becomes
  `publication_unknown`; the UI never claims success. Retrying the same operation may resend the same
  replace-state selector values or verify remote state first when readable.
- Every non-empty current page type requires at least one successfully saved marked candidate before
  publication. Candidate pages beyond that minimum need not all be marked. A moved marking counts only
  toward its current label. Empty page types are excluded silently.
- Todo header progress is `covered actionable page types / actionable page types` (for example `4/6` or
  `6/6`). Each page type shows `saved marked candidates / 1` without clamping (`0/1`, `1/1`, `3/1`) and
  uses the established legacy status colors. Failed/unknown feed state preserves the last valid list and
  is never rendered as an empty list.

---

## Required operation/state vocabulary

Implementations may add internal substates, but these observable outcomes are stable:

| Code | Meaning | Draft | Writes |
|---|---|---:|---:|
| `managed_candidate` | Same property and current candidate | keep | allowed when lock/gates pass |
| `managed_non_candidate` | Same property, not a current candidate, no active removed-page suspension | none/current session rules | marking writes unavailable |
| `suspended_candidate_removed` | Active draft's key left the feed | keep | disabled |
| `suspended_candidate_feed_conflict` | Duplicate cross-type assignment | keep | disabled |
| `authentication_required` / `access_denied` / `unavailable` | Authority cannot be refreshed | keep while session lives | disabled |
| `unmanaged` | Definitive no-property result | discard | disabled |
| `lock_transferred` | Fence moved to another editor session | discard immediately | stale writes rejected |
| `integrity_shrink` | Snapshot shrank without reconciliation proof | keep | blocked pending diagnosis |
| `publication_unknown` | Lynx mutation outcome cannot be proven | n/a | do not claim or reissue as a new operation |

## Cross-repository acceptance scenarios

1. Save page B in a property already containing page A; request contains no A, response contains A+B,
   and A is byte/semantically unchanged.
2. Two save deliveries with one `operationId` produce one page timestamp and the same full response.
3. A stale fencing token cannot save, remove, reconcile, publish, or acknowledge selectors.
4. A feed relabel preserves the page record; a feed removal deletes it and supplies shrink proof.
5. Cross-type duplicate keys block mutations without data loss and clear only after a valid feed.
6. HTTP 500 carrying an auth GraphQL payload is surfaced as auth, never Hub outage or empty feed.
7. Candidate removal during a draft suspends; return yields Ready-to-save only after explicit user action,
   never automatic write replay.
8. A hidden forgotten tab stops renewing the lease. A focused, non-idle suspended tab retains it; loss
   of presence gets 10 minutes before the normal countdown.
9. Same-user Continue here warns from `hasUnsavedWork`, rotates the fence, and destroys the old draft.
10. Publishing selectors advances the submitted fingerprint only after definitive Lynx success; an
    identical recalculation does not alter selector timestamps or require republishing.
11. Empty page types are invisible to completion; a zero-actionable feed shows a neutral note and cannot
    publish an empty set.
12. Any unexplained response shrink preserves the client baseline/draft and blocks writes.
