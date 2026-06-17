type FocusHandlerDeps = {
  getElementFromXPath: (xpath: string) => Element | null;
  focusPreviewElement: (element: Element) => void;
  isAiPreviewActive: () => boolean;
  setAiPreviewFocusedXpath: (xpath: string) => void;
  clearFocusHighlight: () => void;
};

type FocusMessage = {
  xpath?: unknown;
};

export function createFocusHandler(deps: FocusHandlerDeps) {
  function handleFocusMessage(message: FocusMessage = {}): { ok: boolean } {
    const xpath = typeof message.xpath === "string" ? message.xpath : "";
    const target = xpath ? deps.getElementFromXPath(xpath) : null;
    if (!target) {
      return { ok: false };
    }

    deps.focusPreviewElement(target);
    if (deps.isAiPreviewActive()) {
      deps.setAiPreviewFocusedXpath(xpath);
    }

    return { ok: true };
  }

  function handleClearFocusMessage() {
    deps.clearFocusHighlight();
    if (deps.isAiPreviewActive()) {
      deps.setAiPreviewFocusedXpath("");
    }
    return { ok: true };
  }

  return {
    handleFocusMessage,
    handleClearFocusMessage
  };
}
