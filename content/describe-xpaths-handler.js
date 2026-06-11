export function createDescribeXpathsHandler(deps) {
  function handleMessage(message = {}) {
    const xpaths = Array.isArray(message.xpaths) ? message.xpaths : [];
    const items = [];

    xpaths.forEach((xpath) => {
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
