# Patch 4 — Signal-birth topology: dual birth with no dedup

**Gap filled:** the comparative study never enumerated *where each signal is born*. The
consequence is that `qa-decisions.md` D1 rests on a false premise, and the real defect —
two live birth channels with nothing reconciling them — is unnamed.

**Repos read**
- Rewrite: `/home/rojan/Documents/Git/GitHub/Unfluffify` (branch `re-write`)
- Legacy: `/tmp/claude-1000/-home-rojan-Documents-Git-GitHub-Unfluffify/b1655411-e6e6-4a07-9e06-63a92fc1f3e8/scratchpad/legacy-main` (branch `main`, v1.10.0+3)

All paths below are repo-relative to whichever tree the section names.

---

## 0. Executive summary

1. **D1's premise is wrong.** `brain.observe` (`src/background/rewrite-brain.ts:14-23`) is
   already live in production, reached on every `fact.reported` event
   (`src/background/index.ts:158-179`) and on every property-lock observation
   (`src/background/index.ts:113-132` ← `src/background/lock-runtime.ts:234-241`). The
   deciders are **not** dead code.
2. **What *is* dead** is the `uf.rewriteBrain.*` runtime-message surface
   (`src/background/rewrite-brain-runtime.ts:8-34, 71-109`). Production constructs the
   runtime with a **no-op** `addMessageListener` (`src/background/index.ts:70`) and
   **never calls `runtime.start()`** — the only production uses are `runtime.getBrain`
   and `runtime.keepAlive`. Its only senders are tests
   (`tests/src/background/brain.test.ts:257, 267, 316, 342, 361`).
3. **The real defect is dual birth.** Two live channels append to the same log:
   the **decided** channel (`fold → decideSignals → signalLog.append`) and the
   **direct-emit** channel (`signals.emit → brain.emitSourceSignal → signalLog.append`,
   `src/background/index.ts:139-153`, `src/background/rewrite-brain.ts:24-37`). Nothing
   dedups: `append` increments `seq` unconditionally
   (`src/background/brain/signals.ts:24-41`) and `markConsumed` is a per-organ read
   cursor, not per-event idempotency (`src/background/brain/signals.ts:51-59`).
4. **Confirmed:** enabling marking births `marking.enabled` twice — but only the *first*
   time on a tab per worker lifetime (§4.1). **Confirmed and worse than reported:** one
   navigation births `session.navigated` **two or three** times plus a spurious
   `marking.disabled` (§4.2).
5. **A larger structural finding the critic did not have:** of the 16 signal names,
   **only 4 have any live brain birth path at all**. The other 12 are born *exclusively*
   by the popup's direct emit, because no live fact reporter ever populates the fact
   fields those deciders read (`runPhase`, `previewActive`, `savedSeq`, `discardedSeq`,
   `inspectionPending`, `reconciliationPending`). D1's "move signal birth into the brain"
   is therefore not a deletion — it is a **fact-coverage project** (§3, §5).
6. **4 of 16 names have no birth path anywhere** (`preview.exit.requested`,
   `preview.exited`, `inspection.started`, `inspection.ended`), which strands the popup's
   `silent_preview` / `preview_open` / `exit_restoring` states (§6.1).
7. **The rewrite's own contract already specifies the missing dedup.**
   `.reimplementation/architecture.md:103` and `:260` mandate a 250 ms double-fire window
   and a per-cycle `dedupeKey`. Neither exists in the code (`grep -ri dedup src/` returns
   one unrelated comment). Legacy *implements both*, and its in-code comments record the
   live incidents that forced them (§7).

---

## 1. The contract the rewrite wrote for itself

`.reimplementation/architecture.md:235-252` is a **one-birthplace-per-name** table:

| Name | Contract birthplace / cause | Payload |
|---|---|---|
| `marking.enabled` | brain / `activate-ok` | `{ baseUrl }` |
| `marking.disabled` | brain / `deactivate-ok` \| `navigation` \| `config-out-of-scope` | `{ baseUrl, cause }` |
| `markings.changed` | content / **`user-marking-edit` ONLY** | `{ pageUrl, markedCount }` |
| `run.started` | brain / `run-start-accepted` | `{ sessionId, deadlineAt }` |
| `run.completed` | brain / `run-completed` | `{ sessionId }` |
| `run.failed` | brain / `run-failed` \| `run-timeout` | `{ sessionId, reason }` |
| `preview.opened` | brain / `show-preview-ok` | `{ origin }` |
| `preview.exit.requested` | popup / `user-exit-click` | `{ restore }` |
| `preview.exited` | content / `exit-routine` (single return point) | `{ restored, pageUrl }` |
| `session.saved` | brain / `save-confirmed` (server ack) | `{ pageUrl }` |
| `session.discarded` | popup / `user-discard` | `{}` |
| `session.navigated` | content / `navigation` | `{ fromUrl, toUrl }` |
| `inspection.started` / `.ended` | content / `render-mode` \| `page-inspection` | `{ kind }` |
| `reconciliation.started` / `.ended` | brain / `save-lifecycle` | `{ reason }` |

Plus the explicit provenance rules at `:254-261`:

> `markings.changed` has **exactly one birthplace** … Paired edges (`inspection.*`,
> `reconciliation.*`) are emitted through **one wrapped store mutation** … Each carries a
> per-cycle `dedupeKey` so the 250 ms window can only drop a true double-fire.

The vocabulary itself (`src/domain/schema/signals.ts:5-22`) is a byte-for-byte copy of
legacy's (`legacy: src/common/bus/contracts/signals.ts:9-27`). What was dropped in the copy
is the `dedupeKey` field (`legacy: .../signals.ts:54-63`) and everything that consumed it.

---

## 2. The five birth channels that exist in the rewrite

| # | Channel | Entry point | Live? | Goes through `fold`/`decide`? |
|---|---|---|---|---|
| **A** | Decided — facts | `bus.on("fact.reported")` `src/background/index.ts:158-179` → `brain.observe` | **YES** | yes |
| **B** | Decided — lock | `observeLockFacts` `src/background/index.ts:113-132` ← `src/background/lock-runtime.ts:167-174, 234-241` → `brain.observe` | **YES** | yes |
| **C** | Direct emit | `bus.onCommand("signals.emit")` `src/background/index.ts:139-153` → `brain.emitSourceSignal` `src/background/rewrite-brain.ts:24-37` | **YES** | **no** |
| D | Runtime message | `uf.rewriteBrain.observe` / `.emit` `src/background/rewrite-brain-runtime.ts:77-95` | **DEAD** | (observe: yes) |
| E | `signal.emitted` event | `src/messaging/realms.ts:247` | **DEAD** | n/a |

### 2.1 Why D is dead (evidence)

```
src/background/index.ts:69-80
  const runtime = createRewriteBrainRuntime({
    addMessageListener() {},          // ← no-op host
    createAlarm(...) {...}, clearAlarm(...) {...}, addAlarmListener(...) {...},
  });
```

`runtime.start()` — the only thing that mounts `handle()` onto a listener
(`src/background/rewrite-brain-runtime.ts:112-123`) — is never called anywhere in `src/`
(`grep -rn "runtime.start()" src/` → nothing; `src/background/index.ts:97` is
`authTokenMonitor.start()`). Even if it were called, the host's `addMessageListener` is a
no-op. Production reaches the runtime only via `runtime.getBrain(...)`
(`src/background/index.ts:114, 136-137, 143, 155, 162`) and `runtime.keepAlive`
(`:81, 99, 140`).

**Consequence for the study:** `tests/src/background/brain.test.ts` proves the *decider
logic* through a door that production does not open. The deciders are exercised in
production through channels A and B instead — which is why the double birth is invisible
to the suite.

### 2.2 Channel E is a stray

`src/entrypoints/offscreen/main.ts:14-23` emits a `signal.emitted` event with
`name: "inspection.ended"`, `source: "popup"`, `seq: 1`, `at: 0`, `target: "offscreen"` —
as an *offscreen-document readiness ping*. Nothing subscribes to `signal.emitted` anywhere
(`grep -rn "signal.emitted" src/ tests/` → the emitter and the contract entry only). A
signal name from the operator-facing vocabulary is being used as an internal liveness
probe; if a push channel is ever wired (legacy publishes on every admission — `legacy:
src/background/brain/index.ts:792-794`), this frame becomes a spurious `inspection.ended`.

---

## 3. Fact coverage: why only 4 of 16 names can be brain-born

`decideSignals` (`src/background/brain/decide.ts:10-132`) reads 13 fact fields. Here is
every field it reads against every live fact producer:

| Fact field read by `decide.ts` | Set by content `reportContentFact`? | Set by popup `reportPopupFact`? | Set by `observeLockFacts`? |
|---|---|---|---|
| `pageUrl` / `baseUrl` | yes `content-loader.content.ts:271-272` | yes `popup/main.tsx:1028` | yes `lock-runtime.ts:237-238` |
| `markingEnabled` | yes `content-loader.content.ts:273` | no | no |
| `markingToggleSeq` | yes `content-loader.content.ts:244` | yes `popup/main.tsx:911` | no |
| `runPhase`, `runSessionId` | **never** | **never** | **never** |
| `previewActive` | **never** | **never** | **never** |
| `previewExitRequested` | **never** | **never** | **never** |
| `savedSeq` | **never** | **never** | **never** |
| `discardedSeq` | **never** | **never** | **never** |
| `inspectionPending` | **never** | **never** | **never** |
| `reconciliationPending` | yes, but always `false` — the lock runtime hard-codes it (`lock-runtime.ts:73`) and content mirrors the directive (`content-loader.content.ts:276`) | no | no |

The full set of live fact producers is three:
`src/entrypoints/content-loader.content.ts:243-248` (`marking-toggle`), `:283-294`
(`activity-ping`), `src/entrypoints/popup/main.tsx:908-915` (`marking-toggle-observed`),
plus `src/background/lock-runtime.ts:167-174, 234-241`.
(`grep -rn "fact.reported" src/` → 3 emit sites, 1 handler.)

**Therefore, in production the brain can only ever birth:**
`session.navigated`, `marking.enabled`, `marking.disabled`, `markings.changed`.
The remaining **12** names are reachable *only* through channel C. The
`decide.ts:47-130` branches for `run.*`, `preview.*`, `session.saved`,
`session.discarded`, `inspection.*` and `reconciliation.*` are the genuinely dead code —
not because nothing calls `decideSignals`, but because their input facts are never written.

---

## 4. Per-name birth table (the deliverable)

Legend for **Dual?**: **YES** = one real-world operator event appends more than one frame.

| # | Name | Birth path(s) live in production | Dual? |
|---|---|---|---|
| 1 | `marking.enabled` | **C** popup `main.tsx:984` (enable toggle, `cause:"toggle"`) · **C** popup `main.tsx:897` (`reconcileContentStatus`, `cause:"content-reconciliation"`) · **A** brain via content `activity-ping` after `activateContentMain` (`content-loader.content.ts:742` sets `markingActive=true`, `src/content/command-router.ts:196-197` pings, `decide.ts:21-27` fires) | **YES** — first enable per tab per worker (§4.1) |
| 2 | `marking.disabled` | **C** popup `main.tsx:952` (`emulation-failed`), `:984` (`content-activation-failed`), `:1001` (`toggle`) · **A/B** brain on `pageUrlChanged` (`fold.ts:57` forces false → `decide.ts:28-34`, `cause:"navigation"`) · popup-local fabrication `main.tsx:924` (never reaches the brain) | **YES** on navigation (§4.2); also a *spurious* birth after a toggle-off (§4.3) |
| 3 | `markings.changed` | **A** brain only, from content `marking-toggle` fact (`decide.ts:40-46`). The popup deliberately refuses to mint it — `content-loader.content.ts:238-242` and `popup/main.tsx:903-907` both say so in comments, and `tests/src/popup/entrypoint.test.ts:1408-1410, 1536` pin it | **NO** — the one name that obeys the contract. But it is **suppressed** after a discard/AI run (§6.2) |
| 4 | `run.started` | **C** popup `main.tsx:1531` only | no (single path) |
| 5 | `run.completed` | **C** popup `main.tsx:1584` only | no |
| 6 | `run.failed` | **C** popup `main.tsx:1540` (capture failed), `:1558` (backend failed) — mutually exclusive | no |
| 7 | `preview.opened` | **C** popup `main.tsx:1704` only | no |
| 8 | `preview.exit.requested` | **none** | n/a — **unreachable** |
| 9 | `preview.exited` | **none** | n/a — **unreachable** |
| 10 | `session.saved` | **C** popup `main.tsx:1671` only | no |
| 11 | `session.discarded` | **C** popup `main.tsx:1724` only | no |
| 12 | `session.navigated` | **C** popup `main.tsx:470` (`handleBoundContext`, `sameTabNavigation`) · **C** content `content-loader.content.ts:662` (SPA nav *while marking active*) · **A/B** brain via any fact carrying the new `pageUrl` — in practice the per-tick `lock.directive` (`popup/main.tsx:496, 717-722` → `lock-runtime.ts:234-241` → `decide.ts:14-20`) | **YES — 2× full nav, 3× SPA nav** (§4.2) |
| 13 | `inspection.started` | **none** (offscreen ping at `offscreen/main.ts:18` is `inspection.ended` on a dead channel) | n/a — **unreachable** |
| 14 | `inspection.ended` | **none** (see above) | n/a — **unreachable** |
| 15 | `reconciliation.started` | **C** popup `main.tsx:1638` only | no |
| 16 | `reconciliation.ended` | **C** popup `main.tsx:1646, 1654, 1676` — `:1676` is the tail of the save and **can follow** `:1646`/`:1654`? No: both early-return. Mutually exclusive | no |

**Popup direct-emit call sites (16):** `main.tsx:470, 897, 952, 984, 1001, 1531, 1540,
1558, 1584, 1638, 1646, 1654, 1671, 1676, 1704, 1724`, split between
`emitPopupSignal` (`:435-455`, 7 sites: 470, 897, 952, 984, 1001, 1531, 1724) and
`emitPopupSignalAndPullTail` (`:414-433`, 9 sites). The distinction matters — see §5.2.
**Distinct names emitted with `source:"popup"`: 11, not 12** (D1's count is off by one;
it likely counted the local-only fabrication at `:924`).

**Content direct-emit call sites (1):** `content-loader.content.ts:662`.

### 4.1 CONFIRMED — `marking.enabled` is born twice (with a caveat that makes it worse)

Trace of `setMarkingEnabled(true)` (`src/entrypoints/popup/main.tsx:920-1004`):

1. `:956-963` popup sends `activateContentMain` over the tab transport.
2. Content handles it (`content-loader.content.ts:709-747`), setting `markingActive = true`
   at `:742`, and returns `{ ok: true }` at `:746`.
3. **Before that reply is returned**, `command-router.ts:196-197` sees `activateContentMain`
   in `DATA_AFFECTING_COMMANDS` (`:63-67`) and awaits `pingActivity`, which posts
   `fact.reported{reason:"activity-ping", facts:{markingEnabled:true,…}}`
   (`content-loader.content.ts:283-294, 261-281`).
4. Background folds it (`index.ts:158-170`): `prev.markingEnabled === false`,
   `next.markingEnabled === true` → `decide.ts:21-27` → **`marking.enabled`, seq N,
   `source:"brain"`, `cause:"activate-ok"`**.
5. `:984` the popup then emits **`marking.enabled`, seq N+1, `source:"popup"`,
   `cause:"toggle"`**.

Two frames, one operator click. The ordering is the natural one (content ping posted
first) but is not guaranteed: `bus.emit` for an event is fire-and-forget at the transport
(`src/messaging/transports/runtime.ts:141-144`), so only the *post* order is fixed.

**The caveat that makes it worse.** `emitSourceSignal`
(`src/background/rewrite-brain.ts:24-37`) appends to the log and updates *only*
`lastSignalSeq` — it never folds the emitted signal back into the facts. And nothing
reports `markingEnabled:false` on deactivation: `deactivateContentMain` is **not** in
`DATA_AFFECTING_COMMANDS` (`src/content/command-router.ts:63-67`), so no ping fires. So after one
enable→disable cycle the brain's facts are stuck at `markingEnabled: true`, and the
**second** enable produces only the popup frame (`decide.ts:21` guard
`prev?.markingEnabled !== true` fails).

> **The same operator action births 1 or 2 frames depending on the tab's history.** That
> is worse than a consistent duplicate: it is unanalysable, and no test can pin it.

### 4.2 CONFIRMED — a navigation births `session.navigated` twice, and often three times

Poll order is fixed at `src/entrypoints/popup/main.tsx:489-511`:
`handleBoundContext` (`:494`) → `pullSignals` (`:495`) → `refreshLockDirective` (`:496`).

**Full-page navigation, popup open, managed property, signed in:**

1. `:494` → `handleBoundContext` → `bindToTab` reports `sameTabNavigation`
   (`:338-367`) → `:470` emits **`session.navigated`, seq N, `source:"popup"`**, which
   `emitPopupSignal` consumes immediately (`:445-449`).
2. `:496` → `refreshLockDirective` → `lock.directive` with the **new** `pageUrl`
   (`:717-722`) → `lock-runtime.ts:234-241` → `observeLockFacts` →
   `index.ts:113-127` → `brain.observe` → `fold.ts:48-51` sees `pageUrlChanged` →
   `decide.ts:14-20` → **`session.navigated`, seq N+1, `source:"brain"`** — *and*
   `fold.ts:57` forces `markingEnabled:false`, so if marking was on,
   `decide.ts:28-34` also appends **`marking.disabled`, seq N+2, `cause:"navigation"`**.
3. The next poll tick (≤500 ms later) pulls N+1 and N+2 and dispatches both.

So the operator's activity log shows: `Page navigated` → `session.navigated #N · popup`
→ (500 ms) → `session.navigated #N+1 · brain` → `marking.disabled #N+2 · brain`.
`transitionPopupState` resets to `silent` and clears `contentRows` **twice**
(`src/popup/organ/machine.ts:191-195`).

**SPA navigation with marking active adds a third:** `content-loader.content.ts:641-667`
calls `emitContentBrainSignal("session.navigated", "content-url-change", …)` at `:662`
(guarded by `if (!markingActive) return;` at `:658`). That frame is born with
`source:"content"` and, being a direct emit, does **not** move the brain's facts — so the
brain still births its own on the next lock tick.

**Race window:** the brain-born `session.navigated` lands up to 500 ms after the popup
already rebound. If the operator re-enables marking inside that window, the delayed frame
knocks the popup back to `silent` (`machine.ts:192-195`) while the content script is
armed — the exact "popup says silent, page says marking" divergence
`reconcileContentStatus` (`:877-918`) exists to paper over.

### 4.3 Additional dual/spurious births found while building the table

- **Spurious `marking.disabled` after a toggle-off.** Per §4.1 the brain's
  `markingEnabled` never returns to `false` on deactivate. The next navigation therefore
  births `marking.disabled` (`decide.ts:28-34`) for a session that was already off.
- **`marking.enabled` from `reconcileContentStatus`** (`main.tsx:896-902`) fires whenever
  the popup opens onto an already-armed tab in `silent`. If the brain also has stale
  `markingEnabled:false` facts (worker restarted since activation), the next content ping
  births a second one. Same class.

---

## 5. The consumption side: why the duplicates are sometimes invisible, and what hides them

The popup's cursor is a **high-water mark**, not a set:

```
src/popup/signal-cursor.ts:35-41
  claim(seq) {
    if (seq <= consumedThrough) { return false; }
    consumedThrough = seq;
    return true;
  },
```

### 5.1 The cursor silently swallows the brain-born twin

`emitPopupSignal` (`main.tsx:435-455`) consumes **its own emit's response first**
(`:446-448`). Consuming seq N+1 sets `consumedThrough = N+1`, so the brain-born frame at
seq N can never be claimed again — `pullSignals(:989)` asks for `afterSeq = N+1` and gets
nothing. In the common ordering the duplicate is *born* but never *delivered*.

That is not a fix; it is a second bug wearing the first one's clothes:

> **Any signal whose seq falls in the gap is destroyed, regardless of what it is.**

Concrete: cursor at 10; the operator's last mark is still in flight and the brain admits
`markings.changed` at seq 11; the operator clicks *Run AI*; `main.tsx:1531` emits
`run.started` at seq 12 and consumes it; seq 11 is now unreachable forever. The same
hazard applies at `:470, 897, 952, 984, 1001, 1724` — the seven plain-`emitPopupSignal`
sites. The nine `emitPopupSignalAndPullTail` sites (`:414-433`) are safe *by accident*:
they pull first (`:424`) and only consume the response if the pull returned nothing.

### 5.2 The offline fabrication burns a real seq

```
src/entrypoints/popup/main.tsx:260-272   nextSignal()  → seq += 1, source: "brain"
src/entrypoints/popup/main.tsx:454       dispatchSignal(nextSignal(tabId, name, payload))
src/entrypoints/popup/main.tsx:309       seq = Math.max(seq, signal.seq)
```

When `signals.emit` fails, the popup **fabricates a frame and labels it `source:"brain"`**
— a lie in the operator-facing log (`:314-318` prints the source). Worse, the local `seq`
counter is `Math.max`-synced with real brain seqs at `:309`, so the fabricated frame takes
the number the brain will assign next. `dispatchSignal` sets
`state.lastConsumedSeq` to it (`machine.ts:76`), and `transitionPopupState:73` then
**ignores the genuine brain frame that later arrives with that same seq**. One transport
failure permanently swallows exactly one subsequent real signal. (D1 already calls for
deleting "the fabricated `source:"brain"` offline signals" — this is the mechanism that
makes it urgent rather than cosmetic.)

### 5.3 The cursor resets on every rebind, so old frames replay

`bindToTab` calls `brainSignals.reset()` (`main.tsx:347`, cursor → 0) and
`resetPopupState({… lastConsumedSeq: 0 …})` (`:365`). The brain's log keeps up to 128
frames per tab (`src/background/brain/signals.ts:19, 37-39`) and is **never** pruned —
there is no `tabs.onRemoved` handler and no `brains.delete` anywhere in `src/`.

Reachable wedge: mark page A → navigate to B → press **Back** to A. The binding key
`${tabId}|${url}` (`main.tsx:280-282`) returns to A's value, the cursor resets to 0, and
the pull replays A's entire retained history. `signalMatchesBinding` (`:321-336`) filters
on `payload.pageUrl` — which now *matches* — so A's old `marking.enabled`,
`markings.changed`, `run.started`, `run.completed` are re-dispatched in seq order and the
popup lands in `post_ai_clean` on a page with no armed content script.

Related latent hazard: `decide.ts:117-130` gives `reconciliation.started`/`.ended` a
payload of `{ reason }` **with no `pageUrl`**, and `signalMatchesBinding:329-335` lets
payload-less frames through unconditionally for exactly those names. The moment
`reconciliationPending` becomes a real fact, a replayed `reconciliation.started` wedges
the popup behind the reconciling curtain across an unrelated navigation. This is the same
shape as legacy's live wedge of 2026-07-03 (`legacy:
src/background/brain/session-signal-edges.ts:6-13`).

### 5.4 Nothing survives a service-worker restart

`getBrain` (`src/background/rewrite-brain-runtime.ts:62-69`) constructs
`createRewriteBrain(tabId)` with **no initial facts**, so `createSignalLog({ startSeq: 0 })`
(`src/background/rewrite-brain.ts:11`). `rehydrateDurableFacts` exists
(`src/background/persistence.ts:12-18`, wired at `src/background/services.ts:229-230`) but
**is never called** — `grep -rn "persistence\." src/` shows three `persistDurableFacts`
calls (`index.ts:130, 147, 173`) and zero reads. Writes without reads.

Consequence: after a worker restart, seqs restart at 1 while a still-open side panel holds
`consumedThrough` at, say, 42. Every new frame fails `claim()` and the panel goes
permanently deaf until a rebind. The 500 ms poll makes worker death unlikely while the
panel is open, so this is *latent* rather than routine — but it is the precise failure
legacy paid to fix with `signal-log-persistence.ts` and `hydrate()`.

---

## 6. Other topology defects found in the same sweep

### 6.1 Four names have no birth site, stranding three popup states

`preview.exit.requested`, `preview.exited`, `inspection.started`, `inspection.ended` are
emitted by nobody (§4). Effects:

- `exit_restoring` (`machine.ts:177-180`) is **unreachable**.
- `preview_open` can only be left via `marking.disabled` / `session.navigated` /
  `session.saved` / `session.discarded` (`machine.ts:185-198`) — there is no *Exit
  preview* affordance at all in `main.tsx` (only `showPreview` at `:1680-1706`).
- `silent_preview` is a **dead end for the operator**: its memory row disables Run AI,
  Save, Discard *and* Show preview (`src/popup/organ/memory.ts:107-125`). The only escape
  is flipping the marking toggle or navigating.
- `inspecting` (`machine.ts:199-204`) is unreachable, so the render-mode inspection runs
  with no curtain and no `priorState` capture.

Legacy births all four, each from exactly one place: `preview.exit.requested` at
`legacy: src/popup.ts:9182-9189` (`cause:"user-exit-click"`), `preview.exited` at
`legacy: src/content-main.ts:3709-3716`, `inspection.*` from the wrapped store mutation
(`legacy: src/background/brain/session-signal-edges.ts:91-103`).

### 6.2 `markings.changed` is *suppressed* by a monotonic counter that gets reset

`decide.ts:40-46` gates on `(prev.markingToggleSeq ?? 0) < (next.markingToggleSeq ?? 0)`.
The counter is content-local `userToggleCount`
(`content-loader.content.ts:35, 562, 244`), and it is reset to 0 by:

- `markContentClean` (`content-loader.content.ts:792-795`), called by the popup right
  after a successful AI run (`main.tsx:1577`);
- `resetMarking` (`content-loader.content.ts:696`), the Discard path (`main.tsx:1715`);
- `deactivateMarking` (`:607`) and `activateContentMain` (`:727`).

The brain's `markingToggleSeq` is **not** reset with it, because `session.discarded` /
`run.completed` are direct emits that never touch the fold. So:

> Mark 5 elements → Run AI (counter → 0, brain still holds 5) → mark 1 more →
> content reports `markingToggleSeq: 1` → `5 < 1` is false → **no `markings.changed`**.

The popup stays in `post_ai_clean`, where `saveDisabled: false`
(`src/popup/organ/memory.ts:209-213`) instead of moving to `pre_ai_dirty`, where
`saveDisabled: true` (`memory.ts:141-146`). The operator can Save post-run edits **with
the selectors computed before those edits** — `saveSession` takes rows from
`captureSubmission` (`main.tsx:1620-1622`, reads the live engine) but selectors from
`store.getState().selectors` (`:1626`). This is a plausible mechanism for the known live
finding *"a save persists stale selectors"*. Same story after Discard.

### 6.3 Direct emits leave the brain's model permanently wrong

`emitSourceSignal` (`rewrite-brain.ts:24-37`) updates `lastSignalSeq` and nothing else —
and when facts are `null` it *invents* a minimal all-false snapshot (`:28-35`) which
`index.ts:145-148` then **persists to durable storage**. So a popup emit arriving before
any fact has been folded writes a fabricated fact record for the tab. Combined with §4.1
(`markingEnabled` stuck true) and §6.2 (`markingToggleSeq` stuck high), the brain's model
of a tab drifts monotonically away from reality for as long as the worker lives, and every
edge decision it makes afterwards is computed against that drift.

---

## 7. Legacy behaviour — it solved this, and the code says why

Legacy allows the same two channels but funnels **everything** through one admission
function that dedups.

**`legacy: src/background/brain/signal-log.ts:76-120` — `admit()`**

- **Rule 1** (`:88-96`): identical consecutive `(name, cause, payload)` within
  `SIGNAL_DEDUPE_WINDOW_MS = 250` (`:13`) is dropped. The in-code justification is
  literally our defect: *"double-wired call sites."*
- **Rule 2** (`:97-101`): an explicit `dedupeKey` drops regardless of the window when the
  most recent frame of that name carried the same key.
- Seq is assigned **after** the dedupe check (`:103`), so a deduped frame never burns a
  sequence number — unlike `src/background/brain/signals.ts:24-25`, which increments
  first, unconditionally.

**`legacy: src/background/brain/index.ts:783-810`** — `emitSignal` is the single admission
path, and the `signal.emit` request handler stamps `source` from the *bus sender realm*
(`:807`) rather than trusting the caller, then pushes the admitted frame to popup **and**
content (`:792-794`).

**Legacy's own dual-birth incidents, recorded in comments:**

- `legacy: src/background/brain/index.ts:228-231` — *"Run lifecycle signals are
  once-per-session: multiple layers republish the same ai-run event (live P1 trace:
  RESULTS_APPLIED admitted twice, >250ms apart), so the session id is the dedupe key."*
  Fixed with `dedupeKey: session:${sessionId}` on `run.started` / `run.completed` /
  `run.failed` (`:240, 249, 258`).
- `legacy: src/content-main.ts:3704-3708` — *"'preview.exited' is born HERE … (The brain's
  EXITED ai-run event **no longer doubles as this signal's birthplace**.)"* — a dual birth
  found and deliberately removed.
- `legacy: src/background/brain/session-signal-edges.ts:1-19` — the 2026-07-03 live wedge
  where a paired edge's closing member was never born. The fix was to move edge detection
  to the **one choke point every state rewrite funnels through** (the store's `mutate`,
  wrapped at `:45-105`), plus per-cycle `dedupeKey`s so a rapid flap cannot collapse.

**Legacy's per-name ownership in practice** (one owner each, all admitted through the same
gate):

| Name | Legacy birthplace |
|---|---|
| `marking.enabled` | brain, `src/background.ts:1392-1397` (`activate-command-ok`) |
| `marking.disabled` | brain `src/background.ts:1488-1494`; content `src/content-main.ts:6640-6646` (config-out-of-scope) — different causes |
| `markings.changed` | content only, `src/content/layers/content-bus-client.ts:99` |
| `run.*`, `preview.opened` | brain only, `src/background/brain/index.ts:233, 245, 254, 263` |
| `preview.exit.requested` | popup only, `src/popup.ts:9184` |
| `preview.exited` | content only, `src/content-main.ts:3712` |
| `session.saved` / `session.discarded` | popup only, `src/popup.ts:8215, 8292` |
| `inspection.*` / `reconciliation.*` | brain, wrapped mutate, `session-signal-edges.ts:78-103` |
| `session.navigated` | **never emitted** — vocabulary-only in legacy (`src/popup.ts:1812` is a log-label map). The rewrite gave this name three birth sites |

**Legacy also disposes tabs**: `disposeTab` (`legacy: src/background/brain/index.ts:1007-1017`)
calls `signalLog.resetTab` on `tabs.onRemoved` (`legacy: src/background.ts:3812, 3830`),
with a comment recording the live cost of not doing so: *"each closed tab left a GHOST
whose per-second directive/spinner publishes rejected forever (observed live: three
ghosts…)"*. The rewrite has no tab lifecycle handling at all.

---

## 8. UX elements to bring over

Ordered by operator impact. All are behaviours, not schema.

1. **An *Exit preview* affordance and its two signals.** `silent_preview` and
   `preview_open` currently have no exit path in the UI (§6.1). Legacy: popup click →
   `preview.exit.requested{restore}` (`legacy: src/popup.ts:9182-9189`) → content's single
   exit-routine return point → `preview.exited{restored, pageUrl}`
   (`legacy: src/content-main.ts:3709-3716`) → popup lands in `post_ai_clean` or `silent`
   depending on `restored`. The rewrite's machine already implements both transitions
   (`machine.ts:177-184`); only the births are missing.
2. **The inspection curtain.** `inspection.started`/`.ended` gate the "Inspecting the page"
   overlay and the `priorState` restore (`machine.ts:199-204`). Without them the operator
   runs a render-mode inspection — which reloads the tab twice — with no curtain and no
   protection from clicking Save mid-inspection.
3. **Admission dedupe (250 ms window + `dedupeKey`).** Restores the operator-facing
   activity log to one line per real event. Today a single navigation prints two to four
   lines (§4.2), which is exactly the noise that makes the log useless for diagnosing the
   live findings.
4. **Session-persisted signal log with `hydrate()` + `headSeq`.**
   `legacy: src/background/brain/signal-log-persistence.ts:16-32` +
   `signal-log.ts:139-171`. Removes the deaf-panel wedge of §5.4.
5. **Tab disposal on `tabs.onRemoved`.** `legacy: src/background/brain/index.ts:1007-1017`.
6. **Source stamped by the bus, not by the caller.**
   `legacy: src/background/brain/index.ts:807` derives `source` from `meta.src`. The
   rewrite lets the caller assert it (`src/messaging/rewrite-signals.ts:15-21`), which is
   how `main.tsx:267` gets away with labelling a fabricated frame `source:"brain"`.

---

## 9. Restating D1's phase-1 mandate

D1 as written (`.reimplementation/study/qa-decisions.md:13-15`):

> Signal birth moves **into the brain**. `main.tsx` must stop emitting the 12 signal names
> it currently emits with `source:"popup"`; the brain's `fold → decide` loop becomes the
> live path and its already-tested deciders stop being dead code.

**This is wrong in its premise and incomplete in its remedy.** The `fold → decide` loop is
*already* the live path for the four names whose facts are reported (§2, §3). Deleting the
popup's emit today would silently delete 12 of 16 signals from the product, because no fact
reporter feeds their deciders. And even for the four that work, deletion alone leaves the
navigation triple-birth (three sources, one of which is the content script) intact.

**Restated:**

> **D1 phase 1 — make signal birth single-sourced and idempotent. Three parts, in order:**
>
> **1a. Close the fact-coverage gap.** Every lifecycle transition the popup currently
> *asserts* must instead be *reported* as a fact, so `decideSignals` can decide it:
> `runPhase`/`runSessionId` (from `ai.run` in the background, not the popup),
> `previewActive`/`previewExitRequested` (content's exit routine),
> `savedSeq` (the `config.save` ack in `index.ts:300-309`),
> `discardedSeq` (content's `resetContentMain`), `inspectionPending`
> (`renderMode.inspect` in `index.ts:272`), and a real `reconciliationPending`
> (currently hard-coded `false` at `lock-runtime.ts:73`). Until this lands, deleting the
> popup emit deletes the feature.
>
> **1b. Delete the direct-emit path.** Remove `emitPopupSignal` /
> `emitPopupSignalAndPullTail` and their 16 call sites, `emitContentBrainSignal`
> (`content-loader.content.ts:250-259, 662`), the `signals.emit` command
> (`realms.ts:122-125`, `index.ts:139-153`), `brain.emitSourceSignal`
> (`rewrite-brain.ts:24-37`), and the popup-local fabrications at `main.tsx:454, 924`. The
> replacement for each is a `fact.reported` relay — the pattern `reportPopupFact`
> (`main.tsx:1006-1036`) and `reportMarkingToggle`
> (`content-loader.content.ts:238-248`) already demonstrate, complete with the comment
> explaining why it is the honest move.
>
> **1c. Add edge dedup — two mechanisms, because the fold alone is not enough.**
> `decideSignals` is edge-triggered and is therefore dedup-by-construction *within one
> worker lifetime with correct facts*. It is not enough because (i) facts reset on worker
> restart, re-firing every edge, and (ii) `emitSourceSignal` currently lets frames in
> without moving the facts, so edges are computed against a stale `prev`. Port legacy's
> `admit()` — dedupe **before** seq assignment, 250 ms `(name, cause, payload)` window plus
> an explicit `dedupeKey` for paired edges and run sessions
> (`legacy: src/background/brain/signal-log.ts:76-120`) — and persist/hydrate the log
> (`legacy: signal-log-persistence.ts`).
>
> **1d (new, same phase). Fix the consumer cursor.** The popup's high-water `claim()`
> (`src/popup/signal-cursor.ts:35-41`) destroys any frame whose seq is jumped over, and
> `bindToTab`'s `reset()` (`main.tsx:347`) replays history on a back-navigation. Consume
> strictly in seq order from a monotonic per-tab cursor that is *not* reset on rebind, and
> filter by tab+URL at the brain, not at the consumer.

The corollary in D1 ("no further feature work on `main.tsx` before this lands") stands and
is reinforced: every one of the 16 emit sites is a feature that will have to be rewritten
as a fact relay.

---

## 10. Weakness register

| # | Weakness | Evidence | Severity |
|---|---|---|---|
| W1 | Two live birth channels, no dedup; `append` increments seq unconditionally | `index.ts:139-153` vs `:158-179`; `brain/signals.ts:24-41` | **High** |
| W2 | 12 of 16 names have no live brain birth path (facts never reported) | §3 table; `decide.ts:47-130` | **High** |
| W3 | 4 of 16 names have no birth path at all; 3 popup states unreachable/dead-ended | §6.1; `machine.ts:177-204`; `memory.ts:107-125` | **High** |
| W4 | `markings.changed` suppressed after AI run / discard → Save enabled on a dirty session with stale selectors | §6.2; `content-loader.content.ts:696, 793`; `decide.ts:40` | **High** |
| W5 | High-water `claim()` destroys any signal in a skipped seq gap | `signal-cursor.ts:35-41`; `main.tsx:446-448` | **High** |
| W6 | Direct emits never fold, so brain facts drift permanently (stuck `markingEnabled`, stuck `markingToggleSeq`) and the drift is persisted | `rewrite-brain.ts:24-37`; `index.ts:145-148` | **High** |
| W7 | `session.navigated` born 2–3× per navigation, plus a spurious `marking.disabled` | §4.2 | Medium |
| W8 | Cursor reset on rebind replays a tab's history on back-navigation | `main.tsx:347, 365`; `brain/signals.ts:37-39` | Medium |
| W9 | No signal-log persistence; seq restarts at 0 on worker restart → deaf side panel | `rewrite-brain-runtime.ts:62-69`; `persistence.ts:12-18` unused | Medium |
| W10 | No tab disposal; brains and logs accumulate for the worker's life | no `onRemoved` / `brains.delete` in `src/` | Medium |
| W11 | Popup fabricates `source:"brain"` frames and burns a real seq, swallowing the next genuine one | `main.tsx:260-272, 309, 454`; `machine.ts:73` | Medium |
| W12 | `uf.rewriteBrain.*` runtime surface is dead but is what the brain tests exercise | `index.ts:70`; `rewrite-brain-runtime.ts:112-123`; `brain.test.ts:257` | Medium |
| W13 | `signal.emitted` channel has one emitter (an offscreen readiness ping mislabelled `inspection.ended`) and no listeners | `offscreen/main.ts:14-23`; `realms.ts:247` | Low |
| W14 | `reconciliation.*` payloads carry no `pageUrl`, and the binding filter waves payload-less frames through | `decide.ts:117-130`; `main.tsx:329-335` | Low (latent) |
| W15 | Caller asserts `source`; the bus does not stamp it | `rewrite-signals.ts:15-21` vs `legacy: brain/index.ts:807` | Low |

---

## 11. What the tests would and would not catch

`tests/src/popup/entrypoint.test.ts:1395-1412` and `:1531-1540` pin exactly one provenance
rule — that the popup never mints `markings.changed` — and they pass. No test asserts the
*count* of frames for any other name, and no test drives the production wiring
(`bus.on("fact.reported")` + `signals.emit` against the same brain in one scenario), so
W1/W7 are invisible to the suite by construction. A regression test for this phase should
assert, for a single simulated operator action, `signalLog.snapshot()` contains exactly one
frame of each expected name.

---

## 12. Product-owner questions

These are genuine product decisions; everything else above is answerable from code.

1. **Does `session.navigated` remain in the vocabulary?** Legacy defines it and never emits
   it — navigation is expressed as `marking.disabled{cause:"navigation"}`. The rewrite gave
   it three birth sites. One name must own "the page changed": either
   `session.navigated` (and `marking.disabled` stops firing on navigation) or the legacy
   shape (and `session.navigated` is deleted). This is a UX decision about what the
   operator's activity log should say.
2. **Should a preview opened from silent mode be exitable without leaving the page?**
   Today `silent_preview` traps the operator (§6.1). Legacy's exit restores marking when
   the preview was opened from a marking session. What should exiting a *silent* preview
   return to — silent, or armed marking?
3. **After an AI run, should further marking edits force a re-run before Save is allowed?**
   The state machine says yes (`pre_ai_dirty` → `saveDisabled: true`), the current
   behaviour says no (§6.2). Confirming "yes" makes W4 a bug; confirming "no" makes the
   `pre_ai_dirty` row wrong and the AI-run gate advisory.
4. **Is the render-mode inspection allowed to run without a blocking curtain?** Restoring
   `inspection.*` re-introduces a full-screen overlay across two tab reloads. Legacy had
   it; the rewrite currently does not. Operators may have come to rely on being able to
   interact during the inspection.
5. **What is the acceptable duplicate-suppression window?** Legacy chose 250 ms from live
   observation. If the rewrite keeps the 500 ms popup poll, a 250 ms window will not catch
   a poll-straddling duplicate; either the window widens (risking dropping a genuine rapid
   flap, e.g. two fast marking toggles) or the poll goes away in favour of push. This is a
   trade the owner should make explicitly.
6. **Should the activity log show provenance at all?** `dispatchSignal` prints
   `#seq · source` (`main.tsx:314-318`). Once birth is single-sourced, every line reads
   `brain` and the field is noise — unless it is deliberately kept as a debugging surface
   for the editor team.
