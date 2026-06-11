export function createFocusHandler(deps) {
  function handleFocusMessage(message = {}) {
    const xpath = message.xpath || "";
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
