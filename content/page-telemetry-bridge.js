export function handlePageTelemetryWindowMessage(deps, event) {
  if (
    deps.isExtensionContextInvalidated() ||
    deps.getRemoteSupportMode() !== deps.REMOTE_SUPPORT_MODE_BEING_SUPPORTED ||
    !deps.getPageTelemetryBridgeNonce() ||
    !event ||
    event.source !== globalThis.window
  ) {
    return;
  }

  const data = event.data && typeof event.data === "object" ? event.data : null;
  if (!data || data.__unfluffifyTelemetry !== deps.PAGE_TELEMETRY_MESSAGE_MARKER) {
    return;
  }
  if (data.nonce !== deps.getPageTelemetryBridgeNonce()) {
    return;
  }

  const message = data.message && typeof data.message === "object" ? data.message : null;
  if (!message || message.type !== "remoteSupportExtensionTelemetry") {
    return;
  }

  deps.forwardPageTelemetryMessage(message);
}

export function syncPageTelemetryControl(deps) {
  const windowObject = globalThis.window;
  if (
    typeof windowObject === "undefined" ||
    typeof windowObject.postMessage !== "function"
  ) {
    return;
  }

  const enabled = deps.getRemoteSupportMode() === deps.REMOTE_SUPPORT_MODE_BEING_SUPPORTED;
  const nonce = enabled ? deps.getOrCreatePageTelemetryBridgeNonce() : deps.getPageTelemetryBridgeNonce();
  if (!nonce) {
    return;
  }

  const control = {
    __unfluffifyTelemetry: deps.PAGE_TELEMETRY_CONTROL_MARKER,
    nonce,
    enabled,
    includePayloads: enabled && deps.getRemoteSupportIncludePayloads()
  };

  const transfer = [];
  if (
    enabled &&
    !deps.getPageTelemetryBridgePort() &&
    typeof MessageChannel === "function"
  ) {
    const channel = new MessageChannel();
    const port = channel.port1;
    port.onmessage = (event) => {
      deps.handlePageTelemetryPortMessage(event);
    };
    deps.setPageTelemetryBridgePort(port);
    transfer.push(channel.port2);
  }

  if (transfer.length) {
    windowObject.postMessage(control, "*", transfer);
  } else {
    windowObject.postMessage(control, "*");
  }
}

export function ensurePageTelemetryBridge(deps) {
  if (
    deps.isExtensionContextInvalidated() ||
    deps.getRemoteSupportMode() !== deps.REMOTE_SUPPORT_MODE_BEING_SUPPORTED ||
    typeof window === "undefined" ||
    typeof document !== "object" ||
    !globalThis.chrome ||
    !chrome.runtime ||
    typeof chrome.runtime.getURL !== "function"
  ) {
    return;
  }

  if (!deps.isPageTelemetryBridgeListenerBound()) {
    window.addEventListener("message", deps.handlePageTelemetryWindowMessage);
    deps.setPageTelemetryBridgeListenerBound(true);
  }

  const existingScript = document.getElementById(deps.PAGE_TELEMETRY_SCRIPT_ID);
  if (existingScript) {
    deps.syncPageTelemetryControl();
    return;
  }

  const parent = document.head || document.documentElement;
  if (!parent || typeof document.createElement !== "function") {
    return;
  }

  const script = document.createElement("script");
  script.id = deps.PAGE_TELEMETRY_SCRIPT_ID;
  script.type = "module";
  script.src = chrome.runtime.getURL("common/page-telemetry.js");
  script.addEventListener("load", () => {
    deps.syncPageTelemetryControl();
  }, { once: true });
  parent.appendChild(script);
}