import { h, render, Fragment } from "./vendor/preact/dist/preact.module.js";
import * as stateModule from "./state.js";

const { state } = stateModule;

const refs = {};

export const View = {
    Configuration: 'Configuration',
    Marking: 'Marking'
}

const initialViewState = {
  currentView: View.Configuration,
  configurationComplete: false,
  configurationContinueDisabled: true,
  configurationNoticeText: "",
  configurationNoticeVisible: false,
  currentPageUrl: "Unavailable",
  currentPageUrlTitle: "Unavailable",
  currentBaseUrl: "",
  baseUrlInputValue: "",
  baseUrlInputReadOnly: true,
  baseUrlSetVisible: false,
  baseUrlEditVisible: false,
  baseUrlEditText: "Change",
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
  syncLoadStatusText: "Not loaded yet",
  syncSaveStatusText: "No save sent yet",
  explicitExcludes: [],
  explicitExcludesEmptyText: "No mapped base page URL/siteId for this page",
  explicitIncludes: [],
  explicitIncludesEmptyText: "No mapped base page URL/siteId for this page",
  markedPages: [],
  markedPagesEmptyText: "No mapped base page URL/siteId for this page",
  basePageUrls: [],
  basePageUrlsEmptyText: "No base URLs saved",
  endpointUrlValue: "",
  endpointUrlReadOnly: true,
  endpointSetVisible: true,
  endpointEditVisible: false,
  endpointEditText: "Change",
  endpointNoticeText: "",
  endpointNoticeVisible: false,
  endpointInputDisabled: false,
  endpointSetDisabled: false,
  endpointEditDisabled: false,
  configEndpointUrlValue: "",
  configEndpointUrlReadOnly: true,
  configEndpointSetVisible: true,
  configEndpointEditVisible: false,
  configEndpointEditText: "Change",
  configEndpointNoticeText: "",
  configEndpointNoticeVisible: false,
  configEndpointInputDisabled: false,
  configEndpointSetDisabled: false,
  configEndpointEditDisabled: false,
  stageBaseValue: "",
  stageBaseReadOnly: true,
  stageBaseSetVisible: true,
  stageBaseEditVisible: false,
  stageBaseEditText: "Change",
  stageBaseNoticeText: "",
  stageBaseNoticeVisible: false,
  stageBaseInputDisabled: false,
  stageBaseSetDisabled: false,
  stageBaseEditDisabled: false,
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
  computeButtonText: "Decide Content",
  computeButtonDisabled: true,
  computeButtonLoading: false,
  saveExcludesButtonText: "Submit to the server",
  saveExcludesButtonDisabled: true,
  saveExcludesButtonLoading: false,
  previewLatestButtonDisabled: true,
  cssSelectorsVisible: false,
  highlightingOptionsVisible: false,
  highlightMarkedPagesChecked: true,
  highlightIncludedContentChecked: true,
  highlightExcludedContentChecked: false,
  highlightVisibleConsentChecked: false,
  highlightHideDuringScrollRedrawChecked: true,
  configMenuOpen: false,
  clearDomainCacheDisabled: false,
  isBusy: false,
  busyMessage: "",
  toastMessage: "",
  toastVisible: false
};

let viewState = { ...initialViewState };
let actions = {};

function classNames(...values) {
  return values.filter(Boolean).join(" ");
}

function renderListItems(items, emptyText, renderItem) {
  if (!items.length) {
    return [h("li", { class: "empty" }, emptyText)];
  }
  return items.map(renderItem);
}

function getBlockingUiCurtainState(view) {
  if (view.isBusy) {
    return {
      visible: true,
      message: view.busyMessage || "Loading popup..."
    };
  }
  if (view.computeButtonLoading) {
    return {
      visible: true,
      message: "Computing selectors..."
    };
  }
  if (view.saveExcludesButtonLoading) {
    return {
      visible: true,
      message: "Submitting selectors..."
    };
  }
  if (view.aiControlsBusy) {
    return {
      visible: true,
      message: "Working with AI..."
    };
  }
  if (view.deviceControlsDisabled) {
    return {
      visible: true,
      message: "Applying device emulation..."
    };
  }
  return {
    visible: false,
    message: ""
  };
}

function renderMarkedPagesSection(view, handlers, extraClassName = "") {
  return h(
    "section",
    {class: classNames("card", "margin-above", "margin-below", extraClassName)},
    h("div", {class: "padding-below section-title"}, "Marked Pages"),
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
              "Navigate"
            )
          )
      )
    )
  );
}

function App({ state: view, actions: handlers }) {
  const curtain = getBlockingUiCurtainState(view);

  return h(
    Fragment,
    null,
    h(
      "div",
      { class: "app" },
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
        { class: "ui-curtain__content" },
        h("div", { class: "ui-curtain__spinner", "aria-hidden": "true" }),
        h("div", { class: "ui-curtain__title" }, curtain.message || "Please wait..."),
        h(
          "div",
          { class: "ui-curtain__hint" },
          "Working... controls are temporarily blocked."
        )
      )
    )
  );
}

function renderMarkingView({state: view, actions: handlers}) {
  const computeButtonClass = classNames(
    "full-width",
    "margin-above",
    view.computeButtonLoading && "loading"
  );
  const showDeviceSection = !view.mainUiHidden || view.highlightingOptionsVisible;
  const markingMode = !view.mainUiHidden;

  const deviceSection = h(
    "section",
    { class: "card margin-below", hidden: !showDeviceSection },
    h("div", {class: "section-title"}, "Device emulation"),
    h(
      "label",
      {class: "row"},
      h("span", null, "Enable simulation"),
      h("input", {
        id: "device-emulation-enabled",
        type: "checkbox",
        checked: view.deviceEmulationEnabled,
        disabled: view.deviceControlsDisabled,
        onChange: handlers.onDeviceEmulationEnabledChange
      })
    ),
    h(
      "div",
      {
        class: "radio-group",
        role: "radiogroup",
        "aria-label": "Device emulation"
      },
      h(
        "label",
        {class: "row"},
        h("span", null, "Desktop 1920x1080"),
        h("input", {
          id: "device-mode-desktop",
          type: "radio",
          name: "device-mode",
          value: "desktop",
          checked: view.deviceMode === "desktop",
          disabled: view.deviceControlsDisabled || !view.deviceEmulationEnabled,
          onChange: handlers.onDeviceModeChange
        })
      ),
      h(
        "label",
        {class: "row"},
        h("span", null, "Mobile 412x960"),
        h("input", {
          id: "device-mode-mobile",
          type: "radio",
          name: "device-mode",
          value: "mobile",
          checked: view.deviceMode === "mobile",
          disabled: view.deviceControlsDisabled || !view.deviceEmulationEnabled,
          onChange: handlers.onDeviceModeChange
        })
      )
    ),
    h(
      "div",
      {class: "scale-control"},
      h(
        "div",
        {class: "row"},
        h("span", null, "Scale"),
        h("span", {id: "device-scale-value", class: "scale-value"}, view.deviceScaleValue)
      ),
      h("input", {
        id: "device-scale",
        type: "range",
        min: "0.25",
        max: "1",
        step: "0.01",
        value: view.deviceScale,
        disabled: view.deviceControlsDisabled || !view.deviceEmulationEnabled,
        onInput: handlers.onDeviceScaleInput,
        onChange: handlers.onDeviceScaleChange
      })
    )
  );

  const aiControlsSection = h(
    "section",
    {class: "card margin-above"},
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
        class: "border-above",
        "aria-busy": view.aiControlsBusy ? "true" : "false"
      },
      h(
        "div",
        {class: "section-title padding-above padding-below"},
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
        view.computeButtonText
      )
    )
  );

  const pageDataSection = h(
    "section",
    {class: "card"},
    h("div", {class: "section-title"}, "Page data"),
    view.pageSaveMobileSimulationRequiredVisible &&
      h(
        "div",
        {
          class: "notice",
          role: "status",
          "aria-live": "polite"
        },
        view.pageSaveMobileSimulationRequiredText
      ),
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
          disabled: view.pageSaveDisabled,
          onClick: handlers.onPageSave
        },
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
        "Revert to saved"
      )
    ),
    h("div", {id: "page-draft-status", class: "hint"}, view.pageDraftStatusText),
    h("div", { class: "section-divider", role: "separator" }),
    h("div", { class: "section-title" }, "Server Sync"),
    h("div", { class: "hint", id: "sync-load-status" }, `Latest loaded: ${view.syncLoadStatusText}`),
    h("div", { class: "hint", id: "sync-save-status" }, `Latest saved: ${view.syncSaveStatusText}`)
  );

  const explicitExcludesSection = h(
    "section",
    {class: "card"},
    h("div", {class: "section-title"}, "Explicit excludes"),
    h(
      "ul",
      {id: "explicit-excludes", class: "list"},
      renderListItems(
        view.explicitExcludes,
        view.explicitExcludesEmptyText,
        (item) =>
          h(
            "li",
            {key: item.xpath},
            h(
              "span",
              {title: item.text || item.xpath},
              item.text || item.xpath
            ),
            h(
              "button",
              {
                type: "button",
                onClick: () => handlers.onExplicitExcludeView(item.xpath)
              },
              "View"
            ),
            h(
              "button",
              {
                type: "button",
                onClick: () => handlers.onExplicitExcludeRemove(item.xpath)
              },
              "Remove"
            )
          )
      )
    )
  );

  const explicitIncludesSection = h(
    "section",
    {class: "card"},
    h("div", {class: "section-title"}, "Explicit includes"),
    h(
      "ul",
      {id: "explicit-includes", class: "list"},
      renderListItems(
        view.explicitIncludes,
        view.explicitIncludesEmptyText,
        (item) =>
          h(
            "li",
            {key: item.xpath},
            h(
              "span",
              {title: item.text || item.xpath},
              item.text || item.xpath
            ),
            h(
              "button",
              {
                type: "button",
                onClick: () => handlers.onExplicitIncludeView(item.xpath)
              },
              "View"
            ),
            h(
              "button",
              {
                type: "button",
                onClick: () => handlers.onExplicitIncludeRemove(item.xpath)
              },
              "Remove"
            )
          )
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
        h("span", null, "Current Page URL"),
        h(
          "div",
          {class: "input-row"},
          h(
            "div",
            {
              id: "current-page-url",
              class: "readout",
              title: view.currentPageUrlTitle
            },
            view.currentPageUrl
          ),
          h(
            "button",
            {
              id: "refresh-context",
              type: "button",
              onClick: handlers.onRefreshContext
            },
            "Refresh"
          )
        )
      ),
      h(
        "label",
        {class: "field"},
        h("span", null, "Base Page URL"),
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
        {class: "collapsible"},
        h("summary", null, "Base Page URLs"),
        h(
          "div",
          {class: "collapsible-body"},
          h(
            "ul",
            {id: "base-page-urls", class: "list"},
            renderListItems(
              view.basePageUrls,
              view.basePageUrlsEmptyText,
              (item) =>
                h(
                  "li",
                  {key: item.url},
                  h(
                    "span",
                    {class: "page-title", title: item.url},
                    item.url
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      disabled: item.url === view.currentBaseUrl,
                      onClick: () => handlers.onBasePageNavigate(item.url)
                    },
                    "Navigate"
                  )
                )
            )
          )
        )
      )
    ),
    h(
      "section",
      {class: "card"},
      h(
        "label",
        {class: "row"},
        h("span", null, "Enable Marking"),
        h("input", {
          id: "toggle-enabled",
          type: "checkbox",
          checked: view.toggleEnabled,
          disabled: view.toggleEnabledDisabled,
          onChange: handlers.onToggleEnabled
        })
      )
    ),
    view.highlightingOptionsVisible &&
      renderHighlightingOptionsSection({ state: view, actions: handlers }),
    deviceSection,
    markingMode && aiControlsSection,
    view.cssSelectorsVisible &&
      renderCssSelectorsSection({ state: view, actions: handlers }),
    markingMode && pageDataSection,
    (markingMode || view.highlightingOptionsVisible) &&
      renderMarkedPagesSection(view, handlers),
    markingMode && explicitExcludesSection,
    markingMode && explicitIncludesSection
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
        h("span", null, "Marked pages (anchors)"),
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
        h("span", null, "Included content"),
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
        h("span", null, "Excluded content"),
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
        h("span", null, "Hide while redraw/scroll"),
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
        h("span", null, "Visible Consent"),
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
      "section",
      { class: "card" },
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
                "Set endpoints, login credentials, and sign in to enable Marking features."
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
                "Continue to Marking"
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

export function updateViewState(updater) {
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

export function setConfigMenuOpen(open) {
  if (state.configMenuOpen === open) {
    return;
  }
  state.configMenuOpen = open;
  setViewState({ configMenuOpen: open });
}
