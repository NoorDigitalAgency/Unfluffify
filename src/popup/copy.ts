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
  "managed-non-candidate": () => "Managed property · this page is not a Live Page candidate",
  "candidate-removed": () => "This page is no longer a candidate",
  "candidate-feed-conflict": () => "Candidate feed assignments conflict",
  "signed-out": () => "Sign in to use the property lock",
  unavailable: () => "Property lock unavailable",
} satisfies Readonly<Record<LockReason, LockCopyResolver>>;

export function resolvePopupLockCopy(lock: LockBannerVocabulary): string {
  return POPUP_LOCK_COPY[lock.reason](lock);
}

const POPUP_BLOCKED_REASON_COPY: Readonly<Record<string, string>> = {
  boot: "Unfluffify is starting.",
  silent: "Enable marking to make changes.",
  "property-lock": "Editing is unavailable until the property lock is ready.",
  locked: "Another editor currently controls this property.",
  "preview-open": "Exit the Content List before continuing.",
  "no-pending-changes": "There are no pending changes to save or discard.",
  "requires-ai-run": "Run AI again to update the selectors for the latest markings.",
  post_ai: "The current AI result must be saved or discarded before running again.",
  "ai-up-to-date": "The current AI result already matches the markings.",
  inspection: "Page inspection is still in progress.",
  "page-inspection": "Page inspection is still in progress.",
  syncing: "The page and saved configuration are being synchronized.",
  sync_pending: "Synchronization is still finishing.",
  reconciliation: "The page and saved configuration are being reconciled.",
  editor_preparing: "The page is being prepared for editing.",
  "page-recovery-required": "Reload the page to finish recovering the saved session.",
  "render-mode-not-set": "Choose and confirm a render mode first.",
  "not-implemented": "This action is unavailable in the current view.",
  "no-saved-selectors": "No saved selectors are available for this page.",
  "not-ready": "The current page is not ready for editing.",
  "session-blocked": "The current session is temporarily unavailable.",
  "property-authority-unavailable": "The page is still binding to this property. Retry; if it persists, refresh the page.",
  "consent-registration-failed": "Consent protection could not be restored for this page. Refresh the page and retry.",
};

export function resolvePopupBlockedReasonCopy(reason: string): string {
  if (!reason) return "";
  return POPUP_BLOCKED_REASON_COPY[reason] ?? (
    reason.startsWith("save-") || reason.includes("reconcil")
      ? "Save reconciliation is still finishing."
      : "The requested action is temporarily unavailable."
  );
}

const RAW_EXCEPTION_PATTERN = /(?:^|\b)(?:Error|TypeError|ReferenceError|RangeError|SyntaxError):|\bat\s+\S+|Cannot read propert|Receiving end does not exist|message port closed|Extension context invalidated|Failed to fetch|chrome-extension:\/\/|moz-extension:\/\//i;
const INTERNAL_TOKEN_PATTERN = /^[a-z0-9]+(?:[-_.][a-z0-9]+)+$/i;

/** Keeps exception and state vocabulary in diagnostic builds while production
 * receives actionable, non-technical copy. */
export function resolvePopupOperatorDetail(detail: string): string {
  const trimmed = detail.trim();
  if (!trimmed) return "";
  if (POPUP_BLOCKED_REASON_COPY[trimmed] || INTERNAL_TOKEN_PATTERN.test(trimmed)) {
    return resolvePopupBlockedReasonCopy(trimmed);
  }
  if (RAW_EXCEPTION_PATTERN.test(trimmed)) {
    return "The operation could not be completed. Retry; if it persists, reopen the panel.";
  }
  return trimmed;
}
