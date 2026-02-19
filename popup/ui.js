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
  baseUrlSetVisible: true,
  baseUrlEditVisible: false,
  baseUrlEditText: "Change",
  baseUrlNoticeText: "",
  baseUrlNoticeVisible: false,
  toggleEnabled: false,
  toggleEnabledDisabled: true,
  mainUiHidden: true,
  deviceEmulationEnabled: false,
  deviceMode: "desktop",
  deviceScale: 0.7,
  deviceScaleValue: "70%",
  deviceControlsDisabled: false,
  pageDataNewNoticeHidden: true,
  pageSaveDisabled: true,
  pageRevertDisabled: true,
  pageDeleteDisabled: true,
  pageDraftStatusText: "",
  syncLoadStatusText: "Not loaded yet",
  syncSaveStatusText: "No save sent yet",
  explicitExcludes: [],
  explicitExcludesEmptyText: "Set Base Page URL first",
  explicitIncludes: [],
  explicitIncludesEmptyText: "Set Base Page URL first",
  defaultTagExclusions: [],
  defaultTagExclusionsEmptyText: "Set Base Page URL first",
  markedPages: [],
  markedPagesEmptyText: "Set Base Page URL first",
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
  loginEndpointUrlValue: "",
  loginEndpointUrlReadOnly: true,
  loginEndpointSetVisible: true,
  loginEndpointEditVisible: false,
  loginEndpointEditText: "Change",
  loginEndpointNoticeText: "",
  loginEndpointNoticeVisible: false,
  loginEndpointInputDisabled: false,
  loginEndpointSetDisabled: false,
  loginEndpointEditDisabled: false,
  loginEmailValue: "",
  loginPasswordValue: "",
  loginCredentialsDisabled: true,
  loginStatusText: "",
  loginActionDisabled: false,
  aiControlsHidden: true,
  aiControlsBusy: false,
  aiDirtyNoticeVisible: false,
  mobileSimulationRequiredVisible: false,
  mobileSimulationRequiredText: "",
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
  highlightHideDuringScrollRedrawChecked: false,
  configMenuOpen: false,
  configClearCurrentDisabled: true,
  clearDomainCacheDisabled: false,
  isBusy: false,
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
            ),
            h("div", { class: "config-divider", role: "separator" }),
            h(
              "button",
              {
                id: "config-clear-current",
                type: "button",
                role: "menuitem",
                class: "danger",
                disabled: view.configClearCurrentDisabled,
                onClick: handlers.onClearCurrent
              },
              "Delete current Base Page URL configuration"
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
        hidden: !view.isBusy
      },
      h("div", { class: "ui-curtain__content" }, "Please wait...")
    )
  );
}

function renderMarkingView({state: view, actions: handlers}) {
    const computeButtonClass = classNames(
        "full-width",
        "margin-above",
        view.computeButtonLoading && "loading"
    );
    const showMarkedPagesInHighlightingMode =
      view.highlightingOptionsVisible && view.markedPages.length > 0;

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
                        placeholder: "https://example.com",
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
        h(
            "div",
            {id: "main-ui", hidden: view.mainUiHidden},
            h(
                "section",
                {class: "card margin-below"},
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
            ),
            h(
                "section",
                {class: "card"},
                h("div", {class: "section-title"}, "Page data"),
                view.mobileSimulationRequiredVisible &&
                  h(
                    "div",
                    {
                      class: "notice",
                      role: "status",
                      "aria-live": "polite"
                    },
                    view.mobileSimulationRequiredText
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
                h(
                    "button",
                    {
                        id: "page-delete",
                        type: "button",
                        class: "button-danger button-small",
                        disabled: view.pageDeleteDisabled,
                        onClick: handlers.onPageDelete
                    },
                    "Delete current page"
                ),
                h("div", {id: "page-draft-status", class: "hint"}, view.pageDraftStatusText),
                h("div", { class: "section-divider", role: "separator" }),
                h("div", { class: "section-title" }, "Server Sync"),
                h("div", { class: "hint", id: "sync-load-status" }, `Latest /load: ${view.syncLoadStatusText}`),
                h("div", { class: "hint", id: "sync-save-status" }, `Latest /save: ${view.syncSaveStatusText}`)
            ),
            h(
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
            ),
            h(
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
            ),
            h(
                "section",
                {class: "card"},
                h("div", {class: "section-title"}, "Default tag exclusions"),
                h(
                    "ul",
                    {id: "default-tag-exclusions", class: "list"},
                    renderListItems(
                        view.defaultTagExclusions,
                        view.defaultTagExclusionsEmptyText,
                        (item) =>
                            h(
                                "li",
                                {key: item.xpath},
                                h(
                                    "span",
                                    {title: item.text},
                                    item.text
                                ),
                                h(
                                    "span",
                                    {class: "status"},
                                    item.excluded ? "Excluded" : "Included"
                                ),
                                h(
                                    "button",
                                    {
                                        type: "button",
                                        onClick: () => handlers.onDefaultTagExclusionView(item)
                                    },
                                    "View"
                                ),
                                h(
                                    "button",
                                    {
                                        type: "button",
                                        onClick: () => handlers.onDefaultTagExclusionToggle(item)
                                    },
                                    item.excluded ? "Include" : "Exclude"
                                )
                            )
                    )
                )
            ),
            h(
                "section",
                {class: "card"},
                h("div", {class: "section-title"}, "AI controls"),
                view.mobileSimulationRequiredVisible &&
                  h(
                    "div",
                    {
                      class: "notice",
                      role: "status",
                      "aria-live": "polite"
                    },
                    view.mobileSimulationRequiredText
                  ),
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
            ),
            !showMarkedPagesInHighlightingMode &&
              renderMarkedPagesSection(view, handlers),
        )
        ,
        view.cssSelectorsVisible &&
          renderCssSelectorsSection({ state: view, actions: handlers }),
        showMarkedPagesInHighlightingMode &&
          renderMarkedPagesSection(view, handlers)
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
        h("span", null, "Visible Consent"),
        h("input", {
          id: "highlight-visible-consent",
          type: "checkbox",
          checked: view.highlightVisibleConsentChecked,
          onChange: handlers.onHighlightVisibleConsentChange
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
      view.mobileSimulationRequiredVisible &&
        h(
          "div",
          {
            class: "notice",
            role: "status",
            "aria-live": "polite"
          },
          view.mobileSimulationRequiredText
        ),
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
            h("div", {class: "section-title"}, "AI settings"),
            h(
                Fragment,
                null,
                h(
                    "label",
                    {class: "field"},
                    h("span", null, "Login Endpoint URL"),
                    h(
                        "div",
                        {class: "input-row"},
                        h("input", {
                            id: "login-endpoint-url",
                            type: "text",
                            placeholder: "https://example.com/login",
                            readOnly: view.loginEndpointUrlReadOnly,
                            value: view.loginEndpointUrlValue,
                            disabled: view.loginEndpointInputDisabled,
                            onInput: handlers.onLoginEndpointInput,
                            onKeyDown: handlers.onLoginEndpointKeyDown,
                            ref: (el) => {
                                refs.loginEndpointUrlInput = el;
                            }
                        }),
                        h(
                            "button",
                            {
                                id: "login-endpoint-url-set",
                                type: "button",
                                style: {display: view.loginEndpointSetVisible ? "inline-flex" : "none"},
                                disabled: view.loginEndpointSetDisabled,
                                onClick: handlers.onLoginEndpointSet
                            },
                            "Set"
                        ),
                        h(
                            "button",
                            {
                                id: "login-endpoint-url-edit",
                                type: "button",
                                style: {display: view.loginEndpointEditVisible ? "inline-flex" : "none"},
                                disabled: view.loginEndpointEditDisabled,
                                onClick: handlers.onLoginEndpointEditToggle
                            },
                            view.loginEndpointEditText
                        )
                    )
                ),
                h(
                    "div",
                    {
                        id: "login-endpoint-notice",
                        class: "notice",
                        role: "status",
                        "aria-live": "polite",
                        hidden: !view.loginEndpointNoticeVisible
                    },
                    view.loginEndpointNoticeText
                ),
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

export function setUiBusy(isBusy) {
  document.body.classList.toggle("is-busy", isBusy);
  setViewState({ isBusy });
}

export function setConfigMenuOpen(open) {
  if (state.configMenuOpen === open) {
    return;
  }
  state.configMenuOpen = open;
  setViewState({ configMenuOpen: open });
}
