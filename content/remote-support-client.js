export function createRemoteSupportClient(deps) {
  let mode = "inactive";
  let role = "";
  let includePayloads = false;
  let terminatePending = false;
  let mediaQuietingActive = false;
  let mediaQuietObserver = null;
  const quietedMediaElements = new Map();

  const isBeingSupportedMode = () => mode === deps.REMOTE_SUPPORT_MODE_BEING_SUPPORTED;

  const restoreQuietedVideo = (video) => {
    const quietedState = quietedMediaElements.get(video);
    if (!quietedState) {
      return;
    }

    quietedMediaElements.delete(video);
    if (quietedState.wasPaused || typeof video.play !== "function") {
      return;
    }

    try {
      const playResult = video.play();
      if (playResult && typeof playResult.catch === "function") {
        playResult.catch(() => {});
      }
    } catch (error) {
      // Ignore autoplay policy failures while restoring paused media.
    }
  };

  const quietVideo = (video) => {
    if (!video || video.nodeType !== 1 || String(video.tagName || "").toLowerCase() !== "video") {
      return;
    }
    if (!mediaQuietingActive) {
      return;
    }

    if (!quietedMediaElements.has(video)) {
      if (video.paused) {
        return;
      }
      quietedMediaElements.set(video, { wasPaused: false });
    }

    if (!video.paused && typeof video.pause === "function") {
      try {
        video.pause();
      } catch (error) {
        // Ignore transient media state changes while the page is loading.
      }
    }
  };

  const quietVideos = (root = document) => {
    if (!mediaQuietingActive || !root) {
      return;
    }

    if (root.nodeType === 1 && String(root.tagName || "").toLowerCase() === "video") {
      quietVideo(root);
    }
    if (typeof root.querySelectorAll !== "function") {
      return;
    }
    root.querySelectorAll("video").forEach((video) => {
      quietVideo(video);
    });
  };

  const handleMediaPlay = (event) => {
    if (!event || !mediaQuietingActive) {
      return;
    }
    quietVideo(event.target);
  };

  const handleMediaQuietMutations = (mutations) => {
    if (!mediaQuietingActive || !Array.isArray(mutations)) {
      return;
    }
    mutations.forEach((mutation) => {
      if (!mutation) {
        return;
      }
      if (mutation.type === "attributes") {
        quietVideo(mutation.target);
        return;
      }
      (mutation.addedNodes || []).forEach((node) => {
        quietVideos(node);
      });
    });
  };

  const startMediaQuieting = () => {
    if (mediaQuietingActive) {
      quietVideos(document);
      return;
    }

    mediaQuietingActive = true;
    quietVideos(document);
    document.addEventListener("play", handleMediaPlay, true);
    const root = document.documentElement || document.body;
    if (!root || typeof MutationObserver !== "function") {
      return;
    }

    mediaQuietObserver = new MutationObserver(handleMediaQuietMutations);
    mediaQuietObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["autoplay", "controls", "loop", "muted", "src", "style", "class"]
    });
  };

  const stopMediaQuieting = () => {
    if (
      !mediaQuietingActive &&
      !mediaQuietObserver &&
      quietedMediaElements.size === 0
    ) {
      return;
    }

    mediaQuietingActive = false;
    document.removeEventListener("play", handleMediaPlay, true);
    if (mediaQuietObserver) {
      mediaQuietObserver.disconnect();
      mediaQuietObserver = null;
    }

    Array.from(quietedMediaElements.keys()).forEach((video) => {
      restoreQuietedVideo(video);
    });
    quietedMediaElements.clear();
  };

  const ensureTerminateButton = () => {
    if (!document.body) {
      return null;
    }

    let style = document.getElementById(deps.REMOTE_SUPPORT_TERMINATE_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = deps.REMOTE_SUPPORT_TERMINATE_STYLE_ID;
      style.setAttribute("data-uf-extension-ui", "true");
      style.textContent = `
      #${deps.REMOTE_SUPPORT_TERMINATE_BUTTON_ID} {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        padding: 10px 14px;
        border: 0;
        border-radius: 999px;
        background: #cf2338;
        color: #ffffff;
        font: 600 13px/1.1 ${deps.EXTENSION_UI_FONT_STACK};
        box-shadow: 0 12px 32px rgba(126, 14, 27, 0.35);
        cursor: pointer;
      }
      #${deps.REMOTE_SUPPORT_TERMINATE_BUTTON_ID}:hover {
        background: #b91d31;
      }
      #${deps.REMOTE_SUPPORT_TERMINATE_BUTTON_ID}:disabled {
        cursor: wait;
        opacity: 0.8;
      }
    `;
      (document.head || document.documentElement).appendChild(style);
    }

    let button = document.getElementById(deps.REMOTE_SUPPORT_TERMINATE_BUTTON_ID);
    if (!button) {
      button = document.createElement("button");
      button.id = deps.REMOTE_SUPPORT_TERMINATE_BUTTON_ID;
      button.type = "button";
      button.textContent = "Terminate session";
      button.setAttribute("data-uf-extension-ui", "true");
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (terminatePending) {
          return;
        }

        terminatePending = true;
        syncTerminateButton();
        deps.sendRuntimeMessageSafely({
          type: "remoteSupportEnd"
        }).finally(() => {
          terminatePending = false;
          syncTerminateButton();
        });
      });
      (document.body || document.documentElement).appendChild(button);
    }

    return button;
  };

  function syncTerminateButton() {
    if (isBeingSupportedMode() && !document.body && document.readyState === "loading") {
      window.addEventListener("DOMContentLoaded", syncTerminateButton, { once: true });
      return;
    }

    const button = isBeingSupportedMode()
      ? ensureTerminateButton()
      : document.getElementById(deps.REMOTE_SUPPORT_TERMINATE_BUTTON_ID);
    if (!button) {
      return;
    }

    button.hidden = !isBeingSupportedMode();
    button.disabled = terminatePending;
  }

  const applySessionState = (remoteSupportStateLike) => {
    if (!deps.isRemoteSupportFeatureEnabled()) {
      mode = "inactive";
      role = "";
      includePayloads = false;
      stopMediaQuieting();
      deps.syncPageTelemetryBridgeLifecycle();
      syncTerminateButton();
      return;
    }
    const remoteSupportState =
      remoteSupportStateLike && typeof remoteSupportStateLike === "object"
        ? remoteSupportStateLike
        : {};
    const active = Boolean(
      typeof remoteSupportState.active === "boolean"
        ? remoteSupportState.active
        : String(remoteSupportState.mode || "inactive") !== "inactive"
    );

    mode = active ? String(remoteSupportState.mode || "inactive") : "inactive";
    role = active ? String(remoteSupportState.role || "") : "";
    includePayloads = active ? Boolean(remoteSupportState.includePayloads) : false;

    if (isBeingSupportedMode()) {
      if (document.activeElement && typeof document.activeElement.blur === "function") {
        document.activeElement.blur();
      }
      startMediaQuieting();
    } else {
      stopMediaQuieting();
    }

    deps.syncPageTelemetryBridgeLifecycle();
    syncTerminateButton();
  };

  const syncSessionStateFromBackground = async () => {
    if (!deps.isRemoteSupportFeatureEnabled()) {
      applySessionState(null);
      return;
    }
    try {
      const response = await deps.requestRemoteSupportState();
      if (!response || !response.ok) {
        return;
      }

      applySessionState(response.state || null);
    } catch (error) {
      // Ignore initial sync failures caused by transient background reloads.
    }
  };

  return {
    applySessionState,
    getIncludePayloads: () => includePayloads,
    getMode: () => mode,
    getRole: () => role,
    isBeingSupportedMode,
    syncSessionStateFromBackground,
    syncTerminateButton
  };
}