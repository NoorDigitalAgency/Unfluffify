type VisibleXpathsDeps = {
  getElementFromXPath: (xpath: string) => Element | null;
  isVisible: (element: Element) => boolean;
};

type XpathsMessage = {
  xpaths?: unknown;
};

export function createVisibleXpathsHandler(deps: VisibleXpathsDeps) {
  function handleMessage(message: XpathsMessage = {}): { xpaths: string[] } {
    const xpaths = Array.isArray(message.xpaths) ? message.xpaths : [];
    const filtered = xpaths.filter((xpath) => {
      if (typeof xpath !== "string") {
        return false;
      }
      const element = deps.getElementFromXPath(xpath);
      return element && deps.isVisible(element);
    });
    return { xpaths: filtered };
  }

  return {
    handleMessage
  };
}
