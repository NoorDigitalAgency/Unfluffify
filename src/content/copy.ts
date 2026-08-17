import type { LockBannerVocabulary, LockReason } from "../domain/schema/facts";

type LockCopyResolver = (lock: LockBannerVocabulary) => string;

const CONTENT_LOCK_COPY = {
  "extension-context-invalidated": () => "Extension context invalidated",
  connecting: () => "Property lock connecting",
  transfer: (lock) => lock.fromName && lock.toName
    ? `Editing is being transferred from ${lock.fromName} to ${lock.toName}`
    : lock.toName
      ? `Editing is being transferred to ${lock.toName}`
      : "Editing is being transferred",
  "disconnect-warning": () => "Connection lost; editor role may be released",
  "takeover-suggested": (lock) => lock.fromName
    ? `${lock.fromName} wants to take over editing`
    : "Another editor wants to take over editing",
  editor: () => "",
  locked: (lock) => lock.editorName ? `Locked by ${lock.editorName}` : "Property locked",
  "not-configured": () => "Property lock not configured",
  "not-candidate": () => "Not a managed property",
  "signed-out": () => "Sign in to use the property lock",
  unavailable: () => "Property lock unavailable",
} satisfies Readonly<Record<LockReason, LockCopyResolver>>;

export function resolveContentLockCopy(lock: LockBannerVocabulary): string {
  return CONTENT_LOCK_COPY[lock.reason](lock);
}
