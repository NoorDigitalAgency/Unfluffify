import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ACCEPTANCE_IDS,
  ARTIFACT_SCHEMA_VERSION,
  FOCUSED_AUTHORITIES,
  LOCK_CASES,
  PLAYWRIGHT_CLI_VERSION,
  REQUIRED_CHECK_IDS,
  REQUIRED_PRODUCTION_SEAMS,
  SPACE_WATCHDOG_MS,
  VIEWPORT,
  validateCheckCatalog,
} from "../scripts/performance/p20/contract.mjs";

describe("P20 integrated browser gate contract", () => {
  it("pins both acceptance identities and the exact browser catalog", () => {
    expect(ACCEPTANCE_IDS).toEqual([
      "ACCEPT-P20-SPACE-RECOVERY",
      "ACCEPT-P20-LOCK-COPY",
    ]);
    expect(ARTIFACT_SCHEMA_VERSION).toBe("p20-integrated-browser-gate/v1");
    expect(PLAYWRIGHT_CLI_VERSION).toBe("0.1.17");
    expect(VIEWPORT).toEqual({ width: 1280, height: 900 });
    expect(SPACE_WATCHDOG_MS).toBe(1_200);
    expect(REQUIRED_CHECK_IDS).toEqual([
      "space-passthrough-recovers-on-every-boundary",
      "production-lock-copy-is-curated",
      "debug-lock-fence-and-operation-are-retained",
      "no-browser-errors",
    ]);
    expect(new Set(REQUIRED_CHECK_IDS).size).toBe(REQUIRED_CHECK_IDS.length);
  });

  it("pins every canonical lock reason with an independent expected sentence", () => {
    expect(LOCK_CASES.map((entry) => entry.id)).toEqual([
      "extension-context-invalidated",
      "connecting",
      "transfer",
      "disconnect-warning",
      "inactivity-warning",
      "off-candidate",
      "cross-property",
      "takeover-suggested",
      "editor",
      "locked",
      "not-configured",
      "not-candidate",
      "candidate-removed",
      "candidate-feed-conflict",
      "signed-out",
      "unavailable",
    ]);
    expect(new Set(LOCK_CASES.map((entry) => entry.expected)).size).toBe(LOCK_CASES.length);
    expect(LOCK_CASES.find((entry) => entry.id === "editor")?.expected).toBe("You hold the editor lock");
    expect(LOCK_CASES.find((entry) => entry.id === "locked")?.expected).toBe("Locked by Dana");
  });

  it("pins production seams and supporting focused authorities", () => {
    expect(REQUIRED_PRODUCTION_SEAMS).toEqual([
      "src/entrypoints/content-loader.content.ts::default.main",
      "src/entrypoints/content-loader.content.ts::setSpacePassthrough",
      "src/popup/App.tsx::App",
      "src/popup/organ/machine.ts::transitionPopupState",
      "src/popup/copy.ts::resolvePopupLockCopy",
    ]);
    expect(FOCUSED_AUTHORITIES).toEqual({
      keyboardRecovery: "tests/c4-content-entrypoint.test.ts",
      lockVocabulary: "tests/src/lock/copy.test.ts",
      productionStripping: "tests/build-artifact-parity.test.ts",
    });
  });

  it("rejects missing, duplicate, unexpected, or failing evidence", () => {
    const passing = REQUIRED_CHECK_IDS.map((id) => ({ id, pass: true }));
    expect(validateCheckCatalog(passing)).toEqual({ pass: true, missing: [], duplicates: [], unexpected: [] });
    expect(validateCheckCatalog(passing.slice(1))).toMatchObject({ pass: false, missing: [REQUIRED_CHECK_IDS[0]] });
    expect(validateCheckCatalog([...passing, passing[0]!])).toMatchObject({ pass: false, duplicates: [REQUIRED_CHECK_IDS[0]] });
    expect(validateCheckCatalog([...passing, { id: "unexpected", pass: true }])).toMatchObject({ pass: false, unexpected: ["unexpected"] });
    expect(validateCheckCatalog(passing.map((entry, index) => ({ ...entry, pass: index !== 1 }))).pass).toBe(false);
  });

  it("polls asynchronous content authority outside the browser predicate", () => {
    const controller = readFileSync(new URL("../scripts/performance/p20/playwright-controller.js", import.meta.url), "utf8");
    expect(controller).toContain("waitForContentSnapshot");
    expect(controller).not.toContain("waitForFunction(async");
  });
});
