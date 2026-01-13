const HARD_EXCLUDED_TAGS = [
  "IMG",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "FOOTER",
  "FORM",
  "BUTTON",
  "INPUT",
  "LABEL",
  "NAV",
  "HEADER",
  "NOSCRIPT",
  "DIALOG",
  "ASIDE",
  "SELECT",
  "TITLE",
  "STYLE"
];

const HARD_EXCLUDED_SELECTORS = [
  "[aria-hidden='true']",
  "[role='dialog']",
  ".cookie",
  ".cookies",
  ".cookie-banner",
  ".newsletter",
  ".subscribe",
  ".modal",
  ".popup"
];

const storageGet = (area, keys) =>
  new Promise((resolve) => area.get(keys, resolve));
const storageSet = (area, items) =>
  new Promise((resolve) => area.set(items, resolve));
const tabsQuery = (query) =>
  new Promise((resolve) => chrome.tabs.query(query, resolve));

const ui = {
  toggleEnabled: document.getElementById("toggle-enabled"),
  currentPageUrl: document.getElementById("current-page-url"),
  baseUrlInput: document.getElementById("base-url"),
  refreshContext: document.getElementById("refresh-context"),
  baseUrlSet: document.getElementById("base-url-set"),
  baseUrlEdit: document.getElementById("base-url-edit"),
  baseUrlNotice: document.getElementById("base-url-notice"),
  tokenStatus: document.getElementById("token-status"),
  tokenAction: document.getElementById("token-action"),
  computeButton: document.getElementById("compute"),
  exportButton: document.getElementById("export"),
  explicitExcludes: document.getElementById("explicit-excludes"),
  headingDefaults: document.getElementById("heading-defaults"),
  aiExcludes: document.getElementById("ai-excludes"),
  toast: document.getElementById("toast")
};

let currentTab = null;
let currentBaseUrl = "";
let currentConfig = null;
let toastTimer = 0;
let refreshTimer = 0;
let baseUrlEditMode = false;

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    ui.toast.classList.remove("show");
  }, 1800);
}

function createDefaultConfig(baseUrl) {
  let domain = "";
  try {
    domain = new URL(baseUrl).hostname;
  } catch (error) {
    domain = "";
  }
  return {
    baseUrl,
    domain,
    showDefaultHighlights: true,
    explicitXPathDecisions: { include: [], exclude: [] },
    pageHtmlSnapshots: {},
    defaultToggleExclusionsDisabled: [],
    domainAiSelectorSet: { inclusionSelectors: [], exclusionSelectors: [] }
  };
}

function normalizeConfig(baseUrl, config) {
  const normalized = config || createDefaultConfig(baseUrl);
  let changed = false;

  if (!normalized.explicitXPathDecisions) {
    normalized.explicitXPathDecisions = { include: [], exclude: [] };
    changed = true;
  }
  if (!Array.isArray(normalized.explicitXPathDecisions.exclude)) {
    normalized.explicitXPathDecisions.exclude = [];
    changed = true;
  }
  if (!Array.isArray(normalized.explicitXPathDecisions.include)) {
    normalized.explicitXPathDecisions.include = [];
    changed = true;
  }
  if (!Array.isArray(normalized.defaultToggleExclusionsDisabled)) {
    normalized.defaultToggleExclusionsDisabled = [];
    changed = true;
  }
  if (
    !normalized.domainAiSelectorSet ||
    !Array.isArray(normalized.domainAiSelectorSet.exclusionSelectors)
  ) {
    normalized.domainAiSelectorSet = {
      inclusionSelectors: [],
      exclusionSelectors: []
    };
    changed = true;
  }
  if (
    !normalized.pageHtmlSnapshots ||
    typeof normalized.pageHtmlSnapshots !== "object"
  ) {
    normalized.pageHtmlSnapshots = {};
    changed = true;
  }
  if (normalized.showDefaultHighlights !== true) {
    normalized.showDefaultHighlights = true;
    changed = true;
  }

  return { config: normalized, changed };
}

async function getConfigs() {
  const result = await storageGet(chrome.storage.local, "configs");
  return result.configs || {};
}

async function saveConfigs(configs) {
  await storageSet(chrome.storage.local, { configs });
}

async function getTabState(tabId) {
  const key = `tabState:${tabId}`;
  const result = await storageGet(chrome.storage.session, key);
  return result[key] || { enabled: false, baseUrl: "" };
}

async function setTabState(tabId, state) {
  const key = `tabState:${tabId}`;
  await storageSet(chrome.storage.session, { [key]: state });
}

function findMatchingBaseUrl(pageUrl, configs) {
  if (!pageUrl) {
    return "";
  }
  let match = "";
  Object.keys(configs).forEach((baseUrl) => {
    if (pageUrl.startsWith(baseUrl) && baseUrl.length > match.length) {
      match = baseUrl;
    }
  });
  return match;
}

function parseBaseUrl(value) {
  if (!value) {
    return null;
  }
  try {
    return new URL(value);
  } catch (error) {
    return null;
  }
}

async function ensureConfig(baseUrl) {
  const configs = await getConfigs();
  const { config, changed } = normalizeConfig(baseUrl, configs[baseUrl]);
  if (!configs[baseUrl] || changed) {
    configs[baseUrl] = config;
    await saveConfigs(configs);
  }
  return configs[baseUrl];
}

async function updateConfig(baseUrl, updater) {
  const configs = await getConfigs();
  const { config } = normalizeConfig(baseUrl, configs[baseUrl]);
  updater(config);
  configs[baseUrl] = config;
  await saveConfigs(configs);
  return config;
}

async function sendTabMessage(message) {
  return new Promise((resolve) => {
    if (!currentTab || !currentTab.id) {
      resolve(null);
      return;
    }
    chrome.tabs.sendMessage(currentTab.id, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response);
    });
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendTabMessageWithRetry(message, attempts = 3) {
  for (let i = 0; i < attempts; i += 1) {
    const response = await sendTabMessage(message);
    if (response) {
      return response;
    }
    await delay(250);
  }
  return null;
}

async function clearFocusedElement() {
  await sendTabMessage({ type: "clearFocus" });
}

async function loadActiveTab() {
  const tabs = await tabsQuery({ active: true, lastFocusedWindow: true });
  currentTab = tabs[0] || null;
}

async function ensureEnabledOnOpen() {
  if (!currentTab || !currentTab.url) {
    return;
  }
  const tabState = await getTabState(currentTab.id);
  if (
    tabState.enabled &&
    tabState.baseUrl &&
    currentTab.url.startsWith(tabState.baseUrl)
  ) {
    await sendTabMessageWithRetry({
      type: "setEnabled",
      enabled: true,
      baseUrl: tabState.baseUrl
    });
    await sendTabMessageWithRetry({ type: "forceRefresh" });
    return;
  }
  if (tabState.enabled) {
    await setTabState(currentTab.id, { enabled: false, baseUrl: tabState.baseUrl || "" });
    await sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
  }
}

function renderList(listEl, items, emptyText, onRemove) {
  listEl.textContent = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = emptyText;
    listEl.appendChild(li);
    return;
  }
  items.forEach((item) => {
    const li = document.createElement("li");
    const text = document.createElement("span");
    text.textContent = item;
    const button = document.createElement("button");
    button.textContent = "Remove";
    button.addEventListener("click", () => onRemove(item));
    li.appendChild(text);
    li.appendChild(button);
    listEl.appendChild(li);
  });
}

function renderExcludeList(listEl, items, emptyText, onView, onRemove) {
  listEl.textContent = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = emptyText;
    listEl.appendChild(li);
    return;
  }
  items.forEach((item) => {
    const li = document.createElement("li");
    const text = document.createElement("span");
    const label = item.text || item.xpath || "";
    text.textContent = label;
    if (item.xpath) {
      text.title = item.xpath;
    }
    const viewButton = document.createElement("button");
    viewButton.textContent = "View";
    viewButton.addEventListener("click", () => onView(item.xpath));
    const removeButton = document.createElement("button");
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => onRemove(item.xpath));
    li.appendChild(text);
    li.appendChild(viewButton);
    li.appendChild(removeButton);
    listEl.appendChild(li);
  });
}

function renderHeadingDefaults(listEl, items, emptyText, onToggle) {
  listEl.textContent = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = emptyText;
    listEl.appendChild(li);
    return;
  }
  items.forEach((item) => {
    const li = document.createElement("li");
    const text = document.createElement("span");
    text.textContent = item.text;
    const status = document.createElement("span");
    status.className = "status";
    status.textContent = item.excluded ? "Excluded" : "Included";
    const viewButton = document.createElement("button");
    viewButton.textContent = "View";
    viewButton.addEventListener("click", () => onToggle(item, "view"));
    const button = document.createElement("button");
    button.textContent = item.excluded ? "Allow" : "Exclude";
    button.addEventListener("click", () => onToggle(item, "toggle"));
    li.appendChild(text);
    li.appendChild(status);
    li.appendChild(viewButton);
    li.appendChild(button);
    listEl.appendChild(li);
  });
}

async function refreshUi() {
  if (!currentTab) {
    return;
  }
  const configs = await getConfigs();
  const tabState = await getTabState(currentTab.id);
  const pageUrl = currentTab.url || "";
  let effectiveTabState = tabState;
  if (tabState.baseUrl && pageUrl && !pageUrl.startsWith(tabState.baseUrl)) {
    effectiveTabState = { enabled: false, baseUrl: "" };
    await setTabState(currentTab.id, effectiveTabState);
  }
  const fallbackBaseUrl = findMatchingBaseUrl(pageUrl, configs);
  currentBaseUrl = effectiveTabState.baseUrl || fallbackBaseUrl || "";
  if (currentBaseUrl) {
    const normalized = normalizeConfig(currentBaseUrl, configs[currentBaseUrl]);
    if (!configs[currentBaseUrl] || normalized.changed) {
      configs[currentBaseUrl] = normalized.config;
      await saveConfigs(configs);
    }
    currentConfig = configs[currentBaseUrl];
  } else {
    currentConfig = null;
  }
  if (!currentBaseUrl) {
    baseUrlEditMode = false;
  }

  ui.currentPageUrl.textContent = pageUrl || "Unavailable";
  let suggestedBaseUrl = "";
  if (pageUrl) {
    try {
      suggestedBaseUrl = new URL(pageUrl).origin;
    } catch (error) {
      suggestedBaseUrl = "";
    }
  }
  const baseUrlSet = Boolean(currentBaseUrl);
  const isEditing = !baseUrlSet || baseUrlEditMode;
  if (!isEditing) {
    ui.baseUrlInput.value = currentBaseUrl;
  } else if (document.activeElement !== ui.baseUrlInput) {
    ui.baseUrlInput.value = baseUrlSet ? currentBaseUrl : suggestedBaseUrl;
  }
  ui.baseUrlInput.readOnly = !isEditing;
  ui.baseUrlSet.style.display = isEditing ? "inline-flex" : "none";
  ui.baseUrlEdit.style.display = baseUrlSet ? "inline-flex" : "none";
  ui.baseUrlEdit.textContent = baseUrlEditMode ? "Cancel" : "Change";
  ui.baseUrlNotice.style.display = baseUrlSet ? "none" : "block";
  ui.toggleEnabled.checked = Boolean(
    effectiveTabState.enabled &&
      effectiveTabState.baseUrl &&
      pageUrl &&
      pageUrl.startsWith(effectiveTabState.baseUrl)
  );
  ui.toggleEnabled.disabled = !baseUrlSet || baseUrlEditMode;
  ui.computeButton.disabled = !baseUrlSet || baseUrlEditMode;
  ui.exportButton.disabled = !baseUrlSet || baseUrlEditMode;

  const tokenResult = await storageGet(chrome.storage.sync, "globalToken");
  const tokenValue = tokenResult.globalToken || "";
  ui.tokenStatus.textContent = tokenValue ? "Token saved" : "Token required";
  ui.tokenAction.textContent = tokenValue ? "Change token" : "Set token";

  const explicitExclude =
    (currentConfig &&
      currentConfig.explicitXPathDecisions &&
      currentConfig.explicitXPathDecisions.exclude) ||
    [];
  const aiExclude =
    (currentConfig &&
      currentConfig.domainAiSelectorSet &&
      currentConfig.domainAiSelectorSet.exclusionSelectors) ||
    [];

  let pageExplicitExclude = explicitExclude.map((xpath) => ({
    xpath,
    text: xpath
  }));
  if (currentBaseUrl) {
    const response = await sendTabMessage({
      type: "describeXPathsOnPage",
      xpaths: explicitExclude
    });
    if (response && Array.isArray(response.items)) {
      pageExplicitExclude = response.items;
    }
  }

  renderExcludeList(
    ui.explicitExcludes,
    pageExplicitExclude,
    baseUrlSet ? "None yet" : "Set Base Page URL first",
    async (value) => {
      const response = await sendTabMessage({
        type: "focusElement",
        xpath: value
      });
      if (!response || !response.ok) {
        showToast("Unable to focus element");
      }
    },
    async (value) => {
      if (!currentBaseUrl) {
        return;
      }
      await clearFocusedElement();
      currentConfig = await updateConfig(currentBaseUrl, (config) => {
        config.explicitXPathDecisions.exclude =
          config.explicitXPathDecisions.exclude.filter((item) => item !== value);
      });
      await sendTabMessage({ type: "configUpdated", baseUrl: currentBaseUrl });
      await sendTabMessage({ type: "capturePageSnapshot", baseUrl: currentBaseUrl });
      refreshUi();
    }
  );

  let headingDefaults = [];
  if (currentBaseUrl) {
    const response = await sendTabMessage({
      type: "getHeadingDefaultStatus",
      baseUrl: currentBaseUrl
    });
    if (response && Array.isArray(response.items)) {
      headingDefaults = response.items;
    }
  }
  renderHeadingDefaults(
    ui.headingDefaults,
    headingDefaults,
    baseUrlSet ? "None yet" : "Set Base Page URL first",
    async (item, action) => {
      if (action === "view") {
        const response = await sendTabMessage({
          type: "focusElement",
          xpath: item.xpath
        });
        if (!response || !response.ok) {
          showToast("Unable to focus element");
        }
        return;
      }
      if (!currentBaseUrl) {
        return;
      }
      await clearFocusedElement();
      const response = await sendTabMessage({
        type: "toggleHeadingDefault",
        baseUrl: currentBaseUrl,
        xpath: item.xpath
      });
      if (!response || !response.ok) {
        showToast("Unable to update heading");
        return;
      }
      await refreshUi();
    }
  );

  renderList(
    ui.aiExcludes,
    aiExclude,
    baseUrlSet ? "None yet" : "Set Base Page URL first",
    async (value) => {
    if (!currentBaseUrl) {
      return;
    }
    await clearFocusedElement();
    currentConfig = await updateConfig(currentBaseUrl, (config) => {
      config.domainAiSelectorSet.exclusionSelectors =
        config.domainAiSelectorSet.exclusionSelectors.filter(
          (item) => item !== value
        );
    });
    await sendTabMessage({ type: "configUpdated", baseUrl: currentBaseUrl });
    refreshUi();
    }
  );
}

async function handleEnableToggle() {
  await loadActiveTab();
  if (!currentTab) {
    return;
  }
  if (!currentBaseUrl) {
    showToast("Set Base Page URL before enabling marking");
    ui.toggleEnabled.checked = false;
    return;
  }
  const enabled = ui.toggleEnabled.checked;
  const baseUrlValue = currentBaseUrl;
  if (enabled) {
    const parsed = parseBaseUrl(baseUrlValue);
    if (!parsed) {
      showToast("Enter a valid Base Page URL");
      ui.toggleEnabled.checked = false;
      return;
    }
    if (!currentTab.url.startsWith(baseUrlValue)) {
      showToast("Current page is outside the Base Page URL");
      ui.toggleEnabled.checked = false;
      return;
    }
    await ensureConfig(baseUrlValue);
    await setTabState(currentTab.id, { enabled: true, baseUrl: baseUrlValue });
    await sendTabMessageWithRetry({
      type: "setEnabled",
      enabled: true,
      baseUrl: baseUrlValue
    });
    await sendTabMessageWithRetry({ type: "forceRefresh" });
  } else {
    await setTabState(currentTab.id, { enabled: false, baseUrl: baseUrlValue });
    await sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
  }
  await refreshUi();
}

async function handleBaseUrlSet() {
  await loadActiveTab();
  if (!currentTab || !currentTab.url) {
    return;
  }
  const baseUrlValue = ui.baseUrlInput.value.trim();
  if (!baseUrlValue) {
    showToast("Enter a Base Page URL");
    return;
  }
  const parsed = parseBaseUrl(baseUrlValue);
  if (!parsed) {
    showToast("Enter a valid Base Page URL");
    return;
  }
  if (!currentTab.url.startsWith(baseUrlValue)) {
    showToast("Current page is outside the Base Page URL");
    return;
  }
  await ensureConfig(baseUrlValue);
  await setTabState(currentTab.id, { enabled: false, baseUrl: baseUrlValue });
  currentBaseUrl = baseUrlValue;
  currentConfig = await ensureConfig(baseUrlValue);
  baseUrlEditMode = false;
  await sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
  await refreshUi();
}

async function handleBaseUrlEditToggle() {
  if (!currentBaseUrl) {
    return;
  }
  baseUrlEditMode = !baseUrlEditMode;
  await refreshUi();
}

async function handleTokenBlur() {
  const tokenResult = await storageGet(chrome.storage.sync, "globalToken");
  const existing = tokenResult.globalToken || "";
  const entered = window.prompt("Enter token", existing);
  if (entered === null) {
    return;
  }
  const token = entered.trim();
  await storageSet(chrome.storage.sync, { globalToken: token });
  showToast(token ? "Token saved" : "Token cleared");
  await refreshUi();
}

async function handleContextRefresh() {
  await loadActiveTab();
  baseUrlEditMode = false;
  await refreshUi();
}

async function requestAiSelectors(payload, token) {
  const headers = { Authorization: `Bearer ${token}` };
  void headers;
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ inclusionSelectors: [], exclusionSelectors: [] });
    }, 400);
  });
}

async function handleComputeSelectors() {
  await loadActiveTab();
  if (!currentTab) {
    return;
  }
  if (!currentBaseUrl) {
    showToast("Set Base Page URL first");
    return;
  }

  const payload = await sendTabMessage({
    type: "collectPageData",
    baseUrl: currentBaseUrl
  });

  if (!payload) {
    showToast("Open the page and try again");
    return;
  }

  const tokenResult = await storageGet(chrome.storage.sync, "globalToken");
  const selectorSet = await requestAiSelectors(
    payload,
    tokenResult.globalToken || ""
  );

  currentConfig = await updateConfig(currentBaseUrl, (config) => {
    config.domainAiSelectorSet = {
      inclusionSelectors: [],
      exclusionSelectors: selectorSet.exclusionSelectors || []
    };
    config.explicitXPathDecisions.include = [];
  });

  await sendTabMessage({ type: "configUpdated", baseUrl: currentBaseUrl });
  showToast("Selectors updated");
  refreshUi();
}

async function handleExportJson() {
  await loadActiveTab();
  if (!currentBaseUrl || !currentConfig) {
    showToast("Set Base Page URL first");
    return;
  }

  const defaultExclusions = HARD_EXCLUDED_TAGS.concat(HARD_EXCLUDED_SELECTORS);
  const explicitExcludes =
    (currentConfig.explicitXPathDecisions &&
      currentConfig.explicitXPathDecisions.exclude) ||
    [];
  const aiExcludes =
    (currentConfig.domainAiSelectorSet &&
      currentConfig.domainAiSelectorSet.exclusionSelectors) ||
    [];
  const payload = {
    baseUrl: currentConfig.baseUrl || "",
    domain: currentConfig.domain || "",
    defaultExclusions: defaultExclusions.join("\n"),
    xpathsInclude: "",
    xpathsExclude: explicitExcludes.join("\n"),
    aiInclusions: "",
    aiExclusions: aiExcludes.join("\n")
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "markcontit.json";
  link.click();
  URL.revokeObjectURL(url);
}

function scheduleRefresh() {
  if (refreshTimer) {
    return;
  }
  refreshTimer = window.setTimeout(async () => {
    refreshTimer = 0;
    await loadActiveTab();
    await refreshUi();
  }, 120);
}

async function init() {
  await loadActiveTab();

  ui.toggleEnabled.addEventListener("change", handleEnableToggle);
  ui.baseUrlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      if (!ui.baseUrlInput.readOnly) {
        handleBaseUrlSet();
      }
    }
  });
  ui.refreshContext.addEventListener("click", handleContextRefresh);
  ui.baseUrlSet.addEventListener("click", handleBaseUrlSet);
  ui.baseUrlEdit.addEventListener("click", handleBaseUrlEditToggle);
  ui.tokenAction.addEventListener("click", handleTokenBlur);
  ui.computeButton.addEventListener("click", handleComputeSelectors);
  ui.exportButton.addEventListener("click", handleExportJson);

  chrome.tabs.onActivated.addListener(async () => {
    await loadActiveTab();
    await refreshUi();
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (!currentTab || tabId !== currentTab.id) {
      return;
    }
    if (changeInfo.url || changeInfo.status === "complete") {
      currentTab = tab;
      await refreshUi();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" && areaName !== "session") {
      return;
    }
    if (
      (areaName === "local" && changes.configs) ||
      (areaName === "session" && currentTab && changes[`tabState:${currentTab.id}`])
    ) {
      scheduleRefresh();
    }
  });

  await ensureEnabledOnOpen();
  await refreshUi();
}

init();
