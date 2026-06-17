// @ts-nocheck
export function updatePropertyLockBannerMode(deps) {
  if (!deps.isPropertyLockCollaborationEnabled()) {
    deps.setPropertyLockBannerMode("no_banner");
    deps.clearPropertyLockBannerCountdown();
    return;
  }

  const previousBannerMode = deps.getPropertyLockBannerMode();
  if (deps.getPropertyLockRecoveryDeadlineAt() > Date.now()) {
    deps.setPropertyLockBannerMode("editor_cross_property_countdown");
    deps.setPropertyLockBannerCountdownValue(
      Math.max(
        1,
        Math.ceil((deps.getPropertyLockRecoveryDeadlineAt() - Date.now()) / 1000)
      )
    );
    deps.restartPropertyLockBannerCountdown();
    return;
  }

  const propertyLockState = deps.getPropertyLockState();
  if (!propertyLockState) {
    deps.setPropertyLockBannerMode("no_banner");
    deps.clearPropertyLockBannerCountdown();
    return;
  }

  const { state: lockState, isEditor, secondsRemaining } = propertyLockState;
  deps.clearPropertyLockBannerCountdown();

  if (lockState === deps.PROPERTY_LOCK_STATE_UNLOCKED) {
    deps.setPropertyLockBannerMode("no_banner");
    return;
  }

  if (lockState === deps.PROPERTY_LOCK_STATE_TAKEOVER_AVAILABLE) {
    deps.setPropertyLockBannerMode("takeover_available");
    return;
  }

  if (lockState === deps.PROPERTY_LOCK_STATE_TRANSFER) {
    deps.clearPropertyLockCrossPropertyWarning();
    deps.clearPropertyLockOffCandidateWarning();
    deps.setPropertyLockBannerMode("editor_transfer_countdown");
    deps.setPropertyLockBannerCountdownValue(secondsRemaining || 10);
    deps.restartPropertyLockBannerCountdown();
    return;
  }

  if (isEditor && lockState === deps.PROPERTY_LOCK_STATE_EXPIRY_WARNING) {
    deps.clearPropertyLockCrossPropertyWarning({ preserveSession: true });
    deps.clearPropertyLockOffCandidateWarning();
    const defaultInactivityCountdownSeconds = Math.ceil(deps.PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS / 1000);
    deps.setPropertyLockBannerMode("editor_inactivity_warning");
    if (secondsRemaining !== null && secondsRemaining > 0) {
      deps.setPropertyLockBannerCountdownValue(secondsRemaining);
    } else if (
      previousBannerMode !== "editor_inactivity_warning" ||
      deps.getPropertyLockBannerCountdownValue() <= 0
    ) {
      deps.setPropertyLockBannerCountdownValue(defaultInactivityCountdownSeconds);
    }
    deps.restartPropertyLockBannerCountdown();
    return;
  }

  if (!isEditor && lockState === deps.PROPERTY_LOCK_STATE_EXPIRY_WARNING) {
    deps.clearPropertyLockCrossPropertyWarning();
    deps.clearPropertyLockOffCandidateWarning();
    deps.setPropertyLockBannerMode("passive_expiry_countdown");
    deps.setPropertyLockBannerCountdownValue(secondsRemaining || 60);
    deps.restartPropertyLockBannerCountdown();
    return;
  }

  if (isEditor && deps.getPropertyLockOffCandidateDeadlineAt() > Date.now()) {
    deps.setPropertyLockBannerMode("editor_off_candidate_countdown");
    deps.setPropertyLockBannerCountdownValue(
      Math.max(
        1,
        Math.ceil((deps.getPropertyLockOffCandidateDeadlineAt() - Date.now()) / 1000)
      )
    );
    deps.restartPropertyLockBannerCountdown();
    return;
  }

  deps.setPropertyLockBannerMode(
    isEditor || lockState !== deps.PROPERTY_LOCK_STATE_LOCKED
      ? "no_banner"
      : "passive_locked"
  );
}
