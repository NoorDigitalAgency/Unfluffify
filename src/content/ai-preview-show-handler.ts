type AiPreviewShowDeps = {
  normalizeAiSelectorSet: (value: unknown) => unknown;
  collectPreviewItems: (selectorSet: unknown) => unknown[];
  buildAiPreviewItemsWithCategories: (selectorSet: unknown, defaultItems: unknown[]) => unknown[];
  beginAiPreviewMode: (options: { mode: string }) => void;
  refreshSilentHighlightings: () => Promise<unknown>;
  schedulePreviewItemsHydration: (callback: () => void) => void;
  setPreviewItemsPending: (pending: boolean) => void;
  setAiPreviewItemSets: (
    defaultItems: unknown[],
    expandedItems: unknown[],
    options: { showAllCategories: boolean }
  ) => void;
  showAiPopover: (items: unknown[], options: { onClose: () => Promise<unknown> | void }) => void;
  exitAiPreviewMode: () => Promise<unknown>;
  isAiPreviewActive: () => boolean;
  buildPreviewState: () => Record<string, unknown>;
  notifyPreviewStateChanged: () => void;
};

type AiPreviewShowMessage = {
  selectorSet?: unknown;
};

export function createAiPreviewShowHandler(deps: AiPreviewShowDeps) {
  function hydratePreviewItems(selectorSet: unknown) {
    const [defaultItems, expandedItems] = (() => {
      try {
        const nextDefaultItems = deps.collectPreviewItems(selectorSet);
        return [
          nextDefaultItems,
          deps.buildAiPreviewItemsWithCategories(selectorSet, nextDefaultItems)
        ];
      } catch {
        return [[], []];
      }
    })();
    if (!deps.isAiPreviewActive()) {
      return;
    }
    deps.setAiPreviewItemSets(defaultItems, expandedItems, { showAllCategories: false });
    deps.setPreviewItemsPending(false);
    deps.notifyPreviewStateChanged();
    void deps.refreshSilentHighlightings().catch(() => null);
  }

  async function handleMessage(message: AiPreviewShowMessage = {}): Promise<Record<string, unknown>> {
    const selectorSet = deps.normalizeAiSelectorSet(message.selectorSet);
    deps.beginAiPreviewMode({ mode: "preview" });
    deps.setPreviewItemsPending(true);
    deps.setAiPreviewItemSets([], [], { showAllCategories: false });
    deps.notifyPreviewStateChanged();
    deps.showAiPopover([], {
      onClose: () => deps.exitAiPreviewMode()
    });
    deps.schedulePreviewItemsHydration(() => hydratePreviewItems(selectorSet));
    const previewState = deps.buildPreviewState();
    return {
      ...previewState,
      ok: true,
      count: 0
    };
  }

  return {
    handleMessage
  };
}
