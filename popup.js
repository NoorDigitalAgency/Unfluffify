let currentTab = null;
let currentConfig = null;

const enableToggle = document.getElementById("enableToggle");
const baseUrlInput = document.getElementById("baseUrlInput");
const setBaseUrlButton = document.getElementById("setBaseUrl");
const baseUrlHint = document.getElementById("baseUrlHint");
const selectorsList = document.getElementById("selectorsList");
const selectorsCount = document.getElementById("selectorsCount");
const exportJsonButton = document.getElementById("exportJson");
const statusEl = document.getElementById("status");

function setStatus(message) {
  statusEl.textContent = message || "";
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response || {});
    });
  });
}

function suggestBaseUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (path.endsWith("/")) {
      return parsed.origin + path;
    }
    const dir = path.substring(0, path.lastIndexOf("/") + 1);
    return parsed.origin + dir;
  } catch (err) {
    return "";
  }
}

function updateBaseUrlHint() {
  if (currentConfig && currentConfig.baseUrl) {
    baseUrlHint.textContent = `Applies to URLs starting with ${currentConfig.baseUrl}`;
  } else {
    baseUrlHint.textContent = "No base URL saved yet.";
  }
}

function renderSelectors() {
  selectorsList.innerHTML = "";
  if (!currentConfig) {
    selectorsCount.textContent = "";
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "No selectors yet.";
    selectorsList.appendChild(empty);
    return;
  }

  const include = currentConfig.includeSelectors || [];
  const exclude = currentConfig.excludeSelectors || [];
  const all = include.concat(exclude).sort((a, b) => b.createdAt - a.createdAt);
  selectorsCount.textContent = `${all.length}`;

  if (!all.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "No selectors yet.";
    selectorsList.appendChild(empty);
    return;
  }

  all.forEach((record) => {
    const row = document.createElement("div");
    row.className = "selector-row";

    const badge = document.createElement("div");
    badge.className = `selector-badge ${record.category === "include" ? "badge-include" : "badge-exclude"}`;
    badge.textContent = record.category;

    const body = document.createElement("div");
    body.className = "selector-body";

    const selectorText = document.createElement("div");
    selectorText.className = "selector-text";
    selectorText.textContent = record.selector;

    const urlText = document.createElement("div");
    urlText.className = "selector-url";
    urlText.textContent = record.createdFromUrl;

    const actions = document.createElement("div");
    actions.className = "selector-actions";

    const openBtn = document.createElement("button");
    openBtn.className = "action-button";
    openBtn.textContent = "Open";
    openBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: record.createdFromUrl });
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "action-button";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", async () => {
      if (!currentConfig) return;
      const response = await sendMessage({
        type: "removeSelector",
        baseUrl: currentConfig.baseUrl,
        selectorId: record.id,
        category: record.category
      });
      if (response.error) {
        setStatus(response.error);
        return;
      }
      currentConfig = response.config;
      renderSelectors();
      updateBaseUrlHint();
      setStatus("Selector removed.");
    });

    actions.appendChild(openBtn);
    actions.appendChild(removeBtn);
    body.appendChild(selectorText);
    body.appendChild(urlText);
    body.appendChild(actions);

    row.appendChild(badge);
    row.appendChild(body);
    selectorsList.appendChild(row);
  });
}

async function refreshState() {
  if (!currentTab || !currentTab.id) return;
  const response = await sendMessage({
    type: "getState",
    tabId: currentTab.id,
    url: currentTab.url
  });
  if (response.error) {
    setStatus(response.error);
    return;
  }
  currentConfig = response.config || null;
  enableToggle.checked = !!response.enabled;
  if (!baseUrlInput.value) {
    baseUrlInput.value = currentConfig ? currentConfig.baseUrl : suggestBaseUrl(currentTab.url);
  }
  renderSelectors();
  updateBaseUrlHint();
}

async function setBaseUrl() {
  if (!currentTab || !currentTab.id) return;
  const baseUrl = baseUrlInput.value.trim();
  if (!baseUrl) {
    setStatus("Enter a base URL first.");
    return;
  }
  const response = await sendMessage({
    type: "setBaseUrl",
    tabId: currentTab.id,
    baseUrl,
    url: currentTab.url
  });
  if (response.error) {
    setStatus(response.error);
    return;
  }
  currentConfig = response.config;
  baseUrlInput.value = currentConfig.baseUrl;
  updateBaseUrlHint();
  renderSelectors();
  setStatus("Base URL saved.");
}

async function setEnabled(enabled) {
  if (!currentTab || !currentTab.id) return;
  const response = await sendMessage({
    type: "setEnabled",
    tabId: currentTab.id,
    url: currentTab.url,
    enabled
  });
  if (response.error) {
    setStatus(response.error);
    return;
  }
  if (enabled && !response.config) {
    setStatus("Set a base URL before enabling.");
    return;
  }
  if (enabled && response.config && currentTab && currentTab.url) {
    if (!currentTab.url.startsWith(response.config.baseUrl)) {
      setStatus("Current page is outside the base URL scope.");
      return;
    }
  }
  setStatus(enabled ? "Marking enabled." : "Marking disabled.");
}

async function exportJson() {
  if (!currentConfig) {
    setStatus("Nothing to export yet.");
    return;
  }
  const inclusions = (currentConfig.includeSelectors || []).map((item) => item.selector);
  const exclusions = (currentConfig.excludeSelectors || []).map((item) => item.selector);
  const payload = {
    baseUrl: currentConfig.baseUrl,
    domain: currentConfig.domain,
    inclusions: inclusions,
    exclusions: exclusions,
    selectorsCount: inclusions.length + exclusions.length
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "markcontit.json";
  link.click();
  URL.revokeObjectURL(url);
  setStatus("Export ready.");
}

setBaseUrlButton.addEventListener("click", setBaseUrl);
enableToggle.addEventListener("change", (event) => {
  setEnabled(event.target.checked);
});
exportJsonButton.addEventListener("click", exportJson);

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  currentTab = tabs[0] || null;
  if (!currentTab) {
    setStatus("No active tab.");
    return;
  }
  baseUrlInput.value = suggestBaseUrl(currentTab.url);
  refreshState();
});
