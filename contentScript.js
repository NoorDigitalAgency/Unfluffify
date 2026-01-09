(() => {
  const HARD_EXCLUDED_TAGS = [
    "IMG",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
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

  const BLOCKLIKE_DISPLAYS = new Set([
    "block",
    "flex",
    "grid",
    "table",
    "table-row",
    "table-cell",
    "list-item",
    "flow-root",
    "inline-block",
    "inline-flex",
    "inline-grid"
  ]);

  const state = {
    enabled: false,
    baseUrl: "",
    config: null,
    overlay: null,
    layers: {},
    hoverBox: null,
    toast: null,
    toastHideTimer: 0,
    renderRaf: 0,
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
      domainAiSelectorSet: {
        inclusionSelectors: [],
        exclusionSelectors: []
      }
    };
  }

  async function loadConfig(baseUrl) {
    const result = await storageGet("configs");
    const configs = result.configs || {};
    if (!configs[baseUrl]) {
      configs[baseUrl] = createDefaultConfig(baseUrl);
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
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    if (parseFloat(style.opacity) === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }
    return true;
  }

  function hasDirectText(el) {
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        return true;
      }
    }
    return false;
  }

  function hasTextualElementChild(el) {
    for (const child of el.children) {
      if (!isVisible(child)) {
        continue;
      }
      if (child.innerText && child.innerText.trim().length > 0) {
        return true;
      }
    }
    return false;
  }

  function isTextualContainer(el) {
    if (!isVisible(el)) {
      return false;
    }
    const text = el.innerText;
    if (!text || !text.trim()) {
      return false;
    }
    const style = window.getComputedStyle(el);
    if (BLOCKLIKE_DISPLAYS.has(style.display)) {
      return true;
    }
    return hasDirectText(el) && !hasTextualElementChild(el);
  }

  function matchesHardExcluded(el) {
    if (!el || el.nodeType !== 1) {
      return false;
    }
    if (HARD_EXCLUDED_TAGS.includes(el.tagName)) {
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

  function isWithinHardExcluded(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      if (matchesHardExcluded(node)) {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  function hasExcludedDescendant(
    target,
    config,
    {
      includeHardExcludes = true,
      includeExplicitExcludes = true,
      includeAiExcludes = true
    } = {}
  ) {
    if (!target || !config) {
      return false;
    }
    if (includeHardExcludes) {
      const tagSelector = HARD_EXCLUDED_TAGS.map((tag) =>
        tag.toLowerCase()
      ).join(",");
      if (tagSelector && target.querySelector(tagSelector)) {
        return true;
      }
      for (const selector of HARD_EXCLUDED_SELECTORS) {
        try {
          if (target.querySelector(selector)) {
            return true;
          }
        } catch (error) {
          continue;
        }
      }
    }
    if (includeExplicitExcludes) {
      for (const xpath of config.explicitXPathDecisions.exclude || []) {
        const excludedEl = getElementFromXPath(xpath);
        if (excludedEl && excludedEl !== target && target.contains(excludedEl)) {
          return true;
        }
      }
    }
    if (includeAiExcludes) {
      for (const selector of config.domainAiSelectorSet.exclusionSelectors || []) {
        try {
          if (target.querySelector(selector)) {
            return true;
          }
        } catch (error) {
          continue;
        }
      }
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
      precedenceSet = new Set(),
      explicitIncludeSet = new Set()
    } = options || {};
    const results = [];
    const stack = [
      {
        node: root,
        index: 0,
        hasExcludedDescendant: false,
        hasCandidateDescendant: false,
        hasExplicitIncludeDescendant: false,
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
          hasExcludedDescendant: false,
          hasCandidateDescendant: false,
          hasExplicitIncludeDescendant: false,
          ancestorHardExcluded: childHardExcluded,
          ancestorHasPrecedence: childHasPrecedence
        });
        continue;
      }

      const node = frame.node;
      const excludedSelf = excludedSet.has(node);
      const explicitIncludeSelf = explicitIncludeSet.has(node);
      const isRoot = node === document.body || node === document.documentElement;
      const candidate =
        !excludedSelf &&
        !isRoot &&
        !frame.ancestorHardExcluded &&
        !frame.ancestorHasPrecedence &&
        isTextualContainer(node) &&
        !hasHigherPrecedence(node) &&
        !frame.hasExcludedDescendant &&
        !frame.hasExplicitIncludeDescendant;

      if (candidate && !frame.hasCandidateDescendant) {
        results.push(node);
      }

      const hasExcludedSubtree = excludedSelf || frame.hasExcludedDescendant;
      const hasCandidateSubtree = candidate || frame.hasCandidateDescendant;
      const hasExplicitIncludeSubtree =
        explicitIncludeSelf || frame.hasExplicitIncludeDescendant;

      stack.pop();
      if (stack.length) {
        const parent = stack[stack.length - 1];
        if (hasExcludedSubtree) {
          parent.hasExcludedDescendant = true;
        }
        if (hasCandidateSubtree) {
          parent.hasCandidateDescendant = true;
        }
        if (hasExplicitIncludeSubtree) {
          parent.hasExplicitIncludeDescendant = true;
        }
      }
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

  function collectHardExcludedElements() {
    const elements = new Set();
    const tagSelector = HARD_EXCLUDED_TAGS.map((tag) => tag.toLowerCase()).join(",");
    if (tagSelector) {
      document.querySelectorAll(tagSelector).forEach((el) => elements.add(el));
    }
    for (const selector of HARD_EXCLUDED_SELECTORS) {
      try {
        document.querySelectorAll(selector).forEach((el) => elements.add(el));
      } catch (error) {
        continue;
      }
    }
    return elements;
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
      #markcontit-overlay .mc-hard {
        border: 2px solid #b71c1c;
        background: rgba(183, 28, 28, 0.12);
      }
      #markcontit-overlay .mc-default {
        border: 1px solid #2e7d32;
        background: rgba(46, 125, 50, 0.08);
      }
      #markcontit-overlay .mc-ai-include {
        border: 2px solid #1565c0;
        background: rgba(21, 101, 192, 0.12);
      }
      #markcontit-overlay .mc-ai-exclude {
        border: 2px dashed #ef6c00;
        background: rgba(239, 108, 0, 0.12);
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
        top: 16px;
        right: 16px;
        max-width: 320px;
        padding: 10px 14px;
        background: rgba(20, 20, 20, 0.9);
        color: #f6f4ef;
        font-family: "Palatino Linotype", "Book Antiqua", Palatino, serif;
        font-size: 13px;
        border-radius: 8px;
        opacity: 0;
        transform: translateY(-6px);
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
      "ai-exclude",
      "ai-include",
      "default",
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

    const toast = document.createElement("div");
    toast.className = "mc-toast";
    overlay.appendChild(toast);
    state.toast = toast;

    overlay.addEventListener("mousemove", handleMouseMove, true);
    overlay.addEventListener("click", handleClick, true);
    overlay.addEventListener("contextmenu", handleContextMenu, true);
    overlay.addEventListener("wheel", handleWheel, { passive: false, capture: true });

    document.documentElement.appendChild(overlay);
    state.overlay = overlay;

    window.addEventListener("keydown", handleKeydown, true);
    updateOverlayGutter();
  }

  function removeOverlay() {
    if (state.overlay) {
      state.overlay.removeEventListener("mousemove", handleMouseMove, true);
      state.overlay.removeEventListener("click", handleClick, true);
      state.overlay.removeEventListener("contextmenu", handleContextMenu, true);
      state.overlay.removeEventListener("wheel", handleWheel, true);
      state.overlay.remove();
      state.overlay = null;
      state.layers = {};
      state.hoverBox = null;
      state.toast = null;
    }
    window.removeEventListener("keydown", handleKeydown, true);
    const style = document.getElementById("markcontit-freeze-style");
    if (style) {
      style.remove();
    }
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
    if (
      hasExcludedDescendant(el, config, {
        includeExplicitExcludes: false
      })
    ) {
      return false;
    }
    return true;
  }

  function resolveMarkableElement(el, config) {
    if (!isMarkableElement(el, config)) {
      return null;
    }
    let current = el;
    while (current) {
      const markableChildren = [];
      for (const child of current.children) {
        if (isMarkableElement(child, config)) {
          markableChildren.push(child);
          if (markableChildren.length > 1) {
            break;
          }
        }
      }
      if (markableChildren.length === 1) {
        current = markableChildren[0];
        continue;
      }
      return current;
    }
    return null;
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

  async function toggleExplicit(target, type) {
    if (!state.baseUrl) {
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

    const config = await loadConfig(state.baseUrl);
    const include = new Set(config.explicitXPathDecisions.include || []);
    const exclude = new Set(config.explicitXPathDecisions.exclude || []);
    const cleanupHierarchy = (currentXPath) => {
      Array.from(include).forEach((existingXPath) => {
        if (existingXPath === currentXPath) {
          return;
        }
        const existingEl = getElementFromXPath(existingXPath);
        if (!existingEl) {
          return;
        }
        if (existingEl.contains(target) || target.contains(existingEl)) {
          include.delete(existingXPath);
        }
      });
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

    let addedInclude = false;
    let addedExclude = false;
    if (type === "include") {
      if (include.has(xpath)) {
        include.delete(xpath);
      } else {
        if (
          hasExcludedDescendant(target, config, {
            includeExplicitExcludes: false
          })
        ) {
          showToast("Cannot include an element containing excluded blocks");
          return;
        }
        include.add(xpath);
        exclude.delete(xpath);
        addedInclude = true;
      }
    } else {
      if (exclude.has(xpath)) {
        exclude.delete(xpath);
      } else {
        exclude.add(xpath);
        include.delete(xpath);
        addedExclude = true;
      }
    }

    if (addedInclude || addedExclude) {
      cleanupHierarchy(xpath);
    }

    config.explicitXPathDecisions = {
      include: Array.from(include),
      exclude: Array.from(exclude)
    };

    await saveConfig(state.baseUrl, config);
    state.config = config;
    scheduleRender();
  }

  function handleClick(event) {
    if (!state.enabled) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const target = getMarkableTarget(event.clientX, event.clientY);
    if (target) {
      toggleExplicit(target, "include");
    }
  }

  function handleContextMenu(event) {
    if (!state.enabled) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const target = getMarkableTarget(event.clientX, event.clientY);
    if (target) {
      toggleExplicit(target, "exclude");
    }
  }

  function handleWheel(event) {
    if (!state.enabled) {
      return;
    }
    if (!event.altKey) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function handleKeydown(event) {
    if (!state.enabled) {
      return;
    }
    const blockedKeys = new Set([
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "PageUp",
      "PageDown",
      "Home",
      "End",
      " "
    ]);
    if (blockedKeys.has(event.key)) {
      event.preventDefault();
      event.stopPropagation();
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

  function drawRect(layer, rect, className) {
    const box = document.createElement("div");
    box.className = `mc-rect ${className}`;
    box.style.top = `${rect.top}px`;
    box.style.left = `${rect.left}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    layer.appendChild(box);
  }

  function scheduleRender() {
    if (state.renderRaf) {
      return;
    }
    state.renderRaf = window.requestAnimationFrame(() => {
      state.renderRaf = 0;
      renderHighlights();
    });
  }

  function renderHighlights() {
    if (!state.enabled || !state.overlay) {
      return;
    }

    updateOverlayGutter();

    const hardExcluded = collectHardExcludedElements();
    const explicitExclude = collectXPathElements(
      state.config.explicitXPathDecisions.exclude
    );
    const explicitInclude = collectXPathElements(
      state.config.explicitXPathDecisions.include
    );
    const aiExclude = collectSelectorElements(
      state.config.domainAiSelectorSet.exclusionSelectors
    );
    const aiInclude = collectSelectorElements(
      state.config.domainAiSelectorSet.inclusionSelectors
    );

    const layerHard = state.layers["hard"];
    const layerExplicitExclude = state.layers["explicit-exclude"];
    const layerExplicitInclude = state.layers["explicit-include"];
    const layerAiExclude = state.layers["ai-exclude"];
    const layerAiInclude = state.layers["ai-include"];
    const layerDefault = state.layers["default"];

    clearLayer(layerHard);
    clearLayer(layerExplicitExclude);
    clearLayer(layerExplicitInclude);
    clearLayer(layerAiExclude);
    clearLayer(layerAiInclude);
    clearLayer(layerDefault);

    const hasHigherPrecedence = (el) =>
      hardExcluded.has(el) ||
      explicitExclude.has(el) ||
      explicitInclude.has(el) ||
      aiExclude.has(el) ||
      aiInclude.has(el);

    hardExcluded.forEach((el) => {
      const rect = getVisibleRect(el);
      if (rect) {
        drawRect(layerHard, rect, "mc-hard");
      }
    });

    explicitExclude.forEach((el) => {
      if (hardExcluded.has(el)) {
        return;
      }
      const rect = getVisibleRect(el);
      if (rect) {
        drawRect(layerExplicitExclude, rect, "mc-explicit-exclude");
      }
    });

    explicitInclude.forEach((el) => {
      if (hardExcluded.has(el) || explicitExclude.has(el)) {
        return;
      }
      const rect = getVisibleRect(el);
      if (rect) {
        drawRect(layerExplicitInclude, rect, "mc-explicit-include");
      }
    });

    aiExclude.forEach((el) => {
      if (hardExcluded.has(el) || explicitExclude.has(el) || explicitInclude.has(el)) {
        return;
      }
      const rect = getVisibleRect(el);
      if (rect) {
        drawRect(layerAiExclude, rect, "mc-ai-exclude");
      }
    });

    aiInclude.forEach((el) => {
      if (
        hardExcluded.has(el) ||
        explicitExclude.has(el) ||
        explicitInclude.has(el) ||
        aiExclude.has(el)
      ) {
        return;
      }
      const rect = getVisibleRect(el);
      if (rect) {
        drawRect(layerAiInclude, rect, "mc-ai-include");
      }
    });

    if (state.config.showDefaultHighlights) {
      const precedenceSet = new Set([
        ...hardExcluded,
        ...explicitExclude,
        ...explicitInclude,
        ...aiExclude,
        ...aiInclude
      ]);
      const excludedSet = new Set([
        ...hardExcluded,
        ...explicitExclude,
        ...aiExclude
      ]);
      const defaultTargets = collectDefaultHighlightTargets(document.body, {
        excludedSet,
        hardExcludedSet: hardExcluded,
        hasHigherPrecedence,
        precedenceSet,
        explicitIncludeSet: explicitInclude
      });
      defaultTargets.forEach((el) => {
        const rect = getVisibleRect(el);
        if (rect) {
          drawRect(layerDefault, rect, "mc-default");
        }
      });
    }
  }

  function startObservers() {
    if (state.mutationObserver) {
      return;
    }
    state.mutationObserver = new MutationObserver(() => {
      scheduleRender();
    });
    if (document.body) {
      state.mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true
      });
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
    removeOverlay();
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

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

    if (message.type === "collectPageData") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      loadConfig(targetBaseUrl).then((config) => {
        sendResponse({
          baseUrl: targetBaseUrl,
          pageUrl: location.href,
          fullHtml: document.documentElement.outerHTML,
          defaultExclusions: {
            tags: HARD_EXCLUDED_TAGS,
            selectors: HARD_EXCLUDED_SELECTORS
          },
          xpathsInclude: config.explicitXPathDecisions.include,
          xpathsExclude: config.explicitXPathDecisions.exclude
        });
      });
      return true;
    }
  });

  window.addEventListener("resize", scheduleRender);
  window.addEventListener("scroll", scheduleRender, { passive: true });

  refreshFromTabState();
})();
