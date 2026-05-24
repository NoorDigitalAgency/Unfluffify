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
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function appendEntry(entry) {
  if (!rows) {
    return;
  }
  const tr = document.createElement("tr");
  const timestamp = Number(entry.completedAt || entry.startedAt) || Date.now();
  const date = new Date(timestamp).toISOString();
  const hasPayload = Boolean(entry.payload && (entry.payload.request || entry.payload.response));

  const tdDate = document.createElement("td");
  tdDate.className = "mono";
  tdDate.textContent = date;

  const tdStatus = document.createElement("td");
  tdStatus.textContent = String(Number(entry.statusCode) || 0);

  const tdMethod = document.createElement("td");
  tdMethod.textContent = String(entry.method || "GET");

  const tdType = document.createElement("td");
  tdType.textContent = String(entry.type || "other");

  const tdTime = document.createElement("td");
  tdTime.textContent = Math.max(0, Number(entry.loadTimeMs) || 0).toFixed(1);

  const tdUrl = document.createElement("td");
  tdUrl.className = "mono";
  tdUrl.textContent = String(entry.url || "");

  const tdPayload = document.createElement("td");
  tdPayload.className = "payload";

  tr.appendChild(tdDate);
  tr.appendChild(tdStatus);
  tr.appendChild(tdMethod);
  tr.appendChild(tdType);
  tr.appendChild(tdTime);
  tr.appendChild(tdUrl);
  tr.appendChild(tdPayload);

  if (hasPayload) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-btn";
    button.title = "Save payload";
    button.textContent = "↓";
    button.addEventListener("click", () => downloadPayload(entry));
    tdPayload.appendChild(button);
  }
  rows.prepend(tr);
}

port.onMessage.addListener((message) => {
  if (!message) {
    return;
  }
  if (message.type === "remoteSupportStateChanged") {
    const s = message.state;
    if (s && includePayloads) {
      includePayloads.checked = Boolean(s.includePayloads);
      includePayloads.disabled = !(s.active && s.mode === "supporting");
    }
    return;
  }
  if (message.type !== "remoteSupportNetworkEntry") {
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
