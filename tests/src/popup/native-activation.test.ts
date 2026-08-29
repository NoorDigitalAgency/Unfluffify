import { describe, expect, it, vi } from "vitest";

import { bindNativeClickActivation } from "../../../src/popup/native-activation";

describe("native popup activation", () => {
  it("delivers one target-owned action for each pointer or keyboard click", () => {
    const target = new EventTarget();
    const activate = vi.fn();
    const dispose = bindNativeClickActivation(target, activate);

    target.dispatchEvent(new Event("click"));
    target.dispatchEvent(new Event("click"));

    expect(activate).toHaveBeenCalledTimes(2);
    dispose();
    target.dispatchEvent(new Event("click"));
    expect(activate).toHaveBeenCalledTimes(2);
  });
});
