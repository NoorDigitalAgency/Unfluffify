import { h, render, Fragment } from "./vendor/preact/dist/preact.module.js";
import * as stateModule from "./state.js";
import {
  PopupText,
  ViewText,
  formatScalePercent,
  propertyLockText
} from "../common/text.js";
import {
  REMOTE_SUPPORT_DOCK_STATE_EMBEDDED,
  REMOTE_SUPPORT_DOCK_STATE_EMBEDDED_MINIMIZED,
  REMOTE_SUPPORT_DOCK_STATE_FLOATING_PIP,
  shouldShowRemoteSupportPopupJoin
} from "../common/remote-support.js";
import {
  buildLynxChecklistViewModel,
  createInitialLynxChecklistState
} from "../common/lynx-checklist.js";

export { ViewText } from "../common/text.js";

const { state } = stateModule;

const refs = {};
const initialLynxChecklistState = createInitialLynxChecklistState();
let lastPreviewScrolledXpath = "";
let lastRemoteSupportSectionScrollKey = "";

export const View = {
    Configuration: 'Configuration',
    Marking: 'Marking'
}

const initialViewState = {
  currentView: View.Configuration,
  configurationContinueDisabled: true,
  configurationBackDisabled: true,
  configurationExtrasExpanded: false,
  configurationNoticeText: "",
  configurationNoticeVisible: false,
  currentPageUrl: ViewText.unavailable,
  currentBaseUrl: "",
  baseUrlInputValue: "",
  baseUrlNoticeText: "",
  baseUrlNoticeVisible: false,
  propertyLockVisible: false,
  propertyLockTone: "muted",
  propertyLockIcon: "lock-open-outline",
  propertyLockStatusText: "",
  propertyLockDetailText: "",
  propertyLockSuggestVisible: false,
  propertyLockTakeVisible: false,
  propertyLockTakeText: propertyLockText.takeoverButton,
  propertyLockContinueVisible: false,
  propertyLockSuggestionVisible: false,
  propertyLockAcceptVisible: false,
  propertyLockRejectVisible: false,
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
  todoControlsMenuOpen: false,
  todoSectionExpanded: false,
  todoSubsectionsExpanded: {},
  todoAutoCollapse: true,
  todoListVisible: false,
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
  themeValue: "nordic",
  themeModeValue: "system",
  themeOptions: [],
  themeModeOptions: [],
  themeMenuOpen: false,
  themeMenuPlacement: "bottom",
  themeControlsDisabled: false,
  renderModeValue: "undetermined",
  renderModeReadOnly: true,
  renderModeSetVisible: false,
  renderModeEditVisible: false,
  renderModeEditText: ViewText.changeAction,
  renderModeNoticeText: "",
  renderModeNoticeVisible: false,
  renderModeUndeterminedVisible: true,
  renderModeWarningVisible: false,
  renderModeWarningAcknowledgeChecked: false,
  renderModeWarningOkDisabled: true,
  lynxChecklistVisible: false,
  lynxChecklistAiAnswer: initialLynxChecklistState.aiAnswer,
  lynxChecklistPageTypes: initialLynxChecklistState.pageTypes,
  lynxChecklistAiQuestionDisabled: false,
  lynxChecklistAiQuestionHidden: false,
  lynxChecklistNoticeText: "",
  renderModeReady: false,
  renderModeInputDisabled: false,
  renderModeInspectButtonsDisabled: false,
  renderModeSetDisabled: false,
  renderModeEditDisabled: false,
  renderModeSummaryOpen: false,
  renderModeSectionVisible: false,
  renderModeChangeMenuVisible: false,
  renderModeSummaryTitle: PopupText.renderMode.title,
  loginEmailValue: "",
  loginPasswordValue: "",
  loginCredentialsDisabled: true,
  loginStatusText: "",
  loginStatusTone: "muted",
  loginActionDisabled: false,
  aiControlsBusy: false,
  aiDirtyNoticeVisible: false,
  aiDirtyNoticeText: PopupText.ai.dirtyNotice,
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
  previewActive: false,
  previewItems: [],
  previewFocusedXpath: "",
  previewShowAllCategories: false,
  previewBlocked: false,
  previewBlockedMessage: ViewText.previewBlockedDefault,
  aiRunSpinnerNote: "",
  aiRunCountdownVisible: false,
  aiRunCountdownText: "0:00",
  configMenuOpen: false,
  clearDomainCacheDisabled: false,
  unregisterCurrentTabDisabled: false,
  remoteSupportCode: "",
  remoteSupportRequested: false,
  remoteSupportRequestLoading: false,
  remoteSupportJoinCode: "",
  remoteSupportJoinLoading: false,
  remoteSupportVisible: false,
  remoteSupportPageVisible: false,
  remoteSupportAutoFocus: false,
  remoteSupportMode: "inactive",
  remoteSupportRole: "",
  remoteSupportSessionActive: false,
  remoteSupportStatusText: "",
  remoteSupportConnected: false,
  remoteSupportStreaming: false,
  remoteSupportCameraAvailable: false,
  remoteSupportCameraEnabled: false,
  remoteSupportMicrophoneAvailable: false,
  remoteSupportMicrophoneEnabled: false,
  remoteSupportSoundAvailable: false,
  remoteSupportSoundEnabled: false,
  remoteSupportPreviewImage: "",
  remoteSupportDockState: REMOTE_SUPPORT_DOCK_STATE_EMBEDDED,
  remoteSupportLocalCameraActive: false,
  remoteSupportRemoteCameraActive: false,
  remoteSupportInactivityCountdownActive: false,
  remoteSupportInactivitySecondsRemaining: 0,
  remoteSupportInactivityCountdownText: "0:00",
  remoteSupportError: "",
  isBusy: false,
  busyMessage: "",
  toastMessage: "",
  toastVisible: false
};

let viewState = { ...initialViewState };
let actions = {};
const viewStateListeners = new Set();

function notifyViewStateListeners() {
  viewStateListeners.forEach((listener) => {
    try {
      listener(viewState);
    } catch {
      // Ignore listener failures so popup rendering keeps working.
    }
  });
}

function classNames(...values) {
  return values.filter(Boolean).join(" ");
}

function toneUtilityClass(tone) {
  switch (tone) {
    case "success":
      return "u-tone-success";
    case "warning":
      return "u-tone-warning";
    case "danger":
      return "u-tone-danger";
    default:
      return "u-tone-muted";
  }
}

function warningNoticeClass(...extraClasses) {
  return classNames("u-alert", "u-alert-warn", ...extraClasses);
}

function renderListItems(items, emptyText, renderItem) {
  if (!items.length) {
    return [h("li", { class: "empty" }, emptyText)];
  }
  return items.map(renderItem);
}

function icon(name, extraClass = "", btn = false) {
  return h("span", {
    class: classNames("mdi", `mdi-${name}`, "mdi-18px", btn && "btn-icon", extraClass),
    "aria-hidden": "true"
  });
}

function editToggleIcon(label) {
  return label === ViewText.cancelAction ? "close" : "pencil";
}

function renderRemoteSupportErrorNotice(view, handlers) {
  const message = typeof view.remoteSupportError === "string" ? view.remoteSupportError.trim() : "";
  if (!message) {
    return null;
  }

  return h(
    "div",
    { class: warningNoticeClass("u-alert--dismissible"), role: "status", "aria-live": "polite" },
    h("span", { class: "u-alert__content" }, message),
    h(
      "button",
      {
        type: "button",
        class: "u-alert__dismiss",
        "aria-label": PopupText.configuration.dismissNoticeLabel,
        title: PopupText.configuration.dismissNoticeLabel,
        onClick: handlers.onRemoteSupportErrorDismiss
      },
      icon("close", "", true)
    )
  );
}

function renderRemoteSupportInactivityNotice(view, handlers) {
  if (!view.remoteSupportInactivityCountdownActive) {
    return null;
  }

  const isRequester = view.remoteSupportMode === "being_supported";
  return h(
    "div",
    { class: warningNoticeClass(isRequester ? "u-alert--actionable" : null) },
    h(
      "span",
      { class: "u-alert__content" },
      PopupText.configuration.remoteSupportInactivityCountdownNotice(view.remoteSupportInactivityCountdownText || "0:00")
    ),
    isRequester
      ? h(
          "button",
          {
            id: "remote-support-continue",
            type: "button",
            class: "u-alert__action",
            onClick: handlers.onRemoteSupportContinue
          },
          PopupText.configuration.remoteSupportContinueButton
        )
      : null
  );
}

function renderRemoteSupportMediaButton({ id, title, iconName, active, available, onClick }) {
  return h(
    "button",
    {
      id,
      type: "button",
      class: classNames(
        "remote-support-controller__media-button",
        active && "is-active",
        !active && "is-off"
      ),
      disabled: !available,
      "aria-pressed": active ? "true" : "false",
      "aria-label": title,
      title,
      onClick
    },
    icon(iconName, "", true)
  );
}

function renderRemoteSupportedMediaControls(view, handlers) {
  return h(
    "div",
    { class: "remote-support-controller__actions remote-support-controller__actions--compact" },
    renderRemoteSupportMediaButton({
      id: "remote-support-toggle-camera",
      title: view.remoteSupportCameraEnabled
        ? PopupText.configuration.remoteSupportDisableCameraButton
        : PopupText.configuration.remoteSupportEnableCameraButton,
      iconName: view.remoteSupportCameraEnabled ? "camera" : "camera-off",
      active: Boolean(view.remoteSupportCameraEnabled),
      available: Boolean(view.remoteSupportCameraAvailable),
      onClick: handlers.onRemoteSupportCameraToggle
    }),
    renderRemoteSupportMediaButton({
      id: "remote-support-toggle-microphone",
      title: view.remoteSupportMicrophoneEnabled
        ? PopupText.configuration.remoteSupportDisableMicrophoneButton
        : PopupText.configuration.remoteSupportEnableMicrophoneButton,
      iconName: view.remoteSupportMicrophoneEnabled ? "microphone" : "microphone-off",
      active: Boolean(view.remoteSupportMicrophoneEnabled),
      available: Boolean(view.remoteSupportMicrophoneAvailable),
      onClick: handlers.onRemoteSupportMicrophoneToggle
    }),
    renderRemoteSupportMediaButton({
      id: "remote-support-toggle-sound",
      title: view.remoteSupportSoundEnabled
        ? PopupText.configuration.remoteSupportMuteSoundButton
        : PopupText.configuration.remoteSupportUnmuteSoundButton,
      iconName: view.remoteSupportSoundEnabled ? "volume-high" : "volume-off",
      active: Boolean(view.remoteSupportSoundEnabled),
      available: Boolean(view.remoteSupportSoundAvailable),
      onClick: handlers.onRemoteSupportSoundToggle
    })
  );
}

function renderRemoteSupportDock(view, handlers) {
  const dockState = view.remoteSupportDockState || REMOTE_SUPPORT_DOCK_STATE_EMBEDDED;
  const minimized = dockState === REMOTE_SUPPORT_DOCK_STATE_EMBEDDED_MINIMIZED;
  const floating = dockState === REMOTE_SUPPORT_DOCK_STATE_FLOATING_PIP;
  const localCameraActive = Boolean(view.remoteSupportLocalCameraActive);
  const remoteCameraActive = Boolean(view.remoteSupportRemoteCameraActive);

  return h(
    "section",
    {
      class: classNames(
        "remote-support-dock",
        minimized && "remote-support-dock--minimized",
        floating && "remote-support-dock--floating-intent"
      )
    },
    h(
      "div",
      { class: "remote-support-dock__tiles" },
      h(
        "div",
        { class: "remote-support-dock__tile" },
        h("video", {
          ref: (el) => { refs.localCameraVideo = el; },
          class: "remote-support-dock__tile-image",
          autoPlay: true,
          muted: true,
          playsInline: true,
          hidden: !localCameraActive,
          "aria-label": "Local camera preview"
        }),
        !localCameraActive
          ? h("div", { class: "remote-support-dock__tile-placeholder" }, "Local camera")
          : null,
        minimized ? null : h("span", { class: "remote-support-dock__tile-label" }, "You")
      ),
      h(
        "div",
        { class: "remote-support-dock__tile" },
        h("video", {
          ref: (el) => { refs.remoteCameraVideo = el; },
          class: "remote-support-dock__tile-image",
          autoPlay: true,
          muted: true,
          playsInline: true,
          hidden: !remoteCameraActive,
          "aria-label": "Supporter camera preview"
        }),
        !remoteCameraActive
          ? h("div", { class: "remote-support-dock__tile-placeholder" }, "Supporter camera")
          : null,
        minimized ? null : h("span", { class: "remote-support-dock__tile-label" }, "Supporter")
      )
    ),
    h(
      "div",
      { class: "remote-support-dock__controls" },
      renderRemoteSupportedMediaControls(view, handlers),
      h(
        "button",
        {
          id: "remote-support-externalize",
          type: "button",
          class: "u-btn-secondary remote-support-dock__externalize",
          onClick: handlers.onRemoteSupportDockExternalize
        },
        icon("open-in-new", "", true),
        minimized ? "External" : "Open in PiP"
      ),
      h(
        "button",
        {
          id: "remote-support-end-dock",
          type: "button",
          class: "u-btn-danger remote-support-dock__end",
          onClick: handlers.onRemoteSupportEnd
        },
        icon("lan-disconnect", "", true),
        minimized ? null : PopupText.configuration.remoteSupportEndButton
      )
    )
  );
}

function statusToneClass(tone) {
  switch (tone) {
    case "success":
      return classNames("status-text", "u-color-success");
    case "warning":
      return classNames("status-text", "u-color-warning");
    case "danger":
      return classNames("status-text", "u-color-danger");
    default:
      return classNames("status-text", "u-color-muted");
  }
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
      message: view.busyMessage || PopupText.overlay.loadingPopup,
      note: PopupText.overlay.busyHint,
      timerText: ""
    };
  }
  if (view.computeButtonLoading) {
    return {
      visible: true,
      mode: "busy",
      message: PopupText.overlay.computingSelectors,
      note: view.aiRunSpinnerNote || PopupText.overlay.busyHint,
      timerText: view.aiRunCountdownVisible ? view.aiRunCountdownText : ""
    };
  }
  if (view.saveExcludesButtonLoading) {
    return {
      visible: true,
      mode: "busy",
      message: PopupText.overlay.submittingSelectors,
      note: PopupText.overlay.busyHint,
      timerText: ""
    };
  }
  if (view.aiControlsBusy) {
    return {
      visible: true,
      mode: "busy",
      message: PopupText.overlay.workingWithAi,
      note: PopupText.overlay.busyHint,
      timerText: ""
    };
  }
  if (view.deviceControlsDisabled) {
    return {
      visible: true,
      mode: "busy",
      message: PopupText.overlay.applyingDeviceEmulation,
      note: PopupText.overlay.busyHint,
      timerText: ""
    };
  }
  return {
    visible: false,
    mode: "busy",
    message: "",
    note: "",
    timerText: ""
  };
}

function renderBasePageMenu(view, handlers) {
  return h(
    "div",
    {
      class: "section-menu base-page-menu",
      role: "menu",
      hidden: !view.basePageMenuOpen,
      onClick: handlers.onBasePageMenuClick
    },
    (view.basePageUrls.length
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
    )
  );
}

function renderPropertyLockIndicator(view, handlers) {
  if (!view.propertyLockVisible) {
    return null;
  }

  const actions = [];
  if (view.propertyLockSuggestVisible) {
    actions.push(
      h(
        "button",
        {
          key: "suggest",
          type: "button",
          class: "property-lock__button u-btn-secondary",
          onClick: handlers.onPropertyLockSuggest
        },
        propertyLockText.takeoverSuggestButton
      )
    );
  }
  if (view.propertyLockTakeVisible) {
    actions.push(
      h(
        "button",
        {
          key: "take",
          type: "button",
          class: "property-lock__button",
          onClick: handlers.onPropertyLockTake
        },
        view.propertyLockTakeText || propertyLockText.takeoverButton
      )
    );
  }
  if (view.propertyLockContinueVisible) {
    actions.push(
      h(
        "button",
        {
          key: "continue",
          type: "button",
          class: "property-lock__button",
          onClick: handlers.onPropertyLockContinue
        },
        propertyLockText.continueEditingButton
      )
    );
  }
  if (view.propertyLockAcceptVisible) {
    actions.push(
      h(
        "button",
        {
          key: "accept",
          type: "button",
          class: "property-lock__button",
          onClick: handlers.onPropertyLockAcceptSuggestion
        },
        propertyLockText.acceptButton
      )
    );
  }
  if (view.propertyLockRejectVisible) {
    actions.push(
      h(
        "button",
        {
          key: "reject",
          type: "button",
          class: "property-lock__button u-btn-secondary",
          onClick: handlers.onPropertyLockRejectSuggestion
        },
        propertyLockText.rejectButton
      )
    );
  }

  return h(
    "div",
    {
      class: classNames("property-lock", "u-surface-tone", toneUtilityClass(view.propertyLockTone || "muted")),
      role: "status",
      "aria-live": "polite"
    },
    h("span", { class: "property-lock__icon" }, icon(view.propertyLockIcon || "lock-open-outline")),
    h(
      "div",
      { class: "property-lock__text" },
      h("div", { class: "property-lock__status" }, view.propertyLockStatusText),
      view.propertyLockDetailText
        ? h("div", { class: "property-lock__detail" }, view.propertyLockDetailText)
        : null
    ),
    actions.length ? h("div", { class: "property-lock__actions u-flex u-wrap u-justify-end u-gap-2" }, actions) : null
  );
}

function renderThemePalette(option, extraClassName = "") {
  const themeId = option && typeof option.value === "string" ? option.value : "";
  return h(
    "span",
    {
      class: classNames("theme-palette", extraClassName),
      "data-theme": themeId || null,
      "aria-hidden": "true"
    },
    [1, 2, 3, 4].map((index) =>
      h("span", {
        key: index,
        class: `theme-palette__swatch theme-palette__swatch--${index}`
      })
    )
  );
}

function getSelectedThemeOption(view) {
  const themeOptions = Array.isArray(view.themeOptions) ? view.themeOptions : [];
  const themeValue = view && typeof view.themeValue === "string" ? view.themeValue : "";
  return themeOptions.find((option) => option && option.value === themeValue) || themeOptions[0] || null;
}

function renderThemeDropdown(view, handlers) {
  const selectedTheme = getSelectedThemeOption(view);
  const themeOptions = Array.isArray(view.themeOptions) ? view.themeOptions : [];
  return h(
    "div",
    { class: "theme-dropdown" },
    h(
      "button",
      {
        id: "theme-dropdown-toggle",
        type: "button",
        class: "theme-dropdown__toggle",
        disabled: view.themeControlsDisabled,
        "aria-haspopup": "listbox",
        "aria-expanded": view.themeMenuOpen ? "true" : "false",
        "aria-label": `${PopupText.configuration.themeFieldLabel}: ${selectedTheme ? selectedTheme.label : ""}`,
        onClick: handlers.onThemeMenuToggle,
        onKeyDown: handlers.onThemeMenuKeyDown,
        ref: (el) => {
          refs.themeDropdownButton = el;
        }
      },
      h("span", { class: "theme-dropdown__label" }, selectedTheme ? selectedTheme.label : ""),
      renderThemePalette(selectedTheme),
      icon(
        "chevron-down",
        classNames("theme-dropdown__caret", view.themeMenuOpen && "theme-dropdown__caret--open")
      )
    ),
    h(
      "div",
      {
        class: classNames(
          "section-menu",
          "theme-dropdown__menu",
          view.themeMenuPlacement === "top" && "theme-dropdown__menu--top"
        ),
        role: "listbox",
        hidden: !view.themeMenuOpen,
        onKeyDown: handlers.onThemeMenuKeyDown,
        onMouseDown: (event) => {
          event.stopPropagation();
        },
        onClick: (event) => {
          event.stopPropagation();
        }
      },
      themeOptions.map((option) =>
        h(
          "button",
          {
            key: option.value,
            type: "button",
            class: classNames(option.value === view.themeValue && "is-selected"),
            role: "option",
            "aria-selected": option.value === view.themeValue ? "true" : "false",
            onClick: () => handlers.onThemeOptionSelect(option.value)
          },
          h("span", { class: "section-menu__label" }, option.label),
          renderThemePalette(option),
          option.value === view.themeValue ? icon("check") : null
        )
      )
    )
  );
}

function renderTodoControlsMenu(view, handlers) {
  return h(
    "div",
    {
      class: "section-menu todo-controls-menu",
      role: "menu",
      hidden: !view.todoControlsMenuOpen,
      onClick: handlers.onTodoControlsMenuClick
    },
    h(
      "button",
      {
        type: "button",
        role: "menuitem",
        onClick: handlers.onTodoExpandAll
      },
      icon("unfold-more-horizontal"),
      h("span", { class: "section-menu__label" }, PopupText.pageTypes.expandAll)
    ),
    h(
      "button",
      {
        type: "button",
        role: "menuitem",
        onClick: handlers.onTodoCollapseAll
      },
      icon("unfold-less-horizontal"),
      h("span", { class: "section-menu__label" }, PopupText.pageTypes.collapseAll)
    ),
    h(
      "button",
      {
        type: "button",
        role: "menuitemcheckbox",
        "aria-checked": view.todoAutoCollapse ? "true" : "false",
        onClick: handlers.onTodoAutoCollapseToggle
      },
      icon(view.todoAutoCollapse ? "checkbox-marked" : "checkbox-blank-outline"),
      h("span", { class: "section-menu__label" }, PopupText.pageTypes.autoCollapse)
    )
  );
}

function renderThemeModeButtons(view, handlers) {
  const iconByMode = {
    system: "theme-light-dark",
    light: "white-balance-sunny",
    dark: "weather-night"
  };
  return h(
    "div",
    { class: "theme-mode-buttons", role: "group", "aria-labelledby": "theme-mode-field-label" },
    ...(Array.isArray(view.themeModeOptions) ? view.themeModeOptions : []).map((option) =>
      h(
        "button",
        {
          key: option.value,
          type: "button",
          class: classNames(
            "theme-mode-button",
            option.value === view.themeModeValue && "theme-mode-button--active"
          ),
          value: option.value,
          disabled: view.themeControlsDisabled,
          "aria-pressed": option.value === view.themeModeValue ? "true" : "false",
          onClick: handlers.onThemeModeInput
        },
        icon(iconByMode[option.value] || "circle-outline"),
        h("span", null, option.label)
      )
    )
  );
}

function renderRemoteSupportSection(view, handlers) {
  if (!view.remoteSupportVisible) {
    return null;
  }

  const supporting = view.remoteSupportMode === "supporting";
  const beingSupported = view.remoteSupportMode === "being_supported";
  const requesting = Boolean(view.remoteSupportRequestLoading);
  const sessionActive = Boolean(view.remoteSupportSessionActive);
  const supportPageVisible = Boolean(view.remoteSupportPageVisible);
  const showPopupJoin = shouldShowRemoteSupportPopupJoin(supportPageVisible, {
    active: sessionActive
  });
  const sectionClass = view.remoteSupportEmbedded
    ? "config-extra-subsection remote-support-card remote-support-card--embedded u-grid u-gap-4"
    : "card remote-support-card u-grid u-gap-3";
  return h(
    "section",
    {
      class: sectionClass,
      ref: (el) => {
        refs.remoteSupportSection = el;
      }
    },
    h("div", { class: "section-title" }, icon("lifebuoy", "field-icon"), PopupText.configuration.remoteSupportSectionTitle),
    h("div", { class: "hint" }, PopupText.configuration.remoteSupportHint),
    showPopupJoin
      ? h(
          "div",
          { class: "remote-support-join" },
          h(
            "label",
            { class: "field remote-support-join__field" },
            h("span", { class: "control-label" }, PopupText.configuration.remoteSupportJoinCodeLabel),
            h(
              "div",
              { class: "input-row" },
              h("input", {
                id: "remote-support-join-code",
                type: "text",
                value: view.remoteSupportJoinCode || "",
                placeholder: PopupText.configuration.remoteSupportJoinCodePlaceholder,
                disabled: Boolean(view.remoteSupportJoinLoading),
                onInput: handlers.onRemoteSupportJoinCodeInput
              }),
              h(
                "button",
                {
                  id: "remote-support-join",
                  type: "button",
                  class: classNames(view.remoteSupportJoinLoading && "loading"),
                  disabled: Boolean(view.remoteSupportJoinLoading) || !(view.remoteSupportJoinCode || "").trim(),
                  onClick: handlers.onRemoteSupportJoin
                },
                icon(view.remoteSupportJoinLoading ? "loading" : "login-variant", view.remoteSupportJoinLoading ? "mdi-spin" : ""),
                PopupText.configuration.remoteSupportJoinButton
              )
            )
          )
        )
      : supportPageVisible
      ? h("div", { class: warningNoticeClass() }, PopupText.configuration.remoteSupportPageControlHint)
      : h(
          "button",
          {
            id: "remote-support-request",
            type: "button",
            class: classNames("u-full-width", requesting && "loading"),
            disabled: sessionActive || requesting,
            "aria-busy": requesting ? "true" : "false",
            onClick: handlers.onRemoteSupportRequest
          },
          icon(requesting ? "loading" : "monitor-share", requesting ? "mdi-spin" : ""),
          PopupText.configuration.remoteSupportButton
        ),
    view.remoteSupportRequested
      ? h(
          "div",
          { class: "remote-support-code", role: "status", "aria-live": "polite" },
          h("span", null, PopupText.configuration.remoteSupportCodeLabel),
          h("strong", null, view.remoteSupportCode || "------"),
          h("span", { class: "hint" }, PopupText.configuration.remoteSupportCodeHint)
        )
      : null,
    view.remoteSupportStatusText
      ? h("div", { class: "hint", role: "status", "aria-live": "polite" }, view.remoteSupportStatusText)
      : null,
    renderRemoteSupportErrorNotice(view, handlers),
    renderRemoteSupportInactivityNotice(view, handlers),
    supporting
      ? h("div", { class: "hint" }, PopupText.configuration.remoteSupportPageControlHint)
      : null,
    sessionActive && !beingSupported
      ? h(
          "button",
          {
            id: "remote-support-end",
            type: "button",
            class: "u-full-width u-btn-danger",
            onClick: handlers.onRemoteSupportEnd
          },
          icon("close-octagon"),
          PopupText.configuration.remoteSupportEndButton
        )
      : null,
    beingSupported
      ? h(
          Fragment,
          null,
          h("div", { class: "hint" }, PopupText.configuration.remoteSupportBeingSupportedHint),
          renderRemoteSupportDock(view, handlers)
        )
      : null
  );
}

function renderRemoteSupportControllerView(view, handlers) {
  return h(
    "section",
    {
      class: "remote-support-controller u-grid u-gap-4",
      ref: (el) => {
        refs.remoteSupportSection = el;
      }
    },
    h(
      "div",
      { class: "remote-support-controller__toolbar u-flex u-items-start u-justify-between u-gap-4" },
      h(
        "div",
        { class: "remote-support-controller__meta" },
        h(
          "div",
          { class: "section-title" },
          icon("monitor-share", "field-icon"),
          PopupText.configuration.remoteSupportSectionTitle
        ),
        view.remoteSupportStatusText
          ? h("div", { class: "hint", role: "status", "aria-live": "polite" }, view.remoteSupportStatusText)
          : null,
        view.remoteSupportRequested
          ? h(
              "div",
              { class: "remote-support-code remote-support-code--compact", role: "status", "aria-live": "polite" },
              h("span", null, PopupText.configuration.remoteSupportCodeLabel),
              h("strong", null, view.remoteSupportCode || "------")
            )
          : null,
        renderRemoteSupportErrorNotice(view, handlers),
        renderRemoteSupportInactivityNotice(view, handlers)
      ),
      h(
        "button",
        {
          id: "remote-support-end",
          type: "button",
          class: "u-btn-danger remote-support-controller__end",
          onClick: handlers.onRemoteSupportEnd
        },
        icon("close-octagon"),
        PopupText.configuration.remoteSupportEndButton
      )
    ),
    h("div", { class: warningNoticeClass(), role: "status", "aria-live": "polite" }, PopupText.configuration.remoteSupportPageControlHint)
  );
}

function renderRemoteSupportedView(view, handlers) {
  return h(
    "section",
    {
      class: "remote-support-controller u-grid u-gap-4",
      ref: (el) => {
        refs.remoteSupportSection = el;
      }
    },
    h(
      "div",
      { class: "remote-support-controller__toolbar u-flex u-items-start u-justify-between u-gap-4" },
      h(
        "div",
        { class: "remote-support-controller__meta" },
        h(
          "div",
          { class: "section-title" },
          icon("shield-account", "field-icon"),
          PopupText.configuration.remoteSupportSectionTitle
        ),
        view.remoteSupportStatusText
          ? h("div", { class: "hint", role: "status", "aria-live": "polite" }, view.remoteSupportStatusText)
          : null,
        view.remoteSupportRequested
          ? h(
              "div",
              { class: "remote-support-code remote-support-code--compact", role: "status", "aria-live": "polite" },
              h("span", null, PopupText.configuration.remoteSupportCodeLabel),
              h("strong", null, view.remoteSupportCode || "------")
            )
          : null,
        renderRemoteSupportErrorNotice(view, handlers),
        renderRemoteSupportInactivityNotice(view, handlers)
      ),
      renderRemoteSupportedMediaControls(view, handlers)
    ),
    h("div", { class: "hint", role: "status", "aria-live": "polite" }, PopupText.configuration.remoteSupportBeingSupportedHint)
  );
}

function renderRenderModeEditor(view, handlers) {
  const renderModeInputDisabled = view.renderModeInputDisabled || view.renderModeReadOnly;

  return h(
    Fragment,
    null,
    h(
      "div",
      { class: "render-mode-inspect-group" },
      h(
        "div",
        { class: "render-mode-inspect-row" },
        h("span", { class: "control-label" }, PopupText.renderMode.inspectStepOneLabel),
        h(
          "button",
          {
            id: "render-mode-inspect-with-javascript",
            type: "button",
            class: "u-btn-secondary",
            disabled: view.renderModeInspectButtonsDisabled,
            onClick: handlers.onRenderModeInspectWithJavaScript
          },
          PopupText.renderMode.inspectWithJavaScriptButton
        )
      ),
      h(
        "div",
        { class: "render-mode-inspect-row" },
        h("span", { class: "control-label" }, PopupText.renderMode.inspectStepTwoLabel),
        h(
          "button",
          {
            id: "render-mode-inspect-without-javascript",
            type: "button",
            class: "u-btn-secondary",
            disabled: view.renderModeInspectButtonsDisabled,
            onClick: handlers.onRenderModeInspectWithoutJavaScript
          },
          PopupText.renderMode.inspectWithoutJavaScriptButton
        )
      )
    ),
    h(
      "div",
      { class: "render-mode-interpretation" },
      h("span", { class: "control-label" }, PopupText.renderMode.stepThreeLabel),
      h(
        "div",
        { class: "render-mode-radio-group" },
        h(
          "label",
          { class: "render-mode-radio-option" },
          h("input", {
            id: "render-mode-choice-static",
            type: "radio",
            name: "render-mode-choice",
            value: "static",
            checked: view.renderModeValue === "static",
            disabled: renderModeInputDisabled,
            onChange: handlers.onRenderModeChoiceInput
          }),
          h("span", null, PopupText.renderMode.copyLookAlmostSame)
        ),
        h(
          "label",
          { class: "render-mode-radio-option" },
          h("input", {
            id: "render-mode-choice-rendered",
            type: "radio",
            name: "render-mode-choice",
            value: "rendered",
            checked: view.renderModeValue === "rendered",
            disabled: renderModeInputDisabled,
            onChange: handlers.onRenderModeChoiceInput
          }),
          h("span", null, PopupText.renderMode.copyLookVeryDifferent)
        ),
        h("input", {
          id: "render-mode-choice-undetermined",
          type: "radio",
          name: "render-mode-choice",
          value: "undetermined",
          checked: view.renderModeValue === "undetermined",
          disabled: true,
          tabIndex: -1,
          "aria-hidden": "true",
          class: "render-mode-radio-hidden"
        })
      )
    ),
    h(
      "label",
      {class: "field"},
      h("span", { class: "control-label" }, PopupText.renderMode.stepFourLabel),
      h("span", { class: "control-label" }, PopupText.renderMode.renderModeLabel),
      h(
        "div",
        {class: "input-row"},
        h(
          "select",
          {
            id: "render-mode",
            value: view.renderModeValue,
            disabled: renderModeInputDisabled,
            onChange: handlers.onRenderModeInput,
            ref: (el) => {
              refs.renderModeSelect = el;
            }
          },
          h("option", { value: "static" }, PopupText.renderMode.optionStatic),
          h("option", { value: "rendered" }, PopupText.renderMode.optionRendered),
          view.renderModeUndeterminedVisible
            ? h(
                "option",
                {
                  value: "undetermined",
                  disabled: true,
                  hidden: true
                },
                PopupText.renderMode.optionUndetermined
              )
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
    )
  );
}

function getTodoProgress(view) {
  const pageTypeGroups = Array.isArray(view.pageTypeGroups) ? view.pageTypeGroups : [];
  const total = pageTypeGroups.length;
  const completed = pageTypeGroups.reduce(
    (count, group) => count + (group && group.markedCount > 0 ? 1 : 0),
    0
  );
  return {
    total,
    completed,
    done: total > 0 && completed === total
  };
}

function renderTodoIndicator(iconName, done = false, extraClassName = "") {
  return icon(
    iconName,
    classNames(
      "todo-indicator",
      done ? "todo-indicator--done" : "todo-indicator--pending",
      extraClassName
    )
  );
}

function renderMarkedPagesSection(view, handlers, extraClassName = "") {
  const progress = getTodoProgress(view);
  const sectionExpanded = Boolean(view.todoSectionExpanded);

  return h(
    "section",
    {
      class: classNames("card", "todo-section", extraClassName),
      hidden: !view.todoListVisible
    },
    h(
      "div",
      { class: "section-header" },
      h(
        "button",
        {
          type: "button",
          class: "todo-header",
          "aria-expanded": sectionExpanded ? "true" : "false",
          onClick: handlers.onTodoSectionToggle
        },
        h(
          "span",
          { class: "todo-header-title" },
          h("span", { class: "section-title" }, icon("format-list-checks", "field-icon"), PopupText.pageTypes.title)
        ),
        h(
          "span",
          {
            class: classNames(
              "todo-status-line",
              progress.done ? "todo-status-line--done" : "todo-status-line--pending"
            )
          },
          renderTodoIndicator(
            progress.done ? "progress-check" : "progress-helper",
            progress.done
          ),
          h("span", null, `${progress.completed}/${progress.total}`)
        )
      ),
      sectionExpanded
        ? h(
            "div",
            { class: "section-header-actions todo-header-actions" },
            h(
              "button",
              {
                id: "todo-controls-menu-toggle",
                type: "button",
                class: "header-menu-toggle",
                "aria-haspopup": "menu",
                "aria-expanded": view.todoControlsMenuOpen ? "true" : "false",
                title: PopupText.pageTypes.controlsMenu,
                onClick: handlers.onTodoControlsMenuToggle
              },
              icon("dots-vertical")
            ),
            renderTodoControlsMenu(view, handlers)
          )
        : null
    ),
    view.pageTypeNoticeVisible
      ? h(
          "div",
          {
            class: warningNoticeClass(),
            role: "status",
            "aria-live": "polite"
          },
          view.pageTypeNoticeText
        )
      : null,
    sectionExpanded
      ? h(
          "div",
          { class: "todo-body" },
          view.pageTypeGroups.length
            ? [
                view.pageTypeGroups.map((group) => {
                  const subsectionExpanded = Boolean(
                    view.todoSubsectionsExpanded && view.todoSubsectionsExpanded[group.key]
                  );
                  const subsectionDone = group.markedCount > 0;
                  return h(
                    "section",
                    {
                      key: group.key,
                      class: classNames(
                        "todo-subsection",
                        group.missing && "todo-subsection--missing"
                      )
                    },
                    h(
                      "button",
                      {
                        type: "button",
                        class: "todo-subsection-header",
                        "aria-expanded": subsectionExpanded ? "true" : "false",
                        onClick: () => handlers.onTodoSubsectionToggle(group.key)
                      },
                      h("span", { class: "todo-subsection-title" }, group.title),
                      h(
                        "span",
                        {
                          class: classNames(
                            "todo-subsection-count",
                            subsectionDone
                              ? "todo-subsection-count--done"
                              : "todo-subsection-count--pending"
                          )
                        },
                        renderTodoIndicator(
                          subsectionDone ? "progress-check" : "progress-helper",
                          subsectionDone
                        ),
                        h("span", null, String(group.markedCount))
                      )
                    ),
                    subsectionExpanded
                      ? h(
                          "div",
                          { class: "todo-subsection-body" },
                          group.candidates.length
                            ? group.candidates.map((item) =>
                                h(
                                  "div",
                                  {
                                    key: `${group.key}|${item.url}`,
                                    class: classNames(
                                      "todo-candidate",
                                      item.current && "todo-candidate--current",
                                      item.duplicate && "todo-candidate--duplicate"
                                    )
                                  },
                                  renderTodoIndicator(
                                    item.marked ? "progress-check" : "progress-helper",
                                    item.marked
                                  ),
                                  h(
                                    "div",
                                    { class: "todo-candidate-copy" },
                                    item.navigationDisabled
                                      ? h(
                                          "span",
                                          { class: "todo-candidate-link", title: item.url },
                                          item.label
                                        )
                                      : h(
                                          "a",
                                          {
                                            class: "todo-candidate-link",
                                            href: item.url,
                                            title: item.url,
                                            onClick: (event) => {
                                              event.preventDefault();
                                              handlers.onMarkedPageNavigate(item.url);
                                            }
                                          },
                                          item.label
                                        ),
                                    formatCandidateWordsCount(item.wordsCount)
                                      ? h(
                                          "span",
                                          { class: "todo-candidate-words" },
                                          formatCandidateWordsCount(item.wordsCount)
                                        )
                                      : null,
                                    item.current
                                      ? h(
                                          "span",
                                          {
                                            class: "todo-candidate-badge todo-candidate-badge--current",
                                            role: "status",
                                            "aria-live": "polite"
                                          },
                                          PopupText.pageTypes.currentBadge
                                        )
                                      : null,
                                    item.duplicateNotice
                                      ? h(
                                          "div",
                                          { class: "page-types__candidate-warning" },
                                          item.duplicateNotice
                                        )
                                      : null
                                  )
                                )
                              )
                            : h("div", { class: "page-types__empty" }, view.pageTypeGroupsEmptyText)
                        )
                      : null
                  );
                })
              ]
            : h("div", { class: "page-types__empty" }, view.pageTypeGroupsEmptyText)
        )
      : null
  );
}

function renderPreviewSidebar(view, handlers) {
  const openingPreview = view.previewBlocked && !view.previewActive;
  const previewTitle = view.previewShowAllCategories
    ? PopupText.preview.sidebarAllTitle
    : PopupText.preview.sidebarTitle;
  const listItems = openingPreview
    ? [
        h("li", { class: "preview-sidebar__empty", key: "loading" }, PopupText.preview.loading)
      ]
    : view.previewItems.length
      ? view.previewItems.map((item, index) => {
          const active = item.xpath === view.previewFocusedXpath;
          const kindClass = view.previewShowAllCategories && item.kind
            ? `preview-sidebar__item--${item.kind}`
            : "";
          return h(
            "li",
            {
              key: item.xpath,
              class: classNames(
                "preview-sidebar__item",
                kindClass,
                active && "preview-sidebar__item--active"
              )
            },
            h(
              "button",
              {
                type: "button",
                class: "preview-sidebar__item-button",
                title: item.title || item.xpath,
                onClick: () => handlers.onPreviewItemFocus(item.xpath),
                ref: (el) => {
                  if (active) {
                    refs.previewActiveItem = el;
                  }
                }
              },
              h("span", { class: "preview-sidebar__item-index", "aria-hidden": "true" }, `${index + 1}.`),
              h("span", { class: "preview-sidebar__item-text" }, item.text)
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
      h("div", { class: "section-title" }, previewTitle),
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
      "label",
      {
        class: classNames(
          "preview-sidebar__toggle",
          openingPreview && "preview-sidebar__toggle--disabled"
        ),
        title: PopupText.preview.showAllCategoriesTitle
      },
      h(
        "span",
        { class: "preview-sidebar__toggle-text" },
        PopupText.preview.showAllCategoriesLabel
      ),
      h("input", {
        type: "checkbox",
        checked: view.previewShowAllCategories,
        disabled: openingPreview || !view.previewActive,
        onChange: handlers.onPreviewShowAllCategoriesChange
      })
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
  const configurationView = view.currentView === View.Configuration;
  const remoteControllerVisible =
    view.remoteSupportMode === "supporting" &&
    view.remoteSupportSessionActive;
  const remoteSupportedVisible =
    view.remoteSupportMode === "being_supported" &&
    view.remoteSupportSessionActive;

  return h(
    Fragment,
    null,
    h(
      "div",
      { class: classNames("app", "u-grid", "u-gap-4") },
      h(
        "div",
        { class: "close-bar u-flex u-items-center u-gap-3" },
        h(
          "button",
          {
            id: "close-tab",
            type: "button",
            class: "close-button",
            title: PopupText.unregister.closeButtonTitle,
            disabled: view.unregisterCurrentTabDisabled || previewVisible || configurationView || remoteControllerVisible,
            onClick: handlers.onUnregisterCurrentTab
          }
        ),
        remoteSupportedVisible
          ? h(
              "button",
              {
                id: "remote-support-stop-sharing-top",
                type: "button",
                class: "close-bar__stop-sharing",
                title: PopupText.configuration.remoteSupportStopSharingButton,
                "aria-label": PopupText.configuration.remoteSupportStopSharingButton,
                onClick: handlers.onRemoteSupportEnd
              },
              icon("lan-disconnect"),
              PopupText.configuration.remoteSupportStopSharingButton
            )
          : null
      ),
      h(
        "header",
        { class: "app-header" },
        h(
          "div",
          { class: "header-top u-flex u-items-start u-justify-between u-gap-3" },
          h(
            "div",
            { class: "header-text" },
            h("img", { src: "logo.png", alt: PopupText.branding.logoAlt, class: "header-logo" })
          ),
          !previewVisible &&
            !remoteControllerVisible &&
            h(
              "div",
              { class: "header-actions u-flex u-items-start" },
              configurationView
                ? h(
                    "button",
                    {
                      id: "config-header-back",
                      type: "button",
                      class: "header-menu-toggle",
                      title: PopupText.actions.back,
                      "aria-label": PopupText.actions.back,
                      disabled: view.configurationBackDisabled,
                      onClick: handlers.onConfigurationContinue
                    },
                    icon("arrow-left")
                  )
                : [
                    h(
                      "button",
                      {
                        id: "config-toggle",
                        type: "button",
                        class: "header-menu-toggle",
                        "aria-haspopup": "menu",
                        "aria-expanded": view.configMenuOpen ? "true" : "false",
                        title: PopupText.configuration.title,
                        onClick: handlers.onConfigToggle
                      },
                      icon("dots-vertical")
                    ),
                    h(
                      "div",
                      {
                        id: "config-menu",
                        class: "section-menu config-menu",
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
                        h("span", { class: "section-menu__label" }, PopupText.configuration.openViewAction)
                      ),
                      view.renderModeChangeMenuVisible
                        ? h(
                            "button",
                            {
                              id: "render-mode-open-view",
                              type: "button",
                              role: "menuitem",
                              onClick: handlers.onOpenRenderModeSection
                            },
                            icon("monitor-dashboard"),
                            h("span", { class: "section-menu__label" }, PopupText.renderMode.menuAction)
                          )
                        : null,
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
                        h("span", { class: "section-menu__label" }, PopupText.cache.menuAction)
                      )
                    )
                  ]
            )
        ),
        h(
          "div",
          {
            class: "header-property-url",
            hidden: previewVisible || remoteControllerVisible || configurationView
          },
          h(
            "label",
            { class: "field field--compact" },
            h("span", { class: "control-label" }, icon("home-outline", "field-icon"), h("span", { class: "control-label-text" }, PopupText.baseUrl.fieldLabel)),
            h(
              "div",
              { class: "u-flex property-url-row" },
              h(
                "div",
                {
                  id: "base-url",
                  class: "property-url-text",
                  title: view.baseUrlInputValue || PopupText.baseUrl.placeholder
                },
                view.baseUrlInputValue || PopupText.baseUrl.placeholder
              ),
              h(
                "div",
                { class: "section-header-actions property-url-actions" },
                h(
                  "button",
                  {
                    id: "base-page-menu-toggle",
                    type: "button",
                    class: "header-menu-toggle",
                    "aria-haspopup": "menu",
                    "aria-expanded": view.basePageMenuOpen ? "true" : "false",
                    title: PopupText.tooltips.basePageUrls,
                    onClick: handlers.onBasePageMenuToggle
                  },
                  icon("dots-vertical")
                ),
                renderBasePageMenu(view, handlers)
              )
            )
          ),
          h(
            "div",
            {
              id: "base-url-notice",
              class: warningNoticeClass(),
              role: "status",
              "aria-live": "polite",
              hidden: !view.baseUrlNoticeVisible
            },
            view.baseUrlNoticeText
          ),
          renderPropertyLockIndicator(view, handlers)
        )
      ),
      previewVisible
        ? renderPreviewSidebar(view, handlers)
        : remoteControllerVisible
          ? renderRemoteSupportControllerView(view, handlers)
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
          curtain.note || PopupText.overlay.busyHint
        ),
        curtain.timerText
          ? h("div", { class: "ui-curtain__timer" }, curtain.timerText)
          : null
      )
    )
  );
}

function renderAiControlsContent(view, handlers) {
  const computeButtonClass = classNames(
    "u-full-width",
    "u-mt-2",
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
          class: warningNoticeClass(),
          role: "status",
          "aria-live": "polite",
          style: {display: view.aiDirtyNoticeVisible ? "block" : "none"}
        },
        view.aiDirtyNoticeText || PopupText.ai.dirtyNotice
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

function getLynxChecklistNoticeText(checklist, view) {
  if (view && typeof view.lynxChecklistNoticeText === "string" && view.lynxChecklistNoticeText) {
    return view.lynxChecklistNoticeText;
  }
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
  const noticeText = getLynxChecklistNoticeText(checklist, view);
  const showAiQuestion =
    checklist.missingPageTypes.length === 0 &&
    !view.lynxChecklistAiQuestionDisabled &&
    !view.lynxChecklistAiQuestionHidden;

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
                    renderTodoIndicator(
                      item.missing ? "progress-helper" : "progress-check",
                      !item.missing
                    )
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
                            "button",
                            {
                              key: `${item.key}|${candidate.url}`,
                              type: "button",
                              class: "lynx-checklist-popover__candidate-hint",
                              title: candidate.url,
                              onClick: () => handlers.onLynxChecklistCandidateNavigate(candidate.url)
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
      showAiQuestion
        ? h(
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
                disabled: Boolean(view.lynxChecklistAiQuestionDisabled),
                label: ViewText.yes,
                onChange: handlers.onLynxChecklistAiAnswerChange
              }),
              renderLynxChecklistRadioOption({
                name: "lynx-checklist-ai",
                value: "no",
                checked: checklist.aiAnswer === "no",
                disabled: Boolean(view.lynxChecklistAiQuestionDisabled),
                label: ViewText.no,
                onChange: handlers.onLynxChecklistAiAnswerChange
              })
            )
          )
        : null,
      noticeText &&
        h(
          "div",
          {
            class: warningNoticeClass(),
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
            class: "u-btn-secondary",
            onClick: handlers.onLynxChecklistCancel
          },
          icon("arrow-left"),
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
          icon("send"),
          PopupText.actions.sendToLynx
        )
      )
    )
  );
}

function renderMarkingView({state: view, actions: handlers}) {
  const postRenderModeControlsVisible = view.renderModeReady;
  const showDeviceSection = !view.mainUiHidden;
  const markingMode = !view.mainUiHidden;
  const pageSaveNotice = view.pageSaveMobileSimulationRequiredVisible
    ? h(
        "div",
        {
          class: warningNoticeClass(),
          role: "status",
          "aria-live": "polite"
        },
        view.pageSaveMobileSimulationRequiredText
      )
    : h(
        "div",
        {
          id: "page-data-new-notice",
          class: warningNoticeClass(),
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
            class: "u-btn-secondary",
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

  const lynxChecklistPopover = renderLynxChecklistPopover(view, handlers);

  return h(
    Fragment,
    null,
    view.renderModeSectionVisible &&
      h(
        "section",
        { class: "card render-mode-section" },
        h("div", { class: "section-title" }, icon("monitor-dashboard", "field-icon"), view.renderModeSummaryTitle),
        renderRenderModeEditor(view, handlers)
      ),
    view.todoListVisible && renderMarkedPagesSection(view, handlers),
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
    postRenderModeControlsVisible && mergedControlsSection,
    lynxChecklistPopover
  );
}

function renderConfigurationAppearanceSection(view, handlers) {
  return h(
    "section",
    { class: "config-extra-subsection config-appearance-section" },
    h("div", { class: "section-title" }, icon("palette-outline", "field-icon"), PopupText.configuration.appearanceSectionTitle),
    h(
      "div",
      { class: "config-appearance-body" },
      h(
        "div",
        { class: "config-appearance-row" },
        h(
          "div",
          { class: "config-appearance-control" },
          h("span", { id: "theme-field-label", class: "config-appearance-label control-label" }, PopupText.configuration.themeFieldLabel),
          h(
            "div",
            { class: "theme-control-row" },
            h(
              "button",
              {
                type: "button",
                class: "theme-nav-button",
                disabled: view.themeControlsDisabled,
                title: PopupText.configuration.themePrevious,
                "aria-label": PopupText.configuration.themePrevious,
                onClick: handlers.onThemePrevious
              },
              icon("chevron-left")
            ),
            renderThemeDropdown(view, handlers),
            h(
              "button",
              {
                type: "button",
                class: "theme-nav-button",
                disabled: view.themeControlsDisabled,
                title: PopupText.configuration.themeNext,
                "aria-label": PopupText.configuration.themeNext,
                onClick: handlers.onThemeNext
              },
              icon("chevron-right")
            )
          )
        ),
        h(
          "div",
          { class: "config-appearance-control config-appearance-control--mode" },
          h("span", { id: "theme-mode-field-label", class: "config-appearance-label control-label" }, PopupText.configuration.themeModeFieldLabel),
          renderThemeModeButtons(view, handlers)
        )
      )
    )
  );
}

function renderConfigurationExtrasSection(view, handlers) {
  const expanded = Boolean(view.configurationExtrasExpanded || view.remoteSupportAutoFocus);
  const sections = [renderConfigurationAppearanceSection(view, handlers)];

  if (view.remoteSupportVisible) {
    sections.push(renderRemoteSupportSection({ ...view, remoteSupportEmbedded: true }, handlers));
  }

  return h(
    "section",
    { class: "card config-extras" },
    h(
      "button",
      {
        type: "button",
        class: "config-extras-header",
        "aria-expanded": expanded ? "true" : "false",
        onClick: handlers.onConfigurationExtrasToggle
      },
      h("span", { class: "section-title" }, icon("tune-variant", "field-icon"), PopupText.configuration.extrasSectionTitle)
    ),
    expanded
      ? h(
          "div",
          { class: "config-extras-body" },
          sections
        )
      : null
  );
}

function renderCssSelectorsSection({ state: view, actions: handlers }) {
  const previewClass = classNames("u-full-width", "u-btn-secondary");
  const submitClass = classNames(
    "u-full-width",
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
        h("span", { class: "control-label" }, label),
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
          class: warningNoticeClass(),
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
        h("div", { class: "section-title" }, icon("api", "field-icon"), PopupText.configuration.endpointSectionTitle),
        h("div", { class: "hint" }, PopupText.configuration.setupHint),
        h(
          "div",
          {
            class: warningNoticeClass(),
            role: "status",
            "aria-live": "polite",
            hidden: !view.configurationNoticeVisible
          },
          view.configurationNoticeText
        ),
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
        h("div", { class: "section-title" }, icon("account-key-outline", "field-icon"), PopupText.authentication.title),
        h(
          Fragment,
          null,
          h(
            "label",
            { class: "field" },
            h("span", { class: "control-label" }, PopupText.authentication.emailLabel),
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
            h("span", { class: "control-label" }, PopupText.authentication.passwordLabel),
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
      ),
      renderConfigurationExtrasSection(view, handlers)
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
  const remoteSupportScrollKey =
    viewState.remoteSupportAutoFocus && viewState.currentView === View.Configuration
      ? String(viewState.currentPageUrl || "")
      : "";
  if (!remoteSupportScrollKey) {
    lastRemoteSupportSectionScrollKey = "";
  } else if (
    refs.remoteSupportSection &&
    lastRemoteSupportSectionScrollKey !== remoteSupportScrollKey
  ) {
    refs.remoteSupportSection.scrollIntoView({
      block: "center",
      inline: "nearest"
    });
    lastRemoteSupportSectionScrollKey = remoteSupportScrollKey;
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

function collapseTodoViewState(nextViewState) {
  return {
    ...nextViewState,
    todoControlsMenuOpen: false,
    todoSectionExpanded: false,
    todoSubsectionsExpanded: {}
  };
}

function filterTodoSubsectionsExpanded(nextViewState) {
  const pageTypeGroups = Array.isArray(nextViewState.pageTypeGroups)
    ? nextViewState.pageTypeGroups
    : [];
  const validKeys = new Set(pageTypeGroups.map((group) => group.key));
  return {
    ...nextViewState,
    todoSubsectionsExpanded: Object.fromEntries(
      Object.entries(nextViewState.todoSubsectionsExpanded || {}).filter(
        ([key, expanded]) => validKeys.has(key) && expanded
      )
    )
  };
}

function normalizeViewState(nextViewState) {
  let normalizedViewState = nextViewState;
  if (normalizedViewState.remoteSupportAutoFocus) {
    normalizedViewState = {
      ...normalizedViewState,
      configurationExtrasExpanded: true
    };
  }
  if (normalizedViewState.previewBlocked || normalizedViewState.previewActive) {
    normalizedViewState = {
      ...normalizedViewState,
      configMenuOpen: false,
      basePageMenuOpen: false,
      todoControlsMenuOpen: false,
      themeMenuOpen: false
    };
    state.configMenuOpen = false;
    state.basePageMenuOpen = false;
  }
  return normalizedViewState.todoListVisible
    ? filterTodoSubsectionsExpanded(normalizedViewState)
    : collapseTodoViewState(normalizedViewState);
}

export function setViewState(patch) {
  const nextViewState = normalizeViewState({ ...viewState, ...patch });
  viewState = nextViewState;
  renderApp();
  notifyViewStateListeners();
}

/**
 * Updates the view state using an updater function and re-renders the app.
 * @private
 * @param {Function} updater - Function that receives current state and returns updated state
 */
function updateViewState(updater) {
  viewState = normalizeViewState(updater(viewState));
  renderApp();
  notifyViewStateListeners();
}

export function getViewState() {
  return viewState;
}

export function onViewStateChange(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  viewStateListeners.add(listener);
  return () => {
    viewStateListeners.delete(listener);
  };
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

export function toggleConfigurationExtrasExpanded() {
  setViewState({
    configurationExtrasExpanded: !Boolean(viewState.configurationExtrasExpanded)
  });
}

export function setPreviewBlocked(isBlocked, message = ViewText.previewBlockedDefault) {
  setViewState({
    previewBlocked: Boolean(isBlocked),
    previewActive: isBlocked ? viewState.previewActive : false,
    previewItems: isBlocked ? viewState.previewItems : [],
    previewFocusedXpath: isBlocked ? viewState.previewFocusedXpath : "",
    previewShowAllCategories: isBlocked ? viewState.previewShowAllCategories : false,
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
  setViewState({ configMenuOpen: open, themeMenuOpen: false });
}

export function setBasePageMenuOpen(open) {
  if (state.basePageMenuOpen === open) {
    return;
  }
  state.basePageMenuOpen = open;
  setViewState({ basePageMenuOpen: open, themeMenuOpen: false });
}

export function setThemeMenuOpen(open, placement = "bottom") {
  const normalizedOpen = Boolean(open);
  const normalizedPlacement = placement === "top" ? "top" : "bottom";
  if (
    viewState.themeMenuOpen === normalizedOpen &&
    viewState.themeMenuPlacement === normalizedPlacement
  ) {
    return;
  }
  state.configMenuOpen = false;
  state.basePageMenuOpen = false;
  setViewState({
    themeMenuOpen: normalizedOpen,
    themeMenuPlacement: normalizedPlacement,
    configMenuOpen: false,
    basePageMenuOpen: false,
    todoControlsMenuOpen: false
  });
}

export function setTodoControlsMenuOpen(open) {
  if (Boolean(viewState.todoControlsMenuOpen) === Boolean(open)) {
    return;
  }
  setViewState({ todoControlsMenuOpen: Boolean(open) });
}

export function setTodoSectionExpanded(expanded) {
  updateViewState((currentViewState) => ({
    ...currentViewState,
    todoSectionExpanded: Boolean(expanded),
    todoControlsMenuOpen: Boolean(expanded)
      ? currentViewState.todoControlsMenuOpen
      : false
  }));
}

export function setTodoSubsectionExpanded(key, expanded) {
  if (typeof key !== "string" || !key) {
    return;
  }
  updateViewState((currentViewState) => ({
    ...currentViewState,
    todoSubsectionsExpanded: {
      ...(currentViewState.todoSubsectionsExpanded || {}),
      [key]: Boolean(expanded)
    }
  }));
}

export function setTodoAllSubsectionsExpanded(expanded) {
  updateViewState((currentViewState) => ({
    ...currentViewState,
    todoControlsMenuOpen: false,
    todoSubsectionsExpanded: Boolean(expanded)
      ? Object.fromEntries(
          (Array.isArray(currentViewState.pageTypeGroups) ? currentViewState.pageTypeGroups : [])
            .map((group) => [group.key, true])
        )
      : {}
  }));
}

export function setTodoAutoCollapse(checked) {
  updateViewState((currentViewState) => ({
    ...currentViewState,
    todoControlsMenuOpen: false,
    todoAutoCollapse: Boolean(checked)
  }));
}

export function collapseTodoList() {
  updateViewState((currentViewState) => ({
    ...currentViewState,
    todoControlsMenuOpen: false,
    todoSectionExpanded: false,
    todoSubsectionsExpanded: {}
  }));
}
