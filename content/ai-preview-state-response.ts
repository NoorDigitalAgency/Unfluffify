// @ts-nocheck
export function createAiPreviewStateResponseBuilder(deps) {
  const mapItems = (items) => {
    const source = Array.isArray(items) ? items : [];
    return source.map((item) => ({
      xpath: item.xpath,
      text: item.text,
      title: item.title,
      kind: item.kind
    }));
  };

  const buildBase = ({ showAllCategories } = {}) => {
    const state = deps.getAiPreviewState();
    return {
      active: state.active,
      mode: state.mode || "",
      previousEnabled: Boolean(state.previousEnabled),
      restoreMarkingOnExit: Boolean(state.restoreMarkingOnExit),
      previousBaseUrl: state.previousBaseUrl || "",
      showAllCategories,
      items: mapItems(state.items),
      focusedXpath: state.focusedXpath
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

  const buildExpandedModeResponse = (ok) => ({
    ok,
    ...buildBase({ showAllCategories: Boolean(deps.getAiPreviewState().showAllCategories) })
  });

  return {
    buildGetStateResponse,
    buildExpandedModeDisabledResponse,
    buildExpandedModeResponse
  };
}
