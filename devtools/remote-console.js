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
  const headerRow = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = level.toUpperCase();
  const muted = document.createElement("span");
  muted.className = "muted";
  muted.textContent = date.toISOString();
  headerRow.appendChild(strong);
  headerRow.appendChild(muted);
  const messageRow = document.createElement("div");
  messageRow.textContent = message;
  item.appendChild(headerRow);
  item.appendChild(messageRow);
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
