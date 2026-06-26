type CollectPageDataDeps = {
  getBaseUrl: () => string;
  loadConfig: (baseUrl: string) => Promise<unknown>;
  getPageMarkingEntry: (
    config: unknown,
    pageUrl: string,
    options: { create: boolean; persist: boolean }
  ) => { rawHtml?: unknown; xpaths?: unknown };
  createCurrentPageSnapshot: () => { renderedHtml: unknown; renderMode: unknown };
  getImmutableSelectors: () => string[];
  getPageUrl: () => string;
};

type CollectPageDataMessage = {
  baseUrl?: unknown;
};

export function createCollectPageDataHandler(deps: CollectPageDataDeps) {
  async function handleMessage(message: CollectPageDataMessage = {}): Promise<{
    baseUrl: string;
    pageUrl: string;
    renderedHtml: unknown;
    rawHtml: string;
    renderMode: unknown;
    immutableSelectors: string[];
    xpaths: unknown[];
  }> {
    const targetBaseUrl = typeof message.baseUrl === "string" && message.baseUrl
      ? message.baseUrl
      : deps.getBaseUrl();
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
      xpaths: Array.isArray(entry.xpaths) ? entry.xpaths : []
    };
  }

  return {
    handleMessage
  };
}
