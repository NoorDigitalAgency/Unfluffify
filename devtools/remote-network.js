import { REMOTE_SUPPORT_PORT_NETWORK } from "../common/remote-support.js";
import {
  DEVTOOLS_SOURCE_FILTER_ALL,
  formatSourceLabel,
  getDevtoolsSourceFilterOptions,
  matchesDevtoolsSourceFilter
} from "../common/devtools-helpers.js";

const rows = document.getElementById("rows");
const includePayloads = document.getElementById("include-payloads");
const sourceFilter = document.getElementById("source-filter");
const clearButton = document.getElementById("clear");
const networkEntries = [];

let selectedSource = DEVTOOLS_SOURCE_FILTER_ALL;

const port = chrome.runtime.connect({ name: REMOTE_SUPPORT_PORT_NETWORK });
const inspectedTabId = chrome.devtools && chrome.devtools.inspectedWindow
  ? chrome.devtools.inspectedWindow.tabId
  : null;

if (Number.isFinite(inspectedTabId)) {
  port.postMessage({
    type: "remoteSupportAttach",
    tabId: inspectedTabId
  });
}

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

function createEntryRow(entry) {
  const tr = document.createElement("tr");
  const timestamp = Number(entry.completedAt || entry.startedAt) || Date.now();
  const date = new Date(timestamp).toISOString();
  const hasPayload = Boolean(entry.payload && (entry.payload.request || entry.payload.response));

  const tdDate = document.createElement("td");
  tdDate.className = "mono";
  tdDate.textContent = date;

  const tdSource = document.createElement("td");
  tdSource.textContent = formatSourceLabel(entry.source);

  const tdStatus = document.createElement("td");
  tdStatus.textContent = String(Number(entry.statusCode) || 0);

  const tdMethod = document.createElement("td");
  tdMethod.textContent = String(entry.method || "GET");

  const tdType = document.createElement("td");
  tdType.textContent = String(entry.type || "other");

  const tdTime = document.createElement("td");
  tdTime.textContent = Math.max(0, Number(entry.loadTimeMs) || 0).toFixed(1);

  const tdHeaders = document.createElement("td");
  const requestHeaderCount = typeof entry.requestHeaderCount === "number" ? entry.requestHeaderCount : 0;
  const responseHeaderCount = typeof entry.responseHeaderCount === "number" ? entry.responseHeaderCount : 0;
  tdHeaders.textContent = `req ${requestHeaderCount} / res ${responseHeaderCount}`;

  const tdUrl = document.createElement("td");
  tdUrl.className = "mono";
  tdUrl.textContent = String(entry.url || "");

  const tdPayload = document.createElement("td");
  tdPayload.className = "payload";

  tr.appendChild(tdDate);
  tr.appendChild(tdSource);
  tr.appendChild(tdStatus);
  tr.appendChild(tdMethod);
  tr.appendChild(tdType);
  tr.appendChild(tdTime);
  tr.appendChild(tdHeaders);
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

  return tr;
}

function renderSourceFilterOptions() {
  if (!sourceFilter) {
    return;
  }

  const options = getDevtoolsSourceFilterOptions(networkEntries);
  const fragment = document.createDocumentFragment();
  for (const optionLike of options) {
    const option = document.createElement("option");
    option.value = optionLike.value;
    option.textContent = optionLike.label;
    fragment.appendChild(option);
  }

  if (!options.some((option) => option.value === selectedSource)) {
    selectedSource = DEVTOOLS_SOURCE_FILTER_ALL;
  }

  sourceFilter.replaceChildren(fragment);
  sourceFilter.value = selectedSource;
}

function renderEntries() {
  if (!rows) {
    return;
  }

  rows.innerHTML = "";
  for (const entry of networkEntries) {
    if (!matchesDevtoolsSourceFilter(entry, selectedSource)) {
      continue;
    }

    rows.appendChild(createEntryRow(entry));
  }
}

function addEntry(entry) {
  networkEntries.unshift(entry && typeof entry === "object" ? entry : {});
  renderSourceFilterOptions();
  renderEntries();
}

port.onMessage.addListener((message) => {
  if (!message) {
    return;
  }
  if (message.type === "remoteSupportStateChanged") {
    const s = message.state;
    if (s && includePayloads) {
      if (s.active) {
        includePayloads.checked = Boolean(s.includePayloads);
      }
      includePayloads.disabled = !Number.isFinite(inspectedTabId);
    }
    return;
  }
  if (message.type !== "remoteSupportNetworkEntry") {
    return;
  }
  addEntry(message.entry || {});
});

if (sourceFilter) {
  renderSourceFilterOptions();
  sourceFilter.addEventListener("change", () => {
    selectedSource = sourceFilter.value || DEVTOOLS_SOURCE_FILTER_ALL;
    renderEntries();
  });
}

if (includePayloads) {
  includePayloads.disabled = !Number.isFinite(inspectedTabId);
  includePayloads.addEventListener("change", () => {
    port.postMessage({
      type: "setIncludePayloads",
      enabled: includePayloads.checked
    });
  });
}

if (clearButton) {
  clearButton.addEventListener("click", () => {
    networkEntries.length = 0;
    selectedSource = DEVTOOLS_SOURCE_FILTER_ALL;
    renderSourceFilterOptions();
    renderEntries();
  });
}
