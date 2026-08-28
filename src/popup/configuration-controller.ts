import type { ConnectionSettings } from "../storage/settings";
import type { ConfigSnapshot, SelectorSet } from "../storage/config";
import type { RenderMode } from "../domain/schema/property";
import {
  EMPTY_POPUP_CREDENTIALS_FORM,
  EMPTY_POPUP_SETTINGS_FORM,
  type PopupAuthState,
  type PopupCredentialsField,
  type PopupCredentialsForm,
  type PopupSettingsField,
  type PopupSettingsForm,
} from "./presentation";

export type ConfigurationTone = "info" | "success" | "warn" | "danger";

export type ConfigurationPortResult<T> =
  | Readonly<{ ok: true; data: T }>
  | Readonly<{ ok: false; code: string }>;

export type SettingsLoadResult = Readonly<{
  settings: ConnectionSettings;
  hasToken: boolean;
}>;

export type SettingsSaveResult = Readonly<{
  status: "ok";
  settings: ConnectionSettings;
  hasToken: boolean;
}>;

export type AccountStatusResult = Readonly<{
  state: "unknown" | "valid" | "invalid";
  checkedAt: number;
}>;

export type AccountLoginResult = Readonly<{
  status: "ok" | "skipped" | "missing_token" | "rejected";
  httpStatus?: number;
  message?: string;
}>;

export type AccountValidateResult = Readonly<{
  status: "valid" | "invalid" | "skipped" | "error";
  httpStatus?: number;
}>;

export type PropertyConfigLoadResult =
  | Readonly<{
    status: "ok" | "integrity_shrink";
    config: ConfigSnapshot;
    reason?: string;
    renderMode?: RenderMode;
    pendingRenderMode?: RenderMode;
    renderModeSource: "backend";
  }>
  | Readonly<{
    status: "auth_error" | "not_found" | "invalid" | "environment_unconfigured" | "error";
    httpStatus?: number;
    renderMode?: RenderMode;
    pendingRenderMode?: RenderMode;
    renderModeSource: "backend" | "local";
  }>;

export type ConfigurationPorts = Readonly<{
  loadSettings(): Promise<ConfigurationPortResult<SettingsLoadResult>>;
  saveSettings(settings: ConnectionSettings): Promise<ConfigurationPortResult<SettingsSaveResult>>;
  accountStatus(): Promise<ConfigurationPortResult<AccountStatusResult>>;
  login(input: Readonly<{ email: string; password: string }>): Promise<ConfigurationPortResult<AccountLoginResult>>;
  logout(): Promise<ConfigurationPortResult<Readonly<{ status: "ok" }>>>;
  validateToken(): Promise<ConfigurationPortResult<AccountValidateResult>>;
  loadPropertyConfig(siteId: number): Promise<ConfigurationPortResult<PropertyConfigLoadResult>>;
  isRenderModeConfirmed(config: ConfigSnapshot): boolean;
  refreshPopup(): Promise<void>;
  recordActivity(label: string, detail?: string, tone?: ConfigurationTone): void;
  onChange(): void;
}>;

export type ConfigurationSnapshot = Readonly<{
  settings: PopupSettingsForm;
  storedSettings: PopupSettingsForm | null;
  credentials: PopupCredentialsForm;
  settingsLoaded: boolean;
  settingsSaved: boolean;
  settingsDirty: boolean;
  settingsBusy: boolean;
  stageBaseSet: boolean;
  hasStoredToken: boolean;
  authState: PopupAuthState;
  authBusy: boolean;
  authMessage: string;
  configurationComplete: boolean;
  property: Readonly<{
    attemptedSiteId: number | null;
    status: string;
    config: ConfigSnapshot | null;
    selectors: SelectorSet | null;
    renderMode: RenderMode | null;
    renderModeSource: "backend" | "local" | "pending";
  }>;
}>;

export type PropertyLoadCandidate = Readonly<{
  siteId: number;
  bindingVersion: number;
  requestVersion: number;
  response: ConfigurationPortResult<PropertyConfigLoadResult>;
}>;

export type PropertyAdoptionOutcome =
  | Readonly<{ status: "adopted"; projectionInvalidated: boolean }>
  | Readonly<{ status: "stale"; projectionInvalidated: false }>;

export type SettingsSavePreparation = Readonly<{
  payload: ConnectionSettings;
  definitiveDeletion: boolean;
}>;

export type SettingsSaveOutcome =
  | Readonly<{ status: "saved"; preparation: SettingsSavePreparation }>
  | Readonly<{ status: "failed"; code: string }>
  | Readonly<{ status: "busy" }>;

export type ConfigurationController = Readonly<{
  snapshot(): ConfigurationSnapshot;
  updateSettings(field: PopupSettingsField, value: string): void;
  updateCredentials(field: PopupCredentialsField, value: string): void;
  loadSettings(): Promise<"loaded" | "failed" | "busy">;
  prepareSettingsSave(): SettingsSavePreparation;
  saveSettings(preparation: SettingsSavePreparation): Promise<SettingsSaveOutcome>;
  completeDefinitiveDeletion(): void;
  finishSettingsSave(): void;
  adoptAuthStatus(): Promise<"adopted" | "failed">;
  login(): Promise<"completed" | "failed" | "skipped" | "busy">;
  logout(): Promise<"completed" | "failed" | "busy">;
  validateToken(): Promise<"completed" | "failed" | "busy">;
  requestPropertyLoad(siteId: number): Promise<PropertyLoadCandidate | null>;
  adoptPropertyLoad(candidate: PropertyLoadCandidate): PropertyAdoptionOutcome;
  retryPropertyLoad(): void;
  resetPropertyBinding(): void;
  setConfirmedRenderMode(mode: RenderMode): boolean;
  clearConfirmedRenderMode(): void;
  adoptAuthoritativeConfig(config: ConfigSnapshot, status: "ok" | "integrity_shrink"): void;
}>;

const SETTINGS_FORM_FIELDS = ["configEndpoint", "aiEndpoint", "stageBase"] as const;

const LOGIN_FAILURE_TEXT: Readonly<Record<string, string>> = {
  skipped: "Enter an email and password.",
  missing_token: "The accounts backend accepted the sign-in but returned no token.",
};

export function settingsFormFrom(settings: ConnectionSettings): PopupSettingsForm {
  return {
    configEndpoint: settings.configEndpoint ?? "",
    aiEndpoint: settings.aiEndpoint ?? "",
    stageBase: settings.stageBase ?? "",
  };
}

/** Zod rejects empty URL fields, so blank inputs must be omitted entirely. */
export function settingsFromForm(form: PopupSettingsForm): ConnectionSettings {
  return Object.fromEntries(
    SETTINGS_FORM_FIELDS
      .map((field) => [field, form[field].trim()] as const)
      .filter(([, value]) => value !== ""),
  ) as ConnectionSettings;
}

export function settingsFormsMatch(left: PopupSettingsForm, right: PopupSettingsForm): boolean {
  return SETTINGS_FORM_FIELDS.every((field) => left[field].trim() === right[field].trim());
}

/**
 * Owns global connection settings and credential presentation. Browser/tab
 * binding, terminal session cleanup, and property authority remain in popup
 * main and cross this seam only through explicit ports.
 */
export function createConfigurationController(ports: ConfigurationPorts): ConfigurationController {
  let settings = EMPTY_POPUP_SETTINGS_FORM;
  let storedSettings: PopupSettingsForm | null = null;
  let settingsBusy = false;
  let settingsLoadReported = false;
  let settingsFormDirty = false;
  let credentials = EMPTY_POPUP_CREDENTIALS_FORM;
  let hasStoredToken = false;
  let rawAuthState: PopupAuthState = "unknown";
  let authBusy = false;
  let authMessage = "";
  let propertyBindingVersion = 0;
  let propertyRequestVersion = 0;
  let attemptedSiteId: number | null = null;
  let propertyStatus = "";
  let propertyConfig: ConfigSnapshot | null = null;
  let propertySelectors: SelectorSet | null = null;
  let confirmedRenderMode: RenderMode | null = null;
  let renderModeSource: "backend" | "local" | "pending" = "local";

  const resolvedAuthState = (): PopupAuthState => {
    if (authBusy) {
      return "checking";
    }
    if (rawAuthState === "invalid") {
      return "invalid";
    }
    return hasStoredToken ? "signed_in" : storedSettings === null ? "unknown" : "signed_out";
  };

  const configurationComplete = (): boolean => {
    const stored = storedSettings;
    if (stored === null) {
      return false;
    }
    const endpointsSet = SETTINGS_FORM_FIELDS.every((field) => stored[field].trim() !== "");
    return endpointsSet && hasStoredToken && rawAuthState !== "invalid";
  };

  const snapshot = (): ConfigurationSnapshot => Object.freeze({
    settings,
    storedSettings,
    credentials,
    settingsLoaded: storedSettings !== null,
    settingsSaved: storedSettings !== null && !settingsFormsMatch(storedSettings, EMPTY_POPUP_SETTINGS_FORM),
    settingsDirty: storedSettings !== null && !settingsFormsMatch(storedSettings, settings),
    settingsBusy,
    stageBaseSet: (storedSettings?.stageBase ?? "").trim() !== "",
    hasStoredToken,
    authState: resolvedAuthState(),
    authBusy,
    authMessage,
    configurationComplete: configurationComplete(),
    property: Object.freeze({
      attemptedSiteId,
      status: propertyStatus,
      config: propertyConfig,
      selectors: propertySelectors,
      renderMode: confirmedRenderMode,
      renderModeSource,
    }),
  });

  const adoptAuthStatus = async (): Promise<"adopted" | "failed"> => {
    const response = await ports.accountStatus();
    if (!response.ok) {
      return "failed";
    }
    if (response.data.state === "invalid") {
      if (rawAuthState !== "invalid") {
        ports.recordActivity("Token rejected", "reported by the background check", "danger");
      }
      rawAuthState = "invalid";
    } else if (response.data.state === "valid" && rawAuthState === "invalid") {
      rawAuthState = "signed_in";
    }
    return "adopted";
  };

  return {
    snapshot,
    updateSettings(field, value) {
      settings = { ...settings, [field]: value };
      settingsFormDirty = true;
      ports.onChange();
    },
    updateCredentials(field, value) {
      credentials = { ...credentials, [field]: value };
      authMessage = "";
      ports.onChange();
    },
    async loadSettings() {
      if (settingsBusy) {
        return "busy";
      }
      const response = await ports.loadSettings();
      if (!response.ok) {
        if (!settingsLoadReported) {
          settingsLoadReported = true;
          ports.recordActivity("Settings unavailable", `${response.code} · retrying`, "warn");
        }
        ports.onChange();
        return "failed";
      }
      if (settingsLoadReported) {
        ports.recordActivity("Settings loaded", "retry succeeded", "success");
        settingsLoadReported = false;
      }
      hasStoredToken = response.data.hasToken;
      if (!hasStoredToken && rawAuthState === "signed_in") {
        rawAuthState = "signed_out";
      }
      storedSettings = settingsFormFrom(response.data.settings);
      if (!settingsFormDirty) {
        settings = storedSettings;
      }
      if (hasStoredToken) {
        await adoptAuthStatus();
      }
      ports.onChange();
      return "loaded";
    },
    prepareSettingsSave() {
      const payload = settingsFromForm(settings);
      return Object.freeze({
        payload,
        definitiveDeletion: Object.keys(payload).length === 0 &&
          storedSettings !== null &&
          !settingsFormsMatch(storedSettings, EMPTY_POPUP_SETTINGS_FORM),
      });
    },
    async saveSettings(preparation) {
      if (settingsBusy) {
        return { status: "busy" };
      }
      settingsBusy = true;
      ports.onChange();
      const response = await ports.saveSettings(preparation.payload);
      if (!response.ok) {
        settingsBusy = false;
        ports.onChange();
        return { status: "failed", code: response.code };
      }
      storedSettings = settingsFormFrom(response.data.settings);
      settings = storedSettings;
      settingsFormDirty = false;
      hasStoredToken = response.data.hasToken;
      if (!hasStoredToken && rawAuthState === "signed_in") {
        rawAuthState = "signed_out";
      }
      return { status: "saved", preparation };
    },
    completeDefinitiveDeletion() {
      hasStoredToken = false;
      rawAuthState = "signed_out";
      credentials = EMPTY_POPUP_CREDENTIALS_FORM;
      authMessage = "";
    },
    finishSettingsSave() {
      if (!settingsBusy) {
        return;
      }
      settingsBusy = false;
      ports.onChange();
    },
    adoptAuthStatus,
    async login() {
      if (authBusy) {
        return "busy";
      }
      const email = credentials.email.trim();
      if (!email || !credentials.password) {
        authMessage = LOGIN_FAILURE_TEXT.skipped;
        ports.onChange();
        return "skipped";
      }
      authBusy = true;
      authMessage = "";
      ports.onChange();
      const response = await ports.login({ email, password: credentials.password });
      authBusy = false;
      if (!response.ok) {
        authMessage = `Sign-in could not be sent (${response.code}).`;
        ports.recordActivity("Sign-in failed", response.code, "danger");
        ports.onChange();
        return "failed";
      }
      if (response.data.status !== "ok") {
        authMessage = response.data.message
          || LOGIN_FAILURE_TEXT[response.data.status]
          || `Sign-in failed (${response.data.status}).`;
        ports.recordActivity("Sign-in failed", authMessage, "danger");
        ports.onChange();
        return "failed";
      }
      // Retain the non-secret account hint for the popup lifetime. Only the
      // password is cleared after a successful exchange.
      credentials = { email, password: "" };
      hasStoredToken = true;
      rawAuthState = "signed_in";
      authMessage = `Signed in as ${email}.`;
      ports.recordActivity("Signed in", email, "success");
      ports.onChange();
      await ports.refreshPopup();
      return "completed";
    },
    async logout() {
      if (authBusy) {
        return "busy";
      }
      authBusy = true;
      ports.onChange();
      const response = await ports.logout();
      authBusy = false;
      if (!response.ok) {
        authMessage = `Sign-out failed (${response.code}).`;
        ports.onChange();
        return "failed";
      }
      hasStoredToken = false;
      rawAuthState = "signed_out";
      authMessage = "";
      credentials = EMPTY_POPUP_CREDENTIALS_FORM;
      ports.recordActivity("Signed out", "token discarded");
      ports.onChange();
      await ports.refreshPopup();
      return "completed";
    },
    async validateToken() {
      if (authBusy) {
        return "busy";
      }
      authBusy = true;
      authMessage = "";
      ports.onChange();
      const response = await ports.validateToken();
      authBusy = false;
      if (!response.ok) {
        authMessage = `Token check could not be sent (${response.code}).`;
        ports.onChange();
        return "failed";
      }
      if (response.data.status === "valid") {
        rawAuthState = "signed_in";
        authMessage = "Token is valid.";
        ports.recordActivity("Token valid", "", "success");
      } else if (response.data.status === "invalid") {
        rawAuthState = "invalid";
        authMessage = "The stored token was rejected. Sign in again.";
        ports.recordActivity("Token rejected", `HTTP ${response.data.httpStatus ?? 0}`, "danger");
      } else if (response.data.status === "skipped") {
        authMessage = "Nothing to check — set a stage base host and sign in first.";
      } else {
        authMessage = `Token check failed (HTTP ${response.data.httpStatus ?? 0}).`;
        ports.recordActivity("Token check failed", `HTTP ${response.data.httpStatus ?? 0}`, "warn");
      }
      ports.onChange();
      return "completed";
    },
    async requestPropertyLoad(siteId) {
      if (attemptedSiteId === siteId) {
        return null;
      }
      attemptedSiteId = siteId;
      const bindingVersion = propertyBindingVersion;
      propertyRequestVersion += 1;
      const requestVersion = propertyRequestVersion;
      const response = await ports.loadPropertyConfig(siteId);
      return Object.freeze({ siteId, bindingVersion, requestVersion, response });
    },
    adoptPropertyLoad(candidate) {
      if (
        candidate.bindingVersion !== propertyBindingVersion ||
        candidate.requestVersion !== propertyRequestVersion ||
        candidate.siteId !== attemptedSiteId
      ) {
        return { status: "stale", projectionInvalidated: false };
      }
      const response = candidate.response;
      if (!response.ok) {
        propertyStatus = response.code;
        ports.recordActivity("Config load failed", response.code, "warn");
        ports.onChange();
        return { status: "adopted", projectionInvalidated: false };
      }
      const result = response.data;
      propertyStatus = result.status;
      if (result.status !== "ok" && result.status !== "integrity_shrink") {
        confirmedRenderMode = result.pendingRenderMode ?? result.renderMode ?? null;
        renderModeSource = result.pendingRenderMode ? "pending" : result.renderModeSource;
        const projectionInvalidated = result.status === "not_found";
        if (projectionInvalidated) {
          propertyConfig = null;
          propertySelectors = null;
        }
        ports.recordActivity(
          "Config not loaded",
          result.status === "not_found"
            ? result.renderMode
              ? `no stored config · kept local render mode ${result.renderMode}`
              : "no stored config for this property"
            : result.status,
          result.status === "not_found" ? "info" : "warn",
        );
        ports.onChange();
        return { status: "adopted", projectionInvalidated };
      }
      renderModeSource = result.pendingRenderMode ? "pending" : result.renderModeSource;
      propertyConfig = result.config;
      propertySelectors = result.config.selectors;
      if (result.pendingRenderMode) {
        confirmedRenderMode = result.pendingRenderMode;
        ports.recordActivity(
          "Render mode draft restored",
          `${result.pendingRenderMode} · pending Save`,
          "warn",
        );
      } else if (ports.isRenderModeConfirmed(result.config)) {
        confirmedRenderMode = result.config.renderMode;
        ports.recordActivity("Render mode restored", `${result.config.renderMode} · backend`, "success");
      } else {
        confirmedRenderMode = null;
        ports.recordActivity("Render mode not stored", "choose one for this property", "info");
      }
      if (result.status === "integrity_shrink") {
        ports.recordActivity("Configuration integrity warning", result.reason ?? "integrity shrink", "danger");
      }
      ports.onChange();
      return { status: "adopted", projectionInvalidated: true };
    },
    retryPropertyLoad() {
      propertyRequestVersion += 1;
      attemptedSiteId = null;
    },
    resetPropertyBinding() {
      propertyBindingVersion += 1;
      propertyRequestVersion += 1;
      attemptedSiteId = null;
      propertyStatus = "";
      propertyConfig = null;
      propertySelectors = null;
      confirmedRenderMode = null;
      renderModeSource = "local";
    },
    setConfirmedRenderMode(mode) {
      const nextSource = propertyConfig === null
        ? "local"
        : propertyConfig.renderMode === mode ? "backend" : "pending";
      if (confirmedRenderMode === mode && renderModeSource === nextSource) {
        return false;
      }
      confirmedRenderMode = mode;
      renderModeSource = nextSource;
      return true;
    },
    clearConfirmedRenderMode() {
      confirmedRenderMode = null;
      renderModeSource = "local";
    },
    adoptAuthoritativeConfig(config, status) {
      propertyConfig = config;
      propertySelectors = config.selectors;
      renderModeSource = "backend";
      propertyStatus = status;
      if (ports.isRenderModeConfirmed(config)) {
        confirmedRenderMode = config.renderMode;
      }
      ports.onChange();
    },
  };
}
