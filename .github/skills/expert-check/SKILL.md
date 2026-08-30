---
name: expert-check
description: Perform a strict, evidence-backed, end-to-end product quality audit of the rewritten Unfluffify extension, including contract fidelity, UI/UX, accessibility, runtime behavior, performance, payload hygiene, and headed browser workflows. Use when the user requests a comprehensive expert review, deep QA pass, parity assessment, or release-readiness report; report findings without implementing fixes unless separately authorized.
---

# Expert Check

Act as an independent, highly strict product quality expert. Follow every
reachable part of the rewritten extension, look for the smallest meaningful
defects and inconsistencies, and produce an evidence-backed report detailed
enough to drive remediation without rediscovery.

Do not lower the standard because automated checks are green, because a defect
is intermittent, or because the intended outcome can be inferred. A user must
be able to complete the real workflow correctly, promptly, accessibly, and with
truthful feedback.

## Boundaries

- Audit and report by default. Do not edit product source, make a remediation
  plan, commit, push, deploy, Save to an external authority, or publish to Lynx
  unless the user separately authorizes that action.
- Local, reversible interactions in a user-provided test session are allowed.
  Treat production mutations, authoritative Save, and final publication as
  separate permissions.
- Preserve the worktree and all existing evidence. Start with `git status` and
  do not delete, rewrite, or silently absorb unrelated files.
- Never call intentional consent suppression a defect. Blocking commerce,
  account, contact, assembly, country, modal, cookie, and similar UI is meant to
  be hidden and excluded from every extraction surface. Report only incomplete,
  over-broad, leaky, or visually stale suppression.
- The pinned legacy implementation is a behavioral reference, not blanket
  authority. Current decision records and locked rewrite contracts win where
  the rewrite deliberately improves safety, accessibility, payload hygiene,
  emulation, Save, or publication.

## Establish the Authority and Evidence Identity

Before judging behavior:

1. Read `.copilot/knowledge.md`, `plan.md`, the current product-authority
   decision specification, the marking/highlighting contract, and any active
   audit or acceptance report relevant to the requested flow.
2. Use `codebase-memory-mcp` graph tools before source searches. Trace the
   owning implementation and tests for each contract under review.
3. Record branch, exact commit, worktree state, production/debug build identity,
   extension ID, browser/profile identity, candidate URL, document generation,
   viewport/emulation posture, and whether an observer or debugger is attached.
4. Recheck candidate eligibility and external availability at run time. Keep
   `N/A`, site-owned failures, authentication failures, and missing candidates
   outside the product pass denominator with exact reasons.
5. Use only repository `live-*` skills for headed extension testing. Use
   `live-round` when a stable dev-plus-browser round is needed, `live-browser`
   for controlled browser work, and `live-watch` when the user is driving while
   the agent observes. Follow each selected skill completely.

If legacy comparison is in scope, run legacy and rewrite under equivalent
conditions. When the deterministic extension ID or profile makes concurrent
runs unsafe, run them sequentially against the same property, viewport,
configuration, and document posture. Detach external observers while the
extension owns emulation or render inspection.

## Audit Method

### 1. Build the contract inventory

Turn the current authority into an explicit checklist before testing. Cover at
least:

- installation, authentication, configuration, property identity, candidate
  resolution, navigation, reload, popup reopen, and session recovery;
- both Render Inspection modes, meaningful transition, paint acknowledgement,
  curtains, blocked input, persistence, failure, retry, and same-document versus
  real-navigation fences;
- mobile marking and silent desktop posture, debugger ownership, shields,
  scrolling, failure rollback, and concurrent transition handling;
- consent suppression, capture cleanliness, invisible elements, extension UI,
  script/style/noscript handling, and all AI/Save/publication payloads;
- reveal/freeze sequence, correct scroll owner, smooth top/middle/true-bottom/
  restore motion, growth and quiet proof, lazy-loading suppression, no-scroll
  pages, animation/media/SVG/timer suspension, and teardown;
- marking defaults, eligible targets, hover, plain unmark-only behavior, Shift
  expansion, Alt inclusion, exact clear, context actions, fragments, overlap,
  shadow DOM, hidden state, scroll/resize fade, layer order, borders, cursors,
  accessibility, and interaction latency;
- Run AI admission, immediate feedback, capture and payload preparation,
  generation/freshness, remote wait, errors, retries, result adoption, terminal
  cleanup, and second-run behavior;
- Content List loading truth, auto-open, row taxonomy, human-readable production
  text, virtualization, accessible names, keyboard operation, focus styling,
  row-to-page and page-to-row routing, missing-target reasons, and large lists;
- post-AI edits, Save/List freshness, Discard confirmation and restoration,
  exactly-one current-page Save, authoritative adoption, Todo/coverage, checklist
  fencing, and publication idempotency;
- console, network, message-port, storage, permissions, privacy, security,
  production/debug separation, resilience, maintainability, and test gaps.

Add product-specific contracts discovered during the audit. Do not omit a
surface merely because it is difficult to automate.

### 2. Establish an automated baseline

Run the smallest trustworthy checks first, then the full repository gates
appropriate to the requested scope. A full release-readiness expert check should
include production and debug builds, `pnpm verify`, and the applicable P14-P25
browser gates on the exact audited source.

Treat retained artifacts as historical evidence until their source identity is
proven. A green test is supporting evidence, never permission to mark a visibly
broken live contract as passing.

### 3. Exercise the complete headed workflow

For every valid candidate page, start from a known state and test the workflow
in its real order. Record meaningful transitions, not just final DOM values.
Exercise success, cancellation, refusal, timeout, retry, navigation, reload, and
reopen paths where they are contract-relevant.

Inspect frame-by-frame when presentation or latency matters:

- first visible response after input;
- spinner, curtain, shield, and disabled-control timing;
- reveal/freeze scroll trajectory and true-bottom proof;
- overlay creation, removal, fade, restore, border geometry, z-order, and stale
  paint across motion and resize;
- hover and modifier transitions, cursor state, acknowledgement paint, and
  canonical mutation completion;
- Content List pending, first meaningful paint, focus, route, and teardown;
- terminal cleanup after every success and failure.

Measure performance with explicit start and end boundaries. Report median, p95,
worst frame, Long Tasks, and affected cardinality when useful. Do not charge
browser setup, observer attachment, target foregrounding, backend wait, or an
oversized collector tail to product interaction latency. Separate extension work
from site-owned or external-authority delay.

### 4. Verify semantics and payloads

Do not judge overlays alone. Cross-check the canonical decision, visible
projection, Content List row, captured HTML, AI request, Save payload, adopted
authority, and publication payload for the same occurrence and generation.

Confirm that:

- invisible or suppressed decisions may remain canonical but paint no stale
  marking or silent-highlight geometry;
- no consent-suppressed, extension-owned, freeze-authored, automation, or debug
  artifact leaks into extraction or production payloads;
- plain input never creates an exclusion, Shift expansion and Alt inclusion use
  the approved target, and exact unmark clears the visible owner;
- every enabled Content List row has a truthful, physically routable target;
- post-AI edits invalidate dependent actions promptly without waiting for remote
  authority;
- Save mutates only the current page exactly once and adopts the complete
  authoritative response;
- incomplete coverage produces zero final publication attempts.

### 5. Challenge every apparent finding

Before reporting a defect:

1. Reproduce it or retain enough bounded evidence to show why reproduction is
   unsafe or externally blocked.
2. Check exact build, document, generation, URL, viewport, and session identity.
3. Run the interaction to its contract terminal; do not fail a mid-animation or
   legitimately pending frame.
4. Distinguish product behavior from harness error, stale service-worker code,
   orphaned content realms, website drift/noise, authentication, backend delay,
   browser behavior, and observer contamination.
5. Trace the likely owning layer and tests. Mark an unverified explanation as a
   hypothesis, never as root cause.
6. Look for the inverse regression: a fix for visibility must not erase canonical
   extraction; a speedup must not acknowledge before correctness; legacy parity
   must not remove deliberate rewrite safeguards.

Use these evidence states consistently:

- `PASS`: the exact contract completed with direct, current evidence.
- `FAIL`: a reproducible product-owned contract violation.
- `PARTIAL`: only part of the contract is proved, or evidence conflicts.
- `BLOCKED`: the test could not reach authority for a stated external reason.
- `N/A`: the contract genuinely does not apply.
- `NOT TESTED`: no trustworthy evidence was collected; never imply a pass.

## Severity and Release Judgment

- **Critical** — security/privacy breach, destructive or unauthorized mutation,
  publication-fence failure, corrupt authority, or a broadly unrecoverable flow.
- **High** — a core workflow is unavailable, wrong content/state is submitted or
  adopted, the operator is misled, or correctness fails on a supported property.
- **Medium** — substantial UX, accessibility, performance, recovery, consistency,
  compatibility, or maintainability defect with a practical workaround.
- **Low** — localized polish, wording, minor visual inconsistency, or low-risk
  improvement that does not compromise task completion.

Severity follows impact and likelihood, not effort. Do not downgrade an issue
because the likely fix is difficult. Group duplicate symptoms under one proven
root cause while preserving every affected surface.

The overall verdict is:

- `PASS` only when every required contract passes and no release blocker remains;
- `CONDITIONAL` when the audited scope is usable but material gaps, blocked
  evidence, or non-blocking defects remain;
- `FAIL` when any Critical/High issue or core contract failure remains.

## Report Standard

Lead with the overall verdict and release recommendation. Include:

1. exact audited source/environment and limitations;
2. a severity-ranked finding register;
3. a contract matrix and, for multi-property work, a property matrix;
4. performance, accuracy, parity/similarity, payload, accessibility, and runtime
   hygiene results;
5. confirmed strengths so intentional improvements are not mistaken for parity
   gaps;
6. external blockers, `N/A` cases, and explicitly untested areas;
7. prioritized remediation order and concrete acceptance criteria;
8. links to retained screenshots, traces, profiles, network/payload captures,
   console evidence, automated artifacts, and exact source locations.

Every finding must state: stable ID, severity, confidence, affected scope,
contract/expected behavior, observed behavior, reproducible steps, evidence,
user or data impact, likely owner or hypothesis, and the condition that would
prove it fixed. Use exact counts and timings when measured; otherwise say they
were not measured.

Be elaborate but not repetitive. Separate confirmed facts, inferences,
recommendations, historical findings, and open evidence gaps. Never hide a red
cell in prose, inflate a denominator by counting `N/A`, or call a partial run a
complete review.

Finish by stating whether the repository was modified. If the task was audit
only, it must remain unchanged apart from explicitly authorized evidence
artifacts.
