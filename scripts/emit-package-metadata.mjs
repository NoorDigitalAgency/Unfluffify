import { readFile } from "node:fs/promises";

const metadataPath = process.argv.slice(2).find((arg) => arg !== "--");

if (!metadataPath) {
  throw new Error("Missing metadata path");
}

const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
const outputs = {
  archive_name: metadata.archiveFileName,
  display_version: metadata.releaseDisplayVersion || metadata.version,
  latest_alias_name: metadata.latestAliasFileName,
  metadata_path: metadataPath,
  original_version: metadata.originalVersion,
  release_tag: metadata.releaseTag,
  stage_dir: metadata.stageDir,
  timestamp: metadata.timestamp,
  version: metadata.version,
  version_latest_alias_name: metadata.versionLatestAliasFileName,
};

for (const [key, value] of Object.entries(outputs)) {
  console.log(`${key}=${value}`);
}
