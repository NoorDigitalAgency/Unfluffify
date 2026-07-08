import type { BrainSignal } from "../domain/schema/signals";
import type { TabFacts } from "../domain/schema/facts";
import { decideSignals } from "./brain/decide";
import { fold, type BrainSensation } from "./brain/fold";
import { projectBrainState } from "./brain/project";
import { createSignalLog } from "./brain/signals";
import type { EmitSignalInput } from "./brain/signals";

export function createRewriteBrain(tabId: number, initialFacts: TabFacts | null = null) {
  let facts: TabFacts | null = initialFacts;
  const signalLog = createSignalLog({ tabId, startSeq: initialFacts?.lastSignalSeq ?? 0 });

  return {
    observe(sensation: BrainSensation): readonly BrainSignal[] {
      const prev = facts;
      facts = fold(prev, sensation);
      const emitted = decideSignals(prev, facts).map((decision) => signalLog.append(decision));
      facts = {
        ...facts,
        lastSignalSeq: signalLog.head(),
      };
      return emitted;
    },
    emitSourceSignal(input: EmitSignalInput): BrainSignal {
      const emitted = signalLog.append(input);
      facts = facts
        ? { ...facts, lastSignalSeq: signalLog.head() }
        : {
          tabId,
          markingEnabled: false,
          lockRole: "unknown",
          configPresent: false,
          reconciliationPending: false,
          lastSignalSeq: signalLog.head(),
        };
      return emitted;
    },
    snapshot(): TabFacts | null {
      return facts;
    },
    project() {
      return facts ? projectBrainState(facts, signalLog.head()) : null;
    },
    pullSignals(afterSeq: number): readonly BrainSignal[] {
      return signalLog.pull(afterSeq);
    },
    pullForOrgan(organId: string, afterSeq = 0): readonly BrainSignal[] {
      return signalLog.pullForOrgan(organId, afterSeq);
    },
    markConsumed(organId: string, seq: number): void {
      signalLog.markConsumed(organId, seq);
    },
  };
}
