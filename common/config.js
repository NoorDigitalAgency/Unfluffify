import { looksLikeBaseUrl, idbGet, idbSet } from "./utilities.js";

function normalizeUniqueXpathList(list) {
  const values = [];
  const seen = new Set();
  let changed = false;
  for (const value of Array.isArray(list) ? list : []) {
    if (typeof value !== "string") {
      changed = true;
      continue;
    }
    const xpath = value.trim();
    if (!xpath) {
      changed = true;
      continue;
    }
    if (xpath !== value) {
      changed = true;
    }
    if (seen.has(xpath)) {
      changed = true;
      continue;
    }
    seen.add(xpath);
    values.push(xpath);
  }
  return { values, changed };
}

function normalizeXpathItems(rawXpaths) {
  const parsed = [];
  let changed = false;
  for (const item of Array.isArray(rawXpaths) ? rawXpaths : []) {
    if (item && typeof item.xpath === "string") {
      const xpath = item.xpath.trim();
      if (!xpath) {
        changed = true;
        continue;
      }
      const excluded = Boolean(item.excluded);
      if (xpath !== item.xpath || item.excluded !== excluded) {
        changed = true;
      }
      parsed.push({ xpath, excluded });
      continue;
    }
    changed = true;
  }
  const seen = new Set();
  const values = [];
  for (let i = parsed.length - 1; i >= 0; i -= 1) {
    const item = parsed[i];
    if (seen.has(item.xpath)) {
      changed = true;
      continue;
    }
    seen.add(item.xpath);
    values.unshift(item);
  }
  return { values, changed };
}

function normalizeSelectorList(list) {
  const values = [];
  const seen = new Set();
  let changed = false;
  if (!Array.isArray(list)) {
    return { values, changed: true };
  }
  for (const value of list) {
    if (typeof value !== "string") {
      changed = true;
      continue;
    }
    const selector = value.trim();
    if (!selector) {
      changed = true;
      continue;
    }
    if (selector !== value) {
      changed = true;
    }
    if (seen.has(selector)) {
      changed = true;
      continue;
    }
    seen.add(selector);
    values.push(selector);
  }
  return { values, changed };
}

export function createEmptyAiSelectorSet() {
  return { exclusionSelectors: [], inclusionSelectors: [] };
}

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
    latestComputedSelectors: createEmptyAiSelectorSet(),
    lastSavedSelectors: createEmptyAiSelectorSet(),
    domainAiSelectorSet: createEmptyAiSelectorSet()
  };
}

export function normalizePageMarkings(pageMarkings) {
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
    if (!Array.isArray(entry.xpaths) && entry.xpaths !== undefined) {
      changed = true;
    }
    const rawXpaths = Array.isArray(entry.xpaths) ? entry.xpaths : [];
    const normalizedXpaths = normalizeXpathItems(rawXpaths);
    const xpaths = normalizedXpaths.values;
    if (normalizedXpaths.changed) {
      changed = true;
    }
    const fullHTML = typeof entry.fullHTML === "string" ? entry.fullHTML : "";
    if (entry.fullHTML !== undefined && typeof entry.fullHTML !== "string") {
      changed = true;
    }
    if (!Array.isArray(entry.consentXpaths) && entry.consentXpaths !== undefined) {
      changed = true;
    }
    const rawConsent = Array.isArray(entry.consentXpaths) ? entry.consentXpaths : [];
    const consentResult = normalizeUniqueXpathList(rawConsent);
    const consentXpaths = consentResult.values;
    if (consentResult.changed) {
      changed = true;
    }
    if (!Array.isArray(entry.includeXpaths) && entry.includeXpaths !== undefined) {
      changed = true;
    }
    const rawInclude = Array.isArray(entry.includeXpaths) ? entry.includeXpaths : [];
    const includeResult = normalizeUniqueXpathList(rawInclude);
    const includeXpaths = includeResult.values;
    if (includeResult.changed) {
      changed = true;
    }
    normalized[url] = {
      url: entry.url || url,
      title: entry.title || url,
      xpaths,
      consentXpaths,
      includeXpaths,
      fullHTML
    };
  });
  return { normalized, changed };
}

export function normalizeAiSelectorSet(value) {
  const normalized = createEmptyAiSelectorSet();
  let changed = true;
  if (!value || typeof value !== "object") {
    return { normalized, changed };
  }
  changed = false;

  const exclusionResult = normalizeSelectorList(value.exclusionSelectors);
  normalized.exclusionSelectors = exclusionResult.values;
  if (exclusionResult.changed) {
    changed = true;
  }

  const inclusionResult = normalizeSelectorList(value.inclusionSelectors);
  normalized.inclusionSelectors = inclusionResult.values;
  if (inclusionResult.changed) {
    changed = true;
  }

  if (!Array.isArray(value.exclusionSelectors) || !Array.isArray(value.inclusionSelectors)) {
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
  const latestComputed = normalizeAiSelectorSet(incoming.latestComputedSelectors);
  normalized.latestComputedSelectors = latestComputed.normalized;
  if (latestComputed.changed) {
    changed = true;
  }
  const lastSaved = normalizeAiSelectorSet(incoming.lastSavedSelectors);
  normalized.lastSavedSelectors = lastSaved.normalized;
  if (lastSaved.changed) {
    changed = true;
  }
  const aiSelectors = normalizeAiSelectorSet(incoming.domainAiSelectorSet);
  normalized.domainAiSelectorSet = aiSelectors.normalized;
  if (aiSelectors.changed) {
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(incoming, "aiSelectorModifiers")) {
    changed = true;
  }

  return { config: normalized, changed };
}

export async function getConfigs() {
  const result = await idbGet("configs");
  return result.configs || {};
}

export async function saveConfigs(configs) {
  await idbSet({ configs });
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
  let globalConfigEndpoint = "";
  let globalLoginEndpoint = "";

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      incomingConfigs,
      includeGlobals,
      globalToken,
      globalEndpoint,
      globalConfigEndpoint,
      globalLoginEndpoint
    };
  }

  if (parsed.configs && typeof parsed.configs === "object") {
    Object.assign(incomingConfigs, parsed.configs);
    includeGlobals = parsed.scope === "all";
    globalToken = parsed.globalToken || "";
    globalEndpoint = parsed.globalEndpoint || "";
    globalConfigEndpoint = parsed.globalConfigEndpoint || "";
    globalLoginEndpoint = parsed.globalLoginEndpoint || "";
    if (
      !includeGlobals &&
      ("globalToken" in parsed ||
        "globalEndpoint" in parsed ||
        "globalConfigEndpoint" in parsed ||
        "globalLoginEndpoint" in parsed)
    ) {
      includeGlobals = true;
    }
    return {
      incomingConfigs,
      includeGlobals,
      globalToken,
      globalEndpoint,
      globalConfigEndpoint,
      globalLoginEndpoint
    };
  }

  if (parsed.baseUrl && looksLikeBaseUrl(parsed.baseUrl)) {
    const config =
      parsed.config && typeof parsed.config === "object" ? parsed.config : parsed;
    incomingConfigs[parsed.baseUrl] = config;
    return {
      incomingConfigs,
      includeGlobals,
      globalToken,
      globalEndpoint,
      globalConfigEndpoint,
      globalLoginEndpoint
    };
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

  return {
    incomingConfigs,
    includeGlobals,
    globalToken,
    globalEndpoint,
    globalConfigEndpoint,
    globalLoginEndpoint
  };
}
