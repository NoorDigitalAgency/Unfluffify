type AiPreviewItem = {
  xpath?: unknown;
  text?: unknown;
  title?: unknown;
  kind?: unknown;
};

type AiPreviewState = {
  active?: unknown;
  mode?: unknown;
  previousEnabled?: unknown;
  restoreMarkingOnExit?: unknown;
  previousBaseUrl?: unknown;
  items?: unknown;
  focusedXpath?: unknown;
  showAllCategories?: unknown;
};

type AiPreviewStateResponseDeps = {
  getAiPreviewState: () => AiPreviewState;
  isPreviewExpandedStatesEnabled: () => boolean;
  FEATURE_DISABLED_REASON: string;
};

export function createAiPreviewStateResponseBuilder(deps: AiPreviewStateResponseDeps) {
  const mapItems = (items: unknown): Array<{
    xpath: unknown;
    text: unknown;
    title: unknown;
    kind: unknown;
  }> => {
    const source = (Array.isArray(items) ? items : []) as AiPreviewItem[];
    return source.map((item) => {
      return {
        xpath: item.xpath,
        text: item.text,
        title: item.title,
        kind: item.kind
      };
    });
  };

  const buildBase = ({ showAllCategories }: { showAllCategories: boolean }) => {
    const state = deps.getAiPreviewState();
    return {
      active: Boolean(state.active),
      mode: typeof state.mode === "string" ? state.mode : "",
      previousEnabled: Boolean(state.previousEnabled),
      restoreMarkingOnExit: Boolean(state.restoreMarkingOnExit),
      previousBaseUrl: typeof state.previousBaseUrl === "string" ? state.previousBaseUrl : "",
      showAllCategories,
      items: mapItems(state.items),
      focusedXpath: typeof state.focusedXpath === "string" ? state.focusedXpath : ""
    };
  };

  const resolveShowAllCategories = () =>
    deps.isPreviewExpandedStatesEnabled() && Boolean(deps.getAiPreviewState().showAllCategories);

  const buildGetStateResponse = () => ({
    ok: true,
    ...buildBase({ showAllCategories: resolveShowAllCategories() })
  });

  const buildExpandedModeDisabledResponse = () => ({
    ok: false,
    reason: deps.FEATURE_DISABLED_REASON,
    feature: "previewExpandedStates",
    ...buildBase({ showAllCategories: false })
  });

  const buildExpandedModeResponse = (ok: boolean) => ({
    ok,
    ...buildBase({ showAllCategories: Boolean(deps.getAiPreviewState().showAllCategories) })
  });

  return {
    buildGetStateResponse,
    buildExpandedModeDisabledResponse,
    buildExpandedModeResponse
  };
}
