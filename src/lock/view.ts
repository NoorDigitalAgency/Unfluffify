import type { PropertyLockState } from "./reducer";
import type { LockAction, LockReason } from "../domain/schema/facts";

export type PropertyLockView = Readonly<{
  bannerVisible: boolean;
  reason: LockReason;
  canEdit: boolean;
  countdownSeconds?: number;
  editorName?: string;
  fromName?: string;
  toName?: string;
  actions?: readonly LockAction[];
}>;

export function projectPropertyLockView(state: PropertyLockState): PropertyLockView {
  if (state.terminal) {
    return { bannerVisible: true, reason: "extension-context-invalidated", canEdit: false };
  }
  if (state.connectivity === "unavailable") {
    return { bannerVisible: true, reason: "unavailable", canEdit: false };
  }
  if (state.connectivity === "reconnecting") {
    return {
      bannerVisible: true,
      reason: "disconnect-warning",
      canEdit: false,
      countdownSeconds: state.timings.secondsRemaining,
    };
  }
  if (state.state === "unlocked" && state.role === "unknown") {
    return { bannerVisible: true, reason: "connecting", canEdit: false };
  }
  if (state.state === "transfer" && state.transfer) {
    return {
      bannerVisible: true,
      reason: "transfer",
      canEdit: false,
      countdownSeconds: state.timings.secondsRemaining,
      fromName: state.transfer.fromName,
      toName: state.transfer.toName,
    };
  }
  if (state.state === "disconnect_warning") {
    return {
      bannerVisible: true,
      reason: "disconnect-warning",
      canEdit: false,
      countdownSeconds: state.timings.secondsRemaining,
    };
  }
  if (state.takeoverSuggestion) {
    return {
      bannerVisible: true,
      reason: "takeover-suggested",
      canEdit: false,
      countdownSeconds: state.timings.secondsRemaining,
      fromName: state.takeoverSuggestion.fromName,
      actions: [
        {
          kind: "accept-takeover",
          suggestionId: state.takeoverSuggestion.suggestionId,
          confirmDiscard: true,
        },
        { kind: "reject-takeover", suggestionId: state.takeoverSuggestion.suggestionId },
      ],
    };
  }
  if (state.state === "expiry_warning") {
    if (state.role === "editor") {
      return {
        bannerVisible: true,
        reason: "inactivity-warning",
        canEdit: false,
        countdownSeconds: state.timings.secondsRemaining,
      };
    }
    return {
      bannerVisible: true,
      reason: "locked",
      canEdit: false,
      countdownSeconds: state.timings.secondsRemaining,
      ...(state.editorName ? { editorName: state.editorName } : {}),
    };
  }
  if (state.role === "editor") {
    return { bannerVisible: false, reason: "editor", canEdit: true };
  }
  if (state.canContinueHere) {
    return {
      bannerVisible: true,
      reason: "locked",
      canEdit: false,
      ...(state.editorName ? { editorName: state.editorName } : {}),
      actions: [{
        kind: "continue-here",
        // A missing/stale Hub status is conservative. Only an explicit fresh
        // false permits a transfer without the discard warning.
        ...(state.otherTabHasUnsavedWork === false ? {} : { confirmDiscard: true }),
      }],
    };
  }
  return {
    bannerVisible: true,
    reason: "locked",
    canEdit: false,
    countdownSeconds: state.timings.secondsRemaining,
    ...(state.editorName ? { editorName: state.editorName } : {}),
    actions: state.state === "takeover_available"
      ? [{ kind: "take-over" }]
      : state.suggestionPending ? undefined : [{ kind: "suggest-takeover" }],
  };
}
