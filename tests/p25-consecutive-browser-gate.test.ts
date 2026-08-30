import { describe, expect, it } from "vitest";

import packageJson from "../package.json";
import {
  CONSECUTIVE_ARTIFACT_SCHEMA_VERSION,
  REQUIRED_CONSECUTIVE_PASSES,
  validateConsecutiveP25Runs,
} from "../scripts/performance/p25/consecutive-contract.mjs";

function passingRun(ordinal: number) {
  return {
    ordinal,
    exitCode: 0,
    processReaped: true,
    artifactPath: `/repo/output/playwright/p25-parity/acceptance-${ordinal}.json`,
    artifact: {
      schemaVersion: "p25-parity-browser-gate/v2",
      mode: "acceptance",
      pass: true,
      source: {
        accepted: true,
        stable: true,
        preflight: { headCommit: "a".repeat(40), cleanSourceSet: true },
      },
      warmup: { artifact: { validated: true } },
      validation: { pass: true },
    },
  };
}

describe("P25 consecutive acceptance contract", () => {
  it("requires exactly three sequential clean passes at one HEAD", () => {
    expect(CONSECUTIVE_ARTIFACT_SCHEMA_VERSION).toBe("p25-consecutive-browser-gate/v1");
    expect(REQUIRED_CONSECUTIVE_PASSES).toBe(3);
    expect(packageJson.scripts["performance:p25:consecutive"]).toBe(
      "node ./scripts/performance/p25-consecutive-browser-gate.mjs",
    );
    const runs = [passingRun(1), passingRun(2), passingRun(3)];
    expect(validateConsecutiveP25Runs(runs)).toMatchObject({ pass: true });
    expect(validateConsecutiveP25Runs(runs.slice(0, 2))).toMatchObject({
      pass: false,
      checks: { complete: false },
    });
  });

  it("rejects a dirty, repeated-artifact, failed, or changed-HEAD sequence", () => {
    const dirty = [passingRun(1), passingRun(2), passingRun(3)];
    dirty[1].artifact.source.preflight.cleanSourceSet = false;
    expect(validateConsecutiveP25Runs(dirty).pass).toBe(false);

    const repeated = [passingRun(1), passingRun(2), passingRun(3)];
    repeated[2].artifactPath = repeated[1].artifactPath;
    expect(validateConsecutiveP25Runs(repeated).pass).toBe(false);

    const failed = [passingRun(1), passingRun(2), passingRun(3)];
    failed[2].artifact.pass = false;
    expect(validateConsecutiveP25Runs(failed).pass).toBe(false);

    const changedHead = [passingRun(1), passingRun(2), passingRun(3)];
    changedHead[2].artifact.source.preflight.headCommit = "b".repeat(40);
    expect(validateConsecutiveP25Runs(changedHead).pass).toBe(false);
  });
});
