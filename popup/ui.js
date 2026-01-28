import * as stateModule from "./state.js";

const { state } = stateModule;

export const ui = {
  toggleEnabled: document.getElementById("toggle-enabled"),
  currentPageUrl: document.getElementById("current-page-url"),
  baseUrlInput: document.getElementById("base-url"),
  refreshContext: document.getElementById("refresh-context"),
  baseUrlSet: document.getElementById("base-url-set"),
  baseUrlEdit: document.getElementById("base-url-edit"),
  baseUrlNotice: document.getElementById("base-url-notice"),
  pagePatternSelect: document.getElementById("page-pattern"),
  pagePatternSet: document.getElementById("page-pattern-set"),
  pagePatternNotice: document.getElementById("page-pattern-notice"),
  mainUi: document.getElementById("main-ui"),
  markedPages: document.getElementById("marked-pages"),
  configToggle: document.getElementById("config-toggle"),
  configMenu: document.getElementById("config-menu"),
  configExportAll: document.getElementById("config-export-all"),
  configExportCurrent: document.getElementById("config-export-current"),
  configImport: document.getElementById("config-import"),
  configClearCurrent: document.getElementById("config-clear-current"),
  configClearAll: document.getElementById("config-clear-all"),
  clearDomainCache: document.getElementById("clear-domain-cache"),
  configImportFile: document.getElementById("config-import-file"),
  uiCurtain: document.getElementById("ui-curtain"),
  deviceEmulationEnabled: document.getElementById("device-emulation-enabled"),
  deviceModeDesktop: document.getElementById("device-mode-desktop"),
  deviceModeMobile: document.getElementById("device-mode-mobile"),
  deviceScale: document.getElementById("device-scale"),
  deviceScaleValue: document.getElementById("device-scale-value"),
  pageSave: document.getElementById("page-save"),
  pageRevert: document.getElementById("page-revert"),
  pageDelete: document.getElementById("page-delete"),
  pageDraftStatus: document.getElementById("page-draft-status"),
  copySourceBaseUrl: document.getElementById("copy-source-base-url"),
  copySourcePageUrl: document.getElementById("copy-source-page-url"),
  copyFromPage: document.getElementById("copy-from-page"),
  xpathCssHighlight: document.getElementById("xpath-css-highlight"),
  xpathCssGenerate: document.getElementById("xpath-css-generate"),
  xpathCssNotice: document.getElementById("xpath-css-notice"),
  xpathCssOutput: document.getElementById("xpath-css-output"),
  xpathCssCopyAll: document.getElementById("xpath-css-copy-all"),
  endpointUrl: document.getElementById("endpoint-url"),
  endpointSet: document.getElementById("endpoint-url-set"),
  endpointEdit: document.getElementById("endpoint-url-edit"),
  endpointNotice: document.getElementById("endpoint-notice"),
  aiControls: document.getElementById("ai-controls"),
  aiDirtyNotice: document.getElementById("ai-dirty-notice"),
  aiToken: document.getElementById("ai-token"),
  tokenStatus: document.getElementById("token-status"),
  tokenAction: document.getElementById("token-action"),
  computeButton: document.getElementById("compute"),
  saveExcludesButton: document.getElementById("save-excludes"),
  previewLatestButton: document.getElementById("preview-latest"),
  explicitExcludes: document.getElementById("explicit-excludes"),
  headingDefaults: document.getElementById("heading-defaults"),
  toast: document.getElementById("toast")
};

export function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    ui.toast.classList.remove("show");
  }, 1800);
}

export function setUiBusy(isBusy) {
  if (ui.uiCurtain) {
    ui.uiCurtain.hidden = !isBusy;
  }
  document.body.classList.toggle("is-busy", isBusy);
}

export function setConfigMenuOpen(open) {
  state.configMenuOpen = open;
  if (ui.configMenu) {
    ui.configMenu.hidden = !open;
  }
  if (ui.configToggle) {
    ui.configToggle.setAttribute("aria-expanded", open ? "true" : "false");
  }
}
