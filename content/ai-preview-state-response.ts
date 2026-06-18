type AiPreviewItem = {
  xpath?: string;
  text?: string;
  title?: string;
  kind?: string;
};

type AiPreviewState = {
  active?: boolean;
  mode?: string;
  previousEnabled?: boolean;
  restoreMarkingOnExit?: boolean;
  previousBaseUrl?: string;
  items?: AiPreviewItem[];
  focusedXpath?: string;
  showAllCategories?: boolean;
};

type AiPreviewStateResponseDeps = {
  getAiPreviewState: () => AiPreviewState;
  isPreviewExpandedStatesEnabled: () => boolean;
  FEATURE_DISABLED_REASON: string;
};

export function createAiPreviewStateResponseBuilder(deps: AiPreviewStateResponseDeps) {
  const mapItems = (items: AiPreviewItem[] | undefined): Array<{
    xpath: string | undefined;
    text: string | undefined;
    title: string | undefined;
    kind: string | undefined;
  }> => {
    const source = (Array.isArray(items) ? items : []);
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
