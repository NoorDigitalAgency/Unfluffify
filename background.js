const STORAGE_KEY = "markcontit";
const SESSION_KEY = "markcontitEnabledTabs";

function nowTs() {
  return Date.now();
}

function getStorageArea() {
  return chrome.storage.local;
}

function getSessionArea() {
  return chrome.storage.session || chrome.storage.local;
}

async function getLocalData() {
  const result = await getStorageArea().get(STORAGE_KEY);
  if (!result[STORAGE_KEY]) {
    return { configs: {}, activeBaseUrlByDomain: {} };
  }
  return result[STORAGE_KEY];
}

async function setLocalData(data) {
  await getStorageArea().set({ [STORAGE_KEY]: data });
}

async function getEnabledTabs() {
  const result = await getSessionArea().get(SESSION_KEY);
  return result[SESSION_KEY] || {};
}

async function setEnabledTabs(enabledTabs) {
  await getSessionArea().set({ [SESSION_KEY]: enabledTabs });
}

function safeUrl(input, baseUrl) {
  try {
    return new URL(input);
  } catch (err) {
    if (!baseUrl) return null;
    try {
      return new URL(input, baseUrl);
    } catch (nested) {
      return null;
    }
  }
}

function normalizeBaseUrl(input, fallbackUrl) {
  const candidate = safeUrl(input, fallbackUrl);
  if (!candidate) return null;
  candidate.hash = "";
  candidate.search = "";
  if (!candidate.pathname.endsWith("/")) {
    const last = candidate.pathname.split("/").pop();
    if (last && !last.includes(".")) {
      candidate.pathname += "/";
    }
  }
  return candidate.toString();
}

function buildConfig(baseUrl) {
  const parsed = new URL(baseUrl);
  return {
    baseUrl,
    domain: parsed.hostname,
    includeSelectors: [],
    excludeSelectors: [],
    createdAt: nowTs()
  };
}

function getDomainFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch (err) {
    return "";
  }
}

function selectConfigForUrl(data, url) {
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    return null;
  }
  const domain = parsed.hostname;
  const activeBaseUrl = data.activeBaseUrlByDomain[domain];
  if (activeBaseUrl) {
    const config = data.configs[activeBaseUrl] || null;
    return config;
  }
  let best = null;
  let bestLen = 0;
  for (const baseUrl of Object.keys(data.configs)) {
    const config = data.configs[baseUrl];
    if (!config || config.domain !== domain) continue;
    if (url.startsWith(baseUrl) && baseUrl.length > bestLen) {
      best = config;
      bestLen = baseUrl.length;
    }
  }
  return best;
}

async function ensureConfig(baseUrl, currentUrl) {
  const normalized = normalizeBaseUrl(baseUrl, currentUrl);
  if (!normalized) {
    return { error: "Invalid base URL." };
  }
  const data = await getLocalData();
  let config = data.configs[normalized];
  if (!config) {
    config = buildConfig(normalized);
    data.configs[normalized] = config;
  }
  data.activeBaseUrlByDomain[config.domain] = normalized;
  await setLocalData(data);
  return { config };
}

async function addSelectorRecord(baseUrl, record) {
  const data = await getLocalData();
  const config = data.configs[baseUrl];
  if (!config) return { error: "No configuration found for base URL." };
  if (record.category === "include") {
    config.includeSelectors.push(record);
  } else {
    config.excludeSelectors.push(record);
  }
  await setLocalData(data);
  return { config };
}

async function removeSelectorRecord(baseUrl, selectorId, category) {
  const data = await getLocalData();
  const config = data.configs[baseUrl];
  if (!config) return { error: "No configuration found for base URL." };
  if (category === "include") {
    config.includeSelectors = config.includeSelectors.filter((item) => item.id !== selectorId);
  } else {
    config.excludeSelectors = config.excludeSelectors.filter((item) => item.id !== selectorId);
  }
  await setLocalData(data);
  return { config };
}

async function notifyTabsForBaseUrl(baseUrl, config) {
  const enabledTabs = await getEnabledTabs();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab || !tab.id || !tab.url) continue;
    if (!enabledTabs[tab.id]) continue;
    if (tab.url.startsWith(baseUrl)) {
      chrome.tabs.sendMessage(tab.id, { type: "configUpdated", config });
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handle = async () => {
    switch (message.type) {
      case "getState": {
        const data = await getLocalData();
        const enabledTabs = await getEnabledTabs();
        const config = selectConfigForUrl(data, message.url);
        return {
          enabled: !!enabledTabs[message.tabId],
          config
        };
      }
      case "getStateForContent": {
        const data = await getLocalData();
        const enabledTabs = await getEnabledTabs();
        const tabId = sender.tab ? sender.tab.id : null;
        const config = selectConfigForUrl(data, message.url);
        return {
          enabled: tabId ? !!enabledTabs[tabId] : false,
          config
        };
      }
      case "setEnabled": {
        const enabledTabs = await getEnabledTabs();
        if (message.enabled) {
          enabledTabs[message.tabId] = true;
        } else {
          delete enabledTabs[message.tabId];
        }
        await setEnabledTabs(enabledTabs);
        const data = await getLocalData();
        const config = selectConfigForUrl(data, message.url);
        if (message.tabId) {
          chrome.tabs.sendMessage(message.tabId, {
            type: "setEnabled",
            enabled: message.enabled,
            config
          });
        }
        return { enabled: message.enabled, config };
      }
      case "setBaseUrl": {
        const result = await ensureConfig(message.baseUrl, message.url);
        if (result.error) return { error: result.error };
        if (message.tabId) {
          chrome.tabs.sendMessage(message.tabId, {
            type: "configUpdated",
            config: result.config
          });
        }
        await notifyTabsForBaseUrl(result.config.baseUrl, result.config);
        return { config: result.config };
      }
      case "addSelector": {
        const record = {
          id: crypto.randomUUID ? crypto.randomUUID() : String(nowTs()) + Math.random().toString(16).slice(2),
          category: message.category,
          selector: message.selector,
          createdFromUrl: message.createdFromUrl,
          createdAt: nowTs(),
          note: ""
        };
        const result = await addSelectorRecord(message.baseUrl, record);
        if (result.error) return { error: result.error };
        await notifyTabsForBaseUrl(message.baseUrl, result.config);
        return { config: result.config, record };
      }
      case "removeSelector": {
        const result = await removeSelectorRecord(message.baseUrl, message.selectorId, message.category);
        if (result.error) return { error: result.error };
        await notifyTabsForBaseUrl(message.baseUrl, result.config);
        return { config: result.config };
      }
      case "openCreatedUrl": {
        if (message.url) {
          chrome.tabs.create({ url: message.url });
        }
        return { ok: true };
      }
      default:
        return { error: "Unknown message." };
    }
  };

  handle()
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ error: error.message }));

  return true;
});
