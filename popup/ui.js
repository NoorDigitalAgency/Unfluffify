import { h, render, Fragment } from "./vendor/preact/dist/preact.module.js";
import * as stateModule from "./state.js";
import {
  PopupText,
  ViewText,
  formatScalePercent,
  formatSyncLoadSummary,
  formatSyncSaveSummary
} from "../common/text.js";
import {
  buildLynxChecklistViewModel,
  createInitialLynxChecklistState
} from "../common/lynx-checklist.js";

export { ViewText } from "../common/text.js";

const { state } = stateModule;

const refs = {};
const initialLynxChecklistState = createInitialLynxChecklistState();
let lastPreviewScrolledXpath = "";

export const View = {
    Configuration: 'Configuration',
    Marking: 'Marking'
}

const initialViewState = {
  currentView: View.Configuration,
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
  pageDraftStatusTone: "muted",
  syncLoadStatusText: ViewText.syncLoadIdle,
  syncLoadStatusTone: "muted",
  syncSaveStatusText: ViewText.syncSaveIdle,
  syncSaveStatusTone: "muted",
  markedPages: [],
  markedPagesEmptyText: ViewText.markedPagesEmpty,
  pageTypeGroups: [],
  pageTypeGroupsEmptyText: PopupText.pageTypes.emptyState,
  pageTypeNoticeText: "",
  pageTypeNoticeVisible: false,
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
  renderModeNoticeActionVisible: false,
  renderModeNoticeActionText: "",
  renderModeUndeterminedVisible: true,
  renderModeWarningVisible: false,
  renderModeWarningAcknowledgeChecked: false,
  renderModeWarningOkDisabled: true,
  lynxChecklistVisible: false,
  lynxChecklistAiAnswer: initialLynxChecklistState.aiAnswer,
  lynxChecklistPageTypes: initialLynxChecklistState.pageTypes,
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
  loginStatusTone: "muted",
  loginActionDisabled: false,
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
  previewActive: false,
  previewItems: [],
  previewFocusedXpath: "",
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

function editToggleIcon(actionText) {
  return actionText === ViewText.cancelAction ? "close" : "pencil-outline";
}

function statusToneClass(tone) {
  const normalizedTone =
    tone === "success" || tone === "warning" || tone === "danger"
      ? tone
      : "muted";
  return classNames("status-text", `status-text--${normalizedTone}`);
}

function formatCandidateWordsCount(wordsCount) {
  const value = Number.isFinite(wordsCount) ? Math.max(0, Math.trunc(wordsCount)) : 0;
  return value > 0 ? `${value} ${PopupText.pageTypes.wordsSuffix}` : "";
}

function getBlockingUiCurtainState(view) {
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
          icon(editToggleIcon(view.renderModeEditText)),
          view.renderModeEditText
        )
      )
    ),
    h(
      "div",
      {
        id: "render-mode-notice",
        class: classNames("notice", view.renderModeNoticeActionVisible && "notice--actionable"),
        role: "status",
        "aria-live": "polite",
        hidden: !view.renderModeNoticeVisible
      },
      h("span", null, view.renderModeNoticeText),
      view.renderModeNoticeActionVisible
        ? h(
            "button",
            {
              id: "render-mode-notice-action",
              type: "button",
              class: "notice__action",
              onClick: handlers.onRenderModeNoticeAction
            },
            view.renderModeNoticeActionText
          )
        : null
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
      h("div", {class: "section-title"}, PopupText.pageTypes.title),
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
    h("div", { class: "hint" }, PopupText.pageTypes.hint),
    h(
      "div",
      {
        class: "notice",
        role: "status",
        "aria-live": "polite",
        hidden: !view.pageTypeNoticeVisible
      },
      view.pageTypeNoticeText
    ),
    view.pageTypeGroups.length
      ? h(
          "div",
          { class: "page-types" },
          view.pageTypeGroups.map((group) =>
            h(
              "section",
              {
                key: group.key,
                class: classNames("page-types__group", group.missing && "page-types__group--missing")
              },
              h(
                "div",
                { class: "page-types__group-header" },
                h(
                  "div",
                  { class: "page-types__group-heading" },
                  h("div", { class: "page-types__group-title" }, group.title),
                  h(
                    "div",
                    { class: "page-types__group-subtitle" },
                    group.markedCount
                      ? `${group.markedCount} saved ${group.markedCount === 1 ? "page" : "pages"}`
                      : PopupText.pageTypes.markRequirement
                  )
                ),
                h(
                  "span",
                  {
                    class: classNames(
                      "page-types__group-badge",
                      group.missing
                        ? "page-types__group-badge--missing"
                        : "page-types__group-badge--ready"
                    )
                  },
                  group.missing ? PopupText.pageTypes.missingBadge : PopupText.pageTypes.readyBadge
                )
              ),
              group.candidates.length
                ? h(
                    "ul",
                    { class: "page-types__candidate-list" },
                    group.candidates.map((item) =>
                      h(
                        "li",
                        {
                          key: `${group.key}|${item.url}`,
                          class: classNames(
                            "page-types__candidate",
                            item.current && "page-types__candidate--current",
                            item.marked && "page-types__candidate--marked",
                            item.duplicate && "page-types__candidate--duplicate"
                          )
                        },
                        h(
                          "button",
                          {
                            type: "button",
                            class: "page-types__candidate-button",
                            disabled: item.navigationDisabled,
                            onClick: () => handlers.onMarkedPageNavigate(item.url)
                          },
                          h(
                            "span",
                            { class: "page-types__candidate-copy" },
                            h(
                              "span",
                              { class: "page-types__candidate-url", title: item.url },
                              item.label
                            ),
                            h(
                              "span",
                              { class: "page-types__candidate-meta" },
                              [item.url, formatCandidateWordsCount(item.wordsCount)]
                                .filter(Boolean)
                                .join(" • ")
                            )
                          ),
                          h(
                            "span",
                            { class: "page-types__candidate-badges" },
                            item.marked
                              ? h(
                                  "span",
                                  { class: "page-types__candidate-badge page-types__candidate-badge--marked" },
                                  PopupText.pageTypes.markedBadge
                                )
                              : null,
                            item.current
                              ? h(
                                  "span",
                                  { class: "page-types__candidate-badge page-types__candidate-badge--current" },
                                  PopupText.pageTypes.currentBadge
                                )
                              : null,
                            item.duplicate
                              ? h(
                                  "span",
                                  {
                                    class: "page-types__candidate-badge page-types__candidate-badge--duplicate",
                                    title: item.duplicateNotice
                                  },
                                  PopupText.pageTypes.duplicateBadge
                                )
                              : null
                          )
                        ),
                        item.duplicateNotice
                          ? h("div", { class: "page-types__candidate-warning" }, item.duplicateNotice)
                          : null
                      )
                    )
                  )
                : h("div", { class: "page-types__empty" }, view.pageTypeGroupsEmptyText)
            )
          )
        )
      : h("div", { class: "page-types__empty" }, view.pageTypeGroupsEmptyText)
  );
}

function renderPreviewSidebar(view, handlers) {
  const openingPreview = view.previewBlocked && !view.previewActive;
  const listItems = openingPreview
    ? [
        h("li", { class: "preview-sidebar__empty", key: "loading" }, PopupText.preview.loading)
      ]
    : view.previewItems.length
      ? view.previewItems.map((item, index) => {
          const active = item.xpath === view.previewFocusedXpath;
          return h(
            "li",
            {
              key: item.xpath,
              class: classNames("preview-sidebar__item", active && "preview-sidebar__item--active")
            },
            h(
              "button",
              {
                type: "button",
                class: "preview-sidebar__item-button",
                onClick: () => handlers.onPreviewItemFocus(item.xpath),
                ref: (el) => {
                  if (active) {
                    refs.previewActiveItem = el;
                  }
                }
              },
              h("span", { class: "preview-sidebar__item-index", "aria-hidden": "true" }, `${index + 1}.`),
              h("span", { class: "preview-sidebar__item-text", title: item.text }, item.text)
            )
          );
        })
      : [
          h("li", { class: "preview-sidebar__empty", key: "empty" }, PopupText.preview.emptyState)
        ];

  return h(
    "section",
    { class: "card preview-sidebar" },
    h(
      "div",
      { class: "preview-sidebar__header" },
      h("div", { class: "section-title" }, PopupText.preview.sidebarTitle),
      h(
        "button",
        {
          type: "button",
          class: "preview-sidebar__dismiss",
          onClick: handlers.onExitPreviewMode,
          "aria-label": PopupText.actions.exitPreview,
          title: PopupText.actions.exitPreview
        },
        icon("exit-to-app")
      )
    ),
    h(
      "div",
      { class: "hint preview-sidebar__hint" },
      openingPreview
        ? (view.previewBlockedMessage || PopupText.preview.loading)
        : PopupText.preview.sidebarHint
    ),
    h("ul", { class: "preview-sidebar__list" }, listItems)
  );
}

function App({ state: view, actions: handlers }) {
  const curtain = getBlockingUiCurtainState(view);
  const previewVisible = view.previewBlocked || view.previewActive;

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
        !previewVisible &&
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
      previewVisible
        ? renderPreviewSidebar(view, handlers)
        : view.currentView === View.Marking
          ? renderMarkingView({ state: view, actions: handlers })
          : view.currentView === View.Configuration
            ? renderConfigurationView({ state: view, actions: handlers })
            : null
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
        h("div", { class: "ui-curtain__title" }, curtain.message || PopupText.overlay.pleaseWait),
        h(
          "div",
          { class: "ui-curtain__hint" },
          PopupText.overlay.busyHint
        )
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
    h(
      "div",
      {
        id: "ai-controls",
        "aria-busy": view.aiControlsBusy ? "true" : "false"
      },
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

function getLynxChecklistNoticeText(checklist) {
  const { blockingReason } = checklist;
  const missingTitles = Array.isArray(blockingReason.pageTypeKeys)
    ? blockingReason.pageTypeKeys
        .map((key) => (checklist.pageTypes.find((item) => item.key === key) || {}).title || "")
        .filter(Boolean)
    : [];

  if (blockingReason.code === "ai_no") {
    return PopupText.lynxChecklist.noticeAiNo;
  }
  if (blockingReason.code === "ai_unanswered") {
    return PopupText.lynxChecklist.noticeAiUnanswered;
  }
  if (blockingReason.code === "no_candidates") {
    return PopupText.lynxChecklist.noticeNoCandidates;
  }
  if (blockingReason.code === "missing_page_types") {
    return `${PopupText.lynxChecklist.noticeMissingPageTypesPrefix}${missingTitles.join(", ")}${PopupText.lynxChecklist.noticeMissingPageTypesSuffix}`;
  }
  if (checklist.canSend) {
    return PopupText.lynxChecklist.noticeCoverageComplete;
  }
  return "";
}

function renderLynxChecklistRadioOption({
  name,
  value,
  checked,
  disabled,
  label,
  onChange
}) {
  return h(
    "label",
    {
      class: classNames(
        "lynx-checklist-popover__choice",
        disabled && "lynx-checklist-popover__choice--disabled"
      )
    },
    h("input", {
      type: "radio",
      name,
      value,
      checked,
      disabled,
      onChange
    }),
    h("span", null, label)
  );
}

function renderLynxChecklistPopover(view, handlers) {
  const checklist = buildLynxChecklistViewModel({
    aiAnswer: view.lynxChecklistAiAnswer,
    pageTypes: view.lynxChecklistPageTypes,
    markedPages: view.markedPages
  });
  const noticeText = getLynxChecklistNoticeText(checklist);

  return h(
    "div",
    {
      class: "warning-popover lynx-checklist-popover",
      hidden: !view.lynxChecklistVisible,
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "lynx-checklist-title"
    },
    h(
      "div",
      { class: "warning-popover__card lynx-checklist-popover__card" },
      h("div", { id: "lynx-checklist-title", class: "warning-popover__title" }, PopupText.lynxChecklist.title),
      h(
        "section",
        { class: "lynx-checklist-popover__section" },
        h("div", { class: "lynx-checklist-popover__question" }, PopupText.lynxChecklist.aiQuestion),
        h(
          "div",
          {
            class: "lynx-checklist-popover__choices",
            role: "radiogroup",
            "aria-label": PopupText.lynxChecklist.aiQuestion
          },
          renderLynxChecklistRadioOption({
            name: "lynx-checklist-ai",
            value: "yes",
            checked: checklist.aiAnswer === "yes",
            disabled: checklist.aiQuestionDisabled,
            label: ViewText.yes,
            onChange: handlers.onLynxChecklistAiAnswerChange
          }),
          renderLynxChecklistRadioOption({
            name: "lynx-checklist-ai",
            value: "no",
            checked: checklist.aiAnswer === "no",
            disabled: checklist.aiQuestionDisabled,
            label: ViewText.no,
            onChange: handlers.onLynxChecklistAiAnswerChange
          })
        )
      ),
      h(
        "section",
        { class: "lynx-checklist-popover__section" },
        h("div", { class: "lynx-checklist-popover__question" }, PopupText.lynxChecklist.pageTypesTitle),
        checklist.pageTypes.length
          ? h(
              "div",
              { class: "lynx-checklist-popover__page-types" },
              checklist.pageTypes.map((item) =>
                h(
                  "div",
                  {
                    key: item.key,
                    class: classNames(
                      "lynx-checklist-popover__page-type",
                      item.missing && "lynx-checklist-popover__page-type--missing"
                    )
                  },
                  h(
                    "div",
                    { class: "lynx-checklist-popover__page-type-title-row" },
                    h("div", { class: "lynx-checklist-popover__page-type-title" }, item.title),
                    h(
                      "span",
                      {
                        class: classNames(
                          "lynx-checklist-popover__page-type-status",
                          item.missing
                            ? "lynx-checklist-popover__page-type-status--missing"
                            : "lynx-checklist-popover__page-type-status--ready"
                        )
                      },
                      item.missing ? PopupText.pageTypes.missingBadge : PopupText.pageTypes.readyBadge
                    )
                  ),
                  h(
                    "div",
                    { class: "lynx-checklist-popover__page-type-subtitle" },
                    item.markedCount
                      ? `${item.markedCount} saved ${item.markedCount === 1 ? "page" : "pages"}`
                      : PopupText.pageTypes.markRequirement
                  ),
                  item.missing && item.candidatePreview.length
                    ? h(
                        "div",
                        { class: "lynx-checklist-popover__candidate-hints" },
                        h(
                          "span",
                          { class: "lynx-checklist-popover__candidate-hints-label" },
                          `${PopupText.lynxChecklist.missingCandidatesLabel}:`
                        ),
                        item.candidatePreview.map((candidate) =>
                          h(
                            "span",
                            {
                              key: `${item.key}|${candidate.url}`,
                              class: "lynx-checklist-popover__candidate-hint",
                              title: candidate.url
                            },
                            candidate.url
                          )
                        )
                      )
                    : null
                )
              )
            )
          : h("div", { class: "hint" }, PopupText.lynxChecklist.noticeNoCandidates)
      ),
      noticeText &&
        h(
          "div",
          {
            class: "notice",
            role: "status",
            "aria-live": "polite"
          },
          noticeText
        ),
      checklist.invalidMarkedPages.length
        ? h(
            "div",
            {
              class: "hint lynx-checklist-popover__invalid-hint",
              role: "status",
              "aria-live": "polite"
            },
            PopupText.lynxChecklist.invalidStoredNotice
          )
        : null,
      h(
        "div",
        { class: "button-row lynx-checklist-popover__actions" },
        h(
          "button",
          {
            id: "lynx-checklist-cancel",
            type: "button",
            class: "button-secondary",
            onClick: handlers.onLynxChecklistCancel
          },
          PopupText.actions.cancel
        ),
        h(
          "button",
          {
            id: "lynx-checklist-send",
            type: "button",
            disabled: !checklist.canSend,
            onClick: handlers.onLynxChecklistSend
          },
          PopupText.actions.sendToLynx
        )
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
      h(
        "div",
        {
          id: "page-draft-status",
          class: classNames("hint", statusToneClass(view.pageDraftStatusTone))
        },
        view.pageDraftStatusText
      ),
      h(
        "details",
        { class: "collapsible" },
        h("summary", null, PopupText.page.serverSyncTitle),
        h(
          "div",
          { class: "collapsible-body" },
          h(
            "div",
            {
              class: classNames("hint", statusToneClass(view.syncLoadStatusTone)),
              id: "sync-load-status"
            },
            formatSyncLoadSummary(view.syncLoadStatusText)
          ),
          h(
            "div",
            {
              class: classNames("hint", statusToneClass(view.syncSaveStatusTone)),
              id: "sync-save-status"
            },
            formatSyncSaveSummary(view.syncSaveStatusText)
          )
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
  const lynxChecklistPopover = renderLynxChecklistPopover(view, handlers);

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
    renderMarkedPagesSection(view, handlers),
    renderModeWarningPopover,
    lynxChecklistPopover
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

  function renderEditableConfigurationField(options) {
    const {
      inputId,
      noticeId,
      label,
      placeholder,
      readOnly,
      value,
      disabled,
      onInput,
      onKeyDown,
      inputRef,
      setVisible,
      setDisabled,
      onSet,
      editVisible,
      editDisabled,
      onEditToggle,
      editText,
      noticeVisible,
      noticeText
    } = options;

    return h(
      Fragment,
      null,
      h(
        "label",
        { class: "field" },
        h("span", null, label),
        h(
          "div",
          { class: "input-row" },
          h("input", {
            id: inputId,
            type: "text",
            placeholder,
            readOnly,
            value,
            disabled,
            onInput,
            onKeyDown,
            ref: inputRef
          }),
          h(
            "button",
            {
              id: `${inputId}-set`,
              type: "button",
              style: { display: setVisible ? "inline-flex" : "none" },
              disabled: setDisabled,
              onClick: onSet
            },
            icon("check"),
            PopupText.actions.set
          ),
          h(
            "button",
            {
              id: `${inputId}-edit`,
              type: "button",
              style: { display: editVisible ? "inline-flex" : "none" },
              disabled: editDisabled,
              onClick: onEditToggle
            },
            icon(editToggleIcon(editText)),
            editText
          )
        )
      ),
      h(
        "div",
        {
          id: noticeId,
          class: "notice",
          role: "status",
          "aria-live": "polite",
          hidden: !noticeVisible
        },
        noticeText
      )
    );
  }

function renderConfigurationView({state: view, actions: handlers}) {
    return h(
      Fragment,
      null,
      h(
        "section",
        { class: "card" },
        h("div", { class: "section-title" }, PopupText.configuration.title),
        h("div", { class: "hint" }, PopupText.configuration.setupHint),
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
        { class: "card" },
        h("div", { class: "section-title" }, PopupText.configuration.endpointSectionTitle),
        renderEditableConfigurationField({
          inputId: "config-endpoint-url",
          noticeId: "config-endpoint-notice",
          label: PopupText.configuration.endpointFieldLabel,
          placeholder: PopupText.configuration.endpointPlaceholder,
          readOnly: view.configEndpointUrlReadOnly,
          value: view.configEndpointUrlValue,
          disabled: view.configEndpointInputDisabled,
          onInput: handlers.onConfigEndpointInput,
          onKeyDown: handlers.onConfigEndpointKeyDown,
          inputRef: (el) => {
            refs.configEndpointUrlInput = el;
          },
          setVisible: view.configEndpointSetVisible,
          setDisabled: view.configEndpointSetDisabled,
          onSet: handlers.onConfigEndpointSet,
          editVisible: view.configEndpointEditVisible,
          editDisabled: view.configEndpointEditDisabled,
          onEditToggle: handlers.onConfigEndpointEditToggle,
          editText: view.configEndpointEditText,
          noticeVisible: view.configEndpointNoticeVisible,
          noticeText: view.configEndpointNoticeText
        }),
        h("div", { class: "section-divider", role: "separator" }),
        renderEditableConfigurationField({
          inputId: "endpoint-url",
          noticeId: "endpoint-notice",
          label: PopupText.configuration.aiEndpointFieldLabel,
          placeholder: PopupText.configuration.aiEndpointPlaceholder,
          readOnly: view.endpointUrlReadOnly,
          value: view.endpointUrlValue,
          disabled: view.endpointInputDisabled,
          onInput: handlers.onEndpointInput,
          onKeyDown: handlers.onEndpointKeyDown,
          inputRef: (el) => {
            refs.endpointUrlInput = el;
          },
          setVisible: view.endpointSetVisible,
          setDisabled: view.endpointSetDisabled,
          onSet: handlers.onEndpointSet,
          editVisible: view.endpointEditVisible,
          editDisabled: view.endpointEditDisabled,
          onEditToggle: handlers.onEndpointEditToggle,
          editText: view.endpointEditText,
          noticeVisible: view.endpointNoticeVisible,
          noticeText: view.endpointNoticeText
        }),
        h("div", { class: "section-divider", role: "separator" }),
        renderEditableConfigurationField({
          inputId: "stage-base",
          noticeId: "stage-base-notice",
          label: PopupText.configuration.stageBaseFieldLabel,
          placeholder: PopupText.configuration.stageBasePlaceholder,
          readOnly: view.stageBaseReadOnly,
          value: view.stageBaseValue,
          disabled: view.stageBaseInputDisabled,
          onInput: handlers.onStageBaseInput,
          onKeyDown: handlers.onStageBaseKeyDown,
          inputRef: (el) => {
            refs.stageBaseInput = el;
          },
          setVisible: view.stageBaseSetVisible,
          setDisabled: view.stageBaseSetDisabled,
          onSet: handlers.onStageBaseSet,
          editVisible: view.stageBaseEditVisible,
          editDisabled: view.stageBaseEditDisabled,
          onEditToggle: handlers.onStageBaseEditToggle,
          editText: view.stageBaseEditText,
          noticeVisible: view.stageBaseNoticeVisible,
          noticeText: view.stageBaseNoticeText
        })
      ),
      h(
        "section",
        { class: "card" },
        h("div", { class: "section-title" }, PopupText.authentication.title),
        h(
          Fragment,
          null,
          h(
            "label",
            { class: "field" },
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
            { class: "field" },
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
            { class: "token-row" },
            h(
              "span",
              {
                id: "token-status",
                class: classNames("token-status", statusToneClass(view.loginStatusTone))
              },
              view.loginStatusText
            ),
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
  refs.previewActiveItem = null;
  render(h(App, { state: viewState, actions }), root);
  if (viewState.previewBlocked || viewState.previewActive) {
    const activeXpath = typeof viewState.previewFocusedXpath === "string"
      ? viewState.previewFocusedXpath
      : "";
    if (!activeXpath) {
      lastPreviewScrolledXpath = "";
    } else if (refs.previewActiveItem && lastPreviewScrolledXpath !== activeXpath) {
      refs.previewActiveItem.scrollIntoView({
        block: "center",
        inline: "nearest"
      });
      lastPreviewScrolledXpath = activeXpath;
    }
  } else {
    lastPreviewScrolledXpath = "";
  }
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
  const nextViewState = { ...viewState, ...patch };
  if (nextViewState.previewBlocked || nextViewState.previewActive) {
    nextViewState.configMenuOpen = false;
    nextViewState.basePageMenuOpen = false;
    state.configMenuOpen = false;
    state.basePageMenuOpen = false;
  }
  viewState = nextViewState;
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
    previewActive: isBlocked ? viewState.previewActive : false,
    previewItems: isBlocked ? viewState.previewItems : [],
    previewFocusedXpath: isBlocked ? viewState.previewFocusedXpath : "",
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
