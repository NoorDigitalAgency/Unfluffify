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

function clampUrl(url, maxLength = 2048) {
  const urlString = String(url || "");
  return urlString.length > maxLength ? urlString.slice(0, maxLength) : urlString;
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


function countHeaders(headersLike) {
  if (!headersLike) {
    return 0;
  }
  try {
    if (Array.isArray(headersLike)) {
      let count = 0;
      for (const pair of headersLike) {
        if (Array.isArray(pair) && pair.length >= 2) {
          count++;
        }
      }
      return count;
    }
    if (typeof headersLike.forEach === "function") {
      let count = 0;
      headersLike.forEach((value, key) => {
        if (typeof key === "string") {
          count++;
        }
      });
      return count;
    }
    if (typeof headersLike === "object") {
      return Object.keys(headersLike).length;
    }
  } catch (error) {
    return 0;
  }
  return 0;
}

function getFetchRequestHeaderCount(input, init) {
  if (init && init.headers) {
    return countHeaders(init.headers);
  }
  if (input && input.headers) {
    return countHeaders(input.headers);
  }
  return 0;
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

function sendRuntimeTelemetryMessage(message) {
  if (
    !globalThis.chrome ||
    !chrome.runtime ||
    typeof chrome.runtime.sendMessage !== "function"
  ) {
    return;
  }

  const result = chrome.runtime.sendMessage(message);
  Promise.resolve(result).catch(() => {});
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

    sendRuntimeTelemetryMessage(message);
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

  const wrappedFetch = function(...args) {
    const startedAt = Date.now();
    const input = args[0];
    const init = args[1] || {};
    const url = getFetchUrl(input);
    const method = getFetchMethod(input, init);
    const requestBody = init && Object.prototype.hasOwnProperty.call(init, "body")
      ? init.body
      : undefined;
    const requestHeaderCount = getFetchRequestHeaderCount(input, init);

    const postFailureTelemetry = (error) => {
      const completedAt = Date.now();
      postTelemetryMessage(options, "network", {
        source: "fetch",
        type: "fetch",
        url: clampUrl(url),
        method,
        statusCode: 0,
        startedAt,
        completedAt,
        loadTimeMs: Math.max(0, completedAt - startedAt),
        requestHeaderCount,
        responseHeaderCount: 0,
        payload: null,
        error: clampTelemetryText(error && error.message ? error.message : error)
      });
    };

    let fetchResult;
    try {
      fetchResult = originalFetch.apply(this, args);
    } catch (error) {
      postFailureTelemetry(error);
      throw error;
    }

    Promise.resolve(fetchResult)
      .then(async (response) => {
        let responseBody = "";
        if (shouldIncludePayloads(options) && response && typeof response.clone === "function") {
          try {
            responseBody = await response.clone().text();
          } catch (error) {
            responseBody = "";
          }
        }

        const completedAt = Date.now();
        postTelemetryMessage(options, "network", {
          source: "fetch",
          type: "fetch",
          url: clampUrl(url),
          method,
          statusCode: Number(response && response.status) || 0,
          startedAt,
          completedAt,
          loadTimeMs: Math.max(0, completedAt - startedAt),
          requestHeaderCount,
          responseHeaderCount: countHeaders(response && response.headers),
          payload: createPayloadFromFetch(options, requestBody, responseBody)
        });
      }, postFailureTelemetry)
      .catch(() => {});

    return fetchResult;
  };

  wrappedFetch.__unfluffifyExtensionTelemetryInstalled = true;
  target.fetch = wrappedFetch;
}


function countRawResponseHeaders(rawHeaders) {
  if (typeof rawHeaders !== "string") {
    return 0;
  }
  let count = 0;
  for (const line of rawHeaders.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      continue;
    }
    const separatorIndex = trimmedLine.indexOf(":");
    if (separatorIndex > 0) {
      count++;
    }
  }
  return count;
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
        url: clampUrl(meta.url),
        method: meta.method || "GET",
        statusCode: Number(this.status) || 0,
        startedAt: meta.startedAt,
        completedAt: Date.now(),
        loadTimeMs: Math.max(0, Date.now() - (Number(meta.startedAt) || Date.now())),
        requestHeaderCount: 0,
        responseHeaderCount: countRawResponseHeaders(typeof this.getAllResponseHeaders === "function" ? this.getAllResponseHeaders() : ""),
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