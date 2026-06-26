#!/usr/bin/env node

import { rmSync } from "node:fs";
import { resolve } from "node:path";

const targets = process.argv.slice(2);

if (targets.length === 0) {
  console.error("Usage: node ./scripts/remove-path.mjs <path> [<path>...]");
  process.exit(1);
}

for (const target of targets) {
  rmSync(resolve(target), { recursive: true, force: true });
}
