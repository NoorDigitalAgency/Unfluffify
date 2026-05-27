import { REMOTE_SUPPORT_PORT_CONSOLE } from "../common/remote-support.js";
import {
  DEVTOOLS_SOURCE_FILTER_ALL,
  formatSourceLabel,
  getDevtoolsSourceFilterOptions,
  matchesDevtoolsSourceFilter
} from "../common/devtools-helpers.js";

const list = document.getElementById("list");
const sourceFilter = document.getElementById("source-filter");
const clearButton = document.getElementById("clear");
const consoleEntries = [];
const KNOWN_CONSOLE_LEVELS = new Set(["log", "info", "warn", "error", "debug"]);

let selectedSource = DEVTOOLS_SOURCE_FILTER_ALL;

const port = chrome.runtime.connect({
  name: REMOTE_SUPPORT_PORT_CONSOLE
});
const inspectedTabId = chrome.devtools && chrome.devtools.inspectedWindow
  ? chrome.devtools.inspectedWindow.tabId
  : null;

if (Number.isFinite(inspectedTabId)) {
  port.postMessage({
    type: "remoteSupportAttach",
    tabId: inspectedTabId
  });
}

function normalizeConsoleLevel(level) {
  const normalized = typeof level === "string" ? level.trim().toLowerCase() : "";
  return KNOWN_CONSOLE_LEVELS.has(normalized) ? normalized : "log";
}

function createEntryItem(entry) {
  const item = document.createElement("div");
  const level = normalizeConsoleLevel(entry && entry.level);
  item.className = `item item--${level}`;
  const message = typeof entry.message === "string" ? entry.message : "";
  const timestamp = Number(entry.timestamp) || Date.now();
  const date = new Date(timestamp);
  const headerRow = document.createElement("div");
  headerRow.className = "item__header";
  const strong = document.createElement("strong");
  strong.textContent = level.toUpperCase();
  const source = document.createElement("span");
  source.className = "source";
  source.textContent = formatSourceLabel(entry.source);
  const muted = document.createElement("span");
  muted.className = "muted";
  muted.textContent = date.toISOString();
  headerRow.appendChild(strong);
  headerRow.appendChild(source);
  headerRow.appendChild(muted);
  const messageRow = document.createElement("div");
  messageRow.className = "item__message";
  messageRow.textContent = message;
  item.appendChild(headerRow);
  item.appendChild(messageRow);
  return item;
}

function renderSourceFilterOptions() {
  if (!sourceFilter) {
    return;
  }

  const options = getDevtoolsSourceFilterOptions(consoleEntries);
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
  if (!list) {
    return;
  }

  list.innerHTML = "";
  for (const entry of consoleEntries) {
    if (!matchesDevtoolsSourceFilter(entry, selectedSource)) {
      continue;
    }

    list.appendChild(createEntryItem(entry));
  }
}

function addEntry(entry) {
  consoleEntries.unshift(entry && typeof entry === "object" ? entry : {});
  renderSourceFilterOptions();
  renderEntries();
}

port.onMessage.addListener((message) => {
  if (!message || message.type !== "remoteSupportConsoleEntry") {
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

if (clearButton) {
  clearButton.addEventListener("click", () => {
    consoleEntries.length = 0;
    selectedSource = DEVTOOLS_SOURCE_FILTER_ALL;
    renderSourceFilterOptions();
    renderEntries();
  });
}
