import { h, render, Fragment } from "./vendor/preact/dist/preact.module.js";
import * as stateModule from "./state.js";

const { state } = stateModule;

const refs = {};

const initialViewState = {
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
  pagePatternOptions: [],
  pagePatternPlaceholder: "",
  pagePatternValue: "",
  pagePatternDisabled: true,
  pagePatternNoticeText: "",
  pagePatternNoticeVisible: false,
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
  copySourceBaseOptions: [],
  copySourceBaseValue: "",
  copySourceBasePlaceholder: "No base URLs saved",
  copySourcePageOptions: [],
  copySourcePageValue: "",
  copySourcePagePlaceholder: "Select a Base Page URL first",
  copySourcePageDisabled: true,
  copyFromPageDisabled: true,
  xpathCssHighlightChecked: false,
  xpathCssHighlightDisabled: true,
  explicitExcludes: [],
  explicitExcludesEmptyText: "Set Base Page URL first",
  explicitIncludes: [],
  explicitIncludesEmptyText: "Set Base Page URL first",
  headingDefaults: [],
  headingDefaultsEmptyText: "Set Base Page URL first",
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
  tokenStatusText: "",
  tokenActionText: "Set token",
  tokenActionDisabled: false,
  aiTokenHidden: true,
  aiControlsHidden: true,
  aiControlsBusy: false,
  aiDirtyNoticeVisible: false,
  computeButtonText: "Decide Content",
  computeButtonDisabled: true,
  computeButtonLoading: false,
  saveExcludesButtonText: "Save Excludes",
  saveExcludesButtonDisabled: true,
  saveExcludesButtonLoading: false,
  previewLatestButtonDisabled: true,
  configMenuOpen: false,
  configExportAllDisabled: false,
  configExportCurrentDisabled: true,
  configImportDisabled: false,
  configClearCurrentDisabled: true,
  configClearAllDisabled: false,
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

function renderOptions(options, placeholder) {
  const items = [];
  if (placeholder) {
    items.push(
      h("option", { value: "" }, placeholder)
    );
  }
  if (!options.length && !placeholder) {
    items.push(
      h("option", { value: "" }, "No options available")
    );
    return items;
  }
  return items.concat(
    options.map((option) =>
      h(
        "option",
        {
          key: option.value,
          value: option.value,
          title: option.title || option.value
        },
        option.label || option.value
      )
    )
  );
}

function renderListItems(items, emptyText, renderItem) {
  if (!items.length) {
    return [h("li", { class: "empty" }, emptyText)];
  }
  return items.map(renderItem);
}

function App({ state: view, actions: handlers }) {
  const computeButtonClass = classNames(
    "full-width",
    "margin-above",
    view.computeButtonLoading && "loading"
  );
  const saveExcludesClass = classNames(
    "full-width",
    "margin-above",
    view.saveExcludesButtonLoading && "loading"
  );
  const previewClass = classNames("full-width", "margin-above");

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
                id: "config-export-all",
                type: "button",
                role: "menuitem",
                disabled: view.configExportAllDisabled,
                onClick: handlers.onExportAll
              },
              "Export all"
            ),
            h(
              "button",
              {
                id: "config-export-current",
                type: "button",
                role: "menuitem",
                disabled: view.configExportCurrentDisabled,
                onClick: handlers.onExportCurrent
              },
              "Export current"
            ),
            h("div", { class: "config-divider", role: "separator" }),
            h(
              "button",
              {
                id: "config-import",
                type: "button",
                role: "menuitem",
                disabled: view.configImportDisabled,
                onClick: handlers.onImport
              },
              "Import"
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
            ),
            h(
              "button",
              {
                id: "config-clear-all",
                type: "button",
                role: "menuitem",
                class: "danger",
                disabled: view.configClearAllDisabled,
                onClick: handlers.onClearAll
              },
              "Delete all configuration"
            )
          )
        )
      ),
      h(
        "section",
        { class: "card" },
        h(
          "label",
          { class: "field" },
          h("span", null, "Current Page URL"),
          h(
            "div",
            { class: "input-row" },
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
          { class: "field" },
          h("span", null, "Base Page URL"),
          h(
            "div",
            { class: "input-row" },
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
                style: { display: view.baseUrlSetVisible ? "inline-flex" : "none" },
                onClick: handlers.onBaseUrlSet
              },
              "Set"
            ),
            h(
              "button",
              {
                id: "base-url-edit",
                type: "button",
                style: { display: view.baseUrlEditVisible ? "inline-flex" : "none" },
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
          { class: "collapsible" },
          h("summary", null, "Base Page URLs"),
          h(
            "div",
            { class: "collapsible-body" },
            h(
              "ul",
              { id: "base-page-urls", class: "list" },
              renderListItems(
                view.basePageUrls,
                view.basePageUrlsEmptyText,
                (item) =>
                  h(
                    "li",
                    { key: item.url },
                    h(
                      "span",
                      { class: "page-title", title: item.url },
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
        { class: "card" },
        h(
          "label",
          { class: "row" },
          h("span", null, "Enable on this tab"),
          h("input", {
            id: "toggle-enabled",
            type: "checkbox",
            checked: view.toggleEnabled,
            disabled: view.toggleEnabledDisabled,
            onChange: handlers.onToggleEnabled
          })
        )
      ),
      h(
        "div",
        { id: "main-ui", hidden: view.mainUiHidden },
        h(
          "section",
          { class: "card margin-below" },
          h("div", { class: "section-title" }, "Device emulation"),
          h(
            "label",
            { class: "row" },
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
              { class: "row" },
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
              { class: "row" },
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
            { class: "scale-control" },
            h(
              "div",
              { class: "row" },
              h("span", null, "Scale"),
              h("span", { id: "device-scale-value", class: "scale-value" }, view.deviceScaleValue)
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
          { class: "card" },
          h("div", { class: "section-title" }, "Page data"),
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
            "label",
            { class: "field" },
            h("span", null, "Page URL pattern"),
            h(
              "div",
              { class: "input-row" },
              h(
                "select",
                {
                  id: "page-pattern",
                  value: view.pagePatternValue,
                  disabled: view.pagePatternDisabled,
                  onChange: handlers.onPagePatternChange
                },
                renderOptions(view.pagePatternOptions, view.pagePatternPlaceholder)
              )
            ),
            h(
              "div",
              {
                id: "page-pattern-notice",
                class: "notice",
                role: "status",
                "aria-live": "polite",
                hidden: !view.pagePatternNoticeVisible
              },
              view.pagePatternNoticeText
            )
          ),
          h(
            "div",
            { class: "button-row" },
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
          h("div", { id: "page-draft-status", class: "hint" }, view.pageDraftStatusText),
          h(
            "details",
            { class: "collapsible" },
            h("summary", null, "Copy from saved page"),
            h(
              "div",
              { class: "collapsible-body" },
              h(
                "label",
                { class: "field" },
                h("span", null, "Base Page URL"),
                h(
                  "select",
                  {
                    id: "copy-source-base-url",
                    value: view.copySourceBaseValue,
                    onChange: handlers.onCopySourceBaseChange
                  },
                  renderOptions(view.copySourceBaseOptions, view.copySourceBasePlaceholder)
                )
              ),
              h(
                "label",
                { class: "field" },
                h("span", null, "Page URL"),
                h(
                  "select",
                  {
                    id: "copy-source-page-url",
                    value: view.copySourcePageValue,
                    disabled: view.copySourcePageDisabled,
                    onChange: handlers.onCopySourcePageChange
                  },
                  renderOptions(view.copySourcePageOptions, view.copySourcePagePlaceholder)
                )
              ),
              h(
                "button",
                {
                  id: "copy-from-page",
                  type: "button",
                  disabled: view.copyFromPageDisabled,
                  onClick: handlers.onCopyFromPage
                },
                "Copy from"
              )
            )
          ),
          h(
            "details",
            { class: "collapsible" },
            h("summary", null, "XPaths to CSS"),
            h(
              "div",
              { class: "collapsible-body" },
              h(
                "div",
                { class: "toggle-row" },
                h(
                  "label",
                  { for: "xpath-css-highlight" },
                  h("input", {
                    id: "xpath-css-highlight",
                    type: "checkbox",
                    checked: view.xpathCssHighlightChecked,
                    disabled: view.xpathCssHighlightDisabled,
                    onChange: handlers.onXpathCssHighlightChange
                  }),
                  "Highlight CSS selectors"
                )
              ),
              h(
                "button",
                {
                  id: "xpath-css-copy-all",
                  type: "button",
                  class: "button-secondary full-width margin-above",
                  onClick: handlers.onXpathCssCopyAll
                },
                "Copy All Pages"
              )
            )
          )
        ),
        h(
          "section",
          { class: "card" },
          h("div", { class: "section-title" }, "Explicit excludes"),
          h(
            "ul",
            { id: "explicit-excludes", class: "list" },
            renderListItems(
              view.explicitExcludes,
              view.explicitExcludesEmptyText,
              (item) =>
                h(
                  "li",
                  { key: item.xpath },
                  h(
                    "span",
                    { title: item.text || item.xpath },
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
          { class: "card" },
          h("div", { class: "section-title" }, "Explicit includes"),
          h(
            "ul",
            { id: "explicit-includes", class: "list" },
            renderListItems(
              view.explicitIncludes,
              view.explicitIncludesEmptyText,
              (item) =>
                h(
                  "li",
                  { key: item.xpath },
                  h(
                    "span",
                    { title: item.text || item.xpath },
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
          { class: "card" },
          h("div", { class: "section-title" }, "Heading defaults"),
          h(
            "ul",
            { id: "heading-defaults", class: "list" },
            renderListItems(
              view.headingDefaults,
              view.headingDefaultsEmptyText,
              (item) =>
                h(
                  "li",
                  { key: item.xpath },
                  h(
                    "span",
                    { title: item.text },
                    item.text
                  ),
                  h(
                    "span",
                    { class: "status" },
                    item.excluded ? "Excluded" : "Included"
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      onClick: () => handlers.onHeadingDefaultView(item)
                    },
                    "View"
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      onClick: () => handlers.onHeadingDefaultToggle(item)
                    },
                    item.excluded ? "Include" : "Exclude"
                  )
                )
            )
          )
        ),
        h(
          "section",
          { class: "card margin-above margin-below" },
          h("div", { class: "padding-below section-title" }, "Marked Pages"),
          h(
            "ul",
            { id: "marked-pages", class: "list" },
            renderListItems(
              view.markedPages,
              view.markedPagesEmptyText,
              (item) =>
                h(
                  "li",
                  { key: item.url },
                  h(
                    "span",
                    { class: "page-title", title: item.title },
                    item.title
                  ),
                  h(
                    "span",
                    { class: "count" },
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
        ),
        h(
          "section",
          { class: "card" },
          h("div", { class: "section-title" }, "AI controls"),
          h(
            "label",
            { class: "field" },
            h("span", null, "Endpoint URL"),
            h(
              "div",
              { class: "input-row" },
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
                  style: { display: view.endpointSetVisible ? "inline-flex" : "none" },
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
                  style: { display: view.endpointEditVisible ? "inline-flex" : "none" },
                  disabled: view.endpointEditDisabled,
                  onClick: handlers.onEndpointEditToggle
                },
                view.endpointEditText
              )
            )
          ),
          h(
            "div",
            {
              id: "endpoint-notice",
              class: "notice",
              role: "status",
              "aria-live": "polite",
              hidden: !view.endpointNoticeVisible
            },
            view.endpointNoticeText
          ),
          h(
            "label",
            { id: "ai-token", class: "field", hidden: view.aiTokenHidden },
            h("span", null, "Token"),
            h(
              "div",
              { class: "token-row" },
              h("span", { id: "token-status", class: "token-status" }, view.tokenStatusText),
              h(
                "button",
                {
                  id: "token-action",
                  type: "button",
                  disabled: view.tokenActionDisabled,
                  onClick: handlers.onTokenAction
                },
                view.tokenActionText
              )
            )
          ),
          h(
            "div",
            {
              id: "ai-controls",
              class: "border-above",
              hidden: view.aiControlsHidden,
              "aria-busy": view.aiControlsBusy ? "true" : "false"
            },
            h(
              "div",
              { class: "section-title padding-above padding-below" },
              "Selector Computation"
            ),
            h(
              "div",
              {
                id: "ai-dirty-notice",
                class: "notice",
                role: "status",
                "aria-live": "polite",
                style: { display: view.aiDirtyNoticeVisible ? "block" : "none" }
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
            ),
            h(
              "button",
              {
                id: "save-excludes",
                class: saveExcludesClass,
                type: "button",
                disabled: view.saveExcludesButtonDisabled,
                onClick: handlers.onSaveExcludes
              },
              view.saveExcludesButtonText
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
            )
          )
        )
      )
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
    ),
    h("input", {
      id: "config-import-file",
      type: "file",
      accept: "application/json",
      hidden: true,
      ref: (el) => {
        refs.configImportFile = el;
      },
      onChange: handlers.onImportFile
    })
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
