import { PopupText } from "../common/text.js";

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
