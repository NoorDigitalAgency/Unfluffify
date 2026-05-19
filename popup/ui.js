import { h, render, Fragment } from "./vendor/preact/dist/preact.module.js";
import * as stateModule from "./state.js";

const { state } = stateModule;

const refs = {};

export const View = {
    Configuration: 'Configuration',
    Marking: 'Marking'
}

export const ViewText = Object.freeze({
  unavailable: "Unavailable",
  changeAction: "Change",
  cancelAction: "Cancel",
  previewBlockedDefault: "Preview is in progress...",
  openOnCurrentTabNotice: "Open the extension on this tab to enable controls.",
  syncLoadIdle: "Not loaded yet",
  syncSaveIdle: "No save sent yet",
  markedPagesEmpty: "None yet",
  basePageUrlsEmpty: "No base URLs with domainId",
  computeButtonIdle: "Decide Content",
  computeButtonBusy: "Computing...",
  saveExcludesIdle: "Submit to the server",
  saveExcludesBusy: "Submitting...",
  baseUrlAutoResolvedNotice: "Base Page URL is resolved automatically from GraphQL.",
  noMappedBaseUrlOrSiteId: "No mapped base page URL/siteId for this page",
  noDomainIdForBaseUrl: "No domainId exists for this base URL"
});

const initialViewState = {
  currentView: View.Configuration,
  configurationComplete: false,
  configurationContinueDisabled: true,
  configurationNoticeText: "",
  configurationNoticeVisible: false,
  currentPageUrl: ViewText.unavailable,
  currentBaseUrl: "",
  baseUrlInputValue: "",
  baseUrlInputReadOnly: true,
  baseUrlSetVisible: false,
  baseUrlEditVisible: false,
  baseUrlEditText: ViewText.changeAction,
  baseUrlNoticeText: "",
  baseUrlNoticeVisible: false,
  toggleEnabled: false,
  toggleEnabledDisabled: true,
  mainUiHidden: true,
  deviceEmulationEnabled: false,
  deviceMode: "mobile",
  deviceScale: 0.85,
  deviceScaleValue: "85%",
  deviceControlsDisabled: false,
  pageDataNewNoticeHidden: true,
  pageSaveDisabled: true,
  pageRevertDisabled: true,
  pageDraftStatusText: "",
  syncLoadStatusText: ViewText.syncLoadIdle,
  syncSaveStatusText: ViewText.syncSaveIdle,
  markedPages: [],
  markedPagesEmptyText: ViewText.markedPagesEmpty,
  basePageUrls: [],
  basePageUrlsEmptyText: ViewText.basePageUrlsEmpty,
  basePageMenuOpen: false,
  endpointUrlValue: "",
  endpointUrlReadOnly: true,
  endpointSetVisible: true,
  endpointEditVisible: false,
  endpointEditText: ViewText.changeAction,
  endpointNoticeText: "",
  endpointNoticeVisible: false,
  endpointInputDisabled: false,
  endpointSetDisabled: false,
  endpointEditDisabled: false,
  configEndpointUrlValue: "",
  configEndpointUrlReadOnly: true,
  configEndpointSetVisible: true,
  configEndpointEditVisible: false,
  configEndpointEditText: ViewText.changeAction,
  configEndpointNoticeText: "",
  configEndpointNoticeVisible: false,
  configEndpointInputDisabled: false,
  configEndpointSetDisabled: false,
  configEndpointEditDisabled: false,
  stageBaseValue: "",
  stageBaseReadOnly: true,
  stageBaseSetVisible: true,
  stageBaseEditVisible: false,
  stageBaseEditText: ViewText.changeAction,
  stageBaseNoticeText: "",
  stageBaseNoticeVisible: false,
  stageBaseInputDisabled: false,
  stageBaseSetDisabled: false,
  stageBaseEditDisabled: false,
  renderModeValue: "undetermined",
  renderModeReadOnly: true,
  renderModeSetVisible: false,
  renderModeEditVisible: false,
  renderModeEditText: ViewText.changeAction,
  renderModeNoticeText: "",
  renderModeNoticeVisible: false,
  renderModeUndeterminedVisible: true,
  renderModeManualGuidanceVisible: false,
  renderModeWarningVisible: false,
  renderModeWarningAcknowledgeChecked: false,
  renderModeWarningOkDisabled: true,
  renderModeReady: false,
  renderModeInputDisabled: false,
  renderModeSetDisabled: false,
  renderModeEditDisabled: false,
  renderModeSummaryOpen: false,
  renderModeSummaryTitle: "Render Mode",
  loginEmailValue: "",
  loginPasswordValue: "",
  loginCredentialsDisabled: true,
  loginStatusText: "",
  loginActionDisabled: false,
  aiControlsHidden: true,
  aiControlsBusy: false,
  aiDirtyNoticeVisible: false,
  pageSaveMobileSimulationRequiredVisible: false,
  pageSaveMobileSimulationRequiredText: "",
  computeButtonText: ViewText.computeButtonIdle,
  computeButtonDisabled: true,
  computeButtonLoading: false,
  saveExcludesButtonText: ViewText.saveExcludesIdle,
  saveExcludesButtonDisabled: true,
  saveExcludesButtonLoading: false,
  previewLatestButtonDisabled: true,
  cssSelectorsVisible: false,
  highlightingOptionsVisible: false,
  previewBlocked: false,
  previewBlockedMessage: ViewText.previewBlockedDefault,
  highlightMarkedPagesChecked: true,
  highlightIncludedContentChecked: true,
  highlightExcludedContentChecked: false,
  highlightVisibleConsentChecked: false,
  highlightHideDuringScrollRedrawChecked: true,
  configMenuOpen: false,
  clearDomainCacheDisabled: false,
  unregisterCurrentTabDisabled: false,
  isBusy: false,
  busyMessage: "",
  toastMessage: "",
  toastVisible: false
};

let viewState = { ...initialViewState };
let actions = {};

const renderModeWarningBodyHtml = `
  <p>
    You must choose the Render Mode manually before continuing:
  </p>
  <ol>
    <li>Click somewhere inside the page first.</li>
    <li>Open the Chrome DevTools with F12.</li>
    <li>Open Preferences with F1.</li>
    <li>From the Debugger section check Disable JavaScript.</li>
    <li>Reload the page with DevTools still open.</li>
    <li>See if the meaningful content is still visible. If it is, choose "Static HTML".</li>
    <li>If the meaningful content disappears, choose "Rendered HTML".</li>
    <li>From the Debugger section, uncheck Disable JavaScript.</li>
    <li>Reload the page again and continue in Unfluffify.</li>
  </ol>
`;

function classNames(...values) {
  return values.filter(Boolean).join(" ");
}

function renderListItems(items, emptyText, renderItem) {
  if (!items.length) {
    return [h("li", { class: "empty" }, emptyText)];
  }
  return items.map(renderItem);
}

function icon(name, extraClass = "") {
  return h("span", {
    class: classNames("mdi", `mdi-${name}`, "btn-icon", extraClass),
    "aria-hidden": "true"
  });
}

function getBlockingUiCurtainState(view) {
  if (view.previewBlocked) {
    return {
      visible: true,
      mode: "preview",
      message: view.previewBlockedMessage || ViewText.previewBlockedDefault
    };
  }
  if (view.isBusy) {
    return {
      visible: true,
      mode: "busy",
      message: view.busyMessage || "Loading popup..."
    };
  }
  if (view.computeButtonLoading) {
    return {
      visible: true,
      mode: "busy",
      message: "Computing selectors..."
    };
  }
  if (view.saveExcludesButtonLoading) {
    return {
      visible: true,
      mode: "busy",
      message: "Submitting selectors..."
    };
  }
  if (view.aiControlsBusy) {
    return {
      visible: true,
      mode: "busy",
      message: "Working with AI..."
    };
  }
  if (view.deviceControlsDisabled) {
    return {
      visible: true,
      mode: "busy",
      message: "Applying device emulation..."
    };
  }
  return {
    visible: false,
    mode: "busy",
    message: ""
  };
}

function renderBasePageMenu(view, handlers) {
  return h(
    "div",
    {
      class: "section-menu",
      role: "menu",
      hidden: !view.basePageMenuOpen,
      onClick: handlers.onBasePageMenuClick
    },
    view.basePageUrls.length
      ? view.basePageUrls.map((item) =>
          h(
            "button",
            {
              key: item.url,
              type: "button",
              role: "menuitem",
              disabled: item.url === view.currentBaseUrl,
              onClick: (event) => {
                event.stopPropagation();
                handlers.onBasePageNavigate(item.url);
              }
            },
            h(
              "span",
              { class: "section-menu__label", title: item.url },
              item.url
            ),
            item.url === view.currentBaseUrl
              ? h("span", { class: "section-menu__status" }, "Current")
              : icon("arrow-right")
          )
        )
      : h(
          "div",
          { class: "section-menu__empty" },
          view.basePageUrlsEmptyText
        )
  );
}

function renderRenderModeEditor(view, handlers) {
  return h(
    Fragment,
    null,
    h(
      "label",
      {class: "field"},
      h("span", null, icon("monitor-dashboard", "field-icon"), "Render Mode"),
      h(
        "div",
        {class: "input-row"},
        h(
          "select",
          {
            id: "render-mode",
            value: view.renderModeValue,
            disabled: view.renderModeInputDisabled || view.renderModeReadOnly,
            onChange: handlers.onRenderModeInput,
            ref: (el) => {
              refs.renderModeSelect = el;
            }
          },
          h("option", { value: "static" }, "Static HTML"),
          h("option", { value: "rendered" }, "Rendered HTML"),
          view.renderModeUndeterminedVisible
            ? h("option", { value: "undetermined", disabled: true }, "Undetermined")
            : null
        ),
        h(
          "button",
          {
            id: "render-mode-set",
            type: "button",
            style: {display: view.renderModeSetVisible ? "inline-flex" : "none"},
            disabled: view.renderModeSetDisabled,
            onClick: handlers.onRenderModeSet
          },
          icon("check"),
          "Set"
        ),
        h(
          "button",
          {
            id: "render-mode-edit",
            type: "button",
            style: {display: view.renderModeEditVisible ? "inline-flex" : "none"},
            disabled: view.renderModeEditDisabled,
            onClick: handlers.onRenderModeEditToggle
          },
          icon("pencil-outline"),
          view.renderModeEditText
        )
      )
    ),
    h(
      "div",
      {
        id: "render-mode-notice",
        class: "notice",
        role: "status",
        "aria-live": "polite",
        hidden: !view.renderModeNoticeVisible
      },
      view.renderModeNoticeText
    ),
    h(
      "div",
      {class: "hint"},
      "Auto-detect only promotes a site to rendered mode when the live DOM diverges substantially from the fetched source HTML."
    )
  );
}

function renderMarkedPagesSection(view, handlers, extraClassName = "") {
  return h(
    "section",
    {class: classNames("card", extraClassName)},
    h(
      "div",
      { class: "section-header" },
      h("div", {class: "section-title"}, "Marked Pages"),
      h(
        "div",
        { class: "section-header-actions" },
        h(
          "button",
          {
            id: "base-page-menu-toggle",
            type: "button",
            class: "section-menu-button button-secondary",
            "aria-haspopup": "menu",
            "aria-expanded": view.basePageMenuOpen ? "true" : "false",
            title: "Base page URLs",
            onClick: handlers.onBasePageMenuToggle
          },
          icon("menu")
        ),
        renderBasePageMenu(view, handlers)
      )
    ),
    h(
      "ul",
      {id: "marked-pages", class: "list"},
      renderListItems(
        view.markedPages,
        view.markedPagesEmptyText,
        (item) =>
          h(
            "li",
            {key: item.url},
            h(
              "span",
              {class: "page-title", title: item.title},
              item.title
            ),
            h(
              "span",
              {class: "count"},
              item.count === 0
                ? "No marks"
                : item.count === 1
                  ? "1 mark"
                  : `${item.count} marks`
            ),
            h(
              "button",
              {
                type: "button",
                disabled: item.url === view.currentPageUrl,
                onClick: () => handlers.onMarkedPageNavigate(item.url)
              },
              icon("arrow-right"),
              "Navigate"
            )
          )
      )
    )
  );
}

function App({ state: view, actions: handlers }) {
  const curtain = getBlockingUiCurtainState(view);
  const previewCurtainVisible = curtain.mode === "preview";

  return h(
    Fragment,
    null,
    h(
      "div",
      { class: "app" },
      h(
        "div",
        { class: "close-bar" },
        h(
          "button",
          {
            id: "close-tab",
            type: "button",
            class: "close-button",
            title: "Unregister current tab and reload",
            disabled: view.unregisterCurrentTabDisabled,
            onClick: handlers.onUnregisterCurrentTab
          }
        )
      ),
      h(
        "header",
        { class: "app-header" },
        h(
          "div",
          { class: "header-text" },
          h("img", { src: "logo.png", alt: "Unfluffify", class: "header-logo" }),
          h("div", { class: "subtitle" }, "Tell AI what's not content")
        ),
        h(
          "div",
          { class: "header-actions" },
          h(
            "button",
            {
              id: "config-toggle",
              type: "button",
              class: "config-button",
              "aria-haspopup": "menu",
              "aria-expanded": view.configMenuOpen ? "true" : "false",
              onClick: handlers.onConfigToggle
            },
            icon("cog-outline"),
            "Configuration"
          ),
          h(
            "div",
            {
              id: "config-menu",
              class: "config-menu",
              role: "menu",
              hidden: !view.configMenuOpen,
              onClick: handlers.onConfigMenuClick
            },
            h(
              "button",
              {
                id: "config-open-view",
                type: "button",
                role: "menuitem",
                onClick: handlers.onOpenConfiguration
              },
              icon("tune"),
              "Open configuration view"
            ),
            h("div", { class: "config-divider", role: "separator" }),
            h(
              "button",
              {
                id: "clear-domain-cache",
                type: "button",
                role: "menuitem",
                class: "danger",
                disabled: view.clearDomainCacheDisabled,
                onClick: handlers.onClearDomainCache
              },
              icon("trash-can-outline"),
              "Empty cache for current domain"
            )
          )
        )
      ),
      view.currentView === View.Marking ?
          renderMarkingView({ state: view, actions: handlers }) :
          view.currentView === View.Configuration ?
              renderConfigurationView({ state: view, actions: handlers }) :
              null
    ),
    h(
      "div",
      {
        id: "toast",
        role: "status",
        "aria-live": "polite",
        class: view.toastVisible ? "show" : ""
      },
      view.toastMessage
    ),
    h(
      "div",
      {
        id: "ui-curtain",
        class: "ui-curtain",
        role: "status",
        "aria-live": "polite",
        hidden: !curtain.visible
      },
      h(
        "div",
        {
          class: classNames(
            "ui-curtain__content",
            previewCurtainVisible && "ui-curtain__content--preview"
          )
        },
        previewCurtainVisible
          ? h(
              "div",
              { class: "ui-curtain__preview-badge", "aria-hidden": "true" },
              h("span", { class: "mdi mdi-eye-outline" })
            )
          : h("div", { class: "ui-curtain__spinner", "aria-hidden": "true" }),
        h("div", { class: "ui-curtain__title" }, curtain.message || "Please wait..."),
        h(
          "div",
          { class: "ui-curtain__hint" },
          view.previewBlocked
            ? "The page is in preview mode. Exit preview to resume editing and settings changes."
            : "Working... controls are temporarily blocked."
        ),
        previewCurtainVisible
          ? h(
              "button",
              {
                type: "button",
                class: "ui-curtain__action",
                onClick: handlers.onExitPreviewMode
              },
              "Exit Preview"
            )
          : null
      )
    )
  );
}

function renderAiControlsContent(view, handlers) {
  const computeButtonClass = classNames(
    "full-width",
    "margin-above",
    view.computeButtonLoading && "loading"
  );

  return h(
    Fragment,
    null,
    h("div", {class: "section-title"}, "AI controls"),
    !view.configurationComplete &&
      h(
        "div",
        {
          class: "notice",
          role: "status",
          "aria-live": "polite"
        },
        "Complete Configuration settings to enable AI controls."
      ),
    h(
      "div",
      {
        id: "ai-controls",
        "aria-busy": view.aiControlsBusy ? "true" : "false"
      },
      h(
        "div",
        {class: "section-title padding-below"},
        "Selector Computation"
      ),
      h(
        "div",
        {
          id: "ai-dirty-notice",
          class: "notice",
          role: "status",
          "aria-live": "polite",
          style: {display: view.aiDirtyNoticeVisible ? "block" : "none"}
        },
        "Save the current page before using AI controls"
      ),
      h(
        "button",
        {
          id: "compute",
          class: computeButtonClass,
          type: "button",
          disabled: view.computeButtonDisabled,
          onClick: handlers.onCompute
        },
        icon("auto-fix"),
        view.computeButtonText
      )
    )
  );
}

function renderMarkingView({state: view, actions: handlers}) {
  const postRenderModeControlsVisible = view.renderModeReady;
  const showDeviceSection = !view.mainUiHidden || view.highlightingOptionsVisible;
  const markingMode = !view.mainUiHidden;
  const mergedControlsSectionChildren = [
    h("div", {class: "section-title"}, "Mobile simulation"),
    h(
      "label",
      {class: "row", title: "CTRL/CMD+M"},
      h("span", {class: "row-label"}, icon("cellphone", "row-icon"), "Enable mobile simulation"),
      h("input", {
        id: "device-emulation-enabled",
        type: "checkbox",
        checked: view.deviceEmulationEnabled,
        disabled: view.deviceControlsDisabled,
        onChange: handlers.onDeviceEmulationEnabledChange
      })
    ),
    h("div", {class: "hint"}, "Scale is applied automatically.")
  ];

  if (markingMode) {
    mergedControlsSectionChildren.push(
      h("div", { class: "section-divider", role: "separator" }),
      h("div", {class: "section-title"}, "Page data"),
      view.pageSaveMobileSimulationRequiredVisible
        ? h(
            "div",
            {
              class: "notice",
              role: "status",
              "aria-live": "polite"
            },
            view.pageSaveMobileSimulationRequiredText
          )
        : null,
      h(
        "div",
        {
          id: "page-data-new-notice",
          class: "notice",
          role: "status",
          "aria-live": "polite",
          hidden: view.pageDataNewNoticeHidden
        },
        "No saved data for this page yet. Save to store it."
      ),
      h(
        "div",
        {class: "button-row"},
        h(
          "button",
          {
            id: "page-save",
            type: "button",
            title: "CTRL/CMD+S",
            disabled: view.pageSaveDisabled,
            onClick: handlers.onPageSave
          },
          icon("content-save"),
          "Save"
        ),
        h(
          "button",
          {
            id: "page-revert",
            type: "button",
            class: "button-secondary",
            disabled: view.pageRevertDisabled,
            onClick: handlers.onPageRevert
          },
          icon("restore"),
          "Revert to saved"
        )
      ),
      h("div", {id: "page-draft-status", class: "hint"}, view.pageDraftStatusText),
      h(
        "details",
        { class: "collapsible" },
        h("summary", null, "Server Sync"),
        h(
          "div",
          { class: "collapsible-body" },
          h("div", { class: "hint", id: "sync-load-status" }, `Latest loaded: ${view.syncLoadStatusText}`),
          h("div", { class: "hint", id: "sync-save-status" }, `Latest saved: ${view.syncSaveStatusText}`)
        )
      )
    );
  }

  if (markingMode) {
    mergedControlsSectionChildren.push(
      h("div", { class: "section-divider", role: "separator" }),
      renderAiControlsContent(view, handlers)
    );
  }

  if (view.cssSelectorsVisible) {
    mergedControlsSectionChildren.push(
      h("div", { class: "section-divider", role: "separator" }),
      renderCssSelectorsSection({ state: view, actions: handlers })
    );
  }

  const mergedControlsSection = h(
    "section",
    {
      class: "card",
      hidden: !showDeviceSection && !view.cssSelectorsVisible
    },
    ...mergedControlsSectionChildren
  );

  const renderModeWarningPopover = h(
    "div",
    {
      class: "warning-popover",
      hidden: !view.renderModeWarningVisible,
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "render-mode-warning-title"
    },
    h(
      "div",
      { class: "warning-popover__card" },
      h("div", { id: "render-mode-warning-title", class: "warning-popover__title" }, "Render Mode Could Not Be Determined"),
      h(
        "div",
        {
          class: "warning-popover__body",
          dangerouslySetInnerHTML: {
            __html: renderModeWarningBodyHtml
          }
        },
      ),
      h(
        "label",
        { class: "warning-popover__ack" },
        h("input", {
          id: "render-mode-warning-ack",
          type: "checkbox",
          checked: view.renderModeWarningAcknowledgeChecked,
          onChange: handlers.onRenderModeWarningAcknowledgeChange
        }),
        h("span", null, "I have determined and ready to choose the render mode")
      ),
      h(
        "button",
        {
          id: "render-mode-warning-ok",
          type: "button",
          class: "warning-popover__ok",
          disabled: view.renderModeWarningOkDisabled,
          onClick: handlers.onRenderModeWarningConfirm
        },
        "OK"
      )
    )
  );

  return h(
    Fragment,
    null,
    h(
      "section",
      {class: "card"},
      h(
        "label",
        {class: "field"},
        h("span", null, icon("home-outline", "field-icon"), "Base Page URL"),
        h(
          "div",
          {class: "input-row"},
          h("input", {
            id: "base-url",
            type: "text",
            placeholder: "Resolved automatically",
            readOnly: view.baseUrlInputReadOnly,
            value: view.baseUrlInputValue,
            onInput: handlers.onBaseUrlInput,
            onKeyDown: handlers.onBaseUrlKeyDown,
            ref: (el) => {
              refs.baseUrlInput = el;
            }
          }),
          h(
            "button",
            {
              id: "base-url-set",
              type: "button",
              style: {display: view.baseUrlSetVisible ? "inline-flex" : "none"},
              onClick: handlers.onBaseUrlSet
            },
            icon("check"),
            "Set"
          ),
          h(
            "button",
            {
              id: "base-url-edit",
              type: "button",
              style: {display: view.baseUrlEditVisible ? "inline-flex" : "none"},
              onClick: handlers.onBaseUrlEditToggle
            },
            icon("pencil-outline"),
            view.baseUrlEditText
          )
        )
      ),
      h(
        "div",
        {
          id: "base-url-notice",
          class: "notice",
          role: "status",
          "aria-live": "polite",
          hidden: !view.baseUrlNoticeVisible
        },
        view.baseUrlNoticeText
      ),
      h(
        "details",
        {
          class: "collapsible",
          open: view.renderModeSummaryOpen,
          onToggle: handlers.onRenderModeSummaryToggle
        },
        h("summary", null, view.renderModeSummaryTitle),
        h(
          "div",
          {class: "collapsible-body"},
          renderRenderModeEditor(view, handlers)
        )
      )
    ),
    postRenderModeControlsVisible &&
      h(
        "section",
        {class: "card"},
        h(
          "label",
          {class: "row", title: "CTRL/CMD+E"},
          h("span", {class: "row-label"}, icon("pencil-box-outline", "row-icon"), "Enable Marking"),
          h("input", {
            id: "toggle-enabled",
            type: "checkbox",
            checked: view.toggleEnabled,
            disabled: view.toggleEnabledDisabled,
            onChange: handlers.onToggleEnabled
          })
        )
      )
    ,
    postRenderModeControlsVisible &&
      view.highlightingOptionsVisible &&
      renderHighlightingOptionsSection({ state: view, actions: handlers }),
    postRenderModeControlsVisible && mergedControlsSection,
    postRenderModeControlsVisible &&
      (markingMode || view.highlightingOptionsVisible) &&
      renderMarkedPagesSection(view, handlers),
    renderModeWarningPopover
  );
}

function renderHighlightingOptionsSection({ state: view, actions: handlers }) {
    return h(
      "section",
      { class: "card" },
      h("div", { class: "section-title" }, "Highlighting"),
      h(
        "label",
        { class: "row" },
        h("span", {class: "row-label"}, icon("bookmark-outline", "row-icon"), "Marked page links"),
        h("input", {
          id: "highlight-marked-pages",
          type: "checkbox",
          checked: view.highlightMarkedPagesChecked,
          onChange: handlers.onHighlightMarkedPagesChange
        })
      ),
      h(
        "label",
        { class: "row" },
        h("span", {class: "row-label"}, icon("check-circle-outline", "row-icon"), "Included content"),
        h("input", {
          id: "highlight-included-content",
          type: "checkbox",
          checked: view.highlightIncludedContentChecked,
          onChange: handlers.onHighlightIncludedContentChange
        })
      ),
      h(
        "label",
        { class: "row" },
        h("span", {class: "row-label"}, icon("minus-circle-outline", "row-icon"), "Excluded content"),
        h("input", {
          id: "highlight-excluded-content",
          type: "checkbox",
          checked: view.highlightExcludedContentChecked,
          onChange: handlers.onHighlightExcludedContentChange
        })
      ),
      h("div", { class: "section-divider", role: "separator" }),
      h(
        "label",
        { class: "row" },
        h("span", {class: "row-label"}, icon("eye-off-outline", "row-icon"), "Hide while scrolling"),
        h("input", {
          id: "highlight-hide-during-scroll-redraw",
          type: "checkbox",
          checked: view.highlightHideDuringScrollRedrawChecked,
          onChange: handlers.onHighlightHideDuringScrollRedrawChange
        })
      ),
      h(
        "label",
        { class: "row" },
        h("span", {class: "row-label"}, icon("shield-check-outline", "row-icon"), "Visible Consent"),
        h("input", {
          id: "highlight-visible-consent",
          type: "checkbox",
          checked: view.highlightVisibleConsentChecked,
          onChange: handlers.onHighlightVisibleConsentChange
        })
      )
    );
}

function renderCssSelectorsSection({ state: view, actions: handlers }) {
    const previewClass = classNames("full-width", "margin-above");
    const submitClass = classNames(
      "full-width",
      view.saveExcludesButtonLoading && "loading"
    );
    return h(
      Fragment,
      null,
      h("div", { class: "section-title" }, "CSS Selectors"),
      h(
        "button",
        {
          id: "preview-latest",
          class: previewClass,
          type: "button",
          disabled: view.previewLatestButtonDisabled,
          onClick: handlers.onPreviewLatest
        },
        icon("eye-outline"),
        "Preview Latest"
      ),
      h("div", { class: "section-divider", role: "separator" }),
      h(
        "button",
        {
          id: "save-excludes",
          class: submitClass,
          type: "button",
          disabled: view.saveExcludesButtonDisabled,
          onClick: handlers.onSaveExcludes
        },
        icon("cloud-upload-outline"),
        view.saveExcludesButtonText
      )
    );
}

function renderConfigurationView({state: view, actions: handlers}) {
    return h(
        Fragment,
        null,
        h(
            "section",
            {class: "card"},
            h("div", {class: "section-title"}, "Configuration"),
            h(
                "div",
                {class: "hint"},
                "Set endpoints, login credentials, and sign in to continue."
            ),
            h(
                "div",
                {
                    class: "notice",
                    role: "status",
                    "aria-live": "polite",
                    hidden: !view.configurationNoticeVisible
                },
                view.configurationNoticeText
            ),
            h(
                "button",
                {
                    id: "config-continue",
                    type: "button",
                    disabled: view.configurationContinueDisabled,
                    onClick: handlers.onConfigurationContinue,
                    class: "full-width margin-above"
                },
                icon("arrow-left"),
                "Go Back"
            )
        ),
        h(
            "section",
            {class: "card"},
            h("div", {class: "section-title"}, "Configuration endpoint"),
            h(
                "label",
                {class: "field"},
                h("span", null, "Configuration Endpoint URL"),
                h(
                    "div",
                    {class: "input-row"},
                    h("input", {
                        id: "config-endpoint-url",
                        type: "text",
                        placeholder: "https://example.com",
                        readOnly: view.configEndpointUrlReadOnly,
                        value: view.configEndpointUrlValue,
                        disabled: view.configEndpointInputDisabled,
                        onInput: handlers.onConfigEndpointInput,
                        onKeyDown: handlers.onConfigEndpointKeyDown,
                        ref: (el) => {
                            refs.configEndpointUrlInput = el;
                        }
                    }),
                    h(
                        "button",
                        {
                            id: "config-endpoint-url-set",
                            type: "button",
                            style: {display: view.configEndpointSetVisible ? "inline-flex" : "none"},
                            disabled: view.configEndpointSetDisabled,
                            onClick: handlers.onConfigEndpointSet
                        },
                        icon("check"),
                        "Set"
                    ),
                    h(
                        "button",
                        {
                            id: "config-endpoint-url-edit",
                            type: "button",
                            style: {display: view.configEndpointEditVisible ? "inline-flex" : "none"},
                            disabled: view.configEndpointEditDisabled,
                            onClick: handlers.onConfigEndpointEditToggle
                        },
                        icon("pencil-outline"),
                        view.configEndpointEditText
                    )
                )
            ),
            h(
                "div",
                {
                    id: "config-endpoint-notice",
                    class: "notice",
                    role: "status",
                    "aria-live": "polite",
                    hidden: !view.configEndpointNoticeVisible
                },
                view.configEndpointNoticeText
            )
        ),
        h(
            "section",
            {class: "card"},
            h("div", {class: "section-title"}, "AI settings"),
            h(
                "label",
                {class: "field"},
                h("span", null, "AI Endpoint URL"),
                h(
                    "div",
                    {class: "input-row"},
                    h("input", {
                        id: "endpoint-url",
                        type: "text",
                        placeholder: "https://example.com",
                        readOnly: view.endpointUrlReadOnly,
                        value: view.endpointUrlValue,
                        disabled: view.endpointInputDisabled,
                        onInput: handlers.onEndpointInput,
                        onKeyDown: handlers.onEndpointKeyDown,
                        ref: (el) => {
                            refs.endpointUrlInput = el;
                        }
                    }),
                    h(
                        "button",
                        {
                            id: "endpoint-url-set",
                            type: "button",
                            style: {display: view.endpointSetVisible ? "inline-flex" : "none"},
                            disabled: view.endpointSetDisabled,
                            onClick: handlers.onEndpointSet
                        },
                        icon("check"),
                        "Set"
                    ),
                    h(
                        "button",
                        {
                            id: "endpoint-url-edit",
                            type: "button",
                            style: {display: view.endpointEditVisible ? "inline-flex" : "none"},
                            disabled: view.endpointEditDisabled,
                            onClick: handlers.onEndpointEditToggle
                        },
                        icon("pencil-outline"),
                        view.endpointEditText
                    )
                )
            ),
        ),
        h(
            "section",
            {class: "card"},
            h("div", {class: "section-title"}, "Stage Base"),
            h(
                "label",
                {class: "field"},
                h("span", null, "Stage Base"),
                h(
                    "div",
                    {class: "input-row"},
                    h("input", {
                        id: "stage-base",
                        type: "text",
                        placeholder: "noorlynx.com",
                        readOnly: view.stageBaseReadOnly,
                        value: view.stageBaseValue,
                        disabled: view.stageBaseInputDisabled,
                        onInput: handlers.onStageBaseInput,
                        onKeyDown: handlers.onStageBaseKeyDown,
                        ref: (el) => {
                            refs.stageBaseInput = el;
                        }
                    }),
                    h(
                        "button",
                        {
                            id: "stage-base-set",
                            type: "button",
                            style: {display: view.stageBaseSetVisible ? "inline-flex" : "none"},
                            disabled: view.stageBaseSetDisabled,
                            onClick: handlers.onStageBaseSet
                        },
                        icon("check"),
                        "Set"
                    ),
                    h(
                        "button",
                        {
                            id: "stage-base-edit",
                            type: "button",
                            style: {display: view.stageBaseEditVisible ? "inline-flex" : "none"},
                            disabled: view.stageBaseEditDisabled,
                            onClick: handlers.onStageBaseEditToggle
                        },
                        icon("pencil-outline"),
                        view.stageBaseEditText
                    )
                )
        ),
        h(
            "div",
            {
                id: "stage-base-notice",
                    class: "notice",
                    role: "status",
                    "aria-live": "polite",
                    hidden: !view.stageBaseNoticeVisible
                },
                view.stageBaseNoticeText
            )
        ),
        h(
            "section",
            {class: "card"},
            h("div", {class: "section-title"}, "Authentication"),
            h(
                Fragment,
                null,
                h(
                    "label",
                    {class: "field"},
                    h("span", null, "Email"),
                    h("input", {
                        id: "login-email",
                        type: "email",
                        placeholder: "name@example.com",
                        value: view.loginEmailValue,
                        disabled: view.loginCredentialsDisabled,
                        onInput: handlers.onLoginEmailInput
                    })
                ),
                h(
                    "label",
                    {class: "field"},
                    h("span", null, "Password"),
                    h("input", {
                        id: "login-password",
                        type: "password",
                        placeholder: "password",
                        value: view.loginPasswordValue,
                        disabled: view.loginCredentialsDisabled,
                        onInput: handlers.onLoginPasswordInput,
                        onKeyDown: handlers.onLoginPasswordKeyDown
                    })
                ),
                h(
                    "div",
                    {class: "token-row"},
                    h("span", {id: "token-status", class: "token-status"}, view.loginStatusText),
                    h(
                        "button",
                        {
                            id: "login-action",
                            type: "button",
                            disabled: view.loginActionDisabled,
                            onClick: handlers.onLoginAction
                        },
                        icon("login"),
                        "Login"
                    )
                )
            )
        )
    );
}

function renderApp() {
  const root = document.getElementById("app");
  if (!root) {
    return;
  }
  render(h(App, { state: viewState, actions }), root);
  document.body.classList.toggle(
    "is-busy",
    getBlockingUiCurtainState(viewState).visible
  );
}

export function initUi(actionHandlers) {
  actions = actionHandlers || {};
  renderApp();
}

export function setViewState(patch) {
  viewState = { ...viewState, ...patch };
  renderApp();
}

/**
 * Updates the view state using an updater function and re-renders the app.
 * @private
 * @param {Function} updater - Function that receives current state and returns updated state
 */
function updateViewState(updater) {
  viewState = updater(viewState);
  renderApp();
}

export function getViewState() {
  return viewState;
}

export function getRefs() {
  return refs;
}

export function showToast(message) {
  setViewState({ toastMessage: message, toastVisible: true });
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    setViewState({ toastVisible: false });
  }, 1800);
}

export function setUiBusy(isBusy, message = "") {
  setViewState({
    isBusy: Boolean(isBusy),
    busyMessage: isBusy ? (message || "Please wait...") : ""
  });
}

export function setPreviewBlocked(isBlocked, message = ViewText.previewBlockedDefault) {
  setViewState({
    previewBlocked: Boolean(isBlocked),
    previewBlockedMessage: isBlocked
      ? (message || ViewText.previewBlockedDefault)
      : ViewText.previewBlockedDefault
  });
}

export function setConfigMenuOpen(open) {
  if (state.configMenuOpen === open) {
    return;
  }
  state.configMenuOpen = open;
  setViewState({ configMenuOpen: open });
}

export function setBasePageMenuOpen(open) {
  if (state.basePageMenuOpen === open) {
    return;
  }
  state.basePageMenuOpen = open;
  setViewState({ basePageMenuOpen: open });
}
