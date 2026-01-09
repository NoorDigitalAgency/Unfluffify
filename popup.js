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
  baseUrlInput: document.getElementById("base-url"),
  tokenInput: document.getElementById("token"),
  showDefault: document.getElementById("show-default"),
  computeButton: document.getElementById("compute"),
  exportButton: document.getElementById("export"),
  explicitIncludes: document.getElementById("explicit-includes"),
  explicitExcludes: document.getElementById("explicit-excludes"),
  aiIncludes: document.getElementById("ai-includes"),
  aiExcludes: document.getElementById("ai-excludes"),
  toast: document.getElementById("toast")
};

let currentTab = null;
let currentBaseUrl = "";
let currentConfig = null;
let toastTimer = 0;

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
    domainAiSelectorSet: { inclusionSelectors: [], exclusionSelectors: [] }
  };
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
  if (!configs[baseUrl]) {
    configs[baseUrl] = createDefaultConfig(baseUrl);
    await saveConfigs(configs);
  }
  return configs[baseUrl];
}

async function updateConfig(baseUrl, updater) {
  const configs = await getConfigs();
  const config = configs[baseUrl] || createDefaultConfig(baseUrl);
  updater(config);
  configs[baseUrl] = config;
  await saveConfigs(configs);
  return config;
}

async function sendTabMessage(message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(currentTab.id, message, (response) => {
      resolve(response);
    });
  });
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

async function refreshUi() {
  if (!currentTab) {
    return;
  }
  const configs = await getConfigs();
  const tabState = await getTabState(currentTab.id);
  const fallbackBaseUrl = findMatchingBaseUrl(currentTab.url, configs);
  currentBaseUrl = tabState.baseUrl || fallbackBaseUrl || "";
  if (currentBaseUrl && !configs[currentBaseUrl]) {
    configs[currentBaseUrl] = createDefaultConfig(currentBaseUrl);
    await saveConfigs(configs);
  }
  currentConfig = currentBaseUrl ? configs[currentBaseUrl] : null;

  ui.baseUrlInput.value = currentBaseUrl;
  ui.toggleEnabled.checked = Boolean(
    tabState.enabled &&
      tabState.baseUrl &&
      currentTab.url &&
      currentTab.url.startsWith(tabState.baseUrl)
  );

  if (currentConfig) {
    ui.showDefault.checked = Boolean(currentConfig.showDefaultHighlights);
  } else {
    ui.showDefault.checked = false;
  }

  const tokenResult = await storageGet(chrome.storage.sync, "globalToken");
  ui.tokenInput.value = tokenResult.globalToken || "";

  const explicitInclude =
    (currentConfig && currentConfig.explicitXPathDecisions.include) || [];
  const explicitExclude =
    (currentConfig && currentConfig.explicitXPathDecisions.exclude) || [];
  const aiInclude =
    (currentConfig && currentConfig.domainAiSelectorSet.inclusionSelectors) || [];
  const aiExclude =
    (currentConfig && currentConfig.domainAiSelectorSet.exclusionSelectors) || [];

  renderList(
    ui.explicitIncludes,
    explicitInclude,
    "None yet",
    async (value) => {
      if (!currentBaseUrl) {
        return;
      }
      currentConfig = await updateConfig(currentBaseUrl, (config) => {
        config.explicitXPathDecisions.include =
          config.explicitXPathDecisions.include.filter((item) => item !== value);
      });
      await sendTabMessage({ type: "configUpdated", baseUrl: currentBaseUrl });
      refreshUi();
    }
  );

  renderList(
    ui.explicitExcludes,
    explicitExclude,
    "None yet",
    async (value) => {
      if (!currentBaseUrl) {
        return;
      }
      currentConfig = await updateConfig(currentBaseUrl, (config) => {
        config.explicitXPathDecisions.exclude =
          config.explicitXPathDecisions.exclude.filter((item) => item !== value);
      });
      await sendTabMessage({ type: "configUpdated", baseUrl: currentBaseUrl });
      refreshUi();
    }
  );

  renderList(ui.aiIncludes, aiInclude, "None yet", async (value) => {
    if (!currentBaseUrl) {
      return;
    }
    currentConfig = await updateConfig(currentBaseUrl, (config) => {
      config.domainAiSelectorSet.inclusionSelectors =
        config.domainAiSelectorSet.inclusionSelectors.filter(
          (item) => item !== value
        );
    });
    await sendTabMessage({ type: "configUpdated", baseUrl: currentBaseUrl });
    refreshUi();
  });

  renderList(ui.aiExcludes, aiExclude, "None yet", async (value) => {
    if (!currentBaseUrl) {
      return;
    }
    currentConfig = await updateConfig(currentBaseUrl, (config) => {
      config.domainAiSelectorSet.exclusionSelectors =
        config.domainAiSelectorSet.exclusionSelectors.filter(
          (item) => item !== value
        );
    });
    await sendTabMessage({ type: "configUpdated", baseUrl: currentBaseUrl });
    refreshUi();
  });
}

async function handleEnableToggle() {
  if (!currentTab) {
    return;
  }
  const enabled = ui.toggleEnabled.checked;
  const baseUrlValue = ui.baseUrlInput.value.trim();
  if (enabled) {
    const parsed = parseBaseUrl(baseUrlValue);
    if (!parsed) {
      showToast("Enter a valid base URL scope");
      ui.toggleEnabled.checked = false;
      return;
    }
    if (!currentTab.url.startsWith(baseUrlValue)) {
      showToast("Current page is outside the base URL scope");
      ui.toggleEnabled.checked = false;
      return;
    }
    await ensureConfig(baseUrlValue);
    await setTabState(currentTab.id, { enabled: true, baseUrl: baseUrlValue });
    await sendTabMessage({
      type: "setEnabled",
      enabled: true,
      baseUrl: baseUrlValue
    });
  } else {
    await setTabState(currentTab.id, { enabled: false, baseUrl: baseUrlValue });
    await sendTabMessage({ type: "setEnabled", enabled: false });
  }
  await refreshUi();
}

async function handleBaseUrlBlur() {
  if (!currentTab) {
    return;
  }
  const baseUrlValue = ui.baseUrlInput.value.trim();
  if (!baseUrlValue) {
    if (ui.toggleEnabled.checked) {
      await setTabState(currentTab.id, { enabled: false, baseUrl: "" });
      await sendTabMessage({ type: "setEnabled", enabled: false });
    }
    currentBaseUrl = "";
    currentConfig = null;
    await refreshUi();
    return;
  }
  const parsed = parseBaseUrl(baseUrlValue);
  if (!parsed) {
    showToast("Enter a valid base URL scope");
    return;
  }

  currentConfig = await ensureConfig(baseUrlValue);
  currentBaseUrl = baseUrlValue;

  if (ui.toggleEnabled.checked) {
    if (!currentTab.url.startsWith(baseUrlValue)) {
      showToast("Current page is outside the base URL scope");
      ui.toggleEnabled.checked = false;
      await setTabState(currentTab.id, { enabled: false, baseUrl: baseUrlValue });
      await sendTabMessage({ type: "setEnabled", enabled: false });
      return;
    }
    await setTabState(currentTab.id, { enabled: true, baseUrl: baseUrlValue });
    await sendTabMessage({
      type: "setEnabled",
      enabled: true,
      baseUrl: baseUrlValue
    });
  }
  await refreshUi();
}

async function handleTokenBlur() {
  const token = ui.tokenInput.value.trim();
  await storageSet(chrome.storage.sync, { globalToken: token });
  showToast("Token saved");
}

async function handleShowDefaultToggle() {
  if (!currentBaseUrl) {
    showToast("Set a base URL scope first");
    ui.showDefault.checked = false;
    return;
  }
  currentConfig = await updateConfig(currentBaseUrl, (config) => {
    config.showDefaultHighlights = ui.showDefault.checked;
  });
  await sendTabMessage({ type: "configUpdated", baseUrl: currentBaseUrl });
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
  if (!currentTab) {
    return;
  }
  const baseUrlValue = ui.baseUrlInput.value.trim();
  if (!baseUrlValue) {
    showToast("Set a base URL scope first");
    return;
  }
  const parsed = parseBaseUrl(baseUrlValue);
  if (!parsed) {
    showToast("Enter a valid base URL scope");
    return;
  }

  const payload = await sendTabMessage({
    type: "collectPageData",
    baseUrl: baseUrlValue
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

  currentConfig = await updateConfig(baseUrlValue, (config) => {
    config.domainAiSelectorSet = {
      inclusionSelectors: selectorSet.inclusionSelectors || [],
      exclusionSelectors: selectorSet.exclusionSelectors || []
    };
  });

  await sendTabMessage({ type: "configUpdated", baseUrl: baseUrlValue });
  showToast("Selectors updated");
  refreshUi();
}

async function handleExportJson() {
  if (!currentBaseUrl || !currentConfig) {
    showToast("Set a base URL scope first");
    return;
  }

  const defaultExclusions = HARD_EXCLUDED_TAGS.concat(HARD_EXCLUDED_SELECTORS);
  const payload = {
    baseUrl: currentConfig.baseUrl || "",
    domain: currentConfig.domain || "",
    defaultExclusions: defaultExclusions.join("\n"),
    xpathsInclude: (currentConfig.explicitXPathDecisions.include || []).join("\n"),
    xpathsExclude: (currentConfig.explicitXPathDecisions.exclude || []).join("\n"),
    aiInclusions: (currentConfig.domainAiSelectorSet.inclusionSelectors || []).join(
      "\n"
    ),
    aiExclusions: (currentConfig.domainAiSelectorSet.exclusionSelectors || []).join(
      "\n"
    )
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

async function init() {
  const tabs = await tabsQuery({ active: true, currentWindow: true });
  currentTab = tabs[0] || null;

  ui.toggleEnabled.addEventListener("change", handleEnableToggle);
  ui.baseUrlInput.addEventListener("blur", handleBaseUrlBlur);
  ui.baseUrlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      ui.baseUrlInput.blur();
    }
  });
  ui.tokenInput.addEventListener("blur", handleTokenBlur);
  ui.showDefault.addEventListener("change", handleShowDefaultToggle);
  ui.computeButton.addEventListener("click", handleComputeSelectors);
  ui.exportButton.addEventListener("click", handleExportJson);

  await refreshUi();
}

init();
