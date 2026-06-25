type DescribeXpathsDeps = {
  getElementFromXPath: (xpath: string) => Element | null;
  isVisible: (element: Element) => boolean;
  getElementLabel: (element: Element) => string;
};

type DescribeXpathsMessage = {
  xpaths?: unknown;
};

export function createDescribeXpathsHandler(deps: DescribeXpathsDeps) {
  function handleMessage(message: DescribeXpathsMessage = {}): { items: Array<{ xpath: string; text: string }> } {
    const xpaths = Array.isArray(message.xpaths) ? message.xpaths : [];
    const items: Array<{ xpath: string; text: string }> = [];

    xpaths.forEach((xpath) => {
      if (typeof xpath !== "string") {
        return;
      }
      const element = deps.getElementFromXPath(xpath);
      if (!element || !deps.isVisible(element)) {
        return;
      }
      items.push({ xpath, text: deps.getElementLabel(element) });
    });

    return { items };
  }

  return {
    handleMessage
  };
}
