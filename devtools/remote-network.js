import { REMOTE_SUPPORT_PORT_NETWORK } from "../common/remote-support.js";

const rows = document.getElementById("rows");
const includePayloads = document.getElementById("include-payloads");
const clearButton = document.getElementById("clear");

const port = chrome.runtime.connect({ name: REMOTE_SUPPORT_PORT_NETWORK });

function downloadPayload(entry) {
  if (!entry || !entry.payload) {
    return;
  }
  const blob = new Blob([JSON.stringify(entry.payload, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `remote-payload-${Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function appendEntry(entry) {
  if (!rows) {
    return;
  }
  const tr = document.createElement("tr");
  const timestamp = Number(entry.completedAt || entry.startedAt) || Date.now();
  const date = new Date(timestamp).toISOString();
  const hasPayload = Boolean(entry.payload && (entry.payload.request || entry.payload.response));
  tr.innerHTML = `
    <td class="mono">${date}</td>
    <td>${Number(entry.statusCode) || 0}</td>
    <td>${entry.method || "GET"}</td>
    <td>${entry.type || "other"}</td>
    <td>${Math.max(0, Number(entry.loadTimeMs) || 0).toFixed(1)}</td>
    <td class="mono">${entry.url || ""}</td>
    <td class="payload"></td>
  `;
  if (hasPayload) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-btn";
    button.title = "Save payload";
    button.textContent = "↓";
    button.addEventListener("click", () => downloadPayload(entry));
    const payloadCell = tr.querySelector(".payload");
    if (payloadCell) {
      payloadCell.appendChild(button);
    }
  }
  rows.prepend(tr);
}

port.onMessage.addListener((message) => {
  if (!message || message.type !== "remoteSupportNetworkEntry") {
    return;
  }
  appendEntry(message.entry || {});
});

if (includePayloads) {
  includePayloads.addEventListener("change", () => {
    port.postMessage({
      type: "setIncludePayloads",
      enabled: includePayloads.checked
    });
  });
}

if (clearButton) {
  clearButton.addEventListener("click", () => {
    if (!rows) {
      return;
    }
    rows.innerHTML = "";
  });
}
