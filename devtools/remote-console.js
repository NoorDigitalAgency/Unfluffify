import { REMOTE_SUPPORT_PORT_CONSOLE } from "../common/remote-support.js";

const list = document.getElementById("list");
const clearButton = document.getElementById("clear");

const port = chrome.runtime.connect({
  name: REMOTE_SUPPORT_PORT_CONSOLE
});

function appendEntry(entry) {
  if (!list) {
    return;
  }
  const item = document.createElement("div");
  item.className = "item";
  const level = typeof entry.level === "string" ? entry.level : "log";
  const message = typeof entry.message === "string" ? entry.message : "";
  const timestamp = Number(entry.timestamp) || Date.now();
  const date = new Date(timestamp);
  item.innerHTML = `<div><strong>${level.toUpperCase()}</strong><span class="muted">${date.toISOString()}</span></div><div>${message}</div>`;
  list.prepend(item);
}

port.onMessage.addListener((message) => {
  if (!message || message.type !== "remoteSupportConsoleEntry") {
    return;
  }
  appendEntry(message.entry || {});
});

if (clearButton) {
  clearButton.addEventListener("click", () => {
    if (!list) {
      return;
    }
    list.innerHTML = "";
  });
}
