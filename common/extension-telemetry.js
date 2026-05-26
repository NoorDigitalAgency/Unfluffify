const DEFAULT_MAX_TEXT_LENGTH = 32768;
const TELEMETRY_MESSAGE_TYPE = "remoteSupportExtensionTelemetry";
const CONSOLE_LEVELS = ["log", "info", "warn", "error", "debug"];

function clampTelemetryText(value, maxLength = DEFAULT_MAX_TEXT_LENGTH) {
  let text = "";
  if (typeof value === "string") {
    text = value;
  } else if (value instanceof Error) {
    text = value.stack || value.message || String(value);
  } else {
    try {
      text = JSON.stringify(value);
    } catch (error) {
      text = String(value);
    }
  }

  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function formatConsoleMessage(args) {
  return Array.from(args || [])
    .map((item) => clampTelemetryText(item))
    .join(" ")
    .trim();
}

function getFetchUrl(input) {
  if (typeof input === "string") {
    return input;
  }
  if (input && typeof input.url === "string") {
    return input.url;
  }
  return "";
}

function getFetchMethod(input, init) {
  if (init && typeof init.method === "string" && init.method.trim()) {
    return init.method.trim().toUpperCase();
  }
  if (input && typeof input.method === "string" && input.method.trim()) {
    return input.method.trim().toUpperCase();
  }
  return "GET";
}


function headersToObject(headersLike) {
  const headers = {};
  if (!headersLike) {
    return headers;
  }
  try {
    if (typeof headersLike.forEach === "function") {
      headersLike.forEach((value, key) => {
        if (typeof key === "string") {
          headers[key] = clampTelemetryText(value, 4096);
        }
      });
      return headers;
    }
    if (Array.isArray(headersLike)) {
      for (const pair of headersLike) {
        if (Array.isArray(pair) && pair.length >= 2) {
          headers[String(pair[0])] = clampTelemetryText(pair[1], 4096);
        }
      }
      return headers;
    }
    if (typeof headersLike === "object") {
      for (const [key, value] of Object.entries(headersLike)) {
        headers[key] = clampTelemetryText(value, 4096);
      }
    }
  } catch (error) {
    return headers;
  }
  return headers;
}

function getFetchRequestHeaders(input, init) {
  if (init && init.headers) {
    return headersToObject(init.headers);
  }
  if (input && input.headers) {
    return headersToObject(input.headers);
  }
  return {};
}

function getFiniteTabId(value) {
  const tabId = Number(value);
  return Number.isFinite(tabId) ? Math.trunc(tabId) : null;
}

function shouldInstallTelemetry(options) {
  if (typeof options.isEnabled !== "function") {
    return true;
  }

  try {
    return Boolean(options.isEnabled());
  } catch (error) {
    return false;
  }
}

function shouldIncludePayloads(options) {
  if (typeof options.getIncludePayloads !== "function") {
    return false;
  }

  try {
    return Boolean(options.getIncludePayloads());
  } catch (error) {
    return false;
  }
}

function resolveTabId(options) {
  if (typeof options.getTabId !== "function") {
    return null;
  }

  try {
    return getFiniteTabId(options.getTabId());
  } catch (error) {
    return null;
  }
}

function postTelemetryMessage(options, channel, entry) {
  if (!shouldInstallTelemetry(options)) {
    return;
  }

  const tabId = resolveTabId(options);
  const message = {
    type: TELEMETRY_MESSAGE_TYPE,
    channel: channel === "network" ? "network" : "console",
    entry: {
      ...(entry && typeof entry === "object" ? entry : {}),
      source: typeof options.source === "string" && options.source.trim()
        ? options.source.trim()
        : "extension",
      timestamp: Date.now()
    }
  };

  if (tabId !== null) {
    message.tabId = tabId;
  }

  try {
    if (typeof options.sendTelemetry === "function") {
      Promise.resolve(options.sendTelemetry(message)).catch(() => {});
      return;
    }

    if (
      globalThis.chrome &&
      chrome.runtime &&
      typeof chrome.runtime.sendMessage === "function"
    ) {
      chrome.runtime.sendMessage(message).catch(() => {});
    }
  } catch (error) {
    // Ignore telemetry failures; instrumentation must never affect product behavior.
  }
}

function createPayloadFromFetch(options, requestBody, responseBody = "") {
  if (!shouldIncludePayloads(options)) {
    return null;
  }

  const request = typeof requestBody === "undefined" ? "" : clampTelemetryText(requestBody);
  const response = responseBody ? clampTelemetryText(responseBody) : "";
  return request || response ? { request, response } : null;
}

function installConsoleTelemetry(target, options) {
  const consoleObject = target.console;
  if (!consoleObject || consoleObject.__unfluffifyExtensionTelemetryInstalled) {
    return;
  }

  CONSOLE_LEVELS.forEach((level) => {
    const original = consoleObject[level];
    if (typeof original !== "function") {
      return;
    }

    consoleObject[level] = function(...args) {
      postTelemetryMessage(options, "console", {
        level,
        message: formatConsoleMessage(args)
      });
      return original.apply(this, args);
    };
  });

  consoleObject.__unfluffifyExtensionTelemetryInstalled = true;
}

function installFetchTelemetry(target, options) {
  const originalFetch = target.fetch;
  if (typeof originalFetch !== "function" || originalFetch.__unfluffifyExtensionTelemetryInstalled) {
    return;
  }

  const wrappedFetch = async function(...args) {
    const startedAt = Date.now();
    const input = args[0];
    const init = args[1] || {};
    const url = getFetchUrl(input);
    const method = getFetchMethod(input, init);
    const requestBody = init && Object.prototype.hasOwnProperty.call(init, "body")
      ? init.body
      : undefined;

    try {
      const response = await originalFetch.apply(this, args);
      let responseBody = "";
      if (shouldIncludePayloads(options) && response && typeof response.clone === "function") {
        try {
          responseBody = await response.clone().text();
        } catch (error) {
          responseBody = "";
        }
      }

      postTelemetryMessage(options, "network", {
        source: "fetch",
        type: "fetch",
        url,
        method,
        statusCode: Number(response && response.status) || 0,
        startedAt,
        completedAt: Date.now(),
        loadTimeMs: Math.max(0, Date.now() - startedAt),
        requestHeaders: getFetchRequestHeaders(input, init),
        responseHeaders: headersToObject(response && response.headers),
        payload: createPayloadFromFetch(options, requestBody, responseBody)
      });
      return response;
    } catch (error) {
      postTelemetryMessage(options, "network", {
        source: "fetch",
        type: "fetch",
        url,
        method,
        statusCode: 0,
        startedAt,
        completedAt: Date.now(),
        loadTimeMs: Math.max(0, Date.now() - startedAt),
        requestHeaders: getFetchRequestHeaders(input, init),
        responseHeaders: {},
        payload: null,
        error: clampTelemetryText(error && error.message ? error.message : error)
      });
      throw error;
    }
  };

  wrappedFetch.__unfluffifyExtensionTelemetryInstalled = true;
  target.fetch = wrappedFetch;
}


function parseRawResponseHeaders(rawHeaders) {
  const headers = {};
  if (typeof rawHeaders !== "string") {
    return headers;
  }
  for (const line of rawHeaders.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }
    headers[line.slice(0, separatorIndex).trim()] = clampTelemetryText(line.slice(separatorIndex + 1).trim(), 4096);
  }
  return headers;
}

function installXhrTelemetry(target, options) {
  const XhrConstructor = target.XMLHttpRequest;
  const prototype = XhrConstructor && XhrConstructor.prototype;
  if (!prototype || prototype.__unfluffifyExtensionTelemetryInstalled) {
    return;
  }

  const originalOpen = prototype.open;
  const originalSend = prototype.send;
  if (typeof originalOpen !== "function" || typeof originalSend !== "function") {
    return;
  }

  prototype.open = function(method, url, ...rest) {
    this.__unfluffifyExtensionTelemetryRequest = {
      method: String(method || "GET").toUpperCase(),
      url: String(url || ""),
      startedAt: 0,
      requestBody: undefined
    };
    return originalOpen.call(this, method, url, ...rest);
  };

  prototype.send = function(body) {
    const meta = this.__unfluffifyExtensionTelemetryRequest || {
      method: "GET",
      url: "",
      startedAt: 0,
      requestBody: undefined
    };
    meta.startedAt = Date.now();
    meta.requestBody = body;
    this.__unfluffifyExtensionTelemetryRequest = meta;
    this.addEventListener("loadend", () => {
      let responseBody = "";
      if (shouldIncludePayloads(options)) {
        try {
          responseBody = this.responseText || "";
        } catch (error) {
          responseBody = "";
        }
      }

      postTelemetryMessage(options, "network", {
        source: "xhr",
        type: "xhr",
        url: meta.url || "",
        method: meta.method || "GET",
        statusCode: Number(this.status) || 0,
        startedAt: meta.startedAt,
        completedAt: Date.now(),
        loadTimeMs: Math.max(0, Date.now() - (Number(meta.startedAt) || Date.now())),
        requestHeaders: {},
        responseHeaders: parseRawResponseHeaders(typeof this.getAllResponseHeaders === "function" ? this.getAllResponseHeaders() : ""),
        payload: createPayloadFromFetch(options, meta.requestBody, responseBody)
      });
    }, { once: true });
    return originalSend.call(this, body);
  };

  prototype.__unfluffifyExtensionTelemetryInstalled = true;
}

export function installExtensionTelemetry(options = {}) {
  const target = options.target || globalThis;
  if (!target || target.__unfluffifyExtensionTelemetryInstalled) {
    return;
  }

  installConsoleTelemetry(target, options);
  installFetchTelemetry(target, options);
  installXhrTelemetry(target, options);
  target.__unfluffifyExtensionTelemetryInstalled = true;
}