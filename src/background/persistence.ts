import type { TabFacts } from "../domain/schema/facts";
import type { TabStateRepo } from "../storage/repositories/tab-state";

export async function persistDurableFacts(repo: TabStateRepo, facts: TabFacts, now = Date.now()): Promise<void> {
  await repo.save({
    tabId: facts.tabId,
    facts,
    updatedAt: now,
  });
}

export async function rehydrateDurableFacts(repo: TabStateRepo, tabId: number): Promise<TabFacts | null> {
  const result = await repo.load(tabId);
  if (!result.ok) {
    throw result.error;
  }
  return result.value?.facts ?? null;
}

export function reDeriveVolatile(facts: TabFacts): TabFacts {
  return {
    ...facts,
    reconciliationPending: false,
  };
}
