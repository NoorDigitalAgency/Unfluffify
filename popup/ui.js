import { h, render, Fragment } from "./vendor/preact/dist/preact.module.js";
import * as stateModule from "./state.js";
import {
  PopupText,
  ViewText,
  formatMarkedPageCount,
  formatScalePercent,
  formatSyncLoadSummary,
  formatSyncSaveSummary
} from "../common/text.js";

export { ViewText } from "../common/text.js";

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
  currentPageUrl: ViewText.unavailable,
  currentBaseUrl: "",
  baseUrlInputValue: "",
  baseUrlNoticeText: "",
  baseUrlNoticeVisible: false,
  toggleEnabled: false,
  toggleEnabledDisabled: true,
  mainUiHidden: true,
  deviceEmulationEnabled: false,
  deviceMode: "mobile",
  deviceScale: 0.85,
  deviceScaleValue: formatScalePercent(0.85),
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
  renderModeSummaryTitle: PopupText.renderMode.title,
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
      message: view.busyMessage || PopupText.overlay.loadingPopup
    };
  }
  if (view.computeButtonLoading) {
    return {
      visible: true,
      mode: "busy",
      message: PopupText.overlay.computingSelectors
    };
  }
  if (view.saveExcludesButtonLoading) {
    return {
      visible: true,
      mode: "busy",
      message: PopupText.overlay.submittingSelectors
    };
  }
  if (view.aiControlsBusy) {
    return {
      visible: true,
      mode: "busy",
      message: PopupText.overlay.workingWithAi
    };
  }
  if (view.deviceControlsDisabled) {
    return {
      visible: true,
      mode: "busy",
      message: PopupText.overlay.applyingDeviceEmulation
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
              ? h("span", { class: "section-menu__status" }, PopupText.markedPages.currentBadge)
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
          h("option", { value: "static" }, PopupText.renderMode.optionStatic),
          h("option", { value: "rendered" }, PopupText.renderMode.optionRendered),
          view.renderModeUndeterminedVisible
            ? h("option", { value: "undetermined", disabled: true }, PopupText.renderMode.optionUndetermined)
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
          PopupText.actions.set
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
      h("div", {class: "section-title"}, PopupText.markedPages.title),
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
            title: PopupText.tooltips.basePageUrls,
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
              formatMarkedPageCount(item.count)
            ),
            h(
              "button",
              {
                type: "button",
                disabled: item.url === view.currentPageUrl,
                onClick: () => handlers.onMarkedPageNavigate(item.url)
              },
              icon("arrow-right"),
              PopupText.actions.navigate
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
            title: PopupText.unregister.closeButtonTitle,
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
          h("img", { src: "logo.png", alt: PopupText.branding.logoAlt, class: "header-logo" })
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
            PopupText.configuration.title
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
              PopupText.configuration.openViewAction
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
              PopupText.cache.menuAction
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
        h("div", { class: "ui-curtain__title" }, curtain.message || PopupText.overlay.pleaseWait),
        h(
          "div",
          { class: "ui-curtain__hint" },
          view.previewBlocked
            ? PopupText.overlay.previewHint
            : PopupText.overlay.busyHint
        ),
        previewCurtainVisible
          ? h(
              "button",
              {
                type: "button",
                class: "ui-curtain__action",
                onClick: handlers.onExitPreviewMode
              },
              PopupText.actions.exitPreview
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
    h("div", {class: "section-title"}, PopupText.ai.sectionTitle),
    !view.configurationComplete &&
      h(
        "div",
        {
          class: "notice",
          role: "status",
          "aria-live": "polite"
        },
        PopupText.ai.configurationRequiredNotice
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
        PopupText.ai.subsectionTitle
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
        PopupText.ai.dirtyNotice
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
  const pageSaveNotice = view.pageSaveMobileSimulationRequiredVisible
    ? h(
        "div",
        {
          class: "notice",
          role: "status",
          "aria-live": "polite"
        },
        view.pageSaveMobileSimulationRequiredText
      )
    : h(
        "div",
        {
          id: "page-data-new-notice",
          class: "notice",
          role: "status",
          "aria-live": "polite",
          hidden: view.pageDataNewNoticeHidden,
          dangerouslySetInnerHTML: {
            __html: PopupText.page.noSavedDataNotice
          }
        }
      );
  const mergedControlsSectionChildren = [
    h(
      "label",
      {class: "row", title: PopupText.tooltips.mobileSimulationHotkey},
      h("span", {class: "row-label"}, icon("cellphone", "row-icon"), PopupText.device.enableLabel),
      h("input", {
        id: "device-emulation-enabled",
        type: "checkbox",
        checked: view.deviceEmulationEnabled,
        disabled: view.deviceControlsDisabled,
        onChange: handlers.onDeviceEmulationEnabledChange
      })
    )
  ];

  if (markingMode) {
    mergedControlsSectionChildren.push(
      h("div", { class: "section-divider", role: "separator" }),
      pageSaveNotice,
      h(
        "div",
        {class: "button-row"},
        h(
          "button",
          {
            id: "page-save",
            type: "button",
            title: PopupText.tooltips.pageSaveHotkey,
            disabled: view.pageSaveDisabled,
            onClick: handlers.onPageSave
          },
          icon("content-save"),
          PopupText.actions.save
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
          PopupText.actions.revertToSaved
        )
      ),
      h("div", {id: "page-draft-status", class: "hint"}, view.pageDraftStatusText),
      h(
        "details",
        { class: "collapsible" },
        h("summary", null, PopupText.page.serverSyncTitle),
        h(
          "div",
          { class: "collapsible-body" },
          h("div", { class: "hint", id: "sync-load-status" }, formatSyncLoadSummary(view.syncLoadStatusText)),
          h("div", { class: "hint", id: "sync-save-status" }, formatSyncSaveSummary(view.syncSaveStatusText))
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
      h("div", { id: "render-mode-warning-title", class: "warning-popover__title" }, PopupText.renderMode.warningTitle),
      h(
        "div",
        {
          class: "warning-popover__body",
          dangerouslySetInnerHTML: {
            __html: PopupText.renderMode.warningBodyHtml
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
        h("span", null, PopupText.renderMode.warningAcknowledge)
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
        PopupText.actions.ok
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
        h("span", null, icon("home-outline", "field-icon"), PopupText.baseUrl.fieldLabel),
        h(
          "div",
          {class: "input-row"},
          h("input", {
            id: "base-url",
            type: "text",
            placeholder: PopupText.baseUrl.placeholder,
            readOnly: true,
            value: view.baseUrlInputValue
          })
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
        h("summary", null, icon("monitor-dashboard", "field-icon"), view.renderModeSummaryTitle),
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
          {class: "row", title: PopupText.tooltips.enableMarkingHotkey},
          h("span", {class: "row-label"}, icon("pencil-box-outline", "row-icon"), PopupText.actions.enableMarking),
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
      h("div", { class: "section-title" }, PopupText.highlighting.sectionTitle),
      h(
        "label",
        { class: "row" },
        h("span", {class: "row-label"}, icon("bookmark-outline", "row-icon"), PopupText.highlighting.markedPages),
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
        h("span", {class: "row-label"}, icon("check-circle-outline", "row-icon"), PopupText.highlighting.includedContent),
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
        h("span", {class: "row-label"}, icon("minus-circle-outline", "row-icon"), PopupText.highlighting.excludedContent),
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
        h("span", {class: "row-label"}, icon("eye-off-outline", "row-icon"), PopupText.highlighting.hideWhileScrolling),
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
        h("span", {class: "row-label"}, icon("shield-check-outline", "row-icon"), PopupText.highlighting.visibleConsent),
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
    const previewClass = classNames("full-width");
    const submitClass = classNames(
      "full-width",
      view.saveExcludesButtonLoading && "loading"
    );
    return h(
      Fragment,
      null,
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
        PopupText.actions.previewLatest
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
      h("div", {class: "section-title"}, PopupText.configuration.title),
            h(
                "div",
                {class: "hint"},
        PopupText.configuration.setupHint
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
                  PopupText.actions.goBack
            )
        ),
        h(
            "section",
            {class: "card"},
                h("div", {class: "section-title"}, PopupText.configuration.endpointSectionTitle),
            h(
                "label",
                {class: "field"},
                  h("span", null, PopupText.configuration.endpointFieldLabel),
                h(
                    "div",
                    {class: "input-row"},
                    h("input", {
                        id: "config-endpoint-url",
                        type: "text",
                      placeholder: PopupText.configuration.endpointPlaceholder,
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
                          PopupText.actions.set
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
          h("div", {class: "section-title"}, PopupText.configuration.aiSettingsTitle),
            h(
                "label",
                {class: "field"},
            h("span", null, PopupText.configuration.aiEndpointFieldLabel),
                h(
                    "div",
                    {class: "input-row"},
                    h("input", {
                        id: "endpoint-url",
                        type: "text",
                placeholder: PopupText.configuration.aiEndpointPlaceholder,
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
                          PopupText.actions.set
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
          h("div", {class: "section-title"}, PopupText.configuration.stageBaseTitle),
            h(
                "label",
                {class: "field"},
            h("span", null, PopupText.configuration.stageBaseFieldLabel),
                h(
                    "div",
                    {class: "input-row"},
                    h("input", {
                        id: "stage-base",
                        type: "text",
                placeholder: PopupText.configuration.stageBasePlaceholder,
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
                          PopupText.actions.set
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
          h("div", {class: "section-title"}, PopupText.authentication.title),
            h(
                Fragment,
                null,
                h(
                    "label",
                    {class: "field"},
              h("span", null, PopupText.authentication.emailLabel),
                    h("input", {
                        id: "login-email",
                        type: "email",
                placeholder: PopupText.authentication.emailPlaceholder,
                        value: view.loginEmailValue,
                        disabled: view.loginCredentialsDisabled,
                        onInput: handlers.onLoginEmailInput
                    })
                ),
                h(
                    "label",
                    {class: "field"},
                  h("span", null, PopupText.authentication.passwordLabel),
                    h("input", {
                        id: "login-password",
                        type: "password",
                    placeholder: PopupText.authentication.passwordPlaceholder,
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
                          PopupText.actions.login
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
    busyMessage: isBusy ? (message || PopupText.overlay.pleaseWait) : ""
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
