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
  mainUi: document.getElementById("main-ui"),
  markedPages: document.getElementById("marked-pages"),
  configToggle: document.getElementById("config-toggle"),
  configMenu: document.getElementById("config-menu"),
  configExportAll: document.getElementById("config-export-all"),
  configExportCurrent: document.getElementById("config-export-current"),
  configImport: document.getElementById("config-import"),
  configClearCurrent: document.getElementById("config-clear-current"),
  configClearAll: document.getElementById("config-clear-all"),
  configImportFile: document.getElementById("config-import-file"),
  endpointUrl: document.getElementById("endpoint-url"),
  endpointSet: document.getElementById("endpoint-url-set"),
  endpointEdit: document.getElementById("endpoint-url-edit"),
  endpointNotice: document.getElementById("endpoint-notice"),
  aiControls: document.getElementById("ai-controls"),
  aiToken: document.getElementById("ai-token"),
  tokenStatus: document.getElementById("token-status"),
  tokenAction: document.getElementById("token-action"),
  computeButton: document.getElementById("compute"),
  saveExcludesButton: document.getElementById("save-excludes"),
  previewLatestButton: document.getElementById("preview-latest"),
  explicitExcludes: document.getElementById("explicit-excludes"),
  headingDefaults: document.getElementById("heading-defaults"),
  toast: document.getElementById("toast")
};

const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

let currentTab = null;
let currentBaseUrl = "";
let currentConfig = null;
let toastTimer = 0;
let refreshTimer = 0;
let baseUrlEditMode = false;
let endpointEditMode = false;
let aiRequestInFlight = null;
let configMenuOpen = false;

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    ui.toast.classList.remove("show");
  }, 1800);
}

function setConfigMenuOpen(open) {
  configMenuOpen = open;
  if (ui.configMenu) {
    ui.configMenu.hidden = !open;
  }
  if (ui.configToggle) {
    ui.configToggle.setAttribute("aria-expanded", open ? "true" : "false");
  }
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
    pageMarkings: {},
    latestComputedSelectors: [],
    lastSavedSelectors: [],
    pendingAiSave: false,
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
  if (!normalized.pageMarkings || typeof normalized.pageMarkings !== "object") {
    normalized.pageMarkings = {};
    changed = true;
  }
  if (!Array.isArray(normalized.latestComputedSelectors)) {
    normalized.latestComputedSelectors = [];
    changed = true;
  }
  if (!Array.isArray(normalized.lastSavedSelectors)) {
    normalized.lastSavedSelectors = [];
    changed = true;
  }
  if (typeof normalized.pendingAiSave !== "boolean") {
    normalized.pendingAiSave = false;
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

async function getImmutableDefaultTags() {
  const response = await sendTabMessageWithRetry({
    type: "getDefaultExclusions"
  });
  if (response && Array.isArray(response.immutableTags)) {
    return response.immutableTags;
  }
  return [];
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
  const configs = await getConfigs();
  const tabState = await getTabState(currentTab.id);
  const fallbackBaseUrl = findMatchingBaseUrl(currentTab.url, configs);
  const baseUrl = tabState.baseUrl || fallbackBaseUrl || "";
  if (baseUrl && currentTab.url.startsWith(baseUrl)) {
    await setTabState(currentTab.id, { enabled: true, baseUrl });
    await sendTabMessageWithRetry({
      type: "setEnabled",
      enabled: true,
      baseUrl
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
    text.title = label;
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
    text.title = item.text;
    const status = document.createElement("span");
    status.className = "status";
    status.textContent = item.excluded ? "Excluded" : "Included";
    const viewButton = document.createElement("button");
    viewButton.textContent = "View";
    viewButton.addEventListener("click", () => onToggle(item, "view"));
    const button = document.createElement("button");
    button.textContent = item.excluded ? "Include" : "Exclude";
    button.addEventListener("click", () => onToggle(item, "toggle"));
    li.appendChild(text);
    li.appendChild(status);
    li.appendChild(viewButton);
    li.appendChild(button);
    listEl.appendChild(li);
  });
}

function renderMarkedPages(listEl, items, emptyText, onNavigate) {
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
    const title = document.createElement("span");
    title.className = "page-title";
    title.textContent = item.title;
    title.title = item.title;
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = item.count === 1 ? "1 mark" : `${item.count} marks`;
    const button = document.createElement("button");
    button.textContent = "Navigate";
    button.addEventListener("click", () => onNavigate(item.url));
    li.appendChild(title);
    li.appendChild(count);
    li.appendChild(button);
    listEl.appendChild(li);
  });
}

function arraysEqual(left, right) {
  if (left === right) {
    return true;
  }
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
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
  ui.currentPageUrl.title = pageUrl || "Unavailable";
  let suggestedBaseUrl = "";
  if (pageUrl) {
    try {
      suggestedBaseUrl = new URL(pageUrl).origin;
    } catch (error) {
      suggestedBaseUrl = "";
    }
  }
  const baseUrlSet = Boolean(currentBaseUrl);
  const baseUrlReady = baseUrlSet && !baseUrlEditMode;
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
  if (!baseUrlSet) {
    ui.baseUrlNotice.textContent =
      "Set Base Page URL before enabling marking";
    ui.baseUrlNotice.style.display = "block";
  } else if (baseUrlEditMode) {
    ui.baseUrlNotice.textContent = "Set Base Page URL to continue";
    ui.baseUrlNotice.style.display = "block";
  } else {
    ui.baseUrlNotice.style.display = "none";
  }
  ui.toggleEnabled.checked = Boolean(
    effectiveTabState.enabled &&
      effectiveTabState.baseUrl &&
      pageUrl &&
      pageUrl.startsWith(effectiveTabState.baseUrl)
  );
  const tokenResult = await storageGet(chrome.storage.sync, "globalToken");
  const tokenValue = tokenResult.globalToken || "";
  const endpointResult = await storageGet(
    chrome.storage.sync,
    "globalEndpoint"
  );
  const endpointValue = endpointResult.globalEndpoint || "";
  if (!endpointValue) {
    endpointEditMode = false;
  }
  const endpointSet = Boolean(endpointValue);
  const endpointReady = endpointSet && !endpointEditMode;
  const endpointEditing = !endpointSet || endpointEditMode;
  if (!endpointEditing) {
    ui.endpointUrl.value = endpointValue;
  } else if (document.activeElement !== ui.endpointUrl) {
    ui.endpointUrl.value = endpointValue;
  }
  ui.endpointUrl.readOnly = !endpointEditing;
  ui.endpointSet.style.display = endpointEditing ? "inline-flex" : "none";
  ui.endpointEdit.style.display = endpointSet ? "inline-flex" : "none";
  ui.endpointEdit.textContent = endpointEditMode ? "Cancel" : "Change";
  if (!endpointSet) {
    ui.endpointNotice.textContent = "Set Endpoint URL before using AI";
    ui.endpointNotice.style.display = "block";
  } else if (endpointEditMode) {
    ui.endpointNotice.textContent = "Set Endpoint URL to continue";
    ui.endpointNotice.style.display = "block";
  } else {
    ui.endpointNotice.style.display = "none";
  }

  const aiReady = baseUrlReady && endpointReady && Boolean(tokenValue);
  const latestComputed =
    (currentConfig && currentConfig.latestComputedSelectors) || [];
  const lastSaved = (currentConfig && currentConfig.lastSavedSelectors) || [];
  const hasNewSelectors =
    latestComputed.length > 0 && !arraysEqual(latestComputed, lastSaved);
  const aiBusy = Boolean(aiRequestInFlight);
  const hasStoredSelectors = latestComputed.length > 0;

  ui.toggleEnabled.disabled = !baseUrlReady;
  ui.computeButton.disabled = aiBusy || !aiReady;
  ui.saveExcludesButton.disabled = aiBusy || !aiReady || !hasNewSelectors;
  ui.previewLatestButton.disabled = aiBusy || !baseUrlReady || !hasStoredSelectors;
  ui.mainUi.hidden = !baseUrlReady;
  ui.tokenStatus.textContent = tokenValue ? "Token saved" : "Token required";
  ui.tokenAction.textContent = tokenValue ? "Change token" : "Set token";
  ui.aiToken.hidden = !endpointReady;
  ui.aiControls.hidden = !endpointReady || !tokenValue;
  ui.tokenAction.disabled = aiBusy;
  ui.endpointUrl.disabled = aiBusy;
  ui.endpointSet.disabled = aiBusy;
  ui.endpointEdit.disabled = aiBusy;
  ui.configExportAll.disabled = aiBusy;
  ui.configExportCurrent.disabled = aiBusy || !baseUrlReady;
  ui.configImport.disabled = aiBusy;
  ui.configClearCurrent.disabled = aiBusy || !currentBaseUrl;
  ui.configClearAll.disabled = aiBusy;
  ui.computeButton.textContent =
    aiRequestInFlight === "compute" ? "Computing..." : "Decide Content";
  ui.saveExcludesButton.textContent =
    aiRequestInFlight === "save" ? "Saving..." : "Save Excludes";
  ui.computeButton.classList.toggle(
    "loading",
    aiRequestInFlight === "compute"
  );
  ui.saveExcludesButton.classList.toggle(
    "loading",
    aiRequestInFlight === "save"
  );
  ui.aiControls.setAttribute("aria-busy", aiBusy ? "true" : "false");

  const explicitExclude =
    (currentConfig &&
      currentConfig.explicitXPathDecisions &&
      currentConfig.explicitXPathDecisions.exclude) ||
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
      await sendTabMessage({
        type: "capturePageSnapshot",
        baseUrl: currentBaseUrl,
        xpaths: currentConfig.explicitXPathDecisions.exclude
      });
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

  const markedPages = [];
  const pageMarkings = (currentConfig && currentConfig.pageMarkings) || {};
  Object.entries(pageMarkings).forEach(([url, entry]) => {
    if (!url || !entry || !Array.isArray(entry.xpaths)) {
      return;
    }
    if (currentBaseUrl && !url.startsWith(currentBaseUrl)) {
      return;
    }
    if (entry.xpaths.length === 0) {
      return;
    }
    markedPages.push({
      url,
      title: entry.title || url,
      count: entry.xpaths.length
    });
  });
  markedPages.sort((a, b) => a.title.localeCompare(b.title));
  renderMarkedPages(
    ui.markedPages,
    markedPages,
    baseUrlSet ? "None yet" : "Set Base Page URL first",
    async (url) => {
      await loadActiveTab();
      if (!currentTab || !currentTab.id) {
        return;
      }
      chrome.tabs.update(currentTab.id, { url });
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

function normalizeImportedConfig(baseUrl, incoming) {
  const { config } = normalizeConfig(baseUrl, incoming);
  config.baseUrl = baseUrl;
  if (!config.domain) {
    try {
      config.domain = new URL(baseUrl).hostname;
    } catch (error) {
      config.domain = "";
    }
  }
  return config;
}

function looksLikeBaseUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function formatBytes(bytes) {
  if (!bytes) {
    return "0 B";
  }
  const units = ["B", "KB", "MB"];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function makeSafeFilename(value) {
  return value.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download(
    {
      url,
      filename,
      saveAs: true
    },
    () => {
      const error = chrome.runtime.lastError;
      window.setTimeout(() => URL.revokeObjectURL(url), 1200);
      if (error) {
        showToast("Unable to save configuration");
      }
    }
  );
}

async function handleExportAll() {
  setConfigMenuOpen(false);
  const configs = await getConfigs();
  const tokenResult = await storageGet(chrome.storage.sync, "globalToken");
  const endpointResult = await storageGet(
    chrome.storage.sync,
    "globalEndpoint"
  );
  const payload = {
    version: 1,
    scope: "all",
    configs,
    globalToken: tokenResult.globalToken || "",
    globalEndpoint: endpointResult.globalEndpoint || ""
  };
  const filename = `markcontit-all-${new Date().toISOString().slice(0, 10)}.json`;
  downloadJsonFile(filename, payload);
}

async function handleExportCurrent() {
  setConfigMenuOpen(false);
  if (!currentBaseUrl) {
    showToast("Set Base Page URL first");
    return;
  }
  const configs = await getConfigs();
  const config = normalizeImportedConfig(
    currentBaseUrl,
    configs[currentBaseUrl] || createDefaultConfig(currentBaseUrl)
  );
  const payload = {
    version: 1,
    scope: "baseUrl",
    baseUrl: currentBaseUrl,
    config
  };
  const safeBase = makeSafeFilename(currentBaseUrl) || "base";
  const filename = `markcontit-${safeBase}.json`;
  downloadJsonFile(filename, payload);
}

function extractIncomingConfigs(parsed) {
  const incomingConfigs = {};
  let includeGlobals = false;
  let globalToken = "";
  let globalEndpoint = "";

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { incomingConfigs, includeGlobals, globalToken, globalEndpoint };
  }

  if (parsed.configs && typeof parsed.configs === "object") {
    Object.assign(incomingConfigs, parsed.configs);
    includeGlobals = parsed.scope === "all";
    globalToken = parsed.globalToken || "";
    globalEndpoint = parsed.globalEndpoint || "";
    if (!includeGlobals && ("globalToken" in parsed || "globalEndpoint" in parsed)) {
      includeGlobals = true;
    }
    return { incomingConfigs, includeGlobals, globalToken, globalEndpoint };
  }

  if (parsed.baseUrl && looksLikeBaseUrl(parsed.baseUrl)) {
    const config =
      parsed.config && typeof parsed.config === "object" ? parsed.config : parsed;
    incomingConfigs[parsed.baseUrl] = config;
    return { incomingConfigs, includeGlobals, globalToken, globalEndpoint };
  }

  Object.entries(parsed).forEach(([key, value]) => {
    if (!looksLikeBaseUrl(key)) {
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    incomingConfigs[key] = value;
  });

  return { incomingConfigs, includeGlobals, globalToken, globalEndpoint };
}

async function handleImport() {
  setConfigMenuOpen(false);
  if (ui.configImportFile) {
    ui.configImportFile.click();
  }
}

async function handleClearCurrent() {
  setConfigMenuOpen(false);
  if (!currentBaseUrl) {
    showToast("Set Base Page URL first");
    return;
  }
  const confirmed = window.confirm(
    "Clear all configuration for this Base Page URL? This cannot be undone."
  );
  if (!confirmed) {
    return;
  }
  const configs = await getConfigs();
  delete configs[currentBaseUrl];
  await saveConfigs(configs);
  await loadActiveTab();
  if (currentTab && currentTab.id) {
    await setTabState(currentTab.id, { enabled: false, baseUrl: "" });
    await sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
  }
  currentBaseUrl = "";
  currentConfig = null;
  baseUrlEditMode = false;
  showToast("Base Page URL cleared");
  await refreshUi();
}

async function handleClearAll() {
  setConfigMenuOpen(false);
  const confirmed = window.confirm(
    "Clear all configuration and tokens? This cannot be undone."
  );
  if (!confirmed) {
    return;
  }
  await saveConfigs({});
  await storageSet(chrome.storage.sync, {
    globalToken: "",
    globalEndpoint: ""
  });
  await loadActiveTab();
  if (currentTab && currentTab.id) {
    await setTabState(currentTab.id, { enabled: false, baseUrl: "" });
    await sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
  }
  currentBaseUrl = "";
  currentConfig = null;
  baseUrlEditMode = false;
  endpointEditMode = false;
  showToast("All configuration cleared");
  await refreshUi();
}

async function handleImportFile(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) {
    return;
  }
  if (file.size > MAX_IMPORT_BYTES) {
    const confirmLarge = window.confirm(
      `File is ${formatBytes(file.size)}. Importing may take a moment. Continue?`
    );
    if (!confirmLarge) {
      return;
    }
  }

  let text = "";
  try {
    text = await file.text();
  } catch (error) {
    showToast("Unable to read file");
    return;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    showToast("Import file is not valid JSON");
    return;
  } finally {
    text = "";
  }

  const {
    incomingConfigs,
    includeGlobals,
    globalToken,
    globalEndpoint
  } = extractIncomingConfigs(parsed);
  const baseUrls = Object.keys(incomingConfigs).filter((value) => value.length > 0);
  if (!baseUrls.length) {
    showToast("No configuration found in file");
    return;
  }

  const confirmImport = window.confirm(
    `Import ${baseUrls.length} configuration ${baseUrls.length === 1 ? "entry" : "entries"} and merge with existing data?`
  );
  if (!confirmImport) {
    return;
  }

  const existing = await getConfigs();
  baseUrls.forEach((baseUrl) => {
    const normalized = normalizeImportedConfig(baseUrl, incomingConfigs[baseUrl]);
    existing[baseUrl] = normalized;
  });
  await saveConfigs(existing);

  if (includeGlobals) {
    await storageSet(chrome.storage.sync, {
      globalToken: globalToken || "",
      globalEndpoint: globalEndpoint || ""
    });
  }

  if (
    currentBaseUrl &&
    baseUrls.includes(currentBaseUrl) &&
    currentTab &&
    currentTab.id
  ) {
    await sendTabMessage({ type: "configUpdated", baseUrl: currentBaseUrl });
  }

  showToast("Configuration imported");
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
  await setTabState(currentTab.id, { enabled: true, baseUrl: baseUrlValue });
  currentBaseUrl = baseUrlValue;
  currentConfig = await ensureConfig(baseUrlValue);
  baseUrlEditMode = false;
  await sendTabMessageWithRetry({
    type: "setEnabled",
    enabled: true,
    baseUrl: baseUrlValue
  });
  await sendTabMessageWithRetry({ type: "forceRefresh" });
  await refreshUi();
}

async function handleBaseUrlEditToggle() {
  if (!currentBaseUrl) {
    return;
  }
  baseUrlEditMode = !baseUrlEditMode;
  if (baseUrlEditMode) {
    await loadActiveTab();
    if (currentTab && currentTab.id) {
      await setTabState(currentTab.id, {
        enabled: false,
        baseUrl: currentBaseUrl
      });
      await sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
    }
  } else if (currentTab && currentTab.url.startsWith(currentBaseUrl)) {
    await setTabState(currentTab.id, {
      enabled: true,
      baseUrl: currentBaseUrl
    });
    await sendTabMessageWithRetry({
      type: "setEnabled",
      enabled: true,
      baseUrl: currentBaseUrl
    });
    await sendTabMessageWithRetry({ type: "forceRefresh" });
  }
  await refreshUi();
}

async function handleEndpointSet() {
  const endpointValue = ui.endpointUrl.value.trim();
  if (!endpointValue) {
    showToast("Enter an Endpoint URL");
    return;
  }
  try {
    new URL(endpointValue);
  } catch (error) {
    showToast("Enter a valid Endpoint URL");
    return;
  }
  await storageSet(chrome.storage.sync, { globalEndpoint: endpointValue });
  endpointEditMode = false;
  await refreshUi();
}

async function handleEndpointEditToggle() {
  endpointEditMode = !endpointEditMode;
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
  endpointEditMode = false;
  await refreshUi();
}

async function handleComputeSelectors() {
  if (aiRequestInFlight) {
    return;
  }
  await loadActiveTab();
  if (!currentTab) {
    return;
  }
  if (!currentBaseUrl) {
    showToast("Set Base Page URL first");
    return;
  }
  const endpointResult = await storageGet(
    chrome.storage.sync,
    "globalEndpoint"
  );
  const endpointValue = endpointResult.globalEndpoint || "";
  if (!endpointValue) {
    showToast("Set Endpoint URL first");
    return;
  }
  const tokenResult = await storageGet(chrome.storage.sync, "globalToken");
  const tokenValue = tokenResult.globalToken || "";
  if (!tokenValue) {
    showToast("Set token first");
    return;
  }

  await sendTabMessage({ type: "capturePageSnapshot", baseUrl: currentBaseUrl });

  const freshConfig = await ensureConfig(currentBaseUrl);
  currentConfig = freshConfig;
  const immutableTags = await getImmutableDefaultTags();
  const pageMarkings = freshConfig.pageMarkings || {};
  const pageSnapshots =
    (freshConfig && freshConfig.pageHtmlSnapshots) || {};
  const payload = Object.entries(pageMarkings)
    .map(([url, entry]) => {
      if (!url || !entry) {
        return null;
      }
      const html = entry.html || pageSnapshots[url];
      return {
        url,
        html,
        xpaths: entry.xpaths || [],
        defaultExclusionSelectors: immutableTags.slice()
      };
    })
    .filter((entry) => {
      if (!entry || !entry.url) {
        return false;
      }
      if (currentBaseUrl && !entry.url.startsWith(currentBaseUrl)) {
        return false;
      }
      return Array.isArray(entry.xpaths) && entry.xpaths.length > 0 && entry.html;
    });

  if (!payload.length) {
    showToast("Mark pages before computing selectors");
    return;
  }

  let selectors = [];
  aiRequestInFlight = "compute";
  await refreshUi();
  try {
    const response = await fetch(endpointValue, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenValue}`
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      showToast("Endpoint response error");
      return;
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      showToast("Endpoint response format error");
      return;
    }
    selectors = data
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    currentConfig = await updateConfig(currentBaseUrl, (config) => {
      config.latestComputedSelectors = selectors;
      config.domainAiSelectorSet = {
        inclusionSelectors: [],
        exclusionSelectors: selectors
      };
      config.pendingAiSave = selectors.length > 0;
    });

    await sendTabMessage({ type: "configUpdated", baseUrl: currentBaseUrl });
    await sendTabMessage({
      type: "showAiPreview",
      selectors
    });
    showToast("Selectors computed");
  } catch (error) {
    showToast("Endpoint request failed");
  } finally {
    aiRequestInFlight = null;
    await refreshUi();
  }
}

async function handleSaveExcludes() {
  if (aiRequestInFlight) {
    return;
  }
  await loadActiveTab();
  if (!currentTab) {
    return;
  }
  if (!currentBaseUrl) {
    showToast("Set Base Page URL first");
    return;
  }
  const endpointResult = await storageGet(
    chrome.storage.sync,
    "globalEndpoint"
  );
  const endpointValue = endpointResult.globalEndpoint || "";
  if (!endpointValue) {
    showToast("Set Endpoint URL first");
    return;
  }
  const tokenResult = await storageGet(chrome.storage.sync, "globalToken");
  const tokenValue = tokenResult.globalToken || "";
  if (!tokenValue) {
    showToast("Set token first");
    return;
  }
  const freshConfig = await ensureConfig(currentBaseUrl);
  currentConfig = freshConfig;
  const selectors = freshConfig.latestComputedSelectors || [];
  if (!selectors.length) {
    showToast("Compute selectors before saving");
    return;
  }
  if (arraysEqual(selectors, freshConfig.lastSavedSelectors || [])) {
    showToast("No new selectors to save");
    return;
  }
  aiRequestInFlight = "save";
  await refreshUi();
  try {
    const response = await fetch(endpointValue, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenValue}`
      },
      body: JSON.stringify({
        baseUrl: currentBaseUrl,
        selectors
      })
    });
    if (!response.ok) {
      showToast("Save response error");
      return;
    }
    currentConfig = await updateConfig(currentBaseUrl, (config) => {
      config.lastSavedSelectors = selectors;
      config.pendingAiSave = false;
    });
    showToast("Excludes saved");
  } catch (error) {
    showToast("Save request failed");
  } finally {
    aiRequestInFlight = null;
    await refreshUi();
  }
}

async function handlePreviewLatest() {
  await loadActiveTab();
  if (!currentTab) {
    return;
  }
  if (!currentBaseUrl) {
    showToast("Set Base Page URL first");
    return;
  }
  const freshConfig = await ensureConfig(currentBaseUrl);
  const selectors = freshConfig.latestComputedSelectors || [];
  if (!selectors.length) {
    showToast("No stored selectors available");
    return;
  }
  await sendTabMessage({
    type: "showAiPreview",
    selectors
  });
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
  ui.configToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    setConfigMenuOpen(!configMenuOpen);
  });
  ui.configMenu.addEventListener("click", (event) => event.stopPropagation());
  ui.configExportAll.addEventListener("click", handleExportAll);
  ui.configExportCurrent.addEventListener("click", handleExportCurrent);
  ui.configImport.addEventListener("click", handleImport);
  ui.configClearCurrent.addEventListener("click", handleClearCurrent);
  ui.configClearAll.addEventListener("click", handleClearAll);
  ui.configImportFile.addEventListener("change", handleImportFile);
  ui.baseUrlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      if (!ui.baseUrlInput.readOnly) {
        handleBaseUrlSet();
      }
    }
  });
  ui.endpointUrl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      if (!ui.endpointUrl.readOnly) {
        handleEndpointSet();
      }
    }
  });
  ui.refreshContext.addEventListener("click", handleContextRefresh);
  ui.baseUrlSet.addEventListener("click", handleBaseUrlSet);
  ui.baseUrlEdit.addEventListener("click", handleBaseUrlEditToggle);
  ui.endpointSet.addEventListener("click", handleEndpointSet);
  ui.endpointEdit.addEventListener("click", handleEndpointEditToggle);
  ui.tokenAction.addEventListener("click", handleTokenBlur);
  ui.computeButton.addEventListener("click", handleComputeSelectors);
  ui.saveExcludesButton.addEventListener("click", handleSaveExcludes);
  ui.previewLatestButton.addEventListener("click", handlePreviewLatest);

  document.addEventListener("click", () => setConfigMenuOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setConfigMenuOpen(false);
    }
  });

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
