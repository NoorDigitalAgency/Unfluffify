import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
const contentSource = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");

test("background bus ingress stays ahead of the raw message.type guard", () => {
  assert.match(
    backgroundSource,
    /browser\.runtime\.onMessage\.addListener\(\(message, sender, sendResponse\) => \{[\s\S]*?if \(busProtocolBridge\.isBusMessage\(message\)\) \{[\s\S]*?return true;[\s\S]*?if \(!message \|\| !message\.type\) \{/
  );
});

test("content bus ingress stays ahead of the raw message.type guard", () => {
  assert.match(
    contentSource,
    /browser\.runtime\.onMessage\.addListener\(\(message, _sender, sendResponse\) => \{[\s\S]*?if \(message && typeof message === "object" && \(message as \{ p\?: unknown \}\)\.p === "uf-bus\/1"\) \{[\s\S]*?return true;[\s\S]*?if \(!message \|\| !message\.type\) \{/
  );
});
