import { installExtensionTelemetry } from "./extension-telemetry.js";

const PAGE_TELEMETRY_MESSAGE_MARKER = "unfluffify-page-telemetry";
const PAGE_TELEMETRY_CONTROL_MARKER = "unfluffify-page-telemetry-control";

if (!globalThis.__unfluffifyPageTelemetryInstalled) {
  let includePayloads = false;

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("message", (event) => {
      if (!event || event.source !== window) {
        return;
      }

      const data = event.data && typeof event.data === "object" ? event.data : null;
      if (!data || data.__unfluffifyTelemetry !== PAGE_TELEMETRY_CONTROL_MARKER) {
        return;
      }

      includePayloads = Boolean(data.includePayloads);
    });
  }

  installExtensionTelemetry({
    target: globalThis,
    source: "page",
    getIncludePayloads: () => includePayloads,
    sendTelemetry(message) {
      if (typeof window !== "undefined" && typeof window.postMessage === "function") {
        window.postMessage({
          __unfluffifyTelemetry: PAGE_TELEMETRY_MESSAGE_MARKER,
          message
        }, "*");
      }
    }
  });

  globalThis.__unfluffifyPageTelemetryInstalled = true;
}