export function createRemoteSupportSupportPage(deps) {
  let remoteSupportSupportPageTabId = null;
  let remoteSupportSupportPageState = createRemoteSupportSupportPageState();
  let remoteSupportSupportPageLastFrame = "";
  let remoteSupportSupportPageRenderedFrame = "";
  let remoteSupportSupportPageElements = null;
  let remoteSupportSupportPageFullscreenActive = false;

  function createRemoteSupportSupportPageState(tabId = null) {
    return {
      active: false,
      mode: "inactive",
      role: "",
      tabId: Number.isFinite(tabId) ? Math.trunc(tabId) : null,
      sessionId: "",
      supportCode: "",
      expiresAt: "",
      connected: false,
      partnerConnected: false,
      streaming: false,
      includePayloads: false,
      dockState: deps.REMOTE_SUPPORT_DOCK_STATE_EMBEDDED_MINIMIZED,
      error: "",
      lastActivityAt: 0,
      inactivityCountdownActive: false,
      inactivitySecondsRemaining: 0
    };
  }

  function normalizeRemoteSupportSupportPageState(stateLike, fallbackTabId = remoteSupportSupportPageTabId) {
    const normalized = {
      ...createRemoteSupportSupportPageState(fallbackTabId),
      ...(stateLike && typeof stateLike === "object" ? stateLike : {})
    };

    normalized.active = Boolean(normalized.active);
    normalized.connected = Boolean(normalized.connected);
    normalized.partnerConnected = Boolean(normalized.partnerConnected);
    normalized.streaming = Boolean(normalized.streaming);
    normalized.includePayloads = Boolean(normalized.includePayloads);
    normalized.dockState = deps.normalizeRemoteSupportDockState(normalized.dockState);
    normalized.inactivityCountdownActive = Boolean(normalized.inactivityCountdownActive);
    normalized.inactivitySecondsRemaining = Math.max(0, Math.trunc(Number(normalized.inactivitySecondsRemaining) || 0));
    normalized.tabId = Number.isFinite(Number(normalized.tabId))
      ? Math.trunc(Number(normalized.tabId))
      : (Number.isFinite(fallbackTabId) ? Math.trunc(fallbackTabId) : null);

    return normalized;
  }

  function getViewerClient() {
    return deps.getViewerClient();
  }

  function syncRemoteSupportSupportPageViewerVisibility() {
    getViewerClient().syncVisibility();
  }

  function updateRemoteSupportSupportPageViewerVideoState({ active = false, width = 0, height = 0 } = {}) {
    getViewerClient().updateVideoState({ active, width, height });
  }

  function initializeRemoteSupportSupportPageViewer(viewerFrame) {
    getViewerClient().initializeViewer(viewerFrame);
  }

  async function sendRemoteSupportSupportPageViewerRequest(requestType, payload = {}) {
    return getViewerClient().sendRequest(requestType, payload);
  }

  function isRemoteSupportSupportPage() {
    return deps.isRemoteSupportFeatureEnabled() &&
      Boolean(document.querySelector(deps.REMOTE_SUPPORT_SUPPORT_PAGE_META_SELECTOR));
  }

  function ensureRemoteSupportSupportPageStyles() {
    let style = document.getElementById(deps.REMOTE_SUPPORT_SUPPORT_PAGE_STYLE_ID);
    if (style) {
      return style;
    }

    style = document.createElement("style");
    style.id = deps.REMOTE_SUPPORT_SUPPORT_PAGE_STYLE_ID;
    style.setAttribute("data-uf-extension-ui", "true");
    style.textContent = `
    html[data-uf-remote-support-page="true"],
    body[data-uf-remote-support-page="true"] {
      margin: 0;
      min-height: 100vh;
      background: #09111d;
    }

    body[data-uf-remote-support-page="true"] {
      display: block;
      padding: 0;
    }

    body[data-uf-remote-support-page="true"] > #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_APP_ID} {
      display: block;
      min-height: 100vh;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} {
      min-height: 100vh;
      color: #e8edf6;
      font-family: ${deps.EXTENSION_UI_FONT_STACK};
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} * {
      box-sizing: border-box;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page {
      min-height: 100vh;
      width: 100vw;
      display: grid;
      place-items: center;
      padding: 16px;
      background:
        radial-gradient(circle at top left, rgba(84, 132, 212, 0.26), transparent 32%),
        linear-gradient(180deg, #09111d 0%, #101a2b 100%);
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__hero {
      display: none;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__hero-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 10px;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__eyebrow {
      display: inline-flex;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(108, 169, 255, 0.16);
      color: #9dc7ff;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__title {
      margin: 14px 0 10px;
      font-size: clamp(32px, 5vw, 54px);
      line-height: 1.02;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__lede,
    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__caption,
    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__status {
      margin: 0;
      max-width: 64rem;
      color: #b7c6dd;
      font-size: 16px;
      line-height: 1.6;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__layout {
      display: grid;
      width: min(1480px, 100%);
      gap: 18px;
      align-items: start;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page--viewer-only {
      padding: 0;
      background: #04080f;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page--viewer-only .uf-support-page__hero,
    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page--viewer-only .uf-support-page__caption {
      display: none;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page--viewer-only .uf-support-page__layout {
      display: block;
      gap: 0;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page--viewer-only .uf-support-page__surface {
      min-height: 100vh;
      border: 0;
      border-radius: 0;
      box-shadow: none;
      background: #04080f;
      backdrop-filter: none;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__stage {
      min-width: 0;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__stage {
      display: grid;
      gap: 14px;
      width: min(1280px, 100%);
      justify-self: center;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__surface {
      border: 1px solid rgba(182, 209, 246, 0.14);
      border-radius: 24px;
      background: rgba(8, 16, 27, 0.84);
      box-shadow: 0 24px 60px rgba(5, 10, 19, 0.35);
      backdrop-filter: blur(18px);
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__sidebar-brand {
      margin: 0;
      color: #ffffff;
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.04em;
      line-height: 1;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__meta {
      display: grid;
      gap: 14px;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__surface:focus-visible {
      outline: 2px solid #6ca9ff;
      outline-offset: 2px;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: fit-content;
      gap: 8px;
      border: 0;
      border-radius: 999px;
      padding: 12px 18px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__button {
      background: #6ca9ff;
      color: #08111c;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__button:disabled {
      cursor: wait;
      opacity: 0.65;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__button--compact {
      margin-left: auto;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__surface {
      position: relative;
      min-height: 70vh;
      overflow: hidden;
      display: grid;
      place-items: stretch;
      padding: 0;
      user-select: none;
      cursor: auto;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__surface.is-disabled {
      opacity: 0.9;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__viewer,
    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__surface img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
      border: 0;
      object-fit: contain;
      background: #04080f;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__viewer {
      pointer-events: none;
      z-index: 2;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__surface img {
      z-index: 1;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__surface .uf-support-page__placeholder {
      visibility: visible;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__surface.is-disabled .uf-support-page__placeholder {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 32px;
      text-align: center;
      color: #c4d1e3;
      font-size: 18px;
      line-height: 1.6;
      background:
        radial-gradient(circle at top, rgba(108, 169, 255, 0.18), transparent 36%),
        linear-gradient(180deg, rgba(7, 12, 20, 0.92), rgba(7, 12, 20, 0.98));
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__notice {
      margin-top: 16px;
      padding: 14px 16px;
      border-radius: 18px;
      background: rgba(207, 35, 56, 0.14);
      border: 1px solid rgba(236, 88, 107, 0.24);
      color: #ffc3cb;
      line-height: 1.5;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: start;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__notice-dismiss {
      position: relative;
      width: 28px;
      height: 28px;
      margin: -4px -6px -4px 4px;
      padding: 0;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: #ffc3cb;
      cursor: pointer;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__notice-dismiss::before,
    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__notice-dismiss::after {
      content: "";
      position: absolute;
      left: 50%;
      top: 50%;
      width: 14px;
      height: 2px;
      border-radius: 999px;
      background: currentColor;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__notice-dismiss::before {
      transform: translate(-50%, -50%) rotate(45deg);
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__notice-dismiss::after {
      transform: translate(-50%, -50%) rotate(-45deg);
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__notice-dismiss:hover {
      background: rgba(236, 88, 107, 0.18);
      color: #ffffff;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__notice-dismiss:focus-visible {
      outline: 2px solid #ffffff;
      outline-offset: 2px;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__caption {
      margin-top: 14px;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__stage-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
    }

    #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__stage-copy {
      display: grid;
      gap: 8px;
    }

    @media (max-width: 1080px) {
      #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__layout {
        width: 100%;
      }

      #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__hero {
        flex-direction: column;
      }

      #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__stage-toolbar {
        flex-direction: column;
        align-items: stretch;
      }

      #${deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__surface {
        min-height: 56vh;
      }
    }
  `;
    (document.head || document.documentElement).appendChild(style);
    return style;
  }

  function buildRemoteSupportSupportPageStatusText() {
    if (!remoteSupportSupportPageState.active) {
      return "Enter the six-digit support code to turn this page into the live remote view.";
    }

    if (remoteSupportSupportPageState.mode === "supporting") {
      return remoteSupportSupportPageState.connected
        ? "Connected."
        : "Support session started. Waiting for the requester to finish connecting.";
    }

    if (remoteSupportSupportPageState.mode === "being_supported") {
      return "This page is currently being supported remotely.";
    }

    return "Remote support is active.";
  }

  function buildRemoteSupportSupportPageSurfaceText() {
    if (!remoteSupportSupportPageState.active) {
      return "Start or join a support session to make this page mirror the remote tab.";
    }

    if (!remoteSupportSupportPageState.connected) {
      return "Waiting for the remote page to connect...";
    }

    return "Connected. Waiting for the live remote surface...";
  }

  function getRemoteSupportSupportPageSurfaceRect(surface, frame, options = {}) {
    const fallbackRect = surface.getBoundingClientRect();
    const remoteSupportViewerClient = getViewerClient();
    const intrinsicWidth = Number.isFinite(Number(options.intrinsicWidth))
      ? Math.max(0, Math.trunc(Number(options.intrinsicWidth)))
      : remoteSupportViewerClient.isVideoActive()
        ? remoteSupportViewerClient.getIntrinsicWidth()
        : (frame && !frame.hidden ? (frame.naturalWidth || frame.width || 0) : 0);
    const intrinsicHeight = Number.isFinite(Number(options.intrinsicHeight))
      ? Math.max(0, Math.trunc(Number(options.intrinsicHeight)))
      : remoteSupportViewerClient.isVideoActive()
        ? remoteSupportViewerClient.getIntrinsicHeight()
        : (frame && !frame.hidden ? (frame.naturalHeight || frame.height || 0) : 0);

    if (!intrinsicWidth || !intrinsicHeight) {
      return fallbackRect;
    }

    const containerWidth = Math.max(1, fallbackRect.width || 1);
    const containerHeight = Math.max(1, fallbackRect.height || 1);
    const imageAspectRatio = intrinsicWidth / intrinsicHeight;
    const containerAspectRatio = containerWidth / containerHeight;

    let renderedWidth = containerWidth;
    let renderedHeight = containerHeight;
    if (containerAspectRatio > imageAspectRatio) {
      renderedHeight = containerHeight;
      renderedWidth = renderedHeight * imageAspectRatio;
    } else {
      renderedWidth = containerWidth;
      renderedHeight = renderedWidth / imageAspectRatio;
    }

    const left = fallbackRect.left + ((containerWidth - renderedWidth) / 2);
    const top = fallbackRect.top + ((containerHeight - renderedHeight) / 2);

    return {
      left,
      top,
      width: renderedWidth,
      height: renderedHeight
    };
  }

  async function handleRemoteSupportSupportPageEnd() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "remoteSupportEnd",
        sessionId: typeof remoteSupportSupportPageState.sessionId === "string"
          ? remoteSupportSupportPageState.sessionId
          : ""
      });

      if (response && response.ok) {
        applyRemoteSupportSupportPageState(response.state || null);
        return;
      }
    } catch (error) {
      // Fall through to a state refresh.
    }

    await refreshRemoteSupportSupportPageState();
  }

  async function dismissRemoteSupportSupportPageError() {
    remoteSupportSupportPageState = normalizeRemoteSupportSupportPageState({
      ...remoteSupportSupportPageState,
      error: ""
    });
    renderRemoteSupportSupportPage();

    try {
      const response = await chrome.runtime.sendMessage({
        type: "remoteSupportDismissError",
        tabId: Number.isFinite(remoteSupportSupportPageTabId) ? remoteSupportSupportPageTabId : undefined,
        sessionId: remoteSupportSupportPageState.active && typeof remoteSupportSupportPageState.sessionId === "string"
          ? remoteSupportSupportPageState.sessionId
          : ""
      });

      if (response && response.ok) {
        applyRemoteSupportSupportPageState(response.state || null);
      }
    } catch (error) {
      // Keep the local dismissal if the background snapshot was already cleared.
    }
  }

  async function syncRemoteSupportSupportPageDockState(dockState) {
    if (!remoteSupportSupportPageState.active) {
      return;
    }
    const normalizedDockState = deps.normalizeRemoteSupportDockState(dockState);
    remoteSupportSupportPageState = normalizeRemoteSupportSupportPageState({
      ...remoteSupportSupportPageState,
      dockState: normalizedDockState
    });
    renderRemoteSupportSupportPage();
    await deps.sendRuntimeMessageSafely({
      type: "remoteSupportSetDockState",
      tabId: Number.isFinite(remoteSupportSupportPageTabId) ? remoteSupportSupportPageTabId : undefined,
      sessionId: remoteSupportSupportPageState.sessionId || "",
      dockState: normalizedDockState
    });
    sendRemoteSupportSupportPageViewerRequest("remoteSupportUpdateDockState", {
      dockState: normalizedDockState
    }).then();
  }

  function syncRemoteSupportSupportPageFullscreenState() {
    const elements = remoteSupportSupportPageElements || ensureRemoteSupportSupportPageUi();
    remoteSupportSupportPageFullscreenActive = Boolean(
      elements &&
        elements.surface &&
        document.fullscreenElement === elements.surface
    );
    if (elements && elements.fullscreenButton) {
      elements.fullscreenButton.textContent = remoteSupportSupportPageFullscreenActive
        ? "Exit fullscreen"
        : "Enter fullscreen";
    }
    if (remoteSupportSupportPageState.active) {
      syncRemoteSupportSupportPageDockState(
        remoteSupportSupportPageFullscreenActive
          ? deps.REMOTE_SUPPORT_DOCK_STATE_FULLSCREEN_ACTIVE
          : deps.REMOTE_SUPPORT_DOCK_STATE_EMBEDDED_MINIMIZED
      ).then();
    }
  }

  async function toggleRemoteSupportSupportPageFullscreen() {
    const elements = remoteSupportSupportPageElements || ensureRemoteSupportSupportPageUi();
    if (!elements || !elements.surface) {
      return;
    }
    if (document.fullscreenElement === elements.surface) {
      await document.exitFullscreen?.();
      return;
    }
    if (typeof elements.surface.requestFullscreen === "function") {
      await elements.surface.requestFullscreen();
    }
  }

  function ensureRemoteSupportSupportPageUi() {
    if (!isRemoteSupportSupportPage() || !document.body) {
      return null;
    }

    ensureRemoteSupportSupportPageStyles();
    document.documentElement.setAttribute("data-uf-remote-support-page", "true");
    document.body.setAttribute("data-uf-remote-support-page", "true");

    const fallback = document.getElementById(deps.REMOTE_SUPPORT_SUPPORT_PAGE_FALLBACK_ID);
    if (fallback) {
      fallback.hidden = true;
    }

    let appHost = document.getElementById(deps.REMOTE_SUPPORT_SUPPORT_PAGE_APP_ID);
    if (!appHost) {
      appHost = document.createElement("div");
      appHost.id = deps.REMOTE_SUPPORT_SUPPORT_PAGE_APP_ID;
      appHost.setAttribute("data-uf-extension-ui", "true");
      document.body.prepend(appHost);
    }

    let root = document.getElementById(deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = deps.REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID;
      root.setAttribute("data-uf-extension-ui", "true");
      root.innerHTML = `
      <div class="uf-support-page" data-uf-extension-ui="true">
        <section class="uf-support-page__layout" data-uf-extension-ui="true">
          <div class="uf-support-page__stage" data-uf-extension-ui="true">
            <div class="uf-support-page__stage-toolbar" data-uf-extension-ui="true">
              <div class="uf-support-page__stage-copy" data-uf-extension-ui="true">
                <h1 class="uf-support-page__sidebar-brand" data-uf-extension-ui="true">Unfluffify Support</h1>
                <p id="uf-support-page-passive-state" class="uf-support-page__status" data-uf-extension-ui="true">Join a support session from the Unfluffify extension popup while this /support tab stays focused on viewing.</p>
                <div id="uf-support-page-error" class="uf-support-page__notice" role="alert" aria-live="assertive" aria-atomic="true" hidden data-uf-extension-ui="true">
                  <span id="uf-support-page-error-text" data-uf-extension-ui="true"></span>
                  <button id="uf-support-page-error-dismiss" class="uf-support-page__notice-dismiss" type="button" aria-label="Dismiss notice" title="Dismiss notice" data-uf-extension-ui="true"></button>
                </div>
              </div>
              <button id="uf-support-page-fullscreen" class="uf-support-page__button uf-support-page__button--compact" type="button" data-uf-extension-ui="true">Enter fullscreen</button>
            </div>
              <div id="uf-support-page-surface" class="uf-support-page__surface is-disabled" tabindex="0" aria-disabled="true" data-uf-extension-ui="true">
              <iframe id="uf-support-page-viewer" class="uf-support-page__viewer" title="Live remote support viewer" hidden data-uf-extension-ui="true"></iframe>
              <img id="uf-support-page-frame" alt="Live remote page reflection" hidden data-uf-extension-ui="true">
              <div id="uf-support-page-placeholder" class="uf-support-page__placeholder" data-uf-extension-ui="true"></div>
            </div>
            <p class="uf-support-page__caption" data-uf-extension-ui="true">Live Chrome window stream. Remote control is disabled.</p>
          </div>
        </section>
      </div>
    `;
      appHost.replaceChildren(root);

      remoteSupportSupportPageElements = {
        root,
        error: root.querySelector("#uf-support-page-error"),
        errorText: root.querySelector("#uf-support-page-error-text"),
        errorDismiss: root.querySelector("#uf-support-page-error-dismiss"),
        controlButton: null,
        endButton: null,
        passiveState: root.querySelector("#uf-support-page-passive-state"),
        fullscreenButton: root.querySelector("#uf-support-page-fullscreen"),
        surface: root.querySelector("#uf-support-page-surface"),
        viewer: root.querySelector("#uf-support-page-viewer"),
        frame: root.querySelector("#uf-support-page-frame"),
        placeholder: root.querySelector("#uf-support-page-placeholder")
      };

      remoteSupportSupportPageElements.frame.decoding = "async";
      initializeRemoteSupportSupportPageViewer(remoteSupportSupportPageElements.viewer);

      remoteSupportSupportPageElements.errorDismiss.addEventListener("click", (event) => {
        event.preventDefault();
        dismissRemoteSupportSupportPageError().then();
      });
      remoteSupportSupportPageElements.fullscreenButton.addEventListener("click", (event) => {
        event.preventDefault();
        toggleRemoteSupportSupportPageFullscreen().then();
      });
      remoteSupportSupportPageElements.surface.addEventListener("contextmenu", (event) => {
        event.preventDefault();
      });
    }

    return remoteSupportSupportPageElements;
  }

  function syncRemoteSupportSupportPageFrame() {
    const elements = remoteSupportSupportPageElements || ensureRemoteSupportSupportPageUi();
    if (!elements) {
      return;
    }

    syncRemoteSupportSupportPageViewerVisibility();

    if (getViewerClient().isVideoActive()) {
      remoteSupportSupportPageRenderedFrame = "";
      elements.frame.hidden = true;
      if (elements.frame.getAttribute("src")) {
        elements.frame.removeAttribute("src");
      }
      elements.placeholder.hidden = true;
      return;
    }

    const nextFrame = remoteSupportSupportPageState.active ? remoteSupportSupportPageLastFrame : "";
    if (nextFrame) {
      if (remoteSupportSupportPageRenderedFrame !== nextFrame) {
        remoteSupportSupportPageRenderedFrame = nextFrame;
        if (elements.frame.getAttribute("src") !== nextFrame) {
          elements.frame.setAttribute("src", nextFrame);
        }
      }
      elements.frame.hidden = false;
      elements.placeholder.hidden = true;
      return;
    }

    remoteSupportSupportPageRenderedFrame = "";
    elements.frame.hidden = true;
    if (elements.frame.getAttribute("src")) {
      elements.frame.removeAttribute("src");
    }
    elements.placeholder.hidden = false;
    elements.placeholder.textContent = buildRemoteSupportSupportPageSurfaceText();
  }

  function scheduleRemoteSupportSupportPageFrameRender() {
    syncRemoteSupportSupportPageFrame();
  }

  function renderRemoteSupportSupportPage() {
    const elements = ensureRemoteSupportSupportPageUi();
    if (!elements) {
      return;
    }

    const active = Boolean(remoteSupportSupportPageState.active);
    const errorText = typeof remoteSupportSupportPageState.error === "string"
      ? remoteSupportSupportPageState.error.trim()
      : "";

    elements.root.classList.remove("uf-support-page--viewer-only");
    elements.error.hidden = !errorText;
    if (elements.errorText) {
      elements.errorText.textContent = errorText;
    }
    if (elements.passiveState) {
      const inactivityCountdownText = Boolean(remoteSupportSupportPageState.inactivityCountdownActive)
        ? ` Session will end in ${deps.formatRemoteSupportCountdown(remoteSupportSupportPageState.inactivitySecondsRemaining)} due to requester inactivity.`
        : "";
      elements.passiveState.textContent = active
        ? `The support session is live. Use the dock or the extension popup to manage the connection.${inactivityCountdownText}`
        : "Join a support session from the Unfluffify extension popup while this /support tab stays focused on viewing.";
    }
    if (elements.fullscreenButton) {
      elements.fullscreenButton.hidden = !active;
      elements.fullscreenButton.textContent = remoteSupportSupportPageFullscreenActive
        ? "Exit fullscreen"
        : "Enter fullscreen";
    }

    elements.surface.classList.toggle("is-disabled", true);
    elements.surface.setAttribute("aria-disabled", "true");
    elements.surface.tabIndex = -1;
    syncRemoteSupportSupportPageViewerVisibility();

    scheduleRemoteSupportSupportPageFrameRender({ immediate: true });
  }

  function applyRemoteSupportSupportPageState(nextState) {
    remoteSupportSupportPageState = normalizeRemoteSupportSupportPageState(nextState);
    if (Number.isFinite(remoteSupportSupportPageState.tabId)) {
      remoteSupportSupportPageTabId = remoteSupportSupportPageState.tabId;
    }
    if (!remoteSupportSupportPageState.active) {
      remoteSupportSupportPageLastFrame = "";
      updateRemoteSupportSupportPageViewerVideoState({ active: false, width: 0, height: 0 });
      remoteSupportSupportPageFullscreenActive = false;
    }
    renderRemoteSupportSupportPage();
    sendRemoteSupportSupportPageViewerRequest("remoteSupportUpdateDockState", {
      dockState: remoteSupportSupportPageFullscreenActive
        ? deps.REMOTE_SUPPORT_DOCK_STATE_FULLSCREEN_ACTIVE
        : remoteSupportSupportPageState.dockState
    }).then();
  }

  async function refreshRemoteSupportSupportPageState() {
    if (!isRemoteSupportSupportPage()) {
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "getRemoteSupportState"
      });

      if (!response || !response.ok) {
        applyRemoteSupportSupportPageState({
          ...remoteSupportSupportPageState,
          error: "Unable to load the current remote support state."
        });
        return;
      }

      applyRemoteSupportSupportPageState(response.state || null);
    } catch (error) {
      applyRemoteSupportSupportPageState({
        ...remoteSupportSupportPageState,
        error: error && error.message ? error.message : "Unable to load the current remote support state."
      });
    }
  }

  function initializeRemoteSupportSupportPage() {
    if (!isRemoteSupportSupportPage()) {
      return;
    }

    if (!document.body) {
      window.addEventListener("DOMContentLoaded", initializeRemoteSupportSupportPage, { once: true });
      return;
    }

    ensureRemoteSupportSupportPageUi();
    renderRemoteSupportSupportPage();
    document.addEventListener("fullscreenchange", syncRemoteSupportSupportPageFullscreenState);
    refreshRemoteSupportSupportPageState().then();
  }

  function handleRemoteSupportSupportPageFramePayload(framePayload) {
    remoteSupportSupportPageLastFrame = typeof framePayload === "string"
      ? framePayload
      : (framePayload && typeof framePayload.dataUrl === "string" ? framePayload.dataUrl : "");
    scheduleRemoteSupportSupportPageFrameRender();
  }

  function handleRemoteSupportSupportPageFrameMessage(message) {
    if (
      Number.isFinite(remoteSupportSupportPageTabId) &&
      Number.isFinite(message && message.tabId) &&
      Math.trunc(message.tabId) !== remoteSupportSupportPageTabId
    ) {
      return false;
    }

    handleRemoteSupportSupportPageFramePayload(message && message.frame);
    return true;
  }

  return {
    applyState: applyRemoteSupportSupportPageState,
    getTabId: () => remoteSupportSupportPageTabId,
    getViewerElement: () => {
      const elements = remoteSupportSupportPageElements || ensureRemoteSupportSupportPageUi();
      return elements && elements.viewer ? elements.viewer : null;
    },
    handleFrameMessage: handleRemoteSupportSupportPageFrameMessage,
    handleFramePayload: handleRemoteSupportSupportPageFramePayload,
    initialize: initializeRemoteSupportSupportPage,
    isActive: () => Boolean(remoteSupportSupportPageState.active),
    isSupportPage: isRemoteSupportSupportPage,
    refreshState: refreshRemoteSupportSupportPageState,
    render: renderRemoteSupportSupportPage,
    sendViewerRequest: sendRemoteSupportSupportPageViewerRequest
  };
}
