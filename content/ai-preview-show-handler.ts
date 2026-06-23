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
  showAiPopover: (items: unknown[], options: { onClose: () => Promise<unknown> | void }) => void;
  exitAiPreviewMode: () => Promise<unknown>;
  getAiPreviewItems: () => unknown[];
};

type AiPreviewShowMessage = {
  selectorSet?: unknown;
};

export function createAiPreviewShowHandler(deps: AiPreviewShowDeps) {
  async function handleMessage(message: AiPreviewShowMessage = {}): Promise<{ ok: true; count: number; items: unknown[] }> {
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
    // Return the rendered preview items so the popup can display the Detected
    // Content sidebar immediately, without waiting for a later full refresh to
    // rediscover the preview via the timeout-prone getAiPreviewState probe.
    let items: unknown[] = [];
    try {
      const renderedItems = deps.getAiPreviewItems();
      items = Array.isArray(renderedItems) ? renderedItems : [];
    } catch {
      items = [];
    }
    return { ok: true, count: defaultItems.length, items };
  }

  return {
    handleMessage
  };
}
