// @ts-nocheck
export function createInvisibleXpathsHandler(deps) {
  function handleMessage(message = {}) {
    const xpaths = Array.isArray(message.xpaths) ? message.xpaths : [];
    const filtered = xpaths.filter((xpath) => {
      const element = deps.getElementFromXPath(xpath);
      return element && !deps.isVisible(element);
    });
    return { xpaths: filtered };
  }

  return {
    handleMessage
  };
}
