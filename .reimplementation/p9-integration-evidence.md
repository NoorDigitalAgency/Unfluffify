# P9 End-to-End Integration Evidence

**Extension baseline:** `a5d75706` on `re-write`  
**Hub baseline:** `9bdce9f` on clean `develop`

The P9 gate was run as a cross-layer scenario matrix. Assertions cover the
background authority/services, content lifecycle, popup projection and command
entrypoint, Hub-facing REST fixtures, and the persisted/captured payloads. The
matrix uses emitted signals, command replies, browser lifecycle events, and
promise completion as readiness conditions; the only timer use in these tests
is a zero-delay event-loop flush, not a fixed lifecycle wait.

| Scenario | State-bearing evidence |
|---|---|
| 1. Configure/authenticate/candidates/lock | `tests/src/background/services.test.ts`, `tests/src/background/startup.test.ts`, `tests/src/popup/entrypoint.test.ts`, `tests/src/lynx/rest.test.ts` assert normalized stored settings/token state, resolved feed context, lock authority/fence, popup state, and exact Hub request/response bodies. |
| 2. Mobile/reveal/freeze/silent | `tests/src/background/render-emulation-runtime.test.ts` and `tests/c4-content-entrypoint.test.ts` assert the CDP posture, content activation facts, reveal/freeze command lifecycle, page-world pause state, and silent surface state. |
| 3. Marking/defaults/modifiers/fast acknowledgement | `tests/c4-content-entrypoint.test.ts` asserts content-engine reuse, selector seeding, Shift/Alt/right-click/Space outcomes, invalid-target acknowledgement, emitted marking facts, and overlay disposal. |
| 4. Shadow capture/AI/reopen/preview | `tests/capture-page-snapshot-handler.test.ts`, `tests/golden/ai-snapshot.test.ts`, `tests/src/background/startup.test.ts`, and `tests/src/popup/root-recovery.test.ts` assert flattened artifact-free capture, exact submission output, durable run/result rehydration, and panel recovery. |
| 5. Save/adopt/Todo/publish | `tests/src/background/property-snapshot-authority.test.ts`, `tests/src/background/services.test.ts`, `tests/src/lynx/rest.test.ts`, and `tests/src/popup/entrypoint.test.ts` assert singular fenced saves, authoritative corpus adoption, canonical coverage, publication gates, idempotent operation identity, and visible popup phase. |
| 6. Discard/navigation/session boundaries | `tests/src/popup/candidate-navigation.test.ts`, `tests/src/popup/entrypoint.test.ts`, `tests/c4-content-entrypoint.test.ts`, and `tests/src/background/lock-browser-lifecycle.test.ts` assert clean-baseline discard, inline confirmation, same-tab navigation, SPA/reload teardown, and session/lock cleanup. |
| 7. Loss/conflict/transfer/restart/recovery/shrink | `tests/src/background/services.test.ts`, `tests/src/background/startup.test.ts`, `tests/src/background/lock-browser-lifecycle.test.ts`, `tests/src/background/property-snapshot-authority.test.ts`, `tests/src/popup/root-recovery.test.ts`, and `tests/orchestration-property-lock-scenario.test.ts` assert draft-preserving suspension, recovery polling, rotated fences, restart rehydration, bounded panel recovery, and fail-closed integrity-shrink handling. |

## Commands and results

```text
pnpm vitest run tests/src/background/services.test.ts tests/src/background/startup.test.ts tests/src/background/lock-browser-lifecycle.test.ts tests/src/background/property-snapshot-authority.test.ts tests/src/background/render-emulation-runtime.test.ts tests/c4-content-entrypoint.test.ts tests/src/popup/entrypoint.test.ts tests/src/popup/candidate-navigation.test.ts tests/src/popup/root-recovery.test.ts tests/capture-page-snapshot-handler.test.ts tests/golden/ai-snapshot.test.ts tests/src/lynx/rest.test.ts tests/orchestration-property-lock-scenario.test.ts --reporter=dot
13 files / 116 tests passed

dotnet test UnfluffifyHub.sln --no-restore --nologo
96 tests passed

pnpm test -- --reporter=dot
90 files / 683 tests passed
```
