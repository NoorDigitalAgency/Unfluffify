function getPathSegments(pathname) {
  if (!pathname) {
    return [];
  }
  return pathname.split("/").filter(Boolean);
}

export function normalizePatternValue(value) {
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

export function isPageUrlMatchingPattern(pageUrl, pattern) {
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

export function findBestMatchingPattern(pageUrl, patterns) {
  if (!pageUrl || !Array.isArray(patterns)) {
    return "";
  }
  const matches = patterns
    .map((pattern) => normalizePatternValue(pattern))
    .filter((pattern) => isPageUrlMatchingPattern(pageUrl, pattern))
    .sort((left, right) => right.length - left.length);
  return matches[0] || "";
}

export function isPageWithinBase(pageUrl, baseUrl) {
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

export function collectPagePatterns(pageMarkings) {
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

export function getPatternOptions(pageUrl, baseUrl) {
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

export function isPageUrlAllowed(config, pageUrl, pendingPattern) {
  if (!config || !pageUrl) {
    return false;
  }
  const pageMarkings = config.pageMarkings || config;
  const patterns = collectPagePatterns(pageMarkings);
  const normalizedPending = normalizePatternValue(pendingPattern || "");
  if (normalizedPending && !patterns.includes(normalizedPending)) {
    patterns.push(normalizedPending);
  }
  if (!patterns.length) {
    return false;
  }
  return patterns.some((pattern) => isPageUrlMatchingPattern(pageUrl, pattern));
}
