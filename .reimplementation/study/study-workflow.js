/* global agent, log, parallel, phase */

export const meta = {
  name: 'unfluffify-legacy-vs-rewrite-study',
  description: 'Exhaustive comparative study of the legacy extension (main) vs the reflex-arc rewrite (re-write): architecture weaknesses, UX/visual inventory, gap analysis',
  phases: [
    { title: 'Study', detail: '7 parallel deep-readers over both trees' },
    { title: 'Synthesize', detail: 'weakness-resolution verdicts + UX bring-over catalog' },
    { title: 'Critique', detail: 'completeness critic over all reports' },
    { title: 'Patch', detail: 'follow-up readers for coverage gaps' },
  ],
}

const LEGACY = '/tmp/claude-1000/-home-rojan-Documents-Git-GitHub-Unfluffify/b1655411-e6e6-4a07-9e06-63a92fc1f3e8/scratchpad/legacy-main'
const REWRITE = '/home/rojan/Documents/Git/GitHub/Unfluffify'
const REPORTS = '/tmp/claude-1000/-home-rojan-Documents-Git-GitHub-Unfluffify/b1655411-e6e6-4a07-9e06-63a92fc1f3e8/scratchpad/reports'

const CONTEXT = `
PROJECT CONTEXT (read carefully, this is shared background):
Unfluffify is a Chrome MV3 extension used by an internal editor team ("Lynx" ecosystem) to mark non-meaningful page elements on customer web properties, so downstream AI scraping focuses on substantive content. It talks to: (a) a USER-owned config + property-lock backend (/load, /save, /remove, lock endpoints), (b) an AI selector service (POST /get_selectors, async job polling), (c) a GraphQL backend (urlSearchInfo, propertyPageTypes, cssInfo, updateScrapingConditions) plus an accounts/token system with token rotation.

TWO VERSIONS UNDER STUDY:
- LEGACY (production, v1.10.0 + 3 fixes): a git worktree of branch main at ${LEGACY}. Grew organically from a simple JS extension into a multi-layer TypeScript app; known to be entangled ("spaghetti communication and decision making"), yet its popup/content UX is established and polished. Biggest files: src/content/core.ts (~14300 lines), src/popup.ts (~10000), src/content-main.ts (~7500), src/background.ts (~4300), src/popup/ui.tsx (~2800), plus src/background/brain/* deciders, src/common/* (spinner-contract, page-motion-freeze-bridge/control, property-lock-background, config, emulation, lynx-checklist).
- REWRITE (branch re-write, checked out at ${REWRITE}): a deliberate from-scratch "reflex-arc" reimplementation. Its contract docs live at ${REWRITE}/.reimplementation/ (plan.md, architecture.md, contract-invariants.md, remote-api.md, decisions-log.md, audit.md, audit-2.md, audit-3.md). Implemented as P0..P10 slices then ~50 commits of continued work porting legacy behaviors (popup views, render-mode CTA, consent hiding, mobile emulation spoofing, page ritual).

IMPORTANT GROUND RULES:
- The backend-facing data schema redesign is DELIBERATE (legacy config version 5 with pageMarkings[url].xpaths + submissionXpaths vs rewrite version 1 with unified rows:[{xpath, excluded, explicit?}]). Do NOT flag schema differences as defects. Behavioral/UX differences ARE in scope.
- Cite evidence as file:line for every claim. Read the actual code; do not trust doc claims without spot-checking.
- Known live findings on legacy production (from prior live QA, for your awareness): a 200 /save once wiped all page markings (half-snapshot write); AI-computed selectors intermittently never reach config.selectors so a save persists stale selectors; a property whose config record was deleted cannot be re-bootstrapped when only one of two render-mode inspections completes; a destructive-save guard fix existed but was dropped when main was reset (dangling commit e11059b1 — you can 'git show e11059b1' from ${REWRITE} to see it).

OUTPUT CONTRACT:
Write your FULL report as GitHub-flavored markdown to the exact file path given in your task (the reports directory ${REPORTS} exists). Be exhaustive — this report is the persistent artifact; your returned summary is only a pointer. Then return the structured output: reportPath, a 10-20 line summary, keyFindings (the most load-bearing facts), and openQuestions (ONLY genuine product/design decisions a product owner must answer — not things answerable from code).
`

const REPORT_SCHEMA = {
  type: 'object',
  required: ['reportPath', 'summary', 'keyFindings', 'openQuestions'],
  properties: {
    reportPath: { type: 'string' },
    summary: { type: 'string' },
    keyFindings: { type: 'array', items: { type: 'string' } },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
}

phase('Study')

const studies = [
  {
    key: 'legacy-arch-weaknesses',
    prompt: `${CONTEXT}
TASK: Catalog every architecture and implementation weakness of the LEGACY version at ${LEGACY}. This catalog is the checklist the rewrite will be judged against, so each weakness must be stated as a testable property, not a vibe.

Study at minimum: src/background.ts, src/background/brain/** (deciders, spinner-authority, signal-log, heartbeat, persistence), src/content/core.ts, src/content-main.ts, src/popup.ts, src/common/** (spinner-contract, page-motion-freeze-bridge, page-motion-freeze-control, property-lock-background, config, utilities, emulation), src/popup/** (marking-session-machine, remote-config, site-resolution, messages). Look for:
- entangled communication: who talks to whom, message types, request/response vs broadcast, layering violations (popup deciding for content, content deciding for background, etc.)
- decision-making scattered across layers (the same decision made in 2+ places, or state duplicated then desynced — e.g. the documented popup toggleEnabled stale-cache desync)
- god files/functions, module coupling, cyclic deps
- state management: module-level mutable caches, race-prone async flows, SW-restart fragility, IndexedDB vs storage.sync split
- lifecycle fragility: one-shot latches (the consumed reveal-attempt bug), navigation/dispose paths, brain.disposeTab known-unsafe
- error handling: swallowed errors, generic "Unable to save session" masking backend bodies, 4xx retries
- save/sync integrity: how config snapshots are assembled and why half-snapshot writes were possible
- testability issues.
For each weakness: WHAT (testable statement), WHERE (file:line evidence), WHY it hurts (symptom/bug it caused if known), and what a correct design would look like.
Also mine ${LEGACY}/.copilot/knowledge.md for documented pain points confirming your findings.
Write the full report to ${REPORTS}/legacy-arch-weaknesses.md`,
  },
  {
    key: 'legacy-popup-ux',
    prompt: `${CONTEXT}
TASK: Produce an EXHAUSTIVE popup + browser-action UX/visual specification of the LEGACY version at ${LEGACY}. This spec must be complete enough that a developer who never saw the legacy popup could re-create it pixel-faithfully and behavior-faithfully.

Study: src/popup.ts (~10000 lines — read it all, in chunks), src/popup/ui.tsx (~2800 lines), src/popup/** (property-lock-ui, messages, remote-config, site-resolution, marking-session-machine, lynx-checklist usage), src/theme-components.css, src/theme-color.css, src/theme-utilities.css, src/popup.css if present, fonts and icon assets under src/public/, the manifest/action wiring (badge, action icon states active/default, title), and any options/settings page.
Document:
- every VIEW/screen/mode the popup can show (signed-out, no-property, property resolution, render-mode selection, marking session, preview, property-lock states, spinners/curtains, error states) and the exact conditions for each
- every CONTROL: id/label/exact text, enabled/disabled gating conditions, click behavior, confirm dialogs (exact strings), tooltips
- every NOTICE/status line: exact strings, when shown ("Saved and synced", "Changes ready to save", "Selectors computed locally at ...", TODO x/5 checklist, etc.)
- visual design system: colors (light/dark?), typography (Inter/JetBrains Mono usage), spacing, component styles (buttons, toggles, sidebar, checklist), iconography (Material Design Icons usage), logo
- layout structure and dimensions
- loading/spinner choreography (spinner-contract) as seen from the popup
- the popup lifecycle: what happens on open/close/reopen, debug affordances (?debugTabId=)
- accounts/sign-in UX and token handling as surfaced to the user
- "Send to Lynx" flow UX.
Write the full report to ${REPORTS}/legacy-popup-ux.md`,
  },
  {
    key: 'legacy-content-ux',
    prompt: `${CONTEXT}
TASK: Produce an EXHAUSTIVE in-page (content script) UX/visual specification of the LEGACY version at ${LEGACY} — everything the user sees and does ON THE PAGE.

Study: src/content/core.ts (~14300 lines — cover it fully, in chunks; it is the visual engine), src/content-main.ts (~7500 lines), src/common/page-motion-freeze-bridge.ts and page-motion-freeze-control.ts, src/common/spinner-contract.ts, src/common/emulation.ts, cursor SVGs under src/public/cursors/, and MARKING_AND_HIGHLIGHTING_LOGIC.md (the locked contract).
Document:
- overlay rendering: every overlay class (uf-rect, uf-hard-locked, uf-explicit-exclude, uf-ai-content, uf-silent-rect, uf-silent-content, ghost fallbacks...), exact colors/opacity/z-index/borders/labels, layering rules, what each represents semantically
- silent mode visuals vs marking mode visuals, and the handover between them
- marking interactions: click include/exclude semantics, first-click behavior on default boundaries, Shift-widening (climbing grouping ancestors), hover feedback, custom cursors (include.svg/exclude.svg), cursor-disabled state
- the reveal/freeze ritual: page-motion pause (uf-page-motion-paused), scroll/animation freezing, the curtain + spinner (single-spinner contract), reveal choreography and timing, one-per-visit semantics
- consent chrome hiding: what is hidden, when (every property page at load), how
- preview mode: what it renders, sidebar, exit affordance
- mobile emulation UX effects (viewport, identity spoofing — including what the re-write added, but focus legacy here)
- render-mode inspection UX (JS-on / JS-off inspections) as visible to the user
- page-visit lifecycle from the user's perspective: passive load vs activation vs cross-property nav
- badge/action icon feedback per tab state.
Include exact CSS values (colors, borders, shadows, transitions) with file:line. Write the full report to ${REPORTS}/legacy-content-ux.md`,
  },
  {
    key: 'legacy-feature-flows',
    prompt: `${CONTEXT}
TASK: Produce an end-to-end FEATURE AND FLOW inventory of the LEGACY version at ${LEGACY} — every capability the product has, as user-visible flows with their backend interactions.

Study: src/background.ts, src/background/ai-run-orchestrator.ts, src/background/ai-run-record-store.ts, src/background/async-tasks.ts, src/background/auth-token-monitor.ts, src/background/remote-config-sync.ts, src/background/remote-network.ts, src/common/config.ts, src/common/property-lock-background.ts, PROPERTY_LOCK.md, src/common/lynx-checklist.ts, src/popup/site-resolution.ts, src/popup/remote-config.ts, and whatever else these lead to.
Document each flow step-by-step (trigger → layers involved → backend calls → state changes → user-visible result):
1. Property identification/resolution (URL → siteId via GraphQL urlSearchInfo, base-URL handling)
2. Activation lifecycle (passive load, popup activation, silent mode, session start/end, cross-property nav reset)
3. Render-mode inspection (the two inspections JS-on/JS-off, confirmation, persistence, the Set action being local-only)
4. Marking session: enable → seed defaults/selectors → user edits → dirty tracking → save/discard semantics (what Discard restores, what a successful save does — e.g. ends the session)
5. AI run: submission payload assembly (sanitized page snapshot), async job lifecycle, status polling, result application, preview
6. Save/load config: snapshot assembly, version, what fields, sync guard logic, failure modes
7. Property lock: acquire/heartbeat/takeover/rotation/observer-refresh (PROPERTY_LOCK.md is the locked contract — digest it)
8. Accounts: sign-in state, token rotation, auth-token-monitor
9. Page types (propertyPageTypes GraphQL, pageTypeAssignments flag), cssInfo, updateScrapingConditions
10. Lynx checklist (TODO x/5) and "Send to Lynx" (updateScrapingConditions? submittedSelectorsFingerprint)
11. Options/settings, endpoints config (storage.sync globalConfigEndpoint/globalEndpoint/globalStageBase/globalToken)
12. Anything else you find (emulation, keepalive, badge, uninstall/install hooks, migrations).
Write the full report to ${REPORTS}/legacy-feature-flows.md`,
  },
  {
    key: 'legacy-locked-contracts',
    prompt: `${CONTEXT}
TASK: Digest the LEGACY repo's DOCUMENTED contracts and institutional knowledge at ${LEGACY} into a register of (a) locked behavioral contracts that must survive any rewrite, and (b) documented pain points/gotchas/deferred bugs.

Study COMPLETELY: MARKING_AND_HIGHLIGHTING_LOGIC.md, PROPERTY_LOCK.md, .copilot/knowledge.md, .copilot/architecture/content-marking/*.md, .copilot/architecture/marking-algorithm/*.md, .copilot/architecture/marking-implementation-plan.md, .copilot/architecture/reflex-arc-plan.md, .copilot/architecture/muscle-memory-inventory.md, .copilot/architecture/widening-hardening-plan.md, .copilot/architecture/marking-widening-review.md, .copilot/HANDOFF.md, .copilot/plan.md, .copilot/lifecycle-resume-plan.md.
Produce:
- LOCKED CONTRACTS: each rule stated precisely (marking model invariants like "selectors/default-tags are initial-state only, rows are sole truth after seeding", immutable-tag lists, widening rules, CP1-CP8 behaviors, property-lock protocol rules, spinner/single-curtain contract, reveal-once-per-visit + real-activation gating, consent-on-every-property-page). Mark which are visual/UX vs algorithmic vs protocol.
- PAIN REGISTER: every documented bug, misdiagnosis, deferred item, live-QA gotcha, with status (fixed-in-legacy / deferred / retracted).
- QA DECISION LOG: decisions locked in 04-qa-decisions.md files that constrain design.
Do not paraphrase into mush — keep the precise conditions. Cite doc sections. Write the full report to ${REPORTS}/legacy-locked-contracts.md`,
  },
  {
    key: 'rewrite-architecture',
    prompt: `${CONTEXT}
TASK: Study the REWRITE architecture at ${REWRITE} (branch re-write is checked out there) and produce a precise description of how it works plus an assessment of its architectural soundness. You are the foundation for judging whether the rewrite solved the legacy's entanglement problems.

First read all of ${REWRITE}/.reimplementation/ (plan.md, architecture.md, contract-invariants.md, remote-api.md, decisions-log.md, README.md, audit.md, audit-2.md, audit-3.md) — this is the intended contract. Then verify against code:
- src/domain/** (pure core: schema, evaluate, boundary, widening, xpath, taxonomy, visibility, selector-seed)
- src/background/** (rewrite-brain.ts, rewrite-brain-runtime.ts, brain/decide.ts, brain/fold.ts, brain/project.ts, brain/signals.ts, services.ts, persistence.ts, lock-runtime.ts, render-emulation-runtime.ts, keepalive.ts, auth-token-monitor.ts)
- src/messaging/** (bus, contracts, realms, transports)
- src/content/** (activation.ts FSM, command-router.ts, consent.ts, marking/**, stabilization/**)
- src/popup/** (App.tsx, organ/machine.ts, organ/memory.ts, store.ts, view.ts, event-log.ts, signal-cursor.ts)
- src/storage/** (repositories, durable, session, settings), src/lock/**, src/lynx/**, src/offscreen/**, src/page-world/program.js, entrypoints.
Describe: the signal→fold→decide→project loop; how layers communicate (who initiates, what is a fact vs command vs signal); state ownership and persistence model; how tabs/navigation/SW-restart are handled; the popup organ FSM; content autonomous organs; how re-derivation is branch-scoped; error propagation. Assess: does the code MATCH the .reimplementation contract, and where does it deviate? Are there places where legacy-style entanglement is creeping back in (check the newest ~15 commits especially)? Any new architectural risks (e.g. signal-log growth, cursor serialization, event ordering)?
Write the full report to ${REPORTS}/rewrite-architecture.md`,
  },
  {
    key: 'rewrite-implementation-state',
    prompt: `${CONTEXT}
TASK: Determine the CURRENT implementation state of the REWRITE at ${REWRITE}: what is actually implemented and working, what is stubbed, what is missing entirely — especially on the UX surface.

Method:
- Read the recent history: git log --oneline 28974c2a..re-write (67 commits) and read the diffs of the most recent ~20 commits (git show) to understand the active work.
- Read src/popup/App.tsx, src/popup/view.ts, src/popup/organ/machine.ts + memory.ts, src/popup.css, theme CSS files — inventory every view/control/string the popup currently renders.
- Read src/content/** for which in-page behaviors exist (consent hiding, freeze/reveal ritual, silent highlighting, marking overlays/interactions, preview?, emulation).
- Read src/entrypoints/**, wxt.config.ts, manifest permissions.
- Search for TODO/FIXME/stub/placeholder/not implemented markers across src/.
- Read the test suite structure under tests/ to see what is pinned by tests vs untested.
- Compare against the audits' claims (.reimplementation/audit*.md) and note what changed since.
Produce an implementation-status matrix: for each subsystem and each user-visible feature (popup views/controls, content visuals/interactions, flows: activation, render-mode, marking session, AI run, save/discard, preview, property lock, accounts, checklist, Send to Lynx, options/settings, badge/icon), status = IMPLEMENTED (evidence) / PARTIAL (what exists, what's missing) / STUBBED / ABSENT. Note any features the REWRITE has that legacy lacks (e.g. mobile identity spoofing commits). 
Write the full report to ${REPORTS}/rewrite-implementation-state.md`,
  },
]

const studyResults = await parallel(studies.map(s => () =>
  agent(s.prompt, { label: `study:${s.key}`, phase: 'Study', schema: REPORT_SCHEMA })
))

const studyByKey = {}
studies.forEach((s, i) => { studyByKey[s.key] = studyResults[i] })
const completed = studies.filter((s, i) => studyResults[i]).map(s => s.key)
log(`Study complete: ${completed.length}/7 reports written`)

const questionPool = []
studyResults.filter(Boolean).forEach(r => questionPool.push(...(r.openQuestions || [])))

phase('Synthesize')

const synthCommon = `${CONTEXT}
Seven study reports have been written to ${REPORTS}/: legacy-arch-weaknesses.md, legacy-popup-ux.md, legacy-content-ux.md, legacy-feature-flows.md, legacy-locked-contracts.md, rewrite-architecture.md, rewrite-implementation-state.md. Read the ones your task names IN FULL, and verify claims against actual code in both trees when the reports conflict or when a claim is load-bearing for your verdict.`

const synthesis = await parallel([
  () => agent(`${synthCommon}
TASK: Produce the WEAKNESS-RESOLUTION VERDICT TABLE — the answer to "has the rewrite solved every weakness and concept/architecture issue of the legacy version?".
Read ${REPORTS}/legacy-arch-weaknesses.md, ${REPORTS}/legacy-locked-contracts.md (pain register), ${REPORTS}/rewrite-architecture.md, ${REPORTS}/rewrite-implementation-state.md.
For EVERY weakness/pain item in the legacy catalogs, render a verdict against the rewrite code at ${REWRITE}:
- SOLVED-BY-DESIGN (the architecture makes the failure impossible — explain the mechanism, cite rewrite code)
- SOLVED-IN-CODE (handled but by convention/implementation, could regress — cite code)
- PARTIAL (what remains)
- UNSOLVED (weakness still present or reintroduced — cite where)
- NOT-YET-APPLICABLE (the subsystem isn't built yet, so the weakness can't be judged; note what to watch for)
Do NOT take the study reports' word for rewrite behavior — spot-check every UNSOLVED/PARTIAL verdict directly in the rewrite code, and at least skim-verify the SOLVED ones. Also add a section NEW RISKS: weaknesses the rewrite introduces that legacy did not have. Order the table by severity. This becomes plan section 1 (corrections needed), so for each non-SOLVED item include a concrete correction recommendation.
Write the full report to ${REPORTS}/verdicts-weakness-resolution.md`,
    { label: 'synth:weakness-verdicts', phase: 'Synthesize', schema: REPORT_SCHEMA }),
  () => agent(`${synthCommon}
TASK: Produce the UX BRING-OVER CATALOG — the complete, prioritized inventory of legacy visual/UX design and functionality that must be ported to the rewrite.
Read ${REPORTS}/legacy-popup-ux.md, ${REPORTS}/legacy-content-ux.md, ${REPORTS}/legacy-feature-flows.md, ${REPORTS}/legacy-locked-contracts.md (locked UX contracts), ${REPORTS}/rewrite-implementation-state.md.
For EVERY UX element / visual / interaction / flow / string / state in the legacy inventories, record:
- element (precise: view, control, overlay, ritual, string, timing)
- legacy behavior (with the legacy file:line from the reports; verify against ${LEGACY} when unclear)
- rewrite status: PRESENT (already ported — cite rewrite code), PARTIAL (what differs), ABSENT
- porting notes: how it should map onto the rewrite architecture (which organ/layer owns it, what signals/facts it needs) — respecting the reflex-arc doctrine, never suggesting legacy-style shortcuts
- any deliberate-change candidates (places where legacy UX was itself awkward — flag as OPEN QUESTION rather than silently changing).
Group by surface: popup views, popup components/design-system, in-page overlays/interactions, rituals (freeze/reveal/curtain/consent), flows (AI run, save/discard, preview, lock, accounts, checklist/Send-to-Lynx), chrome-level (badge, icons, action states). Include a design-token section (colors, fonts, spacing) noting that rewrite already carries theme-*.css and fonts — verify which tokens match legacy and which drifted.
Write the full report to ${REPORTS}/catalog-ux-bring-over.md`,
    { label: 'synth:ux-catalog', phase: 'Synthesize', schema: REPORT_SCHEMA }),
])

const verdicts = synthesis[0]
const uxCatalog = synthesis[1]
synthesis.filter(Boolean).forEach(r => questionPool.push(...(r.openQuestions || [])))

phase('Critique')

const critic = await agent(`${CONTEXT}
TASK: You are the completeness critic. Nine reports exist in ${REPORTS}/ (ls it). Your job is to find WHAT IS MISSING before a repository-level implementation plan is written from them.
Method:
1. Enumerate ground truth yourself: list every source file in both trees (${LEGACY} and ${REWRITE}, src/ plus manifests/configs) and check each is accounted for by some report's coverage. Files nobody covered = potential blind spots (e.g. options page, offscreen document, i18n, badge logic, uninstall hooks, keyboard shortcuts, context menus, web-accessible resources, update/migration paths).
2. Cross-check the two synthesis reports (verdicts-weakness-resolution.md, catalog-ux-bring-over.md) against the five study reports: any weakness without a verdict? any UX element without a bring-over row? any locked contract not mapped?
3. Sanity-check load-bearing claims: pick the 10 most consequential claims across reports and verify each against code directly.
4. List concrete COVERAGE GAPS as instructions for follow-up: each gap = {area, why it matters, exactly what to read}.
Return via structured output; also write your full critique to ${REPORTS}/critique-completeness.md.
In the structured output field "gaps", list at most 4 gaps worth a follow-up reader, most important first. If coverage is genuinely complete, return an empty gaps array.`,
  { label: 'critic:completeness', phase: 'Critique', schema: {
      type: 'object',
      required: ['reportPath', 'summary', 'gaps'],
      properties: {
        reportPath: { type: 'string' },
        summary: { type: 'string' },
        gaps: { type: 'array', items: { type: 'object', required: ['area', 'instructions'], properties: {
          area: { type: 'string' }, instructions: { type: 'string' } } } },
        openQuestions: { type: 'array', items: { type: 'string' } },
      },
    } })

if (critic && critic.openQuestions) questionPool.push(...critic.openQuestions)

let patched = []
if (critic && critic.gaps && critic.gaps.length > 0) {
  phase('Patch')
  log(`Critic found ${critic.gaps.length} coverage gaps — patching`)
  patched = await parallel(critic.gaps.slice(0, 4).map((g, i) => () =>
    agent(`${CONTEXT}
TASK: Fill a coverage gap the completeness critic found in the comparative study.
GAP AREA: ${g.area}
INSTRUCTIONS FROM CRITIC: ${g.instructions}
Read the relevant code in ${LEGACY} and/or ${REWRITE} exhaustively, then write a focused supplemental report to ${REPORTS}/patch-${i + 1}.md covering: legacy behavior (if applicable), rewrite status, weaknesses, UX elements to bring over, and any product-owner questions. Same evidence standards: file:line citations.`,
      { label: `patch:${g.area.slice(0, 30)}`, phase: 'Patch', schema: REPORT_SCHEMA })
  ))
  patched.filter(Boolean).forEach(r => questionPool.push(...(r.openQuestions || [])))
}

return {
  reportsDir: REPORTS,
  studies: studies.map((s, i) => ({ key: s.key, ok: !!studyResults[i], reportPath: studyResults[i] ? studyResults[i].reportPath : null, summary: studyResults[i] ? studyResults[i].summary : null })),
  verdictsSummary: verdicts ? verdicts.summary : null,
  verdictsKeyFindings: verdicts ? verdicts.keyFindings : [],
  uxCatalogSummary: uxCatalog ? uxCatalog.summary : null,
  uxCatalogKeyFindings: uxCatalog ? uxCatalog.keyFindings : [],
  criticSummary: critic ? critic.summary : null,
  gapsPatched: patched.filter(Boolean).length,
  openQuestions: questionPool,
}
