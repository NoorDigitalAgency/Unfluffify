import { describe, expect, expectTypeOf, it } from "vitest";

import * as appExports from "../../../src/popup/App";
import type {
  LynxChecklistState as AppLynxChecklistState,
  PopupActionAvailability as AppPopupActionAvailability,
  PopupAuthState as AppPopupAuthState,
  PopupCredentialsField as AppPopupCredentialsField,
  PopupCredentialsForm as AppPopupCredentialsForm,
  PopupCurtainKind as AppPopupCurtainKind,
  PopupDiagnostics as AppPopupDiagnostics,
  PopupLogEntry as AppPopupLogEntry,
  PopupSettingsField as AppPopupSettingsField,
  PopupSettingsForm as AppPopupSettingsForm,
  RenderModeView as AppRenderModeView,
} from "../../../src/popup/App";
import { memoryFor, type PopupPresentation } from "../../../src/popup/organ/memory";
import * as presentationExports from "../../../src/popup/presentation";
import type {
  LynxChecklistState,
  PopupActionAvailability,
  PopupAuthState,
  PopupCredentialsField,
  PopupCredentialsForm,
  PopupCurtainKind,
  PopupDiagnostics,
  PopupLogEntry,
  PopupSettingsField,
  PopupSettingsForm,
  RenderModeView,
} from "../../../src/popup/presentation";

type DirectContract = Readonly<{
  actionAvailability: PopupActionAvailability;
  authState: PopupAuthState;
  credentialsField: PopupCredentialsField;
  credentialsForm: PopupCredentialsForm;
  curtainKind: PopupCurtainKind;
  diagnostics: PopupDiagnostics;
  logEntry: PopupLogEntry;
  lynxChecklist: LynxChecklistState;
  settingsField: PopupSettingsField;
  settingsForm: PopupSettingsForm;
  renderModeView: RenderModeView;
}>;

type AppContract = Readonly<{
  actionAvailability: AppPopupActionAvailability;
  authState: AppPopupAuthState;
  credentialsField: AppPopupCredentialsField;
  credentialsForm: AppPopupCredentialsForm;
  curtainKind: AppPopupCurtainKind;
  diagnostics: AppPopupDiagnostics;
  logEntry: AppPopupLogEntry;
  lynxChecklist: AppLynxChecklistState;
  settingsField: AppPopupSettingsField;
  settingsForm: AppPopupSettingsForm;
  renderModeView: AppRenderModeView;
}>;

const UNBLOCKED_PRESENTATION: PopupPresentation = {
  ...memoryFor({ name: "post_ai_clean", lastConsumedSeq: 1, reconciliationReason: "" }),
  runAiDisabled: false,
  saveDisabled: false,
  discardDisabled: false,
  showPreviewDisabled: false,
  runAiBlockedReason: "",
  saveBlockedReason: "",
  discardBlockedReason: "",
  showPreviewBlockedReason: "",
};

describe("popup presentation contract", () => {
  it("keeps every value export reference-identical through App", () => {
    expect(Object.keys(presentationExports).sort()).toEqual([
      "EMPTY_LYNX_CHECKLIST_STATE",
      "EMPTY_POPUP_CREDENTIALS_FORM",
      "EMPTY_POPUP_DIAGNOSTICS",
      "EMPTY_POPUP_SETTINGS_FORM",
      "RENDER_MODE_NOT_SET_REASON",
      "markingDisableNeedsConfirmation",
      "resolvePopupActionButtons",
      "resolvePopupCurtainKind",
      "resolvePopupPanelBlocking",
    ]);
    for (const name of Object.keys(presentationExports) as (keyof typeof presentationExports)[]) {
      expect(appExports[name], name).toBe(presentationExports[name]);
    }
  });

  it("keeps every type export identical through App", () => {
    expectTypeOf<DirectContract>().toEqualTypeOf<AppContract>();
  });

  it("preserves the exact empty presentation inputs", () => {
    expect(presentationExports.EMPTY_LYNX_CHECKLIST_STATE).toEqual({
      open: false,
      phase: "idle",
      gate: { status: "context_unavailable" },
      message: "",
      operationId: "",
    });
    expect(presentationExports.EMPTY_POPUP_SETTINGS_FORM).toEqual({
      configEndpoint: "",
      aiEndpoint: "",
      stageBase: "",
    });
    expect(presentationExports.EMPTY_POPUP_CREDENTIALS_FORM).toEqual({
      email: "",
      password: "",
    });
    expect(presentationExports.EMPTY_POPUP_DIAGNOSTICS).toEqual({
      stateName: "",
      pageUrl: "",
      baseUrl: "",
      siteId: null,
      lockStatus: "",
      lockRole: "",
      configPresent: false,
      configStatus: "",
      configurationComplete: false,
      renderModeSource: "local",
      contentActive: false,
      contentDirty: false,
      contentReachable: true,
      runSessionId: "",
      settingsLoaded: false,
      settingsSaved: false,
      settingsDirty: false,
      settingsBusy: false,
      stageBaseSet: false,
      authState: "unknown",
      authBusy: false,
      authMessage: "",
      renderMode: null,
      renderModePending: null,
      renderModeView: "unknown",
      renderModeDetail: "",
      renderModeBusy: false,
      todoStatus: "unresolved",
      todo: { covered: 0, actionable: 0, pageTypes: [] },
      log: [],
      maintenanceBusy: false,
      maintenanceMessage: "",
      maintenanceTone: "info",
    });
  });

  it("preserves action blocking precedence and the render-mode gate", () => {
    const presentationBlocked: PopupPresentation = {
      ...UNBLOCKED_PRESENTATION,
      runAiDisabled: true,
      saveDisabled: true,
      discardDisabled: true,
      showPreviewDisabled: true,
      runAiBlockedReason: "compute-state",
      saveBlockedReason: "save-state",
      discardBlockedReason: "discard-state",
      showPreviewBlockedReason: "preview-state",
    };
    expect(presentationExports.resolvePopupActionButtons(presentationBlocked, {
      renderModeSet: false,
    })).toEqual({
      compute: { disabled: true, blockedReason: "compute-state" },
      save: { disabled: true, blockedReason: "save-state" },
      discard: { disabled: true, blockedReason: "discard-state" },
      preview: { disabled: true, blockedReason: "preview-state" },
    });

    expect(presentationExports.resolvePopupActionButtons(UNBLOCKED_PRESENTATION, {
      renderModeSet: true,
    })).toEqual({
      compute: { disabled: true, blockedReason: "not-implemented" },
      save: { disabled: true, blockedReason: "not-implemented" },
      discard: { disabled: true, blockedReason: "not-implemented" },
      preview: { disabled: true, blockedReason: "not-implemented" },
    });

    expect(presentationExports.resolvePopupActionButtons(UNBLOCKED_PRESENTATION, {
      runAi: true,
      save: true,
      discard: true,
      preview: true,
      renderModeSet: false,
    })).toEqual({
      compute: { disabled: true, blockedReason: "render-mode-not-set" },
      save: { disabled: true, blockedReason: "render-mode-not-set" },
      discard: { disabled: false, blockedReason: "" },
      preview: { disabled: false, blockedReason: "" },
    });

    expect(presentationExports.resolvePopupActionButtons(UNBLOCKED_PRESENTATION, {
      runAi: true,
      save: true,
      discard: true,
      preview: true,
      renderModeSet: true,
    })).toEqual({
      compute: { disabled: false, blockedReason: "" },
      save: { disabled: false, blockedReason: "" },
      discard: { disabled: false, blockedReason: "" },
      preview: { disabled: false, blockedReason: "" },
    });
  });

  it("preserves curtain, dirty-disable, and panel blocking truth tables", () => {
    expect(presentationExports.resolvePopupCurtainKind(memoryFor({
      name: "silent",
      lastConsumedSeq: 1,
      reconciliationReason: "",
    }))).toBe("none");
    expect(presentationExports.resolvePopupCurtainKind(memoryFor({
      name: "running",
      lastConsumedSeq: 1,
      reconciliationReason: "post_ai",
    }))).toBe("busy");
    expect(presentationExports.resolvePopupCurtainKind(memoryFor({
      name: "locked",
      lastConsumedSeq: 1,
      reconciliationReason: "",
      lockBanner: { visible: true, text: "Locked by another editor" },
    }))).toBe("blocked");

    expect([
      [true, true, false],
      [true, false, false],
      [false, false, false],
      [false, true, true],
    ].map(([enabled, dirty]) => presentationExports.markingDisableNeedsConfirmation(enabled, dirty)))
      .toEqual([false, false, false, true]);

    const baseline = {
      curtainKind: "none" as const,
      maintenanceBusy: false,
      lockConfirmation: false,
      candidateConfirmation: false,
      maintenanceConfirmation: false,
      markingDisableConfirmation: false,
      checklist: false,
    };
    expect(presentationExports.resolvePopupPanelBlocking(baseline)).toBe(false);
    expect(presentationExports.resolvePopupPanelBlocking({ ...baseline, curtainKind: "blocked" })).toBe(false);
    expect(presentationExports.resolvePopupPanelBlocking({ ...baseline, curtainKind: "busy" })).toBe(true);
    for (const key of [
      "maintenanceBusy",
      "lockConfirmation",
      "candidateConfirmation",
      "maintenanceConfirmation",
      "markingDisableConfirmation",
      "checklist",
    ] as const) {
      expect(presentationExports.resolvePopupPanelBlocking({ ...baseline, [key]: true }), key).toBe(true);
    }
  });
});
