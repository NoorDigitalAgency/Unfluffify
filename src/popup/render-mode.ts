import { PopupText } from "../common/text";

const RENDER_MODE_DEFAULT_ICON = "monitor-dashboard";

type RenderModeMetadata = {
  label: () => string;
  icon: string;
};

type ReloadOutcome = {
  ok: boolean;
  toast: string;
};

const RENDER_MODE_METADATA: Record<string, RenderModeMetadata> = {
  static: { label: () => PopupText.renderMode.optionStatic, icon: "language-html5" },
  rendered: { label: () => PopupText.renderMode.optionRendered, icon: "language-javascript" }
};

function getRenderModeMetadata(renderModeValue: unknown): RenderModeMetadata | null {
  if (typeof renderModeValue !== "string") {
    return null;
  }
  return RENDER_MODE_METADATA[renderModeValue] || null;
}

export function getRenderModeOptionLabel(renderModeValue: unknown): string {
  const metadata = getRenderModeMetadata(renderModeValue);
  return metadata ? metadata.label() : PopupText.renderMode.optionUndetermined;
}

export function getRenderModeOptionIcon(renderModeValue: unknown): string {
  const metadata = getRenderModeMetadata(renderModeValue);
  return metadata ? metadata.icon : RENDER_MODE_DEFAULT_ICON;
}

export function resolveRenderModeInspectionReloadOutcome(
  reloadResult: { ok?: boolean; error?: string } | null | undefined,
  loadStarted: unknown,
  javaScriptDisabled: boolean | null | undefined
): ReloadOutcome {
  if (!reloadResult || !reloadResult.ok) {
    return {
      ok: false,
      toast:
        typeof reloadResult?.error === "string" && reloadResult.error
          ? reloadResult.error
          : PopupText.renderMode.toastInspectReloadFailed
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
