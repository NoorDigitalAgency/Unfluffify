// @ts-nocheck
export function createAiPreviewShowHandler(deps) {
  async function handleMessage(message = {}) {
    const selectorSet = deps.normalizeAiSelectorSet(message.selectorSet);
    let defaultItems = [];
    let expandedItems = [];
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
