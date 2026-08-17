import type { LockBannerVocabulary, LockReason } from "../domain/schema/facts";

type LockCopyResolver = (lock: LockBannerVocabulary) => string;

function remainingSeconds(lock: LockBannerVocabulary): number | null {
  return typeof lock.countdownSeconds === "number" && lock.countdownSeconds > 0
    ? lock.countdownSeconds
    : null;
}

const CONTENT_LOCK_COPY = {
  "extension-context-invalidated": () => "Extension context invalidated. Reload this page to restore editing.",
  connecting: () => "Checking edit lock...",
  transfer: (lock) => {
    const countdown = remainingSeconds(lock);
    const suffix = countdown === null ? "." : ` (${countdown}s).`;
    if (lock.fromName && lock.toName) {
      return `Editing is being transferred from ${lock.fromName} to ${lock.toName}${suffix}`;
    }
    if (lock.toName) {
      return `Editing is being transferred to ${lock.toName}${suffix}`;
    }
    return `Editing is being transferred${suffix}`;
  },
  "disconnect-warning": (lock) => {
    const countdown = remainingSeconds(lock);
    return countdown === null
      ? "Connection lost. Editing is temporarily paused while the property lock reconnects."
      : `Connection lost. You will lose the editor role in ${countdown}s unless the connection recovers.`;
  },
  "inactivity-warning": (lock) => {
    const countdown = remainingSeconds(lock);
    return countdown === null
      ? "No recent page interaction. Editing is temporarily paused."
      : `No recent page interaction. You will lose the editor role in ${countdown}s unless you continue editing.`;
  },
  "off-candidate": (lock) => {
    const countdown = remainingSeconds(lock) ?? 0;
    return `This page is not a current Live Page candidate. Return to a candidate page within ${countdown}s or you will lose the editor role.`;
  },
  "cross-property": (lock) => {
    const countdown = remainingSeconds(lock) ?? 0;
    return `You left the previous property. Return to it within ${countdown}s or you will lose the editor role.`;
  },
  "takeover-suggested": (lock) => lock.fromName
    ? `${lock.fromName} would like to edit this property`
    : "Someone would like to edit this property",
  editor: () => "You are editing this property",
  locked: (lock) => {
    const countdown = remainingSeconds(lock);
    if (countdown !== null) {
      return `This property will be released for editing in ${countdown}s`;
    }
    return lock.editorName
      ? `${lock.editorName} is currently editing this property`
      : "This property is currently being edited";
  },
  "not-configured": () => "Property lock not configured",
  "not-candidate": () => "Not a managed property",
  "candidate-removed": () => "This page is no longer a candidate",
  "candidate-feed-conflict": () => "Candidate feed assignments conflict",
  "signed-out": () => "Sign in to use the property lock",
  unavailable: () => "Property lock unavailable",
} satisfies Readonly<Record<LockReason, LockCopyResolver>>;

export function resolveContentLockCopy(lock: LockBannerVocabulary): string {
  return CONTENT_LOCK_COPY[lock.reason](lock);
}
