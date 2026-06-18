type AiPreviewShowDeps = {
  normalizeAiSelectorSet: (value: unknown) => unknown;
  collectPreviewItems: (selectorSet: unknown) => unknown[];
  buildAiPreviewItemsWithCategories: (selectorSet: unknown, defaultItems: unknown[]) => unknown[];
  enterAiPreviewMode: (options: { mode: string }) => Promise<void>;
  setAiPreviewItemSets: (
    defaultItems: unknown[],
    expandedItems: unknown[],
    options: { showAllCategories: boolean }
  ) => void;
  showAiPopover: (items: unknown[], options: { onClose: () => Promise<void> | void }) => void;
  exitAiPreviewMode: () => Promise<void>;
};

type AiPreviewShowMessage = {
  selectorSet?: unknown;
};

export function createAiPreviewShowHandler(deps: AiPreviewShowDeps) {
  async function handleMessage(message: AiPreviewShowMessage = {}): Promise<{ ok: true; count: number }> {
    const selectorSet = deps.normalizeAiSelectorSet(message.selectorSet);
    let defaultItems: unknown[] = [];
    let expandedItems: unknown[] = [];
    try {
      defaultItems = deps.collectPreviewItems(selectorSet);
      expandedItems = deps.buildAiPreviewItemsWithCategories(selectorSet, defaultItems);
    } catch {
      defaultItems = [];
      expandedItems = [];
    }
    await deps.enterAiPreviewMode({ mode: "preview" });
    deps.setAiPreviewItemSets(defaultItems, expandedItems, { showAllCategories: false });
    deps.showAiPopover(defaultItems, {
      onClose: () => deps.exitAiPreviewMode()
    });
    return { ok: true, count: defaultItems.length };
  }

  return {
    handleMessage
  };
}
