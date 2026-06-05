import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("repo MCP specs keep absolute Playwright paths and no-sandbox launch args", () => {
  const vscodeMcp = readFileSync(new URL("../.vscode/mcp.json", import.meta.url), "utf8");
  const rootMcp = readFileSync(new URL("../.mcp.json", import.meta.url), "utf8");
  const codexConfig = readFileSync(new URL("../.codex/config.toml", import.meta.url), "utf8");
  const browserConfig = readFileSync(new URL("../.vscode/browser-mcp.config.json", import.meta.url), "utf8");

  assert.match(vscodeMcp, /--user-data-dir=\/home\/rojan\/Documents\/Git\/GitHub\/Unfluffify\/\.mcp-browser-profile/);
  assert.match(vscodeMcp, /--config=\/home\/rojan\/Documents\/Git\/GitHub\/Unfluffify\/\.vscode\/browser-mcp\.config\.json/);
  assert.match(rootMcp, /--user-data-dir=\/home\/rojan\/Documents\/Git\/GitHub\/Unfluffify\/\.mcp-browser-profile/);
  assert.match(rootMcp, /--config=\/home\/rojan\/Documents\/Git\/GitHub\/Unfluffify\/\.vscode\/browser-mcp\.config\.json/);
  assert.match(codexConfig, /--user-data-dir=\/home\/rojan\/Documents\/Git\/GitHub\/Unfluffify\/\.mcp-browser-profile/);
  assert.match(codexConfig, /--config=\/home\/rojan\/Documents\/Git\/GitHub\/Unfluffify\/\.vscode\/browser-mcp\.config\.json/);
  assert.match(browserConfig, /"chromiumSandbox": false/);
  assert.match(browserConfig, /"--no-sandbox"/);
});
