import { installExtensionTelemetry } from "./extension-telemetry.js";

const PAGE_TELEMETRY_MESSAGE_MARKER = "unfluffify-page-telemetry";
const PAGE_TELEMETRY_CONTROL_MARKER = "unfluffify-page-telemetry-control";
const PAGE_TELEMETRY_MIN_NONCE_LENGTH = 16;

if (!globalThis.__unfluffifyPageTelemetryInstalled) {
  let enabled = false;
  let includePayloads = false;
  let telemetryNonce = "";
  let telemetryController = null;
  let telemetryPort = null;

  function isValidTelemetryNonce(value) {
    return typeof value === "string" && value.length >= PAGE_TELEMETRY_MIN_NONCE_LENGTH;
  }

  function closeTelemetryPort() {
    if (telemetryPort) {
      try {
        telemetryPort.close();
      } catch (error) {
        // Best-effort; never let port teardown break the page.
      }
      telemetryPort = null;
    }
  }

  function uninstallTelemetry() {
    enabled = false;
    includePayloads = false;
    telemetryNonce = "";
    closeTelemetryPort();
    if (telemetryController && typeof telemetryController.uninstall === "function") {
      telemetryController.uninstall();
    }
    telemetryController = null;
  }

  function ensureTelemetryInstalled() {
    if (telemetryController) {
      return;
    }

    telemetryController = installExtensionTelemetry({
      target: globalThis,
      source: "page",
      isEnabled: () => enabled && Boolean(telemetryNonce),
      getIncludePayloads: () => enabled && includePayloads,
      sendTelemetry(message) {
        if (!enabled || !telemetryNonce) {
          return;
        }
        // Prefer the private MessageChannel port when the handshake provided
        // one — that stream is not observable by other page scripts. Fall back
        // to the nonce'd window broadcast only when no port was transferred.
        if (telemetryPort) {
          try {
            telemetryPort.postMessage({
              __unfluffifyTelemetry: PAGE_TELEMETRY_MESSAGE_MARKER,
              message
            });
            return;
          } catch (error) {
            // If the port is dead, fall through to the window path below.
          }
        }
        if (
          typeof window === "undefined" ||
          typeof window.postMessage !== "function"
        ) {
          return;
        }
        window.postMessage({
          __unfluffifyTelemetry: PAGE_TELEMETRY_MESSAGE_MARKER,
          nonce: telemetryNonce,
          message
        }, "*");
      }
    });
  }

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("message", (event) => {
      if (!event || event.source !== window) {
        return;
      }

      const data = event.data && typeof event.data === "object" ? event.data : null;
      if (!data || data.__unfluffifyTelemetry !== PAGE_TELEMETRY_CONTROL_MARKER) {
        return;
      }

      if (data.enabled === false) {
        if (!telemetryNonce || data.nonce === telemetryNonce) {
          uninstallTelemetry();
        }
        return;
      }

      if (!isValidTelemetryNonce(data.nonce)) {
        return;
      }
      if (telemetryNonce && data.nonce !== telemetryNonce) {
        return;
      }

      telemetryNonce = data.nonce;
      enabled = Boolean(data.enabled);
      includePayloads = enabled && Boolean(data.includePayloads);
      // Adopt the private telemetry port if this handshake transferred one.
      if (enabled && event.ports && event.ports.length > 0 && !telemetryPort) {
        telemetryPort = event.ports[0];
        if (typeof telemetryPort.start === "function") {
          telemetryPort.start();
        }
      }
      if (enabled) {
        ensureTelemetryInstalled();
      } else {
        uninstallTelemetry();
      }
    });
  }

  globalThis.__unfluffifyPageTelemetryInstalled = true;
}
