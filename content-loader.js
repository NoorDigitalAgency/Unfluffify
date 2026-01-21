(async () => {
  const src = chrome.runtime.getURL("content-main.js");
  const contentMain = await import(src);
  if (contentMain && typeof contentMain.main === "function") {
    contentMain.main();
  }
})();
