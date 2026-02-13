import { looksLikeBaseUrl, idbGet, idbSet } from "./utilities.js";
import {
  DEFAULT_AI_SELECTOR_MODIFIERS,
  normalizeAiSelectorModifiers
} from "./ai-selector-modifiers.js";

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
    if (typeof item === "string") {
      const xpath = item.trim();
      if (!xpath) {
        changed = true;
        continue;
      }
      if (xpath !== item) {
        changed = true;
      }
      changed = true;
      parsed.push({ xpath, excluded: true });
      continue;
    }
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
    domainAiSelectorSet: { exclusionSelectors: [] },
    aiSelectorModifiers: { ...DEFAULT_AI_SELECTOR_MODIFIERS }
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
    const rawXpaths = Array.isArray(entry.xpaths) ? entry.xpaths : [];
    const normalizedXpaths = normalizeXpathItems(rawXpaths);
    const xpaths = normalizedXpaths.values;
    if (normalizedXpaths.changed) {
      changed = true;
    }
    if (entry.pagePattern || entry.pattern) {
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
    const rawConsent =
      Array.isArray(entry.consentXpaths)
        ? entry.consentXpaths
        : Array.isArray(entry.consentXPaths)
          ? entry.consentXPaths
          : [];
    if (entry.consentXPaths) {
      changed = true;
    }
    const consentResult = normalizeUniqueXpathList(rawConsent);
    const consentXpaths = consentResult.values;
    if (consentResult.changed) {
      changed = true;
    }
    const rawInclude =
      Array.isArray(entry.includeXpaths)
        ? entry.includeXpaths
        : Array.isArray(entry.explicitIncludeXpaths)
          ? entry.explicitIncludeXpaths
          : [];
    if (entry.explicitIncludeXpaths) {
      changed = true;
    }
    const includeResult = normalizeUniqueXpathList(rawInclude);
    const includeXpaths = includeResult.values;
    if (includeResult.changed) {
      changed = true;
    }
    if (entry.cssSelectors !== undefined || entry.pageCssSelectors !== undefined) {
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
  const normalized = { exclusionSelectors: [] };
  let changed = false;
  if (!value || typeof value !== "object") {
    return { normalized, changed };
  }
  if (Array.isArray(value.exclusionSelectors)) {
    normalized.exclusionSelectors = value.exclusionSelectors;
  } else if (Array.isArray(value.inclusionSelectors)) {
    normalized.exclusionSelectors = value.inclusionSelectors;
    changed = true;
  } else {
    changed = true;
  }
  return { normalized, changed };
}

function normalizeAiSelectorModifiersConfig(value, maxDescendantSelectors) {
  const normalized = normalizeAiSelectorModifiers(value, maxDescendantSelectors);
  if (!value || typeof value !== "object") {
    return { normalized, changed: true };
  }
  const rawRemoveIdSegments = "removeIdSegments" in value
    ? Boolean(value.removeIdSegments)
    : DEFAULT_AI_SELECTOR_MODIFIERS.removeIdSegments;
  const rawMaxDescendant = Number.parseInt(value.maxDescendantSelectors, 10);
  const resolvedRawMax = Number.isFinite(rawMaxDescendant)
    ? rawMaxDescendant
    : maxDescendantSelectors;
  const changed =
    !("removeIdSegments" in value) ||
    !("maxDescendantSelectors" in value) ||
    rawRemoveIdSegments !== normalized.removeIdSegments ||
    resolvedRawMax !== normalized.maxDescendantSelectors;
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
  if (incoming.pageCssSelectors !== undefined) {
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
  const rawAiSelectorModifiers =
    incoming.aiSelectorModifiers !== undefined
      ? incoming.aiSelectorModifiers
      : incoming.aiSelectorModifierSettings;
  if (incoming.aiSelectorModifierSettings !== undefined) {
    changed = true;
  }
  const aiSelectorModifiers = normalizeAiSelectorModifiersConfig(
    rawAiSelectorModifiers,
    Number.MAX_SAFE_INTEGER
  );
  normalized.aiSelectorModifiers = aiSelectorModifiers.normalized;
  if (aiSelectorModifiers.changed) {
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
