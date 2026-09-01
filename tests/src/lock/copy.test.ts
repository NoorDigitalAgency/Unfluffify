import { describe, expect, it } from "vitest";

import { resolveContentLockCopy } from "../../../src/content/copy";
import {
  LockBannerVocabularySchema,
  type LockBannerVocabulary,
} from "../../../src/domain/schema/facts";
import {
  resolvePopupBlockedReasonCopy,
  resolvePopupLockCopy,
  resolvePopupOperatorDetail,
} from "../../../src/popup/copy";

describe("per-layer property-lock copy", () => {
  it("keeps composed copy out of the shared realm vocabulary", () => {
    const vocabulary = {
      visible: true,
      reason: "transfer" as const,
      fromName: "A",
      toName: "B",
      countdownSeconds: 12,
    };

    expect(vocabulary).not.toHaveProperty("text");
    expect(LockBannerVocabularySchema.parse(vocabulary)).toEqual(vocabulary);
    expect(LockBannerVocabularySchema.safeParse({ ...vocabulary, text: "remote copy" }).success).toBe(false);
  });

  it("lets popup and content independently resolve structural lock context", () => {
    const vocabulary = {
      visible: true,
      reason: "transfer" as const,
      fromName: "A",
      toName: "B",
      countdownSeconds: 12,
    };

    expect(resolvePopupLockCopy(vocabulary)).toBe("Editing is being transferred from A to B");
    expect(resolveContentLockCopy(vocabulary)).toBe("Editing is being transferred from A to B (12s).");
  });

  it("resolves countdown and ownership states with the in-page lock grammar", () => {
    expect(resolveContentLockCopy({
      visible: true,
      reason: "locked",
      editorName: "Dana",
    })).toBe("Dana is currently editing this property");
    expect(resolveContentLockCopy({
      visible: true,
      reason: "locked",
      editorName: "Dana",
      countdownSeconds: 42,
    })).toBe("This property will be released for editing in 42s");
    expect(resolveContentLockCopy({
      visible: true,
      reason: "disconnect-warning",
      countdownSeconds: 70,
    })).toBe("Connection lost. You will lose the editor role in 70s unless the connection recovers.");
    expect(resolveContentLockCopy({
      visible: true,
      reason: "takeover-suggested",
      fromName: "Kai",
    })).toBe("Kai would like to edit this property");
  });

  it("has local copy for every lock banner reason", () => {
    const cases: ReadonlyArray<readonly [LockBannerVocabulary, string]> = [
      [{ visible: true, reason: "extension-context-invalidated" }, "Extension context invalidated. Reload this page to restore editing."],
      [{ visible: true, reason: "connecting" }, "Checking edit lock..."],
      [{ visible: true, reason: "transfer", toName: "Dana" }, "Editing is being transferred to Dana."],
      [{ visible: true, reason: "disconnect-warning" }, "Connection lost. Editing is temporarily paused while the property lock reconnects."],
      [{ visible: true, reason: "takeover-suggested" }, "Someone would like to edit this property"],
      [{ visible: true, reason: "editor" }, "You are editing this property"],
      [{ visible: true, reason: "locked" }, "This property is currently being edited"],
      [{ visible: true, reason: "not-configured" }, "Property lock not configured"],
      [{ visible: true, reason: "not-candidate" }, "Not a managed property"],
      [{ visible: true, reason: "managed-non-candidate" }, "This is a managed property, but this page is not a current Live Page candidate"],
      [{ visible: true, reason: "candidate-removed" }, "This page is no longer a candidate"],
      [{ visible: true, reason: "candidate-feed-conflict" }, "Candidate feed assignments conflict"],
      [{ visible: true, reason: "signed-out" }, "Sign in to use the property lock"],
      [{ visible: true, reason: "unavailable" }, "Property lock unavailable"],
    ];

    for (const [vocabulary, expected] of cases) {
      expect(resolveContentLockCopy(vocabulary)).toBe(expected);
    }
    expect(resolvePopupLockCopy({ visible: true, reason: "managed-non-candidate" }))
      .toBe("Managed property · this page is not a Live Page candidate");
  });

  it("keeps production-facing status and exception copy free of internal tokens", () => {
    expect(resolvePopupBlockedReasonCopy("requires-ai-run"))
      .toBe("Run AI again to update the selectors for the latest markings.");
    expect(resolvePopupBlockedReasonCopy("save-authority-changed"))
      .toBe("Save reconciliation is still finishing.");
    expect(resolvePopupOperatorDetail("property-authority-unavailable"))
      .toBe("The page is still binding to this property. Retry; if it persists, refresh the page.");
    expect(resolvePopupOperatorDetail("consent-registration-failed"))
      .toBe("Consent protection could not be restored for this page. Refresh the page and retry.");
    expect(resolvePopupOperatorDetail("page-visit-stabilization-page-world-acquire-timeout"))
      .toBe("Page preparation timed out while connecting to this document. Retry; if it persists, refresh the page.");
    expect(resolvePopupOperatorDetail("page-visit-stabilization-page-world-acquire-stale"))
      .toBe("The document changed during page preparation. Retry on the current page.");
    expect(resolvePopupOperatorDetail("page-visit-stabilization-page-world-acquire-unavailable"))
      .toBe("Page preparation could not connect to this document. Refresh the page and retry.");
    expect(resolvePopupOperatorDetail("page-visit-stabilization-page-world-acquire-failed"))
      .toBe("Page preparation could not connect to this document. Refresh the page and retry.");
    expect(resolvePopupOperatorDetail("page-visit-stabilization-page-world-command-timeout"))
      .toBe("Page preparation did not finish in time. Retry; if it persists, refresh the page.");
    expect(resolvePopupOperatorDetail("page-visit-stabilization-page-world-command-failed"))
      .toBe("Page preparation could not finish safely. Refresh the page and retry.");
    expect(resolvePopupBlockedReasonCopy("unknown_internal_state"))
      .toBe("The requested action is temporarily unavailable.");
    expect(resolvePopupOperatorDetail("TypeError: Cannot read properties of undefined\n at run (main.ts:4:2)"))
      .toBe("The operation could not be completed. Retry; if it persists, reopen the panel.");
    expect(resolvePopupOperatorDetail("requires-ai-run"))
      .toBe("Run AI again to update the selectors for the latest markings.");
    expect(resolvePopupOperatorDetail("The page changed; run AI again."))
      .toBe("The page changed; run AI again.");
  });
});
