// @ts-nocheck
import { PopupText } from "../common/text.js";

const RENDER_MODE_DEFAULT_ICON = "monitor-dashboard";

const RENDER_MODE_METADATA = {
  static: { label: () => PopupText.renderMode.optionStatic, icon: "language-html5" },
  rendered: { label: () => PopupText.renderMode.optionRendered, icon: "language-javascript" }
};

function getRenderModeMetadata(renderModeValue) {
  return RENDER_MODE_METADATA[renderModeValue] || null;
}

export function getRenderModeOptionLabel(renderModeValue) {
  const metadata = getRenderModeMetadata(renderModeValue);
  return metadata ? metadata.label() : PopupText.renderMode.optionUndetermined;
}

export function getRenderModeOptionIcon(renderModeValue) {
  const metadata = getRenderModeMetadata(renderModeValue);
  return metadata ? metadata.icon : RENDER_MODE_DEFAULT_ICON;
}

export function resolveRenderModeInspectionReloadOutcome(reloadResult, loadStarted, javaScriptDisabled) {
  if (!reloadResult || !reloadResult.ok) {
    return {
      ok: false,
      toast: (reloadResult && reloadResult.error) || PopupText.renderMode.toastInspectReloadFailed
    };
  }

  if (!loadStarted) {
    return {
      ok: false,
      toast: PopupText.renderMode.toastInspectReloadFailed
    };
  }

  return {
    ok: true,
    toast: javaScriptDisabled
      ? PopupText.renderMode.toastInspectWithoutJavaScriptStarted
      : PopupText.renderMode.toastInspectWithJavaScriptStarted
  };
}
