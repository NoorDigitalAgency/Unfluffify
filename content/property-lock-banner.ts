function createPropertyLockBannerButton(_deps: any, text: string, className: string, onClick: () => void, options: { disabled?: unknown } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.disabled = Boolean(options.disabled);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (button.disabled) {
      return;
    }
    onClick();
  });
  return button;
}

function createPropertyLockBannerLabel(text: string) {
  const label = document.createElement("span");
  label.className = "uf-lock-banner-label";
  label.textContent = text;
  return label;
}

export function ensurePropertyLockBannerStyle(deps: any): void {
  if (document.getElementById(deps.PROPERTY_LOCK_BANNER_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = deps.PROPERTY_LOCK_BANNER_STYLE_ID;
  style.textContent = `
    #${deps.PROPERTY_LOCK_BANNER_ID} {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      padding: 12px 16px;
      background: #fff3cd;
      border-bottom: 1px solid #d39e00;
      font-family: ${deps.EXTENSION_UI_FONT_STACK};
      font-size: 14px;
      color: #4d3900;
      z-index: 2147483645;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.16);
    }
    #${deps.PROPERTY_LOCK_BANNER_ID}.uf-lock-banner-hidden {
      display: none;
    }
    #${deps.PROPERTY_LOCK_BANNER_ID} .uf-lock-banner-content {
      flex: 1;
      min-width: 0;
      font-weight: 600;
      line-height: 1.35;
    }
    #${deps.PROPERTY_LOCK_BANNER_ID} .uf-lock-banner-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    #${deps.PROPERTY_LOCK_BANNER_ID} button {
      padding: 6px 12px;
      background: #f8b400;
      border: 1px solid #bf8500;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      color: #2f2200;
    }
    #${deps.PROPERTY_LOCK_BANNER_ID} button:hover {
      background: #e6a700;
    }
    #${deps.PROPERTY_LOCK_BANNER_ID} button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      background: #f5d886;
    }
    #${deps.PROPERTY_LOCK_BANNER_ID} .uf-lock-banner-label {
      display: inline-flex;
      align-items: center;
      font-size: 12px;
      font-weight: 600;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

export function renderPropertyLockBanner(deps: any): void {
  let propertyLockBannerElement = deps.getPropertyLockBannerElement();
  if (!deps.isPropertyLockCollaborationEnabled()) {
    if (propertyLockBannerElement) {
      propertyLockBannerElement.classList.add("uf-lock-banner-hidden");
      propertyLockBannerElement.replaceChildren();
    }
    deps.setPropertyLockBannerVisible(false);
    deps.clearPropertyLockBannerCountdown();
    return;
  }
  const propertyLockBannerMode = deps.getPropertyLockBannerMode();
  const shouldShow = propertyLockBannerMode !== "no_banner";
  ensurePropertyLockBannerStyle(deps);

  if (!propertyLockBannerElement) {
    propertyLockBannerElement = document.createElement("div");
    propertyLockBannerElement.id = deps.PROPERTY_LOCK_BANNER_ID;
    propertyLockBannerElement.setAttribute("data-uf-extension-ui", "true");
    (document.body || document.documentElement).insertBefore(
      propertyLockBannerElement,
      (document.body || document.documentElement).firstChild
    );
    deps.setPropertyLockBannerElement(propertyLockBannerElement);
  }

  if (!shouldShow) {
    propertyLockBannerElement.classList.add("uf-lock-banner-hidden");
    propertyLockBannerElement.replaceChildren();
    deps.setPropertyLockBannerVisible(false);
    deps.clearPropertyLockBannerCountdown();
    return;
  }

  propertyLockBannerElement.classList.remove("uf-lock-banner-hidden");
  deps.setPropertyLockBannerVisible(true);
  propertyLockBannerElement.replaceChildren();

  const propertyLockState = deps.getPropertyLockState();
  const propertyLockText = deps.propertyLockText;
  const propertyLockBannerCountdownValue = deps.getPropertyLockBannerCountdownValue();
  const editorName = propertyLockState?.editorName || "Someone";
  const sameUserEditor = Boolean(propertyLockState?.isSameUserEditor);
  const otherTabHasUnsavedChanges = Boolean(propertyLockState?.otherTabHasUnsavedChanges);
  const content = document.createElement("div");
  const actions = document.createElement("div");
  content.className = "uf-lock-banner-content";
  actions.className = "uf-lock-banner-actions";

  switch (propertyLockBannerMode) {
    case "passive_locked":
      content.textContent = sameUserEditor
        ? propertyLockText.sameUserLockedMessage
        : propertyLockText.passiveLockedMessage(editorName);
      if (sameUserEditor) {
        if (otherTabHasUnsavedChanges) {
          actions.appendChild(createPropertyLockBannerButton(
            deps,
            propertyLockText.continueEditingHereButton,
            "uf-lock-banner-continue-editing",
            () => {},
            { disabled: true }
          ));
          actions.appendChild(createPropertyLockBannerLabel(propertyLockText.otherTabUnsavedChangesLabel));
          actions.appendChild(createPropertyLockBannerButton(deps, propertyLockText.continueEditingHereAnywayButton, "uf-lock-banner-force-continue", () => {
            deps.sendPropertyLockMessage(deps.PROPERTY_LOCK_CONTENT_CONTINUE, { force: true, discardPrevious: true });
          }));
        } else {
          actions.appendChild(createPropertyLockBannerButton(deps, propertyLockText.continueEditingHereButton, "uf-lock-banner-continue-editing", () => {
            deps.sendPropertyLockMessage(deps.PROPERTY_LOCK_CONTENT_CONTINUE);
          }));
        }
      } else {
        actions.appendChild(createPropertyLockBannerButton(deps, propertyLockText.takeoverSuggestButton, "uf-lock-banner-suggest", () => {
          deps.sendPropertyLockMessage(deps.PROPERTY_LOCK_CONTENT_SUGGEST);
        }));
      }
      break;
    case "passive_expiry_countdown":
      content.textContent = sameUserEditor
        ? propertyLockText.sameUserLockedMessage
        : propertyLockText.passiveExpiryCountdownMessage(editorName, propertyLockBannerCountdownValue);
      if (sameUserEditor) {
        actions.appendChild(createPropertyLockBannerButton(
          deps,
          otherTabHasUnsavedChanges
            ? propertyLockText.continueEditingHereAnywayButton
            : propertyLockText.continueEditingHereButton,
          "uf-lock-banner-continue-editing",
          () => {
            deps.sendPropertyLockMessage(deps.PROPERTY_LOCK_CONTENT_CONTINUE, {
              force: otherTabHasUnsavedChanges,
              discardPrevious: otherTabHasUnsavedChanges
            });
          }
        ));
      } else {
        actions.appendChild(createPropertyLockBannerButton(deps, propertyLockText.takeoverSuggestButton, "uf-lock-banner-suggest", () => {
          deps.sendPropertyLockMessage(deps.PROPERTY_LOCK_CONTENT_SUGGEST);
        }));
      }
      break;
    case "passive_suggestion_pending":
      content.textContent = propertyLockText.passiveSuggestionPendingMessage(editorName);
      break;
    case "passive_suggestion_rejected":
      content.textContent = propertyLockText.passiveSuggestionRejectedMessage(editorName);
      actions.appendChild(createPropertyLockBannerButton(deps, propertyLockText.okButton, "uf-lock-banner-ok", () => {
        deps.updatePropertyLockBannerMode();
        deps.renderPropertyLockBanner();
      }));
      break;
    case "takeover_available": {
      content.textContent = propertyLockState?.isRecentEditor
        ? propertyLockText.recentEditorInactiveMessage
        : propertyLockText.takeoverAvailableMessage;
      const label = propertyLockState?.isRecentEditor
        ? propertyLockText.continueEditingButton
        : propertyLockText.takeoverButton;
      actions.appendChild(createPropertyLockBannerButton(deps, label, "uf-lock-banner-takeover", () => {
        deps.sendPropertyLockMessage(deps.PROPERTY_LOCK_CONTENT_TAKE_LOCK);
      }));
      break;
    }
    case "editor_disconnect_countdown":
      content.textContent = propertyLockText.editorDisconnectCountdownMessage(propertyLockBannerCountdownValue);
      break;
    case "editor_inspection_reconnecting":
      content.textContent = propertyLockText.editorInspectionReconnectingMessage;
      break;
    case "editor_inactivity_warning":
      content.textContent = propertyLockText.editorInactivityWarningMessage(propertyLockBannerCountdownValue);
      actions.appendChild(createPropertyLockBannerButton(deps, propertyLockText.continueEditingButton, "uf-lock-banner-continue-editing", () => {
        deps.sendPropertyLockMessage(deps.PROPERTY_LOCK_CONTENT_CONTINUE);
      }));
      break;
    case "editor_cross_property_countdown":
      content.textContent = propertyLockText.editorCrossPropertyCountdownMessage(propertyLockBannerCountdownValue);
      break;
    case "editor_off_candidate_countdown":
      content.textContent = propertyLockText.editorOffCandidateCountdownMessage(propertyLockBannerCountdownValue);
      break;
    case "editor_takeover_suggestion":
      content.textContent = propertyLockText.takeoverSuggestionMessage(deps.getPropertyLockSuggestionFromName() || "Someone");
      actions.appendChild(createPropertyLockBannerButton(deps, propertyLockText.acceptButton, "uf-lock-banner-accept", () => {
        deps.respondToPropertyLockTakeoverSuggestion(true).then();
      }));
      actions.appendChild(createPropertyLockBannerButton(deps, propertyLockText.rejectButton, "uf-lock-banner-reject", () => {
        deps.respondToPropertyLockTakeoverSuggestion(false).then();
      }));
      break;
    case "editor_transfer_countdown":
      content.textContent = propertyLockText.editorTransferCountdownMessage(
        propertyLockState?.transferFromName || deps.getPropertyLockSuggestionFromName() || editorName,
        propertyLockState?.transferToName || deps.getPropertyLockSuggestionFromName() || "the next editor",
        propertyLockBannerCountdownValue
      );
      break;
  }

  propertyLockBannerElement.append(content, actions);
}

export function clearPropertyLockBannerCountdown(deps: any): void {
  const propertyLockBannerCountdownTimer = deps.getPropertyLockBannerCountdownTimer();
  if (propertyLockBannerCountdownTimer) {
    clearInterval(propertyLockBannerCountdownTimer);
    deps.setPropertyLockBannerCountdownTimer(0);
  }
}

export function restartPropertyLockBannerCountdown(deps: any): void {
  if (!deps.isPropertyLockCollaborationEnabled()) {
    deps.clearPropertyLockBannerCountdown();
    return;
  }
  deps.clearPropertyLockBannerCountdown();
  if (deps.getPropertyLockBannerCountdownValue() <= 0) {
    return;
  }
  deps.setPropertyLockBannerCountdownTimer(setInterval(() => {
    deps.setPropertyLockBannerCountdownValue(Math.max(0, deps.getPropertyLockBannerCountdownValue() - 1));
    deps.renderPropertyLockBanner();
    if (deps.getPropertyLockBannerCountdownValue() <= 0) {
      deps.clearPropertyLockBannerCountdown();
    }
  }, 1000));
}