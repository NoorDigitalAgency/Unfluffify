export function createCollectPageDataHandler(deps) {
  async function handleMessage(message = {}) {
    const targetBaseUrl = message.baseUrl || deps.getBaseUrl();
    const config = await deps.loadConfig(targetBaseUrl);
    const entry = deps.getPageMarkingEntry(config, deps.getPageUrl(), {
      create: false,
      persist: false
    });
    const snapshot = deps.createCurrentPageSnapshot();

    return {
      baseUrl: targetBaseUrl,
      pageUrl: deps.getPageUrl(),
      renderedHtml: snapshot.renderedHtml,
      rawHtml: typeof entry.rawHtml === "string" ? entry.rawHtml : "",
      renderMode: snapshot.renderMode,
      immutableSelectors: deps.getImmutableSelectors(),
      xpaths: entry.xpaths || []
    };
  }

  return {
    handleMessage
  };
}
