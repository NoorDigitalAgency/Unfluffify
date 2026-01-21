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

export function collectPagePatterns(config) {
  const patterns = [];
  if (!config || !config.pageMarkings || typeof config.pageMarkings !== "object") {
    return patterns;
  }
  Object.values(config.pageMarkings).forEach((entry) => {
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

export function isPageUrlAllowed(config, pageUrl, pendingPattern) {
  if (!config || !pageUrl) {
    return false;
  }
  const patterns = collectPagePatterns(config);
  const normalizedPending = normalizePatternValue(pendingPattern || "");
  if (normalizedPending && !patterns.includes(normalizedPending)) {
    patterns.push(normalizedPending);
  }
  if (!patterns.length) {
    return false;
  }
  return patterns.some((pattern) => isPageUrlMatchingPattern(pageUrl, pattern));
}
