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
  pagePatternSelect: document.getElementById("page-pattern"),
  pagePatternSet: document.getElementById("page-pattern-set"),
  pagePatternNotice: document.getElementById("page-pattern-notice"),
  mainUi: document.getElementById("main-ui"),
  markedPages: document.getElementById("marked-pages"),
  configToggle: document.getElementById("config-toggle"),
  configMenu: document.getElementById("config-menu"),
  configExportAll: document.getElementById("config-export-all"),
  configExportCurrent: document.getElementById("config-export-current"),
  configImport: document.getElementById("config-import"),
  configClearCurrent: document.getElementById("config-clear-current"),
  configClearAll: document.getElementById("config-clear-all"),
  clearDomainCache: document.getElementById("clear-domain-cache"),
  configImportFile: document.getElementById("config-import-file"),
  uiCurtain: document.getElementById("ui-curtain"),
  deviceEmulationEnabled: document.getElementById("device-emulation-enabled"),
  deviceModeDesktop: document.getElementById("device-mode-desktop"),
  deviceModeMobile: document.getElementById("device-mode-mobile"),
  deviceScale: document.getElementById("device-scale"),
  deviceScaleValue: document.getElementById("device-scale-value"),
  pageSave: document.getElementById("page-save"),
  pageRevert: document.getElementById("page-revert"),
  pageDelete: document.getElementById("page-delete"),
  pageDraftStatus: document.getElementById("page-draft-status"),
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
const DEVICE_MODE_PREFIX = "deviceEmulation:";
const PAGE_PATTERN_DRAFT_PREFIX = "pagePatternDraft:";
const DEVICE_SCALE_DEFAULTS = {
  desktop: 0.7,
  mobile: 0.85
};
const DEVICE_SCALE_LIMITS = {
  min: 0.25,
  max: 1,
  step: 0.01
};
let currentTab = null;
let currentBaseUrl = "";
let currentConfig = null;
let toastTimer = 0;
let refreshTimer = 0;
let baseUrlEditMode = false;
let endpointEditMode = false;
let aiRequestInFlight = null;
let configMenuOpen = false;
let currentDeviceMode = "desktop";
let currentDeviceScale = DEVICE_SCALE_DEFAULTS.desktop;
let currentDeviceEmulationEnabled = false;
let currentDraftEntry = null;
let currentDraftDirty = false;
let currentDraftAvailable = false;
let currentDraftHasEntry = false;

async function getPagePatternDraft(tabId) {
  if (!tabId) {
    return {};
  }
  const key = `${PAGE_PATTERN_DRAFT_PREFIX}${tabId}`;
  const result = await storageGet(chrome.storage.session, key);
  return result[key] || {};
}

async function setPagePatternDraft(tabId, pageUrl, pattern) {
  if (!tabId || !pageUrl) {
    return;
  }
  const normalized = normalizePatternValue(pattern);
  if (!normalized) {
    return;
  }
  const key = `${PAGE_PATTERN_DRAFT_PREFIX}${tabId}`;
  const current = await getPagePatternDraft(tabId);
  current[pageUrl] = normalized;
  await storageSet(chrome.storage.session, { [key]: current });
}

async function clearPagePatternDraft(tabId, pageUrl) {
  if (!tabId || !pageUrl) {
    return;
  }
  const key = `${PAGE_PATTERN_DRAFT_PREFIX}${tabId}`;
  const current = await getPagePatternDraft(tabId);
  if (!current[pageUrl]) {
    return;
  }
  delete current[pageUrl];
  await storageSet(chrome.storage.session, { [key]: current });
}

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    ui.toast.classList.remove("show");
  }, 1800);
}

function setUiBusy(isBusy) {
  if (ui.uiCurtain) {
    ui.uiCurtain.hidden = !isBusy;
  }
  document.body.classList.toggle("is-busy", isBusy);
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
    pageMarkings: {},
    latestComputedSelectors: [],
    lastSavedSelectors: [],
    domainAiSelectorSet: { inclusionSelectors: [] }
  };
}

function normalizePageMarkings(pageMarkings) {
  const normalized = {};
  let changed = false;
  if (!pageMarkings || typeof pageMarkings !== "object") {
    return { normalized, changed };
  }
  Object.entries(pageMarkings).forEach(([url, entry]) => {
    if (!url || !entry || typeof entry !== "object") {
      changed = true;
      return;
    }
    const rawXpaths = Array.isArray(entry.xpaths) ? entry.xpaths : [];
    const xpaths = rawXpaths
      .map((item) => {
        if (typeof item === "string") {
          changed = true;
          return { xpath: item, excluded: true };
        }
        if (item && typeof item.xpath === "string") {
          return { xpath: item.xpath, excluded: Boolean(item.excluded) };
        }
        changed = true;
        return null;
      })
      .filter(Boolean);
    const rawPattern =
      typeof entry.pagePattern === "string"
        ? entry.pagePattern
        : typeof entry.pattern === "string"
          ? entry.pattern
          : "";
    const pagePattern = normalizePatternValue(rawPattern);
    if (rawPattern && rawPattern !== pagePattern) {
      changed = true;
    }
    if (entry.pattern) {
      changed = true;
    }
    const fullHTML =
      typeof entry.fullHTML === "string"
        ? entry.fullHTML
        : typeof entry.fullHtml === "string"
          ? entry.fullHtml
          : typeof entry.html === "string"
            ? entry.html
            : "";
    if (entry.fullHtml || entry.html) {
      changed = true;
    }
    normalized[url] = {
      url: entry.url || url,
      title: entry.title || url,
      xpaths,
      pagePattern,
      fullHTML
    };
  });
  return { normalized, changed };
}

function normalizeAiSelectorSet(value) {
  const normalized = { inclusionSelectors: [] };
  let changed = false;
  if (!value || typeof value !== "object") {
    return { normalized, changed };
  }
  if (Array.isArray(value.inclusionSelectors)) {
    normalized.inclusionSelectors = value.inclusionSelectors;
  } else if (Array.isArray(value.exclusionSelectors)) {
    normalized.inclusionSelectors = value.exclusionSelectors;
    changed = true;
  } else {
    changed = true;
  }
  return { normalized, changed };
}

function normalizePatternValue(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  try {
    const parsed = new URL(value);
    let pathname = parsed.pathname || "/";
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    const rootPath = pathname === "/" ? "" : pathname;
    return `${parsed.origin}${rootPath}`;
  } catch (error) {
    return "";
  }
}

function isPageUrlMatchingPattern(pageUrl, pattern) {
  const pageBase = normalizePatternValue(pageUrl);
  const patternBase = normalizePatternValue(pattern);
  if (!pageBase || !patternBase) {
    return false;
  }
  if (pageBase === patternBase) {
    return true;
  }
  return pageBase.startsWith(`${patternBase}/`);
}

function findBestMatchingPattern(pageUrl, patterns) {
  if (!pageUrl || !Array.isArray(patterns)) {
    return "";
  }
  const matches = patterns
    .map((pattern) => normalizePatternValue(pattern))
    .filter((pattern) => isPageUrlMatchingPattern(pageUrl, pattern))
    .sort((left, right) => right.length - left.length);
  return matches[0] || "";
}

function getPathSegments(pathname) {
  if (!pathname) {
    return [];
  }
  return pathname.split("/").filter(Boolean);
}

function isPageWithinBase(pageUrl, baseUrl) {
  const pageBase = normalizePatternValue(pageUrl);
  const baseBase = normalizePatternValue(baseUrl);
  if (!pageBase || !baseBase) {
    return false;
  }
  if (pageBase === baseBase) {
    return true;
  }
  return pageBase.startsWith(`${baseBase}/`);
}

function collectPagePatterns(pageMarkings) {
  const patterns = [];
  if (!pageMarkings || typeof pageMarkings !== "object") {
    return patterns;
  }
  Object.values(pageMarkings).forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const pattern = normalizePatternValue(entry.pagePattern || "");
    if (pattern && !patterns.includes(pattern)) {
      patterns.push(pattern);
    }
  });
  return patterns;
}

function getPatternOptions(pageUrl, baseUrl) {
  if (!pageUrl || !baseUrl) {
    return [];
  }
  let pageParsed = null;
  let baseParsed = null;
  try {
    pageParsed = new URL(pageUrl);
    baseParsed = new URL(baseUrl);
  } catch (error) {
    return [];
  }
  if (pageParsed.origin !== baseParsed.origin) {
    return [];
  }
  const pageSegments = getPathSegments(pageParsed.pathname);
  const baseSegments = getPathSegments(baseParsed.pathname);
  for (let i = 0; i < baseSegments.length; i += 1) {
    if (pageSegments[i] !== baseSegments[i]) {
      return [];
    }
  }
  const options = [];
  const origin = baseParsed.origin;
  const baseCount = baseSegments.length;
  for (let i = baseCount; i <= pageSegments.length; i += 1) {
    const segments = pageSegments.slice(0, i);
    const path = segments.length ? `/${segments.join("/")}` : "/";
    const value = normalizePatternValue(`${origin}${path}`);
    if (!value || options.some((option) => option.value === value)) {
      continue;
    }
    const label =
      i === baseCount
        ? `Base URL (${value})`
        : i === pageSegments.length
          ? `Only this page (${value})`
          : `Section (${value})`;
    options.push({ value, label });
  }
  return options;
}

function normalizeConfig(baseUrl, incoming) {
  let changed = false;
  const defaultConfig = createDefaultConfig(baseUrl);
  let normalized = { ...defaultConfig };

  if (!incoming) {
    return { config: normalized, changed: true };
  }

  if (
    incoming.explicitXPathDecisions ||
    incoming.defaultToggleExclusionsDisabled ||
    incoming.pageHtmlSnapshots ||
    incoming.pendingAiSave !== undefined
  ) {
    changed = true;
  }
  if (typeof incoming.domain === "string") {
    normalized.domain = incoming.domain;
  }
  if (typeof incoming.pageMarkings === "object" && incoming.pageMarkings !== null) {
    const result = normalizePageMarkings(incoming.pageMarkings);
    normalized.pageMarkings = result.normalized;
    if (result.changed) {
      changed = true;
    }
  } else if (incoming.pageMarkings !== undefined) {
    changed = true;
  }
  if (incoming.pageUrlPatterns !== undefined) {
    changed = true;
  }
  if (Array.isArray(incoming.latestComputedSelectors)) {
    normalized.latestComputedSelectors = incoming.latestComputedSelectors;
  } else if (incoming.latestComputedSelectors !== undefined) {
    changed = true;
  }
  if (Array.isArray(incoming.lastSavedSelectors)) {
    normalized.lastSavedSelectors = incoming.lastSavedSelectors;
  } else if (incoming.lastSavedSelectors !== undefined) {
    changed = true;
  }
  const aiSelectors = normalizeAiSelectorSet(incoming.domainAiSelectorSet);
  normalized.domainAiSelectorSet = aiSelectors.normalized;
  if (aiSelectors.changed) {
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

function normalizeDeviceMode(mode) {
  return mode === "mobile" ? "mobile" : "desktop";
}

function normalizeDeviceScale(scale, mode) {
  if (typeof scale !== "number" || !Number.isFinite(scale)) {
    return DEVICE_SCALE_DEFAULTS[mode];
  }
  if (scale < DEVICE_SCALE_LIMITS.min) {
    return DEVICE_SCALE_LIMITS.min;
  }
  if (scale > DEVICE_SCALE_LIMITS.max) {
    return DEVICE_SCALE_LIMITS.max;
  }
  return scale;
}

function normalizeDeviceEmulationState(value) {
  if (!value) {
    return {
      enabled: false,
      mode: "desktop",
      scale: DEVICE_SCALE_DEFAULTS.desktop
    };
  }
  if (typeof value === "string") {
    const mode = normalizeDeviceMode(value);
    return {
      enabled: true,
      mode,
      scale: DEVICE_SCALE_DEFAULTS[mode]
    };
  }
  const mode = normalizeDeviceMode(value.mode);
  return {
    enabled: Boolean(value.enabled),
    mode,
    scale: normalizeDeviceScale(value.scale, mode)
  };
}

async function getDeviceEmulationState(tabId) {
  const key = `${DEVICE_MODE_PREFIX}${tabId}`;
  const result = await storageGet(chrome.storage.session, key);
  return normalizeDeviceEmulationState(result[key]);
}

function updateDeviceEmulationUi(state) {
  const normalized = normalizeDeviceEmulationState(state);
  currentDeviceMode = normalized.mode;
  currentDeviceScale = normalized.scale;
  currentDeviceEmulationEnabled = normalized.enabled;
  if (ui.deviceEmulationEnabled) {
    ui.deviceEmulationEnabled.checked = normalized.enabled;
  }
  if (ui.deviceModeDesktop) {
    ui.deviceModeDesktop.checked = normalized.mode === "desktop";
  }
  if (ui.deviceModeMobile) {
    ui.deviceModeMobile.checked = normalized.mode === "mobile";
  }
  if (ui.deviceScale) {
    ui.deviceScale.value = normalized.scale.toFixed(2);
  }
  if (ui.deviceScaleValue) {
    ui.deviceScaleValue.textContent = `${Math.round(normalized.scale * 100)}%`;
  }
  setDeviceModeInputsDisabled(!normalized.enabled);
}

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
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

function getOriginFromUrl(url) {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch (error) {
    return null;
  }
}

async function ensureConfig(baseUrl) {
  const configs = await getConfigs();
  if (!configs[baseUrl]) {
    const defaultConfig = createDefaultConfig(baseUrl);
    configs[baseUrl] = defaultConfig;
    await saveConfigs(configs);
    return defaultConfig;
  }
  const { config, changed } = normalizeConfig(baseUrl, configs[baseUrl]);
  if (changed) {
    configs[baseUrl] = config;
    await saveConfigs(configs);
  }
  return config;
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
  try {
    const tabs = await tabsQuery({ active: true, lastFocusedWindow: true });
    currentTab = tabs[0] || null;
  } catch (error) {
    currentTab = null;
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

function renderMarkedPages(listEl, items, emptyText, currentPageUrl, onNavigate) {
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
    count.textContent = item.count === 0 ? "No marks" : item.count === 1 ? "1 mark" : `${item.count} marks`;
    const button = document.createElement("button");
    button.textContent = "Navigate";
    const isCurrentPage = item.url === currentPageUrl;
    button.disabled = isCurrentPage;
    button.addEventListener("click", () => onNavigate(item.url));
    li.appendChild(title);
    li.appendChild(count);
    li.appendChild(button);
    listEl.appendChild(li);
  });
}

function renderPatternSelect(selectEl, options, selectedValue) {
  if (!selectEl) {
    return;
  }
  selectEl.textContent = "";
  if (!options.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No patterns available";
    selectEl.appendChild(option);
    selectEl.value = "";
    return;
  }
  options.forEach((optionItem) => {
    const option = document.createElement("option");
    option.value = optionItem.value;
    option.textContent = optionItem.label;
    option.title = optionItem.value;
    selectEl.appendChild(option);
  });
  selectEl.value = selectedValue || options[0].value;
  selectEl.title = selectedValue || options[0].value;
}

function arraysEqual(left, right) {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
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

function isHeadingXPath(value) {
  if (typeof value !== "string") {
    return false;
  }
  return /\/h[1-6]\[\d+\]\s*$/i.test(value);
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
  const patternDrafts = currentTab ? await getPagePatternDraft(currentTab.id) : {};
  let draftPattern =
    normalizePatternValue(
      (currentDraftEntry && currentDraftEntry.pagePattern) || ""
    ) || normalizePatternValue(patternDrafts[pageUrl] || "");
  ui.toggleEnabled.checked = Boolean(
    effectiveTabState.enabled &&
      effectiveTabState.baseUrl &&
      pageUrl &&
      pageUrl.startsWith(effectiveTabState.baseUrl)
  );
  const pagePatternOptions = baseUrlReady
    ? getPatternOptions(pageUrl, currentBaseUrl)
    : [];
  if (baseUrlReady && pageUrl) {
    const basePattern = normalizePatternValue(currentBaseUrl);
    const pagePattern = normalizePatternValue(pageUrl);
    if (basePattern && pagePattern && basePattern === pagePattern && !draftPattern) {
      await setPagePatternDraft(currentTab.id, pageUrl, basePattern);
      draftPattern = basePattern;
    }
  }
  const storedPatterns = collectPagePatterns(
    currentConfig ? currentConfig.pageMarkings : null
  );
  if (draftPattern && !storedPatterns.includes(draftPattern)) {
    storedPatterns.push(draftPattern);
  }
  const matchingPattern = findBestMatchingPattern(pageUrl, storedPatterns);
  const pagePatternReady = Boolean(matchingPattern);
  if (ui.toggleEnabled.checked && !pagePatternReady && currentTab && currentTab.id) {
    ui.toggleEnabled.checked = false;
    await setTabState(currentTab.id, { enabled: false, baseUrl: currentBaseUrl });
    await sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
  }
  const storedDeviceState = await getDeviceEmulationState(currentTab.id);
  updateDeviceEmulationUi(storedDeviceState);
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

  const isEnabled = ui.toggleEnabled.checked;
  currentDraftEntry = null;
  currentDraftDirty = false;
  currentDraftAvailable = false;
  currentDraftHasEntry = false;
  if (currentBaseUrl && isEnabled) {
    const draftStatus = await sendTabMessage({
      type: "getPageDraftStatus",
      baseUrl: currentBaseUrl
    });
    if (draftStatus && draftStatus.ok) {
      currentDraftEntry = draftStatus.entry || null;
      currentDraftDirty = Boolean(draftStatus.dirty);
      currentDraftAvailable = true;
      currentDraftHasEntry = Boolean(currentDraftEntry);
    }
  }
  ui.toggleEnabled.disabled = !baseUrlReady || !pagePatternReady;
  ui.computeButton.disabled = aiBusy || !aiReady;
  ui.saveExcludesButton.disabled = aiBusy || !aiReady || !hasNewSelectors;
  ui.previewLatestButton.disabled = aiBusy || !baseUrlReady || !hasStoredSelectors;
  ui.mainUi.hidden = !isEnabled;
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
  if (ui.pagePatternSelect && ui.pagePatternSet && ui.pagePatternNotice) {
    const patternUiDisabled =
      !baseUrlReady || !pageUrl || !isPageWithinBase(pageUrl, currentBaseUrl);
    renderPatternSelect(
      ui.pagePatternSelect,
      pagePatternOptions,
      draftPattern || matchingPattern || ""
    );
    ui.pagePatternSelect.disabled = patternUiDisabled || !pagePatternOptions.length;
    ui.pagePatternSet.disabled = patternUiDisabled || !pagePatternOptions.length;
    if (!baseUrlReady) {
      ui.pagePatternNotice.textContent = "Set Base Page URL first";
      ui.pagePatternNotice.style.display = "block";
    } else if (!pageUrl || !isPageWithinBase(pageUrl, currentBaseUrl)) {
      ui.pagePatternNotice.textContent = "Current page is outside the Base Page URL";
      ui.pagePatternNotice.style.display = "block";
    } else if (!pagePatternReady) {
      ui.pagePatternNotice.textContent =
        "Choose a URL pattern before enabling";
      ui.pagePatternNotice.style.display = "block";
    } else {
      ui.pagePatternNotice.style.display = "none";
    }
  }
  if (ui.pageSave && ui.pageRevert) {
    const draftButtonsDisabled =
      !baseUrlReady || !isEnabled || !currentDraftAvailable || !currentDraftDirty;
    ui.pageSave.disabled = draftButtonsDisabled;
    ui.pageRevert.disabled = draftButtonsDisabled;
  }
  if (ui.pageDelete) {
    ui.pageDelete.disabled =
      !baseUrlReady || !isEnabled || !currentDraftAvailable || !currentDraftHasEntry;
  }
  if (ui.pageDraftStatus) {
    if (!baseUrlReady) {
      ui.pageDraftStatus.textContent = "Set Base Page URL first";
    } else if (!isEnabled) {
      ui.pageDraftStatus.textContent = "Enable marking to edit this page";
    } else if (!currentDraftAvailable) {
      ui.pageDraftStatus.textContent = "Draft unavailable";
    } else if (currentDraftDirty) {
      ui.pageDraftStatus.textContent = "Unsaved changes";
    } else {
      ui.pageDraftStatus.textContent = "All changes saved";
    }
  }

  let headingDefaults = [];
  let headingXPathSet = new Set();
  if (currentBaseUrl) {
    const response = await sendTabMessage({
      type: "getHeadingDefaultStatus",
      baseUrl: currentBaseUrl
    });
    if (response && Array.isArray(response.items)) {
      headingDefaults = response.items;
      headingXPathSet = new Set(
        headingDefaults.map((item) => item.xpath).filter(Boolean)
      );
    }
  }

  const pageEntry =
    currentDraftEntry ||
    (currentConfig &&
      currentConfig.pageMarkings &&
      currentConfig.pageMarkings[pageUrl]);
  const explicitExclude = (pageEntry && pageEntry.xpaths) || [];
  const excludedXPaths = explicitExclude
    .filter(
      (item) =>
        item &&
        item.excluded &&
        item.xpath &&
        !headingXPathSet.has(item.xpath) &&
        !isHeadingXPath(item.xpath)
    )
    .map((item) => item.xpath);
  let pageExplicitExclude = excludedXPaths.map((xpath) => ({
    xpath,
    text: xpath
  }));
  if (currentBaseUrl) {
    const response = await sendTabMessage({
      type: "describeXPathsOnPage",
      xpaths: excludedXPaths
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
      const response = await sendTabMessage({
        type: "setExplicitExclude",
        baseUrl: currentBaseUrl,
        xpath: value,
        excluded: false
      });
      if (!response || !response.ok) {
        showToast("Unable to update exclude");
        return;
      }
      refreshUi();
    }
  );
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
  const mergedPageMarkings = { ...pageMarkings };
  if (currentDraftEntry && pageUrl) {
    mergedPageMarkings[pageUrl] = currentDraftEntry;
  }
  Object.entries(mergedPageMarkings).forEach(([url, entry]) => {
    if (!url || !entry || !Array.isArray(entry.xpaths)) {
      return;
    }
    if (currentBaseUrl && !url.startsWith(currentBaseUrl)) {
      return;
    }
    const excludedCount = entry.xpaths.filter(
      (item) =>
        item &&
        item.excluded &&
        item.xpath &&
        !isHeadingXPath(item.xpath)
    ).length;
    markedPages.push({
      url,
      title: entry.title || url,
      count: excludedCount
    });
  });
  markedPages.sort((a, b) => a.title.localeCompare(b.title));
  renderMarkedPages(
    ui.markedPages,
    markedPages,
    baseUrlSet ? "None yet" : "Set Base Page URL first",
    pageUrl,
    async (url) => {
      await loadActiveTab();
      if (!currentTab || !currentTab.id) {
        return;
      }
      chrome.tabs.update(currentTab.id, { url }, () => {
        void chrome.runtime.lastError;
      });
    }
  );
}

async function injectContentScriptIfNeeded() {
  if (!currentTab || !currentTab.id) {
    return { ok: false, error: "No active tab" };
  }
  const response = await sendRuntimeMessage({
    type: "injectContentScript",
    tabId: currentTab.id
  });
  return response || { ok: false, error: "Injection failed" };
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
      await refreshUi();
      return;
    }
    if (!currentTab.url.startsWith(baseUrlValue)) {
      showToast("Current page is outside the Base Page URL");
      ui.toggleEnabled.checked = false;
      await refreshUi();
      return;
    }
    currentConfig = await ensureConfig(baseUrlValue);
    const patternDrafts = await getPagePatternDraft(currentTab.id);
    const draftPattern = normalizePatternValue(patternDrafts[currentTab.url] || "");
    const storedPatterns = collectPagePatterns(currentConfig.pageMarkings || {});
    if (draftPattern && !storedPatterns.includes(draftPattern)) {
      storedPatterns.push(draftPattern);
    }
    const matchingPattern = findBestMatchingPattern(currentTab.url, storedPatterns);
    if (!matchingPattern) {
      showToast("Choose a URL pattern before enabling");
      ui.toggleEnabled.checked = false;
      await refreshUi();
      return;
    }
    // Inject content script first
    const injectResult = await injectContentScriptIfNeeded();
    if (!injectResult.ok) {
      showToast(injectResult.error || "Unable to activate on this page");
      ui.toggleEnabled.checked = false;
      await refreshUi();
      return;
    }
    await setTabState(currentTab.id, { enabled: true, baseUrl: baseUrlValue });
    await sendTabMessageWithRetry({
      type: "setEnabled",
      enabled: true,
      baseUrl: baseUrlValue,
      pagePattern: matchingPattern
    });
    await sendTabMessageWithRetry({ type: "forceRefresh" });
  } else {
    await setTabState(currentTab.id, { enabled: false, baseUrl: baseUrlValue });
    await sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
  }
  await refreshUi();
}

function getSelectedDeviceMode() {
  if (ui.deviceModeMobile && ui.deviceModeMobile.checked) {
    return "mobile";
  }
  return "desktop";
}

function setDeviceModeInputsDisabled(disabled) {
  if (ui.deviceModeDesktop) {
    ui.deviceModeDesktop.disabled = disabled;
  }
  if (ui.deviceModeMobile) {
    ui.deviceModeMobile.disabled = disabled;
  }
  if (ui.deviceScale) {
    ui.deviceScale.disabled = disabled;
  }
}

function getSelectedDeviceScale() {
  if (!ui.deviceScale) {
    return currentDeviceScale;
  }
  const parsed = Number.parseFloat(ui.deviceScale.value);
  return normalizeDeviceScale(parsed, getSelectedDeviceMode());
}

function setDeviceControlsDisabled(disabled) {
  if (ui.deviceEmulationEnabled) {
    ui.deviceEmulationEnabled.disabled = disabled;
  }
  setDeviceModeInputsDisabled(disabled || !currentDeviceEmulationEnabled);
}

async function handleDeviceEmulationEnabledToggle() {
  await loadActiveTab();
  if (!currentTab || !currentTab.id) {
    return;
  }
  const desiredEnabled = Boolean(ui.deviceEmulationEnabled.checked);
  if (desiredEnabled === currentDeviceEmulationEnabled) {
    return;
  }
  setDeviceControlsDisabled(true);
  const response = await sendRuntimeMessage({
    type: "updateDeviceEmulation",
    tabId: currentTab.id,
    enabled: desiredEnabled,
    mode: currentDeviceMode,
    scale: currentDeviceScale
  });
  setDeviceControlsDisabled(false);
  if (!response || !response.ok) {
    showToast((response && response.error) || "Device emulation failed");
    updateDeviceEmulationUi({
      enabled: currentDeviceEmulationEnabled,
      mode: currentDeviceMode,
      scale: currentDeviceScale
    });
    return;
  }
  updateDeviceEmulationUi(response.state);
}

async function handleDeviceModeToggle() {
  await loadActiveTab();
  if (!currentTab || !currentTab.id) {
    return;
  }
  if (!currentDeviceEmulationEnabled) {
    updateDeviceEmulationUi({
      enabled: currentDeviceEmulationEnabled,
      mode: currentDeviceMode,
      scale: currentDeviceScale
    });
    return;
  }
  const desiredMode = getSelectedDeviceMode();
  if (desiredMode === currentDeviceMode) {
    return;
  }
  setDeviceControlsDisabled(true);
  const response = await sendRuntimeMessage({
    type: "updateDeviceEmulation",
    tabId: currentTab.id,
    enabled: true,
    mode: desiredMode,
    scale: currentDeviceScale
  });
  setDeviceControlsDisabled(false);
  if (!response || !response.ok) {
    showToast((response && response.error) || "Device emulation failed");
    updateDeviceEmulationUi({
      enabled: currentDeviceEmulationEnabled,
      mode: currentDeviceMode,
      scale: currentDeviceScale
    });
    return;
  }
  updateDeviceEmulationUi(response.state);
}

function handleDeviceScaleInput() {
  const scale = getSelectedDeviceScale();
  if (ui.deviceScaleValue) {
    ui.deviceScaleValue.textContent = `${Math.round(scale * 100)}%`;
  }
}

async function handleDeviceScaleChange() {
  await loadActiveTab();
  if (!currentTab || !currentTab.id) {
    return;
  }
  if (!currentDeviceEmulationEnabled) {
    updateDeviceEmulationUi({
      enabled: currentDeviceEmulationEnabled,
      mode: currentDeviceMode,
      scale: currentDeviceScale
    });
    return;
  }
  const desiredScale = getSelectedDeviceScale();
  if (desiredScale === currentDeviceScale) {
    return;
  }
  setDeviceControlsDisabled(true);
  const response = await sendRuntimeMessage({
    type: "updateDeviceEmulation",
    tabId: currentTab.id,
    enabled: true,
    mode: currentDeviceMode,
    scale: desiredScale
  });
  setDeviceControlsDisabled(false);
  if (!response || !response.ok) {
    showToast((response && response.error) || "Device emulation failed");
    updateDeviceEmulationUi({
      enabled: currentDeviceEmulationEnabled,
      mode: currentDeviceMode,
      scale: currentDeviceScale
    });
    return;
  }
  updateDeviceEmulationUi(response.state);
}

function clearBrowsingDataForOrigin(origin) {
  return new Promise((resolve) => {
    chrome.browsingData.remove(
      { origins: [origin] },
      {
        cookies: true,
        cache: true,
        cacheStorage: true,
        localStorage: true
      },
      () => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message || "Unable to clear cache"
          });
          return;
        }
        resolve({ ok: true });
      }
    );
  });
}

function reloadTab(tabId) {
  return new Promise((resolve) => {
    if (!tabId) {
      resolve({ ok: false, error: "Missing tab" });
      return;
    }
    chrome.tabs.reload(tabId, () => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError.message || "Unable to reload tab"
        });
        return;
      }
      resolve({ ok: true });
    });
  });
}

async function handleClearDomainCache() {
  await loadActiveTab();
  if (!currentTab || !currentTab.url) {
    showToast("No active tab to clear");
    return;
  }
  const origin = getOriginFromUrl(currentTab.url);
  if (!origin) {
    showToast("Unsupported page for cache clearing");
    return;
  }
  let hostname = origin;
  try {
    hostname = new URL(currentTab.url).hostname;
  } catch (error) {
    hostname = origin;
  }
  const confirmed = window.confirm(
    `Clear cookies, local storage, and cached files for ${hostname}?`
  );
  if (!confirmed) {
    return;
  }
  setUiBusy(true);
  if (ui.clearDomainCache) {
    ui.clearDomainCache.disabled = true;
  }
  const result = await clearBrowsingDataForOrigin(origin);
  if (ui.clearDomainCache) {
    ui.clearDomainCache.disabled = false;
  }
  if (!result.ok) {
    setUiBusy(false);
    showToast(result.error || "Unable to clear cache");
    return;
  }
  showToast("Domain cache cleared");
  const reloadResult = await reloadTab(currentTab.id);
  setUiBusy(false);
  if (!reloadResult.ok) {
    showToast(reloadResult.error || "Unable to reload tab");
  }
}

function normalizeImportedConfig(baseUrl, incoming) {
  if (!incoming) {
    return createDefaultConfig(baseUrl);
  }
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
  // Inject content script first
  const injectResult = await injectContentScriptIfNeeded();
  if (!injectResult.ok) {
    showToast(injectResult.error || "Unable to activate on this page");
    return;
  }
  currentBaseUrl = baseUrlValue;
  currentConfig = await ensureConfig(baseUrlValue);
  const basePattern = normalizePatternValue(baseUrlValue);
  const pagePattern = normalizePatternValue(currentTab.url);
  let draftPattern = "";
  if (basePattern && pagePattern && basePattern === pagePattern) {
    draftPattern = pagePattern;
    await setPagePatternDraft(currentTab.id, currentTab.url, draftPattern);
    await sendTabMessage({
      type: "setPagePatternDraft",
      baseUrl: baseUrlValue,
      pagePattern: draftPattern
    });
  }
  const storedPatterns = collectPagePatterns(currentConfig.pageMarkings || {});
  if (draftPattern && !storedPatterns.includes(draftPattern)) {
    storedPatterns.push(draftPattern);
  }
  const matchingPattern = findBestMatchingPattern(currentTab.url, storedPatterns);
  baseUrlEditMode = false;
  if (matchingPattern) {
    await setTabState(currentTab.id, { enabled: true, baseUrl: baseUrlValue });
    await sendTabMessageWithRetry({
      type: "setEnabled",
      enabled: true,
      baseUrl: baseUrlValue,
      pagePattern: matchingPattern
    });
    await sendTabMessageWithRetry({ type: "forceRefresh" });
  } else {
    await setTabState(currentTab.id, { enabled: false, baseUrl: baseUrlValue });
    await sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
  }
  await refreshUi();
}

async function handlePagePatternSet() {
  await loadActiveTab();
  if (!currentTab || !currentTab.url) {
    return;
  }
  if (!currentBaseUrl) {
    showToast("Set Base Page URL first");
    return;
  }
  const selected = ui.pagePatternSelect ? ui.pagePatternSelect.value : "";
  if (!selected) {
    showToast("Choose a URL pattern");
    return;
  }
  if (!isPageWithinBase(selected, currentBaseUrl)) {
    showToast("Pattern must be within the Base Page URL");
    return;
  }
  await setPagePatternDraft(currentTab.id, currentTab.url, selected);
  const injectResult = await injectContentScriptIfNeeded();
  if (!injectResult.ok) {
    showToast(injectResult.error || "Unable to reach the page");
    return;
  }
  const response = await sendTabMessage({
    type: "setPagePatternDraft",
    baseUrl: currentBaseUrl,
    pagePattern: selected
  });
  if (!response || !response.ok) {
    showToast("Unable to set pattern");
    return;
  }
  showToast("Pattern saved in draft");
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
    // Inject content script first when re-enabling
    const injectResult = await injectContentScriptIfNeeded();
    if (!injectResult.ok) {
      showToast(injectResult.error || "Unable to activate on this page");
      baseUrlEditMode = true;
      await refreshUi();
      return;
    }
    currentConfig = await ensureConfig(currentBaseUrl);
    const patternDrafts = await getPagePatternDraft(currentTab.id);
    const draftPattern = normalizePatternValue(patternDrafts[currentTab.url] || "");
    const storedPatterns = collectPagePatterns(currentConfig.pageMarkings || {});
    if (draftPattern && !storedPatterns.includes(draftPattern)) {
      storedPatterns.push(draftPattern);
    }
    const matchingPattern = findBestMatchingPattern(currentTab.url, storedPatterns);
    if (matchingPattern) {
      await setTabState(currentTab.id, {
        enabled: true,
        baseUrl: currentBaseUrl
      });
      await sendTabMessageWithRetry({
        type: "setEnabled",
        enabled: true,
        baseUrl: currentBaseUrl,
        pagePattern: matchingPattern
      });
      await sendTabMessageWithRetry({ type: "forceRefresh" });
    } else {
      await setTabState(currentTab.id, {
        enabled: false,
        baseUrl: currentBaseUrl
      });
      await sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
    }
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
  if (currentTab && currentTab.id) {
    const tabState = await getTabState(currentTab.id);
    if (tabState && tabState.enabled) {
      await sendTabMessageWithRetry({ type: "forceRefresh" });
    }
  }
  await refreshUi();
}

async function handlePageSave() {
  await loadActiveTab();
  if (!currentTab) {
    return;
  }
  if (!currentBaseUrl) {
    showToast("Set Base Page URL first");
    return;
  }
  const response = await sendTabMessage({
    type: "savePageDraft",
    baseUrl: currentBaseUrl
  });
  if (!response || !response.ok) {
    showToast("Unable to save page");
    return;
  }
  showToast(response.saved ? "Page saved" : "No changes to save");
  if (response.saved) {
    await clearPagePatternDraft(currentTab.id, currentTab.url || "");
  }
  await refreshUi();
}

async function handlePageRevert() {
  await loadActiveTab();
  if (!currentTab) {
    return;
  }
  if (!currentBaseUrl) {
    showToast("Set Base Page URL first");
    return;
  }
  const confirmed = window.confirm(
    "Revert to the last saved version? Unsaved changes will be lost."
  );
  if (!confirmed) {
    return;
  }
  const response = await sendTabMessage({
    type: "revertPageDraft",
    baseUrl: currentBaseUrl
  });
  if (!response || !response.ok) {
    showToast("Unable to revert page");
    return;
  }
  showToast("Reverted to last saved");
  await clearPagePatternDraft(currentTab.id, currentTab.url || "");
  await refreshUi();
}

async function handlePageDelete() {
  await loadActiveTab();
  if (!currentTab) {
    return;
  }
  if (!currentBaseUrl) {
    showToast("Set Base Page URL first");
    return;
  }
  const confirmed = window.confirm(
    "Delete saved data for this page? This cannot be undone."
  );
  if (!confirmed) {
    return;
  }
  const response = await sendTabMessage({
    type: "deletePageEntry",
    baseUrl: currentBaseUrl
  });
  if (!response || !response.ok) {
    showToast("Unable to delete page data");
    return;
  }
  showToast("Page data deleted");
  await clearPagePatternDraft(currentTab.id, currentTab.url || "");
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

  currentConfig = await ensureConfig(currentBaseUrl);

  const pageMarkings = currentConfig.pageMarkings || {};
  const pages = Object.entries(pageMarkings)
    .map(([url, entry]) => {
      if (!url || !entry) {
        return null;
      }
      const fullHTML = entry.fullHTML || entry.fullHtml || entry.html || "";
      const xpaths = Array.isArray(entry.xpaths) ? entry.xpaths : [];
      const pattern = typeof entry.pagePattern === "string" ? entry.pagePattern : "";
      return {
        url,
        fullHTML,
        xpaths,
        pattern
      };
    })
    .filter((entry) => {
      if (!entry || !entry.url) {
        return false;
      }
      if (currentBaseUrl && !entry.url.startsWith(currentBaseUrl)) {
        return false;
      }
      return (
        Array.isArray(entry.xpaths) &&
        entry.xpaths.length > 0 &&
        entry.fullHTML
      );
    });

  if (!pages.length) {
    showToast("Mark pages before computing selectors");
    return;
  }

  const payload = {
    baseUrl: currentBaseUrl,
    pages
  };

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
        inclusionSelectors: selectors
      };
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
  const selectors = currentConfig.latestComputedSelectors || [];
  if (!selectors.length) {
    showToast("Compute selectors before saving");
    return;
  }
  if (arraysEqual(selectors, currentConfig.lastSavedSelectors || [])) {
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
  if (!currentBaseUrl || !currentConfig) {
    showToast("Set Base Page URL first");
    return;
  }
  const selectors = currentConfig.latestComputedSelectors || [];
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
  ui.deviceEmulationEnabled.addEventListener("change", handleDeviceEmulationEnabledToggle);
  ui.deviceModeDesktop.addEventListener("change", handleDeviceModeToggle);
  ui.deviceModeMobile.addEventListener("change", handleDeviceModeToggle);
  ui.deviceScale.addEventListener("input", handleDeviceScaleInput);
  ui.deviceScale.addEventListener("change", handleDeviceScaleChange);
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
  if (ui.clearDomainCache) {
    ui.clearDomainCache.addEventListener("click", handleClearDomainCache);
  }
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
  if (ui.pagePatternSet) {
    ui.pagePatternSet.addEventListener("click", handlePagePatternSet);
  }
  if (ui.pageSave) {
    ui.pageSave.addEventListener("click", handlePageSave);
  }
  if (ui.pageRevert) {
    ui.pageRevert.addEventListener("click", handlePageRevert);
  }
  if (ui.pageDelete) {
    ui.pageDelete.addEventListener("click", handlePageDelete);
  }
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
      (areaName === "session" &&
        currentTab &&
        (changes[`tabState:${currentTab.id}`] ||
          changes[`${DEVICE_MODE_PREFIX}${currentTab.id}`]))
    ) {
      scheduleRefresh();
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "pageDraftChanged") {
      return;
    }
    if (currentBaseUrl && message.baseUrl === currentBaseUrl) {
      scheduleRefresh();
    }
  });

  await refreshUi();
}

init();
