# P25 checked-in live comparison harness

## Purpose

`pnpm performance:p25:live` replaces the ignored P25 scratch scripts as the
evidence authority for live legacy/rewrite comparison. It does not replace the
repository browser launcher: start and control Chromium only through
`pnpm browser:live <explicit-url>` as required by `live-browser`, `live-round`,
and `live-watch`.

The harness never launches a browser, never touches OS Chrome, never opens a
second profile, and never performs final Lynx publication. `begin` starts one
run-owned publication-guard daemon against the launcher-owned browser-level CDP
endpoint; `finalize` stops it. Website observation remains stage-bounded and
must begin only after extension-owned Render Inspection or emulation has
acknowledged and released its debugger slot.

## Evidence identity

`begin` creates a fresh, exclusive run directory beneath
`output/playwright/p25-live-comparison/runs/`. The immutable manifest records:

- label and normalized URL;
- legacy/rewrite implementation and production/debug build variant;
- declared build source HEAD, current workspace HEAD, dirty flag, and a digest
  of exact dirty status;
- recursive unpacked-bundle digest, file count, byte count, manifest version,
  and bundle-root digest;
- managed-Chromium product/protocol/user-agent fingerprint and process-instance
  nonce;
- the resolved `.wxt/browser-profile` path fingerprint, cross-checked against
  Chromium's actual `--user-data-dir` command line;
- the no-publication contract and the pinned legacy `/load` compatibility policy;
- the exact loaded extension ID and an independent publication-guard nonce;
- the exact candidate disposition or durable N/A/external-block reason.

`begin` accepts only launcher provenance from `.temp/browser-live-provenance.json`.
`--source-head` cannot override source authority. Rewrite evidence requires a
clean current source and canonical `.output/chrome-mv3`; legacy evidence requires
the static pinned attestation at
`scripts/performance/p25/pinned-legacy-bundle-attestation.json`. Arbitrary 1.10
or 2.0 bundle roots are rejected even when their manifest version looks right.

Every stage re-computes source, bundle, browser, and profile identity before
collecting evidence. A mismatch fails before the probe. Stage directories and
JSON files are created exclusively with independent nonces; overwrite, duplicate
stage IDs, out-of-order stages, stale mtimes, mismatched timestamps, and stale
JSON reuse are rejected.

## Safe collection sequence

1. Build or restore the exact implementation bundle and start the explicitly
   requested URL with `pnpm browser:live <url> --no-build`. For the pinned legacy
   artifact use `--bundle-source .temp/p25-side-by-side/builds/legacy`; the
   launcher stages it recoverably into canonical `.output/chrome-mv3` and
   restores the rewrite bundle at shutdown. Never load the scratch path directly.
2. Run `begin`. It does not return until the run-lifetime publication guard has
   installed browser-level target discovery/auto-attach, attached the exact
   loaded extension target, and written a fresh coherent heartbeat. Legacy defaults to the pinned
   `28974c2a0c859c91a7167f4757cf84a47ea31e28` source identity and requires the
   1.10.0 bundle; rewrite requires 2.0.0. There is no operator eligibility
   override.
3. Capture `preflight`. It derives implementation-neutral validity from the
   normalized URL, document status when available, title/primary heading, and
   substantive body/content signals, then writes a run-, URL-, and
   document-bound `candidate-disposition.json`. Candidate-only stages cannot
   begin without that adopted artifact. A known not-found Aleris document stays
   N/A/external; a valid Aleris document is promoted only by these live facts.
4. Detach every website observer, then capture
   `render-mode-with-javascript --render-mode with-javascript`. The stage clicks
   the implementation's real popup control, waits for its lifecycle to terminalize,
   and only then attaches the bounded website observer.
5. Detach again, then capture
   `render-mode-without-javascript --render-mode without-javascript`; it performs
   and proves the second real inspection the same way.
6. Ensure marking is off, then capture `activation-network`. The persistent
   extension-target traffic guard is already installed before the click. For legacy it also patches the
   missing environment key before the first `/load`; the patch is part of the
   activation evidence. Only after terminal activation does the stage attach a
   bounded website sampler.
7. Capture, in order, `marking-visual`, `marking-gestures`,
   `marking-scroll-fade`, and `marking-resize`.
8. Capture `workflow-summary` while marking is still active. It runs current AI
   itself when `measured-current-run` is selected, retaining its real network,
   feedback, phase, and terminal timing evidence. Choose one of:
   - `--ai-mode measured-current-run`;
   - `--ai-mode retained-reference-only --ai-duration-ms 490178 --ai-evidence-artifact <path> --ai-reason <reason>` for the historical
     Ledigajobb sample. This is explicitly non-comparable and cannot yield an AI
     parity pass;
   - `--ai-mode not-run --ai-reason <reason>`, also non-comparable.
9. Use the real side panel to leave marking and reach the acknowledged silent
   posture. Keep website observers detached during the transition. Capture
   `silent-visual`, `silent-scroll-fade`, and `silent-resize`.
10. Exercise only the permitted Content List, Save/Discard, and checklist-open
    surfaces, then capture `publication-fence`. Do not click the modal's final
    send action.
11. Run `finalize`; it requests a guarded shutdown, waits for the final atomic
    evidence snapshot, and exits nonzero for any code-owned failed stage,
    missing stage, invalid identity, absent activation network evidence, missing
    render choice, incomplete visual/gesture evidence, or any publish attempt.

Example (paths abbreviated):

```bash
pnpm performance:p25:live begin \
  --implementation rewrite \
  --label dpj \
  --url https://www.dpj.se/ \
  --build-variant production

pnpm performance:p25:live stage --run <run-directory> --id preflight
pnpm performance:p25:live stage --run <run-directory> \
  --id render-mode-with-javascript --render-mode with-javascript
# ...remaining stages in the order printed by `pnpm performance:p25:live help`
pnpm performance:p25:live finalize --run <run-directory>
```

## Frame, visual, and gesture proof

Each relevant stage retains bounded compositor screencast frames and compact rAF
state. It reports median, p95, and worst frame delta, worst Long Task, distinct
compositor fingerprints, scroll-owner position, overlay opacity/visibility, and
rectangle signatures. First/change frames are retained as JPEGs, with stage and
popup PNG screenshots.

Visual evidence separately counts source owners, source `getClientRects()`
fragments, painted overlay rectangles, visible layers, physical hit-reachable
rectangles, and implementation-neutral markable candidates. Border width, style,
color, radius, opacity, z-index, and layer order are grouped without relying on
rewrite-only selectors. The marking probe performs real CDP mouse/key input for
plain-no-create, Shift expansion, exact plain unmark, Alt inclusion, context
menu, and plain inclusion unmark. Scroll probes require observed physical wheel
movement, fade, reposition, and restore. Resize probes record changed rectangle
signatures and exact viewport restoration.

## Publication safety and aggregate meaning

`begin` starts one guard that remains connected until `finalize`. Browser-level
CDP target auto-attach pauses every new or restarted service worker. Extension
pages are attached separately only after exact extension-ID discovery. The guard
enables `Fetch` Request-stage interception before resuming an extension target;
any non-extension target is immediately resumed and detached, so the website
debugger slot remains free for extension-owned Render Inspection and emulation.
A lost browser-level session records failed coverage and terminates the daemon
promptly rather than heartbeating until expiry. `/publish` is failed with `BlockedByClient` before
transmission, recorded with body byte count and digest, and still makes the
stage/run/pair fail. Request and response bodies are digested eagerly and then
discarded rather than retained in the long-lived daemon. On shutdown, event
listeners close first and already-started response-body and paused-request jobs
drain under a bounded fail-closed deadline before CDP detaches. Network entries,
attachment/detachment history, guard
errors, legacy `/load` patches, attempts, heartbeat, run/guard nonce, and target
coverage are atomically refreshed in `network/publication-guard.json`. Every
stage rejects stale, mismatched, inactive, non-dynamic, or targetless evidence;
`finalize` adopts the single cumulative snapshot rather than double-counting
per-stage copies. A valid run and pair therefore require exactly zero attempted
publishes, not merely zero successful responses.

`compare` accepts one validated production legacy and rewrite aggregate. It fails when
labels, normalized URLs, build variants, managed-browser fingerprint, profile,
or comparable document fingerprints differ. AI parity requires two current-run
measurements; a retained 490178 ms legacy sample remains visible reference
evidence but never masquerades as N/A or parity. `matrix` combines pair artifacts,
exits nonzero for any red/missing eligible property, includes exact 3D Prima,
Bigbag, and runtime Aleris disposition reasons, and re-enforces zero publish
attempts across the entire batch. Valid non-candidate evidence is reported as
`overall: n/a`, never `passed`.

The pinned legacy source has no authentic debug build. A production matrix uses
`matrix --build-variant production --comparisons <pairs>`. A debug rewrite run
may still be retained as diagnostic evidence, but `matrix --build-variant debug`
returns explicit `overall: n/a` with reason
`legacy-debug-artifact-unavailable`; debug must never be labelled as parity.
