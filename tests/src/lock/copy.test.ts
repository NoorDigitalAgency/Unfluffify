import { describe, expect, it } from "vitest";

import { resolveContentLockCopy } from "../../../src/content/copy";
import { LockBannerVocabularySchema } from "../../../src/domain/schema/facts";
import { resolvePopupLockCopy } from "../../../src/popup/copy";

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
    expect(resolveContentLockCopy(vocabulary)).toBe("Editing is being transferred from A to B");
  });
});
