import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { deriveMarkMode } from "../src/content/core.js";

const ACTIVE = {
  enabled: true,
  hasOverlay: true,
  temporarilyDisabled: false,
  passThrough: false,
  altActive: false
};

test("deriveMarkMode: the default active state is exclude", () => {
  assert.equal(deriveMarkMode({ ...ACTIVE }), "exclude");
});

test("deriveMarkMode: Alt active yields include", () => {
  assert.equal(deriveMarkMode({ ...ACTIVE, altActive: true }), "include");
});

test("deriveMarkMode: Space passthrough yields passthrough", () => {
  assert.equal(deriveMarkMode({ ...ACTIVE, passThrough: true }), "passthrough");
});

test("deriveMarkMode: passthrough outranks include (Space wins over Alt)", () => {
  assert.equal(
    deriveMarkMode({ ...ACTIVE, passThrough: true, altActive: true }),
    "passthrough"
  );
});

test("deriveMarkMode: disabled outranks every other signal", () => {
  // OFF: not enabled / no overlay. BUSY_LOCKED: temporarilyDisabled.
  for (const disable of [
    { enabled: false },
    { hasOverlay: false },
    { temporarilyDisabled: true }
  ]) {
    assert.equal(
      deriveMarkMode({ ...ACTIVE, passThrough: true, altActive: true, ...disable }),
      "disabled",
      `expected disabled for ${JSON.stringify(disable)}`
    );
  }
});

test("deriveMarkMode: full precedence order is disabled > passthrough > include > exclude", () => {
  // Enumerate the mode-relevant signal space and assert the fixed precedence.
  const expectFor = (i: {
    enabled: boolean;
    hasOverlay: boolean;
    temporarilyDisabled: boolean;
    passThrough: boolean;
    altActive: boolean;
  }) => {
    if (!i.enabled || !i.hasOverlay || i.temporarilyDisabled) {
      return "disabled";
    }
    if (i.passThrough) {
      return "passthrough";
    }
    if (i.altActive) {
      return "include";
    }
    return "exclude";
  };
  for (let bits = 0; bits < 32; bits += 1) {
    const inputs = {
      enabled: Boolean(bits & 1),
      hasOverlay: Boolean(bits & 2),
      temporarilyDisabled: Boolean(bits & 4),
      passThrough: Boolean(bits & 8),
      altActive: Boolean(bits & 16)
    };
    assert.equal(
      deriveMarkMode(inputs),
      expectFor(inputs),
      `mismatch for ${JSON.stringify(inputs)}`
    );
  }
});
