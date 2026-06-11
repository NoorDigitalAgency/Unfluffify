export function createPropertyLockStateMachine(deps) {
  function normalizeRecoveryTabState(tabState) {
    const nextSiteId = Number.isFinite(tabState && tabState.propertyLockRecoverySiteId)
      ? Math.trunc(tabState.propertyLockRecoverySiteId)
      : null;
    return {
      siteId: nextSiteId && nextSiteId > 0 ? nextSiteId : null,
      baseUrl: typeof (tabState && tabState.propertyLockRecoveryBaseUrl) === "string"
        ? tabState.propertyLockRecoveryBaseUrl
        : "",
      clientId: deps.normalizePropertyLockClientId(tabState && tabState.propertyLockRecoveryClientId),
      deadlineAt: Number.isFinite(tabState && tabState.propertyLockRecoveryDeadlineAt)
        ? Math.max(0, Math.trunc(tabState.propertyLockRecoveryDeadlineAt))
        : 0,
      offCandidateDeadlineAt: Number.isFinite(tabState && tabState.propertyLockOffCandidateDeadlineAt)
        ? Math.max(0, Math.trunc(tabState.propertyLockOffCandidateDeadlineAt))
        : 0
    };
  }

  function persistRecoveryState({ siteId = null, baseUrl = "", clientId = "", deadlineAt = 0 } = {}) {
    if (!deps.isPropertyLockCollaborationEnabled()) {
      return Promise.resolve(null);
    }
    return deps.sendRuntimeMessage({
      type: "setTabState",
      scope: "initial",
      state: {
        active: true,
        propertyLockRecoverySiteId: Number.isFinite(siteId) ? Math.trunc(siteId) : null,
        propertyLockRecoveryBaseUrl: typeof baseUrl === "string" ? baseUrl : "",
        propertyLockRecoveryClientId: deps.normalizePropertyLockClientId(clientId),
        propertyLockRecoveryDeadlineAt: Number.isFinite(deadlineAt) ? Math.max(0, Math.trunc(deadlineAt)) : 0
      }
    }).catch(() => null);
  }

  function persistOffCandidateDeadline(deadlineAt) {
    if (!deps.isPropertyLockCollaborationEnabled()) {
      return Promise.resolve(null);
    }
    return deps.sendRuntimeMessage({
      type: "setTabState",
      scope: "initial",
      state: {
        active: true,
        propertyLockOffCandidateDeadlineAt: Number.isFinite(deadlineAt) ? Math.max(0, Math.trunc(deadlineAt)) : 0
      }
    }).catch(() => null);
  }

  function clearOffCandidateWarning() {
    deps.setPropertyLockOffCandidateDeadlineAt(0);
    if (deps.getPropertyLockBannerMode() === "editor_off_candidate_countdown") {
      deps.setPropertyLockBannerCountdownValue(0);
      deps.clearPropertyLockBannerCountdown();
    }
    if (deps.isPropertyLockCollaborationEnabled()) {
      persistOffCandidateDeadline(0);
    }
  }

  function clearCrossPropertyWarning(options = {}) {
    const { preserveSession = false } = options || {};
    deps.setPropertyLockRecoveryDeadlineAt(0);
    deps.clearPropertyLockRecoveryReleaseTimer();
    if (deps.getPropertyLockBannerMode() === "editor_cross_property_countdown") {
      deps.setPropertyLockBannerCountdownValue(0);
      deps.clearPropertyLockBannerCountdown();
    }
    if (!preserveSession) {
      deps.setPropertyLockRecoverySiteId(null);
      deps.setPropertyLockRecoveryBaseUrl("");
      deps.setPropertyLockRecoveryClientId("");
    }
    if (deps.isPropertyLockCollaborationEnabled()) {
      persistRecoveryState({
        siteId: deps.getPropertyLockRecoverySiteId(),
        baseUrl: deps.getPropertyLockRecoveryBaseUrl(),
        clientId: deps.getPropertyLockRecoveryClientId(),
        deadlineAt: 0
      });
    }
  }

  function startCrossPropertyWarning(recoveryState) {
    if (!deps.ensurePropertyLockCollaborationActive()) {
      return;
    }
    if (!recoveryState || !recoveryState.siteId || !recoveryState.clientId) {
      return;
    }
    deps.setPropertyLockRecoverySiteId(recoveryState.siteId);
    deps.setPropertyLockRecoveryBaseUrl(recoveryState.baseUrl || "");
    deps.setPropertyLockRecoveryClientId(recoveryState.clientId);
    deps.setPropertyLockRecoveryDeadlineAt(
      recoveryState.deadlineAt > Date.now()
        ? recoveryState.deadlineAt
        : Date.now() + deps.PROPERTY_LOCK_CROSS_PROPERTY_COOLDOWN_TIMEOUT_MS
    );
    deps.setPropertyLockBannerMode("editor_cross_property_countdown");
    deps.setPropertyLockBannerCountdownValue(
      Math.max(
        1,
        Math.ceil((deps.getPropertyLockRecoveryDeadlineAt() - Date.now()) / 1000)
      )
    );
    deps.restartPropertyLockBannerCountdown();
    deps.renderPropertyLockBanner();
    persistRecoveryState({
      siteId: deps.getPropertyLockRecoverySiteId(),
      baseUrl: deps.getPropertyLockRecoveryBaseUrl(),
      clientId: deps.getPropertyLockRecoveryClientId(),
      deadlineAt: deps.getPropertyLockRecoveryDeadlineAt()
    });
    deps.armPropertyLockCrossPropertyRelease();
  }

  function startOffCandidateWarning() {
    if (!deps.ensurePropertyLockCollaborationActive()) {
      return;
    }
    if (deps.getPropertyLockOffCandidateDeadlineAt() > Date.now()) {
      return;
    }
    deps.setPropertyLockOffCandidateDeadlineAt(Date.now() + deps.PROPERTY_LOCK_OFF_CANDIDATE_WARNING_TIMEOUT_MS);
    deps.setPropertyLockBannerMode("editor_off_candidate_countdown");
    deps.setPropertyLockBannerCountdownValue(
      Math.max(
        1,
        Math.ceil((deps.getPropertyLockOffCandidateDeadlineAt() - Date.now()) / 1000)
      )
    );
    deps.restartPropertyLockBannerCountdown();
    deps.renderPropertyLockBanner();
    persistOffCandidateDeadline(deps.getPropertyLockOffCandidateDeadlineAt());
    deps.getTimerHost().setTimeout(() => {
      if (
        deps.getPropertyLockOffCandidateDeadlineAt() <= 0 ||
        deps.getPropertyLockOffCandidateDeadlineAt() > Date.now()
      ) {
        return;
      }
      deps.setPropertyLockOffCandidateDeadlineAt(0);
      deps.setPropertyLockBannerCountdownValue(0);
      deps.clearPropertyLockBannerCountdown();
      persistOffCandidateDeadline(0);
      deps.sendPropertyLockMessage(deps.PROPERTY_LOCK_CONTENT_RELEASE);
    }, deps.PROPERTY_LOCK_OFF_CANDIDATE_WARNING_TIMEOUT_MS + 100);
  }

  function applyServerMessage(serverMessage) {
    if (!deps.ensurePropertyLockCollaborationActive()) {
      return;
    }
    const type = typeof serverMessage.type === "string" ? serverMessage.type : "";
    const secondsRemaining = typeof serverMessage.secondsRemaining === "number"
      ? Math.max(0, Math.ceil(serverMessage.secondsRemaining))
      : null;

    if (type === deps.PROPERTY_LOCK_WS_LOCK_STATE) {
      const previousState = deps.getPropertyLockState();
      deps.setPropertyLockState(serverMessage);
      deps.setPropertyLockSuggestionId("");
      deps.setPropertyLockSuggestionFromName("");
      const becameEditor = (!previousState || !previousState.isEditor) && serverMessage.isEditor;
      if (serverMessage.isEditor && deps.getPropertyLockConnectedSiteId()) {
        deps.setPropertyLockRecoverySiteId(deps.getPropertyLockConnectedSiteId());
        deps.setPropertyLockRecoveryBaseUrl(deps.getPropertyLockConnectedBaseUrl() || deps.getBaseUrl() || "");
        deps.setPropertyLockRecoveryClientId(deps.getPropertyLockClientId());
        clearCrossPropertyWarning({ preserveSession: true });
        persistRecoveryState({
          siteId: deps.getPropertyLockRecoverySiteId(),
          baseUrl: deps.getPropertyLockRecoveryBaseUrl(),
          clientId: deps.getPropertyLockRecoveryClientId(),
          deadlineAt: 0
        });
      } else if (!serverMessage.isEditor) {
        clearCrossPropertyWarning();
      }
      if (!serverMessage.isEditor && !serverMessage.isSameUserEditor) {
        deps.clearSilentHighlightEditorRevealKey();
      }
      if (becameEditor) {
        deps.showPageToast(deps.propertyLockText.editorNowToast);
        deps.runEditorSilentHighlightingActivation().catch(() => {
          // Silent activation is best-effort and should not block lock-state updates.
        });
      } else if (serverMessage.isEditor) {
        deps.runEditorSilentHighlightingActivation().catch(() => {
          // Keep editor-role reveal/freeze aligned with navigation and reconnect updates.
        });
      } else if (
        previousState &&
        previousState.isEditor &&
        !serverMessage.isEditor &&
        serverMessage.editorName
      ) {
        deps.showPageToast(deps.propertyLockText.editorTransferredToast(serverMessage.editorName));
      }
      deps.updatePropertyLockBannerMode();
      deps.renderPropertyLockBanner();
      deps.syncPropertyLockOffCandidateWarning(deps.getBaseUrl() || "", deps.getCurrentUrl()).catch(() => {});
      if (!becameEditor) {
        deps.refreshSilentHighlightings().then();
      }
      return;
    }

    if (type === deps.PROPERTY_LOCK_WS_DISCONNECT_WARNING) {
      if (deps.isRenderModeInspectionActive()) {
        deps.setPropertyLockBannerMode("editor_inspection_reconnecting");
        deps.clearPropertyLockBannerCountdown();
        deps.renderPropertyLockBanner();
        return;
      }
      deps.setPropertyLockBannerMode("editor_disconnect_countdown");
      deps.setPropertyLockBannerCountdownValue(secondsRemaining || 0);
      deps.restartPropertyLockBannerCountdown();
      deps.renderPropertyLockBanner();
      return;
    }

    if (type === deps.PROPERTY_LOCK_WS_INACTIVITY_WARNING) {
      clearCrossPropertyWarning({ preserveSession: true });
      clearOffCandidateWarning();
      const defaultInactivityCountdownSeconds = Math.ceil(deps.PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS / 1000);
      deps.setPropertyLockBannerMode("editor_inactivity_warning");
      if (secondsRemaining !== null) {
        deps.setPropertyLockBannerCountdownValue(secondsRemaining);
        deps.restartPropertyLockBannerCountdown();
      } else if (deps.getPropertyLockBannerCountdownValue() <= 0) {
        deps.setPropertyLockBannerCountdownValue(defaultInactivityCountdownSeconds);
        deps.restartPropertyLockBannerCountdown();
      } else if (!deps.getPropertyLockBannerCountdownTimer()) {
        deps.restartPropertyLockBannerCountdown();
      }
      deps.renderPropertyLockBanner();
      return;
    }

    if (type === deps.PROPERTY_LOCK_WS_TAKEOVER_SUGGESTION) {
      deps.setPropertyLockSuggestionId(String(serverMessage.suggestionId || ""));
      deps.setPropertyLockSuggestionFromName(String(serverMessage.fromName || "Someone"));
      deps.setPropertyLockBannerMode(deps.getPropertyLockSuggestionId() ? "editor_takeover_suggestion" : "no_banner");
      deps.renderPropertyLockBanner();
      return;
    }

    if (type === deps.PROPERTY_LOCK_WS_SUGGESTION_PENDING) {
      deps.setPropertyLockSuggestionId(String(serverMessage.suggestionId || ""));
      deps.setPropertyLockBannerMode("passive_suggestion_pending");
      deps.renderPropertyLockBanner();
      return;
    }

    if (type === deps.PROPERTY_LOCK_WS_SUGGESTION_RESPONSE) {
      if (serverMessage.accepted === false) {
        deps.setPropertyLockBannerMode("passive_suggestion_rejected");
        deps.renderPropertyLockBanner();
      }
      return;
    }

    if (type === deps.PROPERTY_LOCK_WS_SUGGESTION_ACCEPTED || type === deps.PROPERTY_LOCK_WS_TRANSFER_COUNTDOWN) {
      clearCrossPropertyWarning();
      clearOffCandidateWarning();
      deps.setPropertyLockBannerMode("editor_transfer_countdown");
      const existingState = deps.getPropertyLockState() || {};
      deps.setPropertyLockState({
        ...existingState,
        transferFromName: String(serverMessage.transferFromName || serverMessage.fromName || existingState.transferFromName || ""),
        transferToName: String(serverMessage.transferToName || serverMessage.toName || existingState.transferToName || deps.getPropertyLockSuggestionFromName() || "")
      });
      deps.setPropertyLockBannerCountdownValue(secondsRemaining || deps.getPropertyLockBannerCountdownValue() || 10);
      deps.restartPropertyLockBannerCountdown();
      deps.renderPropertyLockBanner();
      return;
    }

    if (type === deps.PROPERTY_LOCK_WS_ERROR) {
      deps.showPageToast(String(serverMessage.reason || "Property lock request failed"));
      return;
    }

    if (
      type === deps.PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS &&
      serverMessage.connectionStatus === deps.PROPERTY_LOCK_CONNECTION_UNAVAILABLE &&
      deps.getPropertyLockState() &&
      deps.getPropertyLockState().isEditor
    ) {
      clearCrossPropertyWarning({ preserveSession: true });
      clearOffCandidateWarning();
      if (deps.isRenderModeInspectionActive()) {
        deps.setPropertyLockBannerMode("editor_inspection_reconnecting");
        deps.clearPropertyLockBannerCountdown();
        deps.renderPropertyLockBanner();
        return;
      }
      const defaultDisconnectCountdownSeconds = Math.ceil(deps.PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS / 1000);
      if (deps.getPropertyLockBannerMode() !== "editor_disconnect_countdown" || deps.getPropertyLockBannerCountdownValue() <= 0) {
        deps.setPropertyLockBannerMode("editor_disconnect_countdown");
        deps.setPropertyLockBannerCountdownValue(defaultDisconnectCountdownSeconds);
        deps.restartPropertyLockBannerCountdown();
      } else if (!deps.getPropertyLockBannerCountdownTimer()) {
        deps.restartPropertyLockBannerCountdown();
      }
      deps.renderPropertyLockBanner();
    }
  }

  return {
    applyServerMessage,
    clearCrossPropertyWarning,
    clearOffCandidateWarning,
    normalizeRecoveryTabState,
    persistOffCandidateDeadline,
    persistRecoveryState,
    startCrossPropertyWarning,
    startOffCandidateWarning
  };
}
