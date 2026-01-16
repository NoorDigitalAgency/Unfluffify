(() => {
  const DEFAULT_EXCLUDED_TAGS_TOGGLEABLE = [
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6"
  ];

  const DEFAULT_EXCLUDED_TAGS_IMMUTABLE = [
    "IMG",
    "FOOTER",
    "FORM",
    "BUTTON",
    "INPUT",
    "LABEL",
    "NAV",
    "HEADER",
    "NOSCRIPT",
    "DIALOG",
    "ASIDE",
    "SELECT",
    "TITLE",
    "STYLE"
  ];

  const DEFAULT_EXCLUDED_TAGS = [
    ...DEFAULT_EXCLUDED_TAGS_TOGGLEABLE,
    ...DEFAULT_EXCLUDED_TAGS_IMMUTABLE
  ];

  const TOGGLEABLE_TAG_SELECTOR = DEFAULT_EXCLUDED_TAGS_TOGGLEABLE.map((tag) =>
    tag.toLowerCase()
  ).join(",");

  const IMMUTABLE_TAG_SELECTOR = DEFAULT_EXCLUDED_TAGS_IMMUTABLE.map((tag) =>
    tag.toLowerCase()
  ).join(",");

  const HARD_EXCLUDED_SELECTORS = [
    "[aria-hidden='true']",
    "[role='dialog']",
    ".cookie",
    ".cookies",
    ".cookie-banner",
    ".newsletter",
    ".subscribe",
    ".modal",
    ".popup"
  ];

  const state = {
    enabled: false,
    baseUrl: "",
    config: null,
    overlay: null,
    layers: {},
    hoverBox: null,
    focusBox: null,
    focusElement: null,
    aiPopover: null,
    toast: null,
    toastHideTimer: 0,
    altPassThrough: false,
    headingToggleableTargets: new Set(),
    markIdCounter: 1,
    markIds: new WeakMap(),
    markedElements: new Set(),
    renderRaf: 0,
    renderTimer: 0,
    scrollHideTimer: 0,
    isScrolling: false,
    saveTimer: 0,
    saveInFlight: false,
    saveAgain: false,
    snapshotTimer: 0,
    urlCheckTimer: 0,
    mutationObserver: null
  };

  const storageGet = (keys) =>
    new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  const storageSet = (items) =>
    new Promise((resolve) => chrome.storage.local.set(items, resolve));

  const sendMessage = (message) =>
    new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        resolve(response);
      });
    });

  function createDefaultConfig(baseUrl) {
    let domain = "";
    try {
      domain = new URL(baseUrl).hostname;
    } catch (error) {
      domain = "";
    }

    return {
      baseUrl,
      domain,
      showDefaultHighlights: true,
      explicitXPathDecisions: {
        include: [],
        exclude: []
      },
      pageHtmlSnapshots: {},
      pageMarkings: {},
      latestComputedSelectors: [],
      lastSavedSelectors: [],
      pendingAiSave: false,
      defaultToggleExclusionsDisabled: [],
      domainAiSelectorSet: {
        inclusionSelectors: [],
        exclusionSelectors: []
      }
    };
  }

  async function loadConfig(baseUrl) {
    const result = await storageGet("configs");
    const configs = result.configs || {};
    let changed = false;
    let currentConfig = configs[baseUrl];
    if (!currentConfig) {
      currentConfig = createDefaultConfig(baseUrl);
      changed = true;
    } else {
      // Merge with default to ensure all new properties are present
      const defaultConfig = createDefaultConfig(baseUrl);
      // Specifically handle properties that are objects and arrays to avoid shallow copy issues
      // and ensure defaults for nested structures.
      currentConfig = {
        ...defaultConfig,
        ...currentConfig,
        explicitXPathDecisions: {
          ...defaultConfig.explicitXPathDecisions,
          ...(currentConfig.explicitXPathDecisions || {})
        },
        domainAiSelectorSet: {
          ...defaultConfig.domainAiSelectorSet,
          ...(currentConfig.domainAiSelectorSet || {})
        }
      };

      // Ensure specific properties are reset or have correct types if they were malformed
      if (!Array.isArray(currentConfig.explicitXPathDecisions.exclude)) {
        currentConfig.explicitXPathDecisions.exclude = [];
        changed = true;
      }
      if (currentConfig.explicitXPathDecisions.include && currentConfig.explicitXPathDecisions.include.length) {
        // As per existing logic, include should always be empty
        currentConfig.explicitXPathDecisions.include = [];
        changed = true;
      }
      if (currentConfig.showDefaultHighlights !== true) {
        currentConfig.showDefaultHighlights = true;
        changed = true;
      }
      if (!Array.isArray(currentConfig.defaultToggleExclusionsDisabled)) {
        currentConfig.defaultToggleExclusionsDisabled = [];
        changed = true;
      }
      if (!Array.isArray(currentConfig.domainAiSelectorSet.inclusionSelectors)) {
        currentConfig.domainAiSelectorSet.inclusionSelectors = [];
        changed = true;
      }
      if (!Array.isArray(currentConfig.domainAiSelectorSet.exclusionSelectors)) {
        currentConfig.domainAiSelectorSet.exclusionSelectors = [];
        changed = true;
      }
      if (typeof currentConfig.pageHtmlSnapshots !== "object" || currentConfig.pageHtmlSnapshots === null) {
        currentConfig.pageHtmlSnapshots = {};
        changed = true;
      }
      if (typeof currentConfig.pageMarkings !== "object" || currentConfig.pageMarkings === null) {
        currentConfig.pageMarkings = {};
        changed = true;
      }
      if (!Array.isArray(currentConfig.latestComputedSelectors)) {
        currentConfig.latestComputedSelectors = [];
        changed = true;
      }
      if (!Array.isArray(currentConfig.lastSavedSelectors)) {
        currentConfig.lastSavedSelectors = [];
        changed = true;
      }
      if (typeof currentConfig.pendingAiSave !== "boolean") {
        currentConfig.pendingAiSave = false;
        changed = true;
      }
    }
    
    configs[baseUrl] = currentConfig; // Update configs object with the potentially modified config

    if (changed) {
      await storageSet({ configs });
    }
    return configs[baseUrl];
  }

  async function saveConfig(baseUrl, config) {
    const result = await storageGet("configs");
    const configs = result.configs || {};
    configs[baseUrl] = config;
    await storageSet({ configs });
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) {
      return false;
    }
    let node = el;
    while (node && node.nodeType === 1) {
      if (
        node.classList &&
        (node.classList.contains("sr-only") ||
          node.classList.contains("visually-hidden"))
      ) {
        return false;
      }
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      if (parseFloat(style.opacity) === 0) {
        return false;
      }
      if (isVisuallyHiddenByStyle(style)) {
        return false;
      }
      node = node.parentElement;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }
    return true;
  }

  function isVisuallyHiddenByStyle(style) {
    if (!style) {
      return false;
    }
    const clip = (style.clip || "").replace(/\s+/g, "").toLowerCase();
    if (clip && clip !== "auto" && clip.includes("rect(")) {
      const numbers = clip.match(/-?\d*\.?\d+/g);
      if (numbers && numbers.length >= 4) {
        const allZero = numbers.every((value) => Number(value) === 0);
        if (allZero) {
          return true;
        }
      }
    }
    const clipPath = (style.clipPath || "").replace(/\s+/g, "").toLowerCase();
    if (
      clipPath &&
      clipPath !== "none" &&
      (clipPath.includes("inset(50%") ||
        clipPath.includes("inset(100%") ||
        clipPath.includes("circle(0") ||
        clipPath.includes("ellipse(0"))
    ) {
      return true;
    }
    const width = parseFloat(style.width);
    const height = parseFloat(style.height);
    const position = style.position;
    if (
      (Number.isFinite(width) && width <= 1) ||
      (Number.isFinite(height) && height <= 1)
    ) {
      if (
        style.overflow === "hidden" &&
        (position === "absolute" || position === "fixed" || position === "sticky")
      ) {
        return true;
      }
    }
    return false;
  }

  function hasDirectText(el) {
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        return true;
      }
    }
    return false;
  }

  function isTextualContainer(el) {
    if (!isVisible(el)) {
      return false;
    }
    if (!hasDirectText(el)) {
      return false;
    }
    return true;
  }

  function matchesImmutableExcluded(el) {
    if (!el || el.nodeType !== 1) {
      return false;
    }
    if (DEFAULT_EXCLUDED_TAGS_IMMUTABLE.includes(el.tagName)) {
      return true;
    }
    for (const selector of HARD_EXCLUDED_SELECTORS) {
      try {
        if (el.matches(selector)) {
          return true;
        }
      } catch (error) {
        continue;
      }
    }
    return false;
  }

  function isToggleableDefaultTarget(el, config, toggleableTargets) {
    if (!el || el.nodeType !== 1) {
      return false;
    }
    if (!TOGGLEABLE_TAG_SELECTOR || !config) {
      return false;
    }
    let targets = toggleableTargets || state.headingToggleableTargets;
    if (!targets || targets.size === 0) {
      targets = collectHeadingToggleableTargets();
      state.headingToggleableTargets = targets;
    }
    return targets.has(el);
  }

  function collectHeadingToggleableTargets() {
    if (!TOGGLEABLE_TAG_SELECTOR) {
      return new Set();
    }
    const targets = new Set();
    const headings = document.querySelectorAll(TOGGLEABLE_TAG_SELECTOR);

    for (const heading of headings) {
      if (isWithinHardExcluded(heading)) {
        continue;
      }
      if (isTextualContainer(heading)) {
        targets.add(heading);
      }
      const children = heading.querySelectorAll("*");
      for (const child of children) {
        if (!isWithinHardExcluded(child) && isTextualContainer(child)) {
          targets.add(child);
        }
      }
    }
    return targets;
  }

  function isWithinHardExcluded(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      if (matchesImmutableExcluded(node)) {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  function getVisibleRect(el) {
    if (!isVisible(el)) {
      return null;
    }
    const rect = el.getBoundingClientRect();
    if (
      rect.bottom < 0 ||
      rect.top > window.innerHeight ||
      rect.right < 0 ||
      rect.left > window.innerWidth
    ) {
      return null;
    }
    return rect;
  }

  function getXPath(el) {
    if (!el || el.nodeType !== 1) {
      return "";
    }
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1) {
      const tag = node.tagName.toLowerCase();
      let index = 1;
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === node.tagName) {
          index += 1;
        }
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(`${tag}[${index}]`);
      if (node === document.documentElement) {
        break;
      }
      node = node.parentElement;
    }
    return `/${parts.join("/")}`;
  }

  function getElementFromXPath(xpath) {
    try {
      const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      const node = result.singleNodeValue;
      if (node && node.nodeType === 1) {
        return node;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  function getElementLabel(el) {
    if (!el || el.nodeType !== 1) {
      return "";
    }
    let text = (el.innerText || "").replace(/\s+/g, " ").trim();
    if (!text) {
      text = (el.getAttribute("aria-label") || "").trim();
    }
    if (!text) {
      text = (el.getAttribute("title") || "").trim();
    }
    if (!text) {
      text = el.tagName.toLowerCase();
    }
    if (text.length > 80) {
      text = `${text.slice(0, 77)}...`;
    }
    return text;
  }

  function collectXPathElements(xpaths) {
    const elements = new Set();
    for (const xpath of xpaths || []) {
      const el = getElementFromXPath(xpath);
      if (el) {
        elements.add(el);
      }
    }
    return elements;
  }

  function collectDefaultHighlightTargets(root, options) {
    if (!root) {
      return [];
    }
    const {
      excludedSet = new Set(),
      hardExcludedSet = new Set(),
      hasHigherPrecedence = () => false,
      precedenceSet = new Set()
    } = options || {};
    const results = [];
    const stack = [
      {
        node: root,
        index: 0,
        ancestorHardExcluded: false,
        ancestorHasPrecedence: false
      }
    ];

    while (stack.length) {
      const frame = stack[stack.length - 1];
      const children = frame.node.children;
      if (frame.index < children.length) {
        const child = children[frame.index];
        frame.index += 1;
        const childHardExcluded =
          frame.ancestorHardExcluded ||
          hardExcludedSet.has(frame.node) ||
          hardExcludedSet.has(child);
        const childHasPrecedence =
          frame.ancestorHasPrecedence ||
          precedenceSet.has(frame.node) ||
          precedenceSet.has(child);
        stack.push({
          node: child,
          index: 0,
          ancestorHardExcluded: childHardExcluded,
          ancestorHasPrecedence: childHasPrecedence
        });
        continue;
      }

      const node = frame.node;
      const excludedSelf = excludedSet.has(node);
      const isRoot = node === document.body || node === document.documentElement;
      const candidate =
        !excludedSelf &&
        !isRoot &&
        !frame.ancestorHardExcluded &&
        !frame.ancestorHasPrecedence &&
        isTextualContainer(node) &&
        !hasHigherPrecedence(node);

      if (candidate) {
        results.push(node);
      }
      stack.pop();
    }

    return results;
  }

  function collectSelectorElements(selectors) {
    const elements = new Set();
    for (const selector of selectors || []) {
      try {
        document.querySelectorAll(selector).forEach((el) => {
          elements.add(el);
        });
      } catch (error) {
        continue;
      }
    }
    return elements;
  }

  function collectDefaultExcludedElements(toggleableTargets) {
    const toggleable = new Set();
    const immutable = new Set();

    if (IMMUTABLE_TAG_SELECTOR) {
      const elements = document.querySelectorAll(IMMUTABLE_TAG_SELECTOR);
      for (const el of elements) {
        if (isVisible(el)) {
          immutable.add(el);
        }
      }
    }

    for (const selector of HARD_EXCLUDED_SELECTORS) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          if (isVisible(el)) {
            immutable.add(el);
          }
        }
      } catch (error) {
        continue;
      }
    }

    if (toggleableTargets) {
      for (const el of toggleableTargets) {
        toggleable.add(el);
      }
    }

    return { toggleable, immutable };
  }

  function collectHeadingDefaultStatus(config) {
    if (!config || !TOGGLEABLE_TAG_SELECTOR) {
      return [];
    }
    const results = new Map();
    const toggleableTargets = collectHeadingToggleableTargets();
    for (const el of toggleableTargets) {
      const xpath = getXPath(el);
      if (!xpath || results.has(xpath)) {
        continue;
      }
      const text = (el.innerText || "").trim();
      results.set(xpath, {
        xpath,
        text: text || el.tagName.toLowerCase()
      });
    }

    const disabled = new Set(config.defaultToggleExclusionsDisabled || []);
    return Array.from(results.values()).map((item) => ({
      ...item,
      excluded: !disabled.has(item.xpath)
    }));
  }

  function collectToggleableExcludedXPaths(config) {
    if (!config) {
      return [];
    }
    const disabled = new Set(config.defaultToggleExclusionsDisabled || []);
    const targets = collectHeadingToggleableTargets();
    const results = new Set();
    for (const el of targets) {
      const xpath = getXPath(el);
      if (xpath && !disabled.has(xpath)) {
        results.add(xpath);
      }
    }
    return Array.from(results);
  }

  function createOverlay() {
    if (state.overlay) {
      return;
    }

    const style = document.createElement("style");
    style.id = "markcontit-freeze-style";
    style.textContent = `
      * {
        animation: none !important;
        transition: none !important;
      }
      html {
        scroll-behavior: auto !important;
      }
      #markcontit-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 2147483647;
        pointer-events: auto;
      }
      #markcontit-overlay .mc-layer {
        position: absolute;
        inset: 0;
        pointer-events: none;
        transition: opacity 0.15s ease;
      }
      #markcontit-overlay.mc-scrolling .mc-layer {
        opacity: 0;
      }
      #markcontit-overlay .mc-rect {
        position: absolute;
        box-sizing: border-box;
        pointer-events: none;
        border-radius: 4px;
      }
      #markcontit-overlay .mc-hover {
        border: 2px solid #ffb300;
        background: rgba(255, 179, 0, 0.1);
      }
      @keyframes blink {
        0%,100% { opacity: 0 }
        50% { opacity: 1 }
      }
      #markcontit-overlay .mc-focus {
        border: 3px solid #00acc1;
        background: rgba(0, 172, 193, 0.12);
        box-shadow: 0px 0px 5px 5px #00acc178;
        opacity: 1;
        animation: blink 1s linear infinite !important;
      }
      #markcontit-overlay .mc-hard-toggle {
        border: 2px solid #b71c1c;
        background: rgba(183, 28, 28, 0.12);
      }
      #markcontit-overlay .mc-hard-locked {
        border: 2px dashed #9c6b6b;
        background: rgba(183, 28, 28, 0.08);
      }
      #markcontit-overlay .mc-default {
        border: 1px solid #2e7d32;
        background: rgba(46, 125, 50, 0.08);
      }
      @keyframes mc-ai-content-dash {
        0% {
          background-position: 0 0, 0 100%, 0 0, 100% 0;
        }
        100% {
          background-position: 24px 0, -24px 100%, 0 -24px, 100% 24px;
        }
      }
      #markcontit-overlay .mc-ai-content {
        border: 1px solid transparent;
        background-color: rgba(46, 125, 50, 0.08);
        background-image:
          repeating-linear-gradient(90deg, #2e7d32 0 6px, transparent 6px 12px),
          repeating-linear-gradient(90deg, #2e7d32 0 6px, transparent 6px 12px),
          repeating-linear-gradient(0deg, #2e7d32 0 6px, transparent 6px 12px),
          repeating-linear-gradient(0deg, #2e7d32 0 6px, transparent 6px 12px);
        background-size: 24px 1px, 24px 1px, 1px 24px, 1px 24px;
        background-position: 0 0, 0 100%, 0 0, 100% 0;
        background-repeat: repeat-x, repeat-x, repeat-y, repeat-y;
        background-origin: border-box;
        background-clip: border-box;
        animation: mc-ai-content-dash 2s linear infinite !important;
      }
      #markcontit-overlay .mc-explicit-include {
        border: 3px solid #1b5e20;
        background: rgba(27, 94, 32, 0.2);
      }
      #markcontit-overlay .mc-explicit-exclude {
        border: 3px solid #c62828;
        background: rgba(198, 40, 40, 0.2);
      }
      #markcontit-overlay .mc-toast {
        position: fixed;
        left: 14px;
        right: 14px;
        bottom: 14px;
        padding: 10px 12px;
        background: rgba(47, 42, 36, 0.9);
        color: #fdf6ed;
        font-family: "Palatino Linotype", "Book Antiqua", Palatino, serif;
        font-size: 12px;
        border-radius: 10px;
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 0.2s ease, transform 0.2s ease;
        pointer-events: none;
      }
      #markcontit-overlay .mc-toast.mc-toast-show {
        opacity: 1;
        transform: translateY(0);
      }
    `;
    document.documentElement.appendChild(style);

    const overlay = document.createElement("div");
    overlay.id = "markcontit-overlay";

    const layerKeys = [
      "hard",
      "explicit-exclude",
      "explicit-include",
      "ai-content",
      "default",
      "focus",
      "hover"
    ];

    layerKeys.forEach((key) => {
      const layer = document.createElement("div");
      layer.className = "mc-layer";
      layer.dataset.layer = key;
      overlay.appendChild(layer);
      state.layers[key] = layer;
    });

    const hoverBox = document.createElement("div");
    hoverBox.className = "mc-rect mc-hover";
    hoverBox.style.display = "none";
    state.layers.hover.appendChild(hoverBox);
    state.hoverBox = hoverBox;

    const focusBox = document.createElement("div");
    focusBox.className = "mc-rect mc-focus";
    focusBox.style.display = "none";
    state.layers.focus.appendChild(focusBox);
    state.focusBox = focusBox;

    const toast = document.createElement("div");
    toast.className = "mc-toast";
    overlay.appendChild(toast);
    state.toast = toast;

    overlay.addEventListener("mousemove", handleMouseMove, true);
    overlay.addEventListener("click", handleClick, true);
    overlay.addEventListener("contextmenu", handleContextMenu, true);
    document.documentElement.appendChild(overlay);
    state.overlay = overlay;
    if (state.altPassThrough) {
      setAltPassThrough(true);
    }

    window.addEventListener("keydown", handleKeydown, true);
    window.addEventListener("click", handleAltClick, true);
    window.addEventListener("keyup", handleKeyup, true);
    updateOverlayGutter();
  }

  function removeOverlay() {
    if (state.overlay) {
      state.overlay.removeEventListener("mousemove", handleMouseMove, true);
      state.overlay.removeEventListener("click", handleClick, true);
      state.overlay.removeEventListener("contextmenu", handleContextMenu, true);
      state.overlay.remove();
      state.overlay = null;
      state.layers = {};
      state.hoverBox = null;
      state.focusBox = null;
      state.focusElement = null;
      state.toast = null;
    }
    window.removeEventListener("keydown", handleKeydown, true);
    window.removeEventListener("click", handleAltClick, true);
    window.removeEventListener("keyup", handleKeyup, true);
    const style = document.getElementById("markcontit-freeze-style");
    if (style) {
      style.remove();
    }
    clearMarkedElements();
    state.altPassThrough = false;
  }

  function updateOverlayGutter() {
    if (!state.overlay) {
      return;
    }
    const verticalGutter = window.innerWidth - document.documentElement.clientWidth;
    const horizontalGutter =
      window.innerHeight - document.documentElement.clientHeight;
    state.overlay.style.right = verticalGutter > 0 ? `${verticalGutter}px` : "0px";
    state.overlay.style.bottom =
      horizontalGutter > 0 ? `${horizontalGutter}px` : "0px";
  }

  function showToast(message) {
    if (!state.toast) {
      return;
    }
    state.toast.textContent = message;
    state.toast.classList.add("mc-toast-show");
    clearTimeout(state.toastHideTimer);
    state.toastHideTimer = setTimeout(() => {
      if (state.toast) {
        state.toast.classList.remove("mc-toast-show");
      }
    }, 1800);
  }

  function updateFocusHighlight() {
    if (!state.focusBox) {
      return;
    }
    if (!state.focusElement) {
      state.focusBox.style.display = "none";
      return;
    }
    const rect = getVisibleRect(state.focusElement);
    if (!rect) {
      state.focusBox.style.display = "none";
      return;
    }
    state.focusBox.style.display = "block";
    state.focusBox.style.top = `${rect.top}px`;
    state.focusBox.style.left = `${rect.left}px`;
    state.focusBox.style.width = `${rect.width}px`;
    state.focusBox.style.height = `${rect.height}px`;
  }

  function clearFocusHighlight() {
    if (!state.focusElement) {
      return;
    }
    state.focusElement = null;
    updateFocusHighlight();
  }

  function ensureAiPopoverStyle() {
    if (document.getElementById("markcontit-ai-popover-style")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "markcontit-ai-popover-style";
    style.textContent = `
      .mc-ai-popover {
        position: fixed;
        inset: 0;
        background: #ffffff;
        z-index: 2147483648;
        overflow: auto;
      }
      .mc-ai-popover-toolbar {
        position: fixed;
        top: 12px;
        right: 12px;
        z-index: 2147483649;
      }
      .mc-ai-popover-close {
        border: 1px solid #8a6f52;
        background: #f8e9d5;
        color: #6c4c2b;
        border-radius: 999px;
        padding: 6px 12px;
        cursor: pointer;
        font-size: 12px;
      }
      .mc-ai-popover-list {
        max-width: 720px;
        margin: 60px auto 40px;
        padding: 0 28px 24px 44px;
        display: grid;
        gap: 8px;
        font-size: 13px;
        line-height: 1.35;
        color: #2f2a24;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function closeAiPopover() {
    if (state.aiPopover) {
      state.aiPopover.remove();
      state.aiPopover = null;
    }
  }

  function collectPreviewItems(selectors) {
    const seen = new Set();
    const rows = [];
    for (const selector of selectors) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          if (!el || el.nodeType !== 1 || seen.has(el)) {
            continue;
          }
          if (!isVisible(el)) {
            continue;
          }
          seen.add(el);
          const rect = el.getBoundingClientRect();
          const text = (el.innerText || "").replace(/\s+/g, " ").trim();
          if (!text) {
            continue;
          }
          rows.push({
            text,
            top: rect.top + window.scrollY,
            left: rect.left + window.scrollX
          });
        }
      } catch (error) {
        continue;
      }
    }
    rows.sort((a, b) => {
      if (a.top === b.top) {
        return a.left - b.left;
      }
      return a.top - b.top;
    });
    return rows.map((row) => row.text);
  }

  function showAiPopover(items) {
    ensureAiPopoverStyle();
    closeAiPopover();
    const popover = document.createElement("div");
    popover.className = "mc-ai-popover";
    const toolbar = document.createElement("div");
    toolbar.className = "mc-ai-popover-toolbar";
    const close = document.createElement("button");
    close.className = "mc-ai-popover-close";
    close.type = "button";
    close.textContent = "Close";
    close.addEventListener("click", () => closeAiPopover());
    toolbar.appendChild(close);
    const list = document.createElement("ul");
    list.className = "mc-ai-popover-list";
    if (!items.length) {
      const empty = document.createElement("li");
      empty.textContent = "No content found";
      list.appendChild(empty);
    } else {
      items.forEach((text) => {
        const li = document.createElement("li");
        li.textContent = text;
        list.appendChild(li);
      });
    }
    popover.appendChild(toolbar);
    popover.appendChild(list);
    document.documentElement.appendChild(popover);
    state.aiPopover = popover;
  }

  function recordPageSnapshot(config, pageUrl, xpaths) {
    if (!config || !pageUrl) {
      return;
    }
    if (!config.pageHtmlSnapshots || typeof config.pageHtmlSnapshots !== "object") {
      config.pageHtmlSnapshots = {};
    }
    if (!config.pageMarkings || typeof config.pageMarkings !== "object") {
      config.pageMarkings = {};
    }
    const html = document.documentElement.outerHTML;
    const explicitList = Array.isArray(xpaths)
      ? xpaths
      : (config.explicitXPathDecisions &&
          config.explicitXPathDecisions.exclude) ||
        [];
    const toggleableExcluded = collectToggleableExcludedXPaths(config);
    const combined = new Set([...explicitList, ...toggleableExcluded]);
    const filtered = Array.from(combined).filter((xpath) => {
      const el = getElementFromXPath(xpath);
      return el && isVisible(el);
    });
    if (filtered.length === 0) {
      delete config.pageMarkings[pageUrl];
    } else {
      config.pageMarkings[pageUrl] = {
        url: pageUrl,
        title: document.title || pageUrl,
        xpaths: filtered,
        html
      };
    }
    config.pageHtmlSnapshots[pageUrl] = html;
  }

  function queueConfigSave() {
    if (!state.baseUrl || !state.config) {
      return;
    }
    if (state.saveTimer) {
      return;
    }
    state.saveTimer = window.setTimeout(async () => {
      state.saveTimer = 0;
      if (state.saveInFlight) {
        state.saveAgain = true;
        return;
      }
      state.saveInFlight = true;
      state.saveAgain = false;
      try {
        if (state.baseUrl && state.config) {
          await saveConfig(state.baseUrl, state.config);
        }
      } finally {
        state.saveInFlight = false;
      }
      if (state.saveAgain) {
        queueConfigSave();
      }
    }, 120);
  }

  function scheduleSnapshotSave() {
    if (!state.baseUrl || !state.config) {
      return;
    }
    if (state.snapshotTimer) {
      window.clearTimeout(state.snapshotTimer);
    }
    state.snapshotTimer = window.setTimeout(() => {
      state.snapshotTimer = 0;
      if (!state.baseUrl || !state.config) {
        return;
      }
      recordPageSnapshot(
        state.config,
        location.href,
        state.config.explicitXPathDecisions.exclude
      );
      queueConfigSave();
    }, 220);
  }

  function setAltPassThrough(enabled) {
    state.altPassThrough = enabled;
    if (!state.overlay) {
      return;
    }
    state.overlay.style.pointerEvents = enabled ? "none" : "auto";
    state.overlay.style.opacity = enabled ? "0.5" : "1";
    if (enabled && state.hoverBox) {
      state.hoverBox.style.display = "none";
    }
    if (!enabled) {
      scheduleRender();
    }
  }

  function getMarkId(el) {
    if (!el || el.nodeType !== 1) {
      return "";
    }
    let id = state.markIds.get(el);
    if (!id) {
      id = `mc-${state.markIdCounter}`;
      state.markIdCounter += 1;
      state.markIds.set(el, id);
    }
    return id;
  }

  function clearMarkedElements() {
    if (!state.markedElements) {
      return;
    }
    for (const el of state.markedElements) {
      if (el && el.nodeType === 1) {
        el.removeAttribute("data-mc-mark-id");
      }
    }
    state.markedElements = new Set();
  }

  function updateMarkedElements(currentMarked) {
    if (!currentMarked) {
      return;
    }
    const previous = state.markedElements || new Set();
    for (const el of previous) {
      if (!currentMarked.has(el) && el && el.nodeType === 1) {
        el.removeAttribute("data-mc-mark-id");
      }
    }
    for (const el of currentMarked) {
      if (!previous.has(el) && el && el.nodeType === 1) {
        const markId = getMarkId(el);
        if (markId) {
          el.setAttribute("data-mc-mark-id", markId);
        }
      }
    }
    state.markedElements = currentMarked;
  }

  function getTargetElement(x, y) {
    const elements = document.elementsFromPoint(x, y);
    for (const el of elements) {
      if (!el || el.nodeType !== 1) {
        continue;
      }
      if (state.overlay && (el === state.overlay || state.overlay.contains(el))) {
        continue;
      }
      if (el === document.documentElement || el === document.body) {
        continue;
      }
      return el;
    }
    return null;
  }

  function isMarkableElement(el, config) {
    if (!config) {
      return false;
    }
    if (!isTextualContainer(el)) {
      return false;
    }
    if (isWithinHardExcluded(el)) {
      return false;
    }
    return true;
  }

  function resolveMarkableElement(el, config) {
    if (!isMarkableElement(el, config)) {
      return null;
    }
    return el;
  }

  function getMarkableTarget(x, y) {
    const elements = document.elementsFromPoint(x, y);
    for (const el of elements) {
      if (!el || el.nodeType !== 1) {
        continue;
      }
      if (state.overlay && (el === state.overlay || state.overlay.contains(el))) {
        continue;
      }
      if (el === document.documentElement || el === document.body) {
        continue;
      }
      const resolved = resolveMarkableElement(el, state.config);
      if (resolved) {
        return resolved;
      }
    }
    return null;
  }

  function handleMouseMove(event) {
    if (!state.enabled) {
      return;
    }
    event.stopPropagation();
    const target = getMarkableTarget(event.clientX, event.clientY);
    if (!target) {
      if (state.hoverBox) {
        state.hoverBox.style.display = "none";
      }
      return;
    }
    const rect = getVisibleRect(target);
    if (!rect || !state.hoverBox) {
      if (state.hoverBox) {
        state.hoverBox.style.display = "none";
      }
      return;
    }
    state.hoverBox.style.display = "block";
    state.hoverBox.style.top = `${rect.top}px`;
    state.hoverBox.style.left = `${rect.left}px`;
    state.hoverBox.style.width = `${rect.width}px`;
    state.hoverBox.style.height = `${rect.height}px`;
  }

  function toggleExplicit(target) {
    if (!state.baseUrl || !state.config) {
      return;
    }
    if (isWithinHardExcluded(target)) {
      showToast("Default exclusions cannot be overridden");
      return;
    }

    const xpath = getXPath(target);
    if (!xpath) {
      return;
    }

    const config = state.config;
    const exclude = new Set(
      (config.explicitXPathDecisions && config.explicitXPathDecisions.exclude) ||
        []
    );
    const toggleDisabled = new Set(
      config.defaultToggleExclusionsDisabled || []
    );
    const cleanupHierarchy = (currentXPath) => {
      Array.from(exclude).forEach((existingXPath) => {
        if (existingXPath === currentXPath) {
          return;
        }
        const existingEl = getElementFromXPath(existingXPath);
        if (!existingEl) {
          return;
        }
        if (existingEl.contains(target) || target.contains(existingEl)) {
          exclude.delete(existingXPath);
        }
      });
    };

    let addedExclude = false;
    const isToggleable = isToggleableDefaultTarget(target, config);
    if (isToggleable) {
      const wasDisabled = toggleDisabled.has(xpath);
      if (wasDisabled) {
        toggleDisabled.delete(xpath);
        addedExclude = true;
      } else {
        toggleDisabled.add(xpath);
      }
      exclude.delete(xpath);
      if (addedExclude) {
        cleanupHierarchy(xpath);
      }
    } else {
      if (exclude.has(xpath)) {
        exclude.delete(xpath);
      } else {
        exclude.add(xpath);
        addedExclude = true;
      }
      if (addedExclude) {
        cleanupHierarchy(xpath);
      }
    }

    config.explicitXPathDecisions = {
      include: [],
      exclude: Array.from(exclude)
    };
    config.defaultToggleExclusionsDisabled = Array.from(toggleDisabled);
    state.config = config;
    scheduleRender();
    queueConfigSave();
    scheduleSnapshotSave();
  }

  function handleToggleEvent(event) {
    if (!state.enabled) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (state.focusElement) {
      const rawTarget = getTargetElement(event.clientX, event.clientY);
      if (!rawTarget || !state.focusElement.contains(rawTarget)) {
        clearFocusHighlight();
      }
    }
    const target = getMarkableTarget(event.clientX, event.clientY);
    if (target) {
      toggleExplicit(target);
    }
  }

  function handleClick(event) {
    handleToggleEvent(event);
  }

  function handleContextMenu(event) {
    handleToggleEvent(event);
  }

  function handleKeydown(event) {
    if (!state.enabled) {
      return;
    }
    if (event.key === "Alt") {
      setAltPassThrough(true);
      return;
    }
  }

  function handleKeyup(event) {
    if (!state.enabled) {
      return;
    }
    if (event.key === "Alt") {
      setAltPassThrough(false);
    }
  }

  function handleScroll() {
    if (!state.enabled || state.aiPopover || !state.overlay) {
      return;
    }
    if (!state.isScrolling) {
      state.isScrolling = true;
      state.overlay.classList.add("mc-scrolling");
    }
    if (state.scrollHideTimer) {
      window.clearTimeout(state.scrollHideTimer);
    }
    state.scrollHideTimer = window.setTimeout(() => {
      state.scrollHideTimer = 0;
      if (!state.overlay) {
        state.isScrolling = false;
        return;
      }
      window.requestAnimationFrame(() => {
        state.isScrolling = false;
        renderHighlights();
        if (state.overlay) {
          state.overlay.classList.remove("mc-scrolling");
        }
      });
    }, 50);
  }

  function handleAltClick(event) {
    if (!state.enabled || !state.altPassThrough) {
      return;
    }
    if (state.aiPopover) {
      return;
    }
    if (!event.altKey) {
      return;
    }
    const target = event.target;
    if (!target || !target.closest) {
      return;
    }
    const link = target.closest("a[href]");
    if (!link) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const href = link.href;
    if (!href) {
      return;
    }
    const openInNewTab =
      link.target === "_blank" || event.metaKey || event.ctrlKey || event.shiftKey;
    if (openInNewTab) {
      window.open(href, link.target || "_blank");
    } else {
      window.location.assign(href);
    }
  }

  function clearLayer(layer) {
    if (!layer) {
      return;
    }
    while (layer.firstChild) {
      layer.removeChild(layer.firstChild);
    }
  }

  function drawRect(layer, rect, className, el, kind, markedSet) {
    const box = document.createElement("div");
    box.className = `mc-rect ${className}`;
    box.style.top = `${rect.top}px`;
    box.style.left = `${rect.left}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    if (el) {
      const markId = getMarkId(el);
      if (markId) {
        box.dataset.mcMarkId = markId;
        if (kind) {
          box.dataset.mcMarkKind = kind;
        }
        if (markedSet) {
          markedSet.add(el);
        }
      }
    }
    layer.appendChild(box);
  }

  function scheduleRender() {
    if (state.renderTimer) {
      return;
    }
    state.renderTimer = window.setTimeout(() => {
      state.renderTimer = 0;
      if (state.renderRaf) {
        return;
      }
      state.renderRaf = window.requestAnimationFrame(() => {
        state.renderRaf = 0;
        renderHighlights();
      });
    }, 50);
  }

  function renderHighlights() {
    if (!state.enabled || !state.overlay) {
      return;
    }

    updateOverlayGutter();

    state.headingToggleableTargets = collectHeadingToggleableTargets();
    const defaultExcluded = collectDefaultExcludedElements(
      state.headingToggleableTargets
    );
    const immutableExcluded = defaultExcluded.immutable;
    const disabledToggleable = collectXPathElements(
      state.config.defaultToggleExclusionsDisabled
    );
    const toggleableExcluded = new Set(
      Array.from(defaultExcluded.toggleable).filter(
        (el) => !disabledToggleable.has(el)
      )
    );
    const allDefaultExcluded = new Set([
      ...immutableExcluded,
      ...toggleableExcluded
    ]);
    const explicitExclude = collectXPathElements(
      state.config.explicitXPathDecisions.exclude
    );
    const aiContent = collectSelectorElements(
      state.config.domainAiSelectorSet.exclusionSelectors
    );

    const layerHard = state.layers["hard"];
    const layerExplicitExclude = state.layers["explicit-exclude"];
    const layerExplicitInclude = state.layers["explicit-include"];
    const layerAiContent = state.layers["ai-content"];
    const layerDefault = state.layers["default"];

    clearLayer(layerHard);
    clearLayer(layerExplicitExclude);
    clearLayer(layerExplicitInclude);
    clearLayer(layerAiContent);
    clearLayer(layerDefault);
    const markedElements = new Set();

    const hasHigherPrecedence = (el) =>
      allDefaultExcluded.has(el) || explicitExclude.has(el) || aiContent.has(el);

    for (const el of immutableExcluded) {
      const rect = getVisibleRect(el);
      if (rect) {
        drawRect(layerHard, rect, "mc-hard-locked", el, "immutable", markedElements);
      }
    }

    for (const el of explicitExclude) {
      if (immutableExcluded.has(el)) {
        continue;
      }
      const rect = getVisibleRect(el);
      if (rect) {
        drawRect(
          layerExplicitExclude,
          rect,
          "mc-explicit-exclude",
          el,
          "explicit-exclude",
          markedElements
        );
      }
    }

    for (const el of toggleableExcluded) {
      if (explicitExclude.has(el)) {
        continue;
      }
      const rect = getVisibleRect(el);
      if (rect) {
        drawRect(
          layerExplicitExclude,
          rect,
          "mc-explicit-exclude",
          el,
          "toggleable-exclude",
          markedElements
        );
      }
    }

    for (const el of aiContent) {
      if (allDefaultExcluded.has(el) || explicitExclude.has(el)) {
        continue;
      }
      const rect = getVisibleRect(el);
      if (rect) {
        drawRect(
          layerAiContent,
          rect,
          "mc-ai-content",
          el,
          "ai-content",
          markedElements
        );
      }
    }

    if (state.config.showDefaultHighlights) {
      const excludedAndPrecedenceSet = new Set([
        ...allDefaultExcluded,
        ...explicitExclude,
        ...aiContent
      ]);
      const defaultTargets = collectDefaultHighlightTargets(document.body, {
        excludedSet: excludedAndPrecedenceSet,
        hardExcludedSet: allDefaultExcluded,
        hasHigherPrecedence,
        precedenceSet: excludedAndPrecedenceSet
      });
      for (const el of defaultTargets) {
        const rect = getVisibleRect(el);
        if (rect) {
          drawRect(layerDefault, rect, "mc-default", el, "default", markedElements);
        }
      }
    }

    updateFocusHighlight();
    updateMarkedElements(markedElements);
  }

  function startObservers() {
    if (state.mutationObserver) {
      return;
    }
    state.mutationObserver = new MutationObserver((mutations) => {
      try {
        if (state.overlay) {
          const hasNonOverlayChange = mutations.some((mutation) => {
            const target = mutation.target;
            return !(target === state.overlay || state.overlay.contains(target));
          });
          if (!hasNonOverlayChange) {
            return;
          }
        }
        scheduleRender();
      } catch (error) {
        // Silently handle errors to prevent observer from stopping
      }
    });
    if (document.body) {
      try {
        state.mutationObserver.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true
        });
      } catch (error) {
        // Silently handle if body is not available
        state.mutationObserver = null;
      }
    }
  }

  function stopObservers() {
    if (state.mutationObserver) {
      state.mutationObserver.disconnect();
      state.mutationObserver = null;
    }
  }

  function startUrlWatcher() {
    if (state.urlCheckTimer) {
      return;
    }
    let lastUrl = location.href;
    state.urlCheckTimer = window.setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        refreshFromTabState();
      }
    }, 800);
  }

  function stopUrlWatcher() {
    if (state.urlCheckTimer) {
      window.clearInterval(state.urlCheckTimer);
      state.urlCheckTimer = 0;
    }
  }

  async function enableForBaseUrl(baseUrl) {
    if (!baseUrl || !location.href.startsWith(baseUrl)) {
      disable();
      return;
    }
    state.enabled = true;
    state.baseUrl = baseUrl;
    state.config = await loadConfig(baseUrl);
    createOverlay();
    startObservers();
    startUrlWatcher();
    scheduleRender();
  }

  function disable() {
    state.enabled = false;
    state.baseUrl = "";
    state.config = null;
    state.altPassThrough = false;
    if (state.renderTimer) {
      window.clearTimeout(state.renderTimer);
      state.renderTimer = 0;
    }
    if (state.renderRaf) {
      window.cancelAnimationFrame(state.renderRaf);
      state.renderRaf = 0;
    }
    if (state.scrollHideTimer) {
      window.clearTimeout(state.scrollHideTimer);
      state.scrollHideTimer = 0;
    }
    if (state.saveTimer) {
      window.clearTimeout(state.saveTimer);
      state.saveTimer = 0;
    }
    if (state.snapshotTimer) {
      window.clearTimeout(state.snapshotTimer);
      state.snapshotTimer = 0;
    }
    state.saveInFlight = false;
    state.saveAgain = false;
    state.isScrolling = false;
    removeOverlay();
    closeAiPopover();
    const popoverStyle = document.getElementById("markcontit-ai-popover-style");
    if (popoverStyle) {
      popoverStyle.remove();
    }
    stopObservers();
    stopUrlWatcher();
  }

  async function refreshFromTabState() {
    const response = await sendMessage({ type: "getTabState" });
    if (response && response.enabled && response.baseUrl) {
      if (location.href.startsWith(response.baseUrl)) {
        enableForBaseUrl(response.baseUrl);
        return;
      }
    }
    disable();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) {
      return;
    }

    if (message.type === "setEnabled") {
      if (message.enabled) {
        enableForBaseUrl(message.baseUrl);
      } else {
        disable();
      }
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "configUpdated") {
      if (state.enabled && message.baseUrl === state.baseUrl) {
        loadConfig(state.baseUrl).then((config) => {
          state.config = config;
          scheduleRender();
        });
      }
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "forceRefresh") {
      refreshFromTabState().then(() => {
        sendResponse({ ok: true });
      });
      return true;
    }

    if (message.type === "getDefaultExclusions") {
      sendResponse({
        immutableTags: DEFAULT_EXCLUDED_TAGS_IMMUTABLE.slice()
      });
      return;
    }

    if (message.type === "collectPageData") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      loadConfig(targetBaseUrl).then((config) => {
        sendResponse({
          baseUrl: targetBaseUrl,
          pageUrl: location.href,
          fullHtml: document.documentElement.outerHTML,
          defaultExclusions: {
            tags: DEFAULT_EXCLUDED_TAGS,
            selectors: HARD_EXCLUDED_SELECTORS
          },
          xpathsInclude: [],
          xpathsExclude: config.explicitXPathDecisions.exclude
        });
      });
      return true;
    }

    if (message.type === "getHeadingDefaultStatus") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      loadConfig(targetBaseUrl).then((config) => {
        sendResponse({ items: collectHeadingDefaultStatus(config) });
      });
      return true;
    }

    if (message.type === "filterXPathsOnPage") {
      const xpaths = Array.isArray(message.xpaths) ? message.xpaths : [];
      const filtered = xpaths.filter((xpath) => {
        const el = getElementFromXPath(xpath);
        return el && isVisible(el);
      });
      sendResponse({ xpaths: filtered });
      return;
    }

    if (message.type === "describeXPathsOnPage") {
      const xpaths = Array.isArray(message.xpaths) ? message.xpaths : [];
      const items = [];
      xpaths.forEach((xpath) => {
        const el = getElementFromXPath(xpath);
        if (!el || !isVisible(el)) {
          return;
        }
        items.push({ xpath, text: getElementLabel(el) });
      });
      sendResponse({ items });
      return;
    }

    if (message.type === "focusElement") {
      const xpath = message.xpath || "";
      const target = xpath ? getElementFromXPath(xpath) : null;
      if (!target) {
        sendResponse({ ok: false });
        return;
      }
      state.focusElement = target;
      target.scrollIntoView({ block: "center", inline: "center" });
      scheduleRender();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "clearFocus") {
      clearFocusHighlight();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "toggleHeadingDefault") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      const xpath = message.xpath || "";
      if (!xpath) {
        sendResponse({ ok: false });
        return;
      }
      loadConfig(targetBaseUrl).then(async (config) => {
        const target = getElementFromXPath(xpath);
        if (!target || !isToggleableDefaultTarget(target, config)) {
          sendResponse({ ok: false });
          return;
        }
        const toggleDisabled = new Set(
          config.defaultToggleExclusionsDisabled || []
        );
        if (toggleDisabled.has(xpath)) {
          toggleDisabled.delete(xpath);
        } else {
          toggleDisabled.add(xpath);
        }
        config.defaultToggleExclusionsDisabled = Array.from(toggleDisabled);
        recordPageSnapshot(
          config,
          location.href,
          config.explicitXPathDecisions.exclude
        );
        await saveConfig(targetBaseUrl, config);
        if (state.baseUrl === targetBaseUrl) {
          state.config = config;
          scheduleRender();
        }
        sendResponse({ ok: true });
      });
      return true;
    }

    if (message.type === "capturePageSnapshot") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      if (!targetBaseUrl) {
        sendResponse({ ok: false });
        return;
      }
      const xpaths = Array.isArray(message.xpaths) ? message.xpaths : null;
      loadConfig(targetBaseUrl).then(async (config) => {
        recordPageSnapshot(
          config,
          location.href,
          xpaths || config.explicitXPathDecisions.exclude
        );
        await saveConfig(targetBaseUrl, config);
        if (state.baseUrl === targetBaseUrl) {
          state.config = config;
        }
        sendResponse({ ok: true });
      });
      return true;
    }

    if (message.type === "showAiPreview") {
      const selectors = Array.isArray(message.selectors) ? message.selectors : [];
      const items = collectPreviewItems(selectors);
      showAiPopover(items);
      sendResponse({ ok: true, count: items.length });
      return;
    }
  });

  window.addEventListener("resize", scheduleRender);
  window.addEventListener("scroll", handleScroll, { passive: true });

  refreshFromTabState();
})();
