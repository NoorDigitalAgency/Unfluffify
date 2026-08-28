export const PARITY_ARTIFACT_ROOTS = Object.freeze([
  "output/playwright/p14-marking-performance/",
  "output/playwright/p15-frozen-shield/",
  "output/playwright/p16-render-inspection/",
  "output/playwright/p17-preview/",
  "output/playwright/p18-transient-toast/",
  "output/playwright/p20-integrated/",
  "output/playwright/p23-frozen-presentation/",
  "output/playwright/p25-parity/",
]);

function statusPaths(line) {
  const payload = line.slice(3).trim();
  return payload.split(" -> ").map((path) => path.replace(/^"|"$/g, "").replaceAll("\\", "/"));
}

export function isParityArtifactPath(path) {
  const normalized = String(path).replaceAll("\\", "/").replace(/^\.\//, "");
  return PARITY_ARTIFACT_ROOTS.some((root) => normalized === root.slice(0, -1) || normalized.startsWith(root));
}

export function isParityArtifactStatusLine(line) {
  const paths = statusPaths(line);
  return paths.length > 0 && paths.every(isParityArtifactPath);
}

export function classifyParitySourceStatus(rawStatus) {
  const allStatus = String(rawStatus)
    .split("\n")
    .filter(Boolean);
  const artifactStatus = [];
  const status = [];
  for (const line of allStatus) {
    (isParityArtifactStatusLine(line) ? artifactStatus : status).push(line);
  }
  return {
    cleanSourceSet: status.length === 0,
    status,
    artifactStatus,
  };
}

export function paritySourceDiffPathspecs() {
  return [
    ".",
    ...PARITY_ARTIFACT_ROOTS.map((root) => `:(exclude)${root}`),
  ];
}
