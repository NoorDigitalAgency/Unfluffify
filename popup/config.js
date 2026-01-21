import { storageGet, storageSet } from "./storage.js";
import { looksLikeBaseUrl } from "./utils.js";
import { normalizePatternValue } from "./patterns.js";

export function createDefaultConfig(baseUrl) {
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
    let resolvedPattern = pagePattern;
    if (!resolvedPattern) {
      const fallbackUrl = typeof entry.url === "string" ? entry.url : url;
      const fallbackPattern = normalizePatternValue(fallbackUrl);
      if (fallbackPattern) {
        resolvedPattern = fallbackPattern;
        changed = true;
      }
    }
    if (entry.pattern) {
      changed = true;
    }
    if (rawPattern && rawPattern !== pagePattern) {
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
      pagePattern: resolvedPattern,
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

export function normalizeConfig(baseUrl, incoming) {
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

export async function getConfigs() {
  const result = await storageGet(chrome.storage.local, "configs");
  return result.configs || {};
}

export async function saveConfigs(configs) {
  await storageSet(chrome.storage.local, { configs });
}

export async function ensureConfig(baseUrl) {
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

export async function updateConfig(baseUrl, updater) {
  const configs = await getConfigs();
  const { config } = normalizeConfig(baseUrl, configs[baseUrl]);
  updater(config);
  configs[baseUrl] = config;
  await saveConfigs(configs);
  return config;
}

export function normalizeImportedConfig(baseUrl, incoming) {
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

export function extractIncomingConfigs(parsed) {
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
