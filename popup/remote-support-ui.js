import * as stateModule from "./state.js";

const { state } = stateModule;

export function syncRemoteSupportViewState(deps, remoteSupportState = null) {
  if (deps.shouldBlockRemoteSupportFeature()) {
    return;
  }
  const currentTabId = state.currentTab && Number.isFinite(state.currentTab.id)
    ? state.currentTab.id
    : null;
  const nextState = deps.scopeRemoteSupportStateToTab(remoteSupportState, currentTabId);
  const statusText = deps.buildRemoteSupportStatusText(nextState);
  deps.setViewState({
    remoteSupportSessionActive: Boolean(nextState.active),
    remoteSupportMode: nextState.mode || "inactive",
    remoteSupportRole: nextState.role || "",
    remoteSupportRequested: Boolean(nextState.supportCode),
    remoteSupportCode: nextState.supportCode || "",
    remoteSupportConnected: Boolean(nextState.connected),
    remoteSupportStreaming: Boolean(nextState.streaming),
    remoteSupportCameraAvailable: Boolean(nextState.supporteeCameraAvailable),
    remoteSupportCameraEnabled: Boolean(nextState.supporteeCameraEnabled),
    remoteSupportMicrophoneAvailable: Boolean(nextState.supporteeMicrophoneAvailable),
    remoteSupportMicrophoneEnabled: Boolean(nextState.supporteeMicrophoneEnabled),
    remoteSupportSoundAvailable: Boolean(nextState.supporteeAudioAvailable),
    remoteSupportSoundEnabled: Boolean(nextState.supporteeAudioEnabled),
    remoteSupportDockState: deps.normalizeRemoteSupportDockState(nextState.dockState),
    remoteSupportLocalCameraActive: Boolean(state.remoteSupportLocalCameraActive),
    remoteSupportRemoteCameraActive: Boolean(state.remoteSupportRemoteCameraActive),
    remoteSupportPreviewImage: Boolean(nextState.active) ? state.remoteSupportLastFrame || "" : "",
    remoteSupportStatusText: statusText,
    remoteSupportInactivityCountdownActive: Boolean(nextState.inactivityCountdownActive),
    remoteSupportInactivitySecondsRemaining: Math.max(0, Math.trunc(Number(nextState.inactivitySecondsRemaining) || 0)),
    remoteSupportInactivityCountdownText: deps.formatRemoteSupportCountdown(nextState.inactivitySecondsRemaining),
    remoteSupportError: nextState.error || ""
  });
  if (!nextState.active) {
    state.remoteSupportLocalCameraActive = false;
    state.remoteSupportRemoteCameraActive = false;
    deps.stopRemoteSupportCameraMediaStreams();
    deps.setViewState({
      remoteSupportLocalCameraActive: false,
      remoteSupportRemoteCameraActive: false,
      remoteSupportDockState: deps.REMOTE_SUPPORT_DOCK_STATE_EMBEDDED
    });
  }
}

export async function handleRemoteSupportRequest(deps) {
  if (deps.shouldBlockRemoteSupportFeature()) {
    return;
  }
  deps.setViewState({ remoteSupportRequestLoading: true });
  try {
    const setup = await deps.requireRemoteSupportSetup();
    if (!setup || !state.currentTab || !state.currentTab.id) {
      return;
    }
    const response = await deps.sendRuntimeMessage({
      type: "remoteSupportRequestCode",
      endpointValue: setup.configEndpointValue,
      tokenValue: setup.tokenValue,
      tabId: state.currentTab.id,
      pageUrl: state.currentTab.url || ""
    });
    if (!response || !response.ok) {
      deps.showToast((response && response.error) || "Unable to request support code");
      return;
    }
    state.remoteSupportState = response.state || null;
    deps.syncRemoteSupportViewState(state.remoteSupportState);
    await deps.refreshUi();
  } finally {
    deps.setViewState({ remoteSupportRequestLoading: false });
  }
}

export function handleRemoteSupportJoinCodeInput(deps, event) {
  if (deps.shouldBlockRemoteSupportFeature()) {
    return;
  }
  const value = event && event.target && typeof event.target.value === "string"
    ? event.target.value.trim().toUpperCase()
    : "";
  state.remoteSupportJoinCode = value;
  deps.setViewState({ remoteSupportJoinCode: value });
}

export async function handleRemoteSupportJoin(deps) {
  if (deps.shouldBlockRemoteSupportFeature()) {
    return;
  }
  deps.setViewState({ remoteSupportJoinLoading: true });
  try {
    const setup = await deps.requireRemoteSupportSetup();
    if (!setup || !state.currentTab || !state.currentTab.id) {
      return;
    }
    const supportCode = (deps.getViewState().remoteSupportJoinCode || "").trim();
    if (!supportCode) {
      deps.showToast(deps.PopupText.configuration.remoteSupportJoinCodePlaceholder);
      return;
    }
    const response = await deps.sendRuntimeMessage({
      type: "remoteSupportJoin",
      endpointValue: setup.configEndpointValue,
      tokenValue: setup.tokenValue,
      tabId: state.currentTab.id,
      supportCode
    });
    if (!response || !response.ok) {
      deps.showToast((response && response.error) || "Unable to join support session");
      return;
    }
    state.remoteSupportState = response.state || null;
    deps.syncRemoteSupportViewState(state.remoteSupportState);
    await deps.refreshUi();
  } finally {
    deps.setViewState({ remoteSupportJoinLoading: false });
  }
}
