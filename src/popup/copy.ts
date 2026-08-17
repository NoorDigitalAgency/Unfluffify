import type { LockBannerVocabulary, LockReason } from "../domain/schema/facts";

type LockCopyResolver = (lock: LockBannerVocabulary) => string;

const POPUP_LOCK_COPY = {
  "extension-context-invalidated": () => "Extension context invalidated",
  connecting: () => "Property lock connecting",
  transfer: (lock) => lock.fromName && lock.toName
    ? `Editing is being transferred from ${lock.fromName} to ${lock.toName}`
    : lock.toName
      ? `Editing is being transferred to ${lock.toName}`
      : "Editing is being transferred",
  "disconnect-warning": () => "Connection lost; editor role may be released",
  "inactivity-warning": () => "No recent page interaction; editor role may be released",
  "off-candidate": () => "Return to a Live Page candidate to keep the editor role",
  "cross-property": () => "Return to the previous property to keep the editor role",
  "takeover-suggested": (lock) => lock.fromName
    ? `${lock.fromName} wants to take over editing`
    : "Another editor wants to take over editing",
  editor: () => "",
  locked: (lock) => lock.editorName ? `Locked by ${lock.editorName}` : "Property locked",
  "not-configured": () => "Property lock not configured",
  "not-candidate": () => "Not a managed property",
  "candidate-removed": () => "This page is no longer a candidate",
  "candidate-feed-conflict": () => "Candidate feed assignments conflict",
  "signed-out": () => "Sign in to use the property lock",
  unavailable: () => "Property lock unavailable",
} satisfies Readonly<Record<LockReason, LockCopyResolver>>;

export function resolvePopupLockCopy(lock: LockBannerVocabulary): string {
  return POPUP_LOCK_COPY[lock.reason](lock);
}
