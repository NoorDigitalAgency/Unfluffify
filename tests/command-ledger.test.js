import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  LEDGER_MAX_ARRAY_PREVIEW,
  LEDGER_MAX_OBJECT_KEYS,
  LEDGER_MAX_STRING_LENGTH,
  redactCommandPayloadForLedger
} from "../src/background/command-ledger.js";

test("command ledger redacts sensitive payload fields and summaries heavy bodies", () => {
  const jwtLike = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.signature";
  const hugeRendered = "x".repeat(300);
  const hugeRaw = "y".repeat(280);
  const circular = {};
  circular.self = circular;

  const payload = {
    tokenValue: "secret-token",
    globalToken: "global-secret",
    password: "pw",
    payloadKey: "transfer-key",
    headers: {
      Authorization: "Bearer abc",
      Cookie: "sid=123"
    },
    renderedHtml: hugeRendered,
    pages: [{ rawHtml: hugeRaw }],
    note: jwtLike,
    longString: "l".repeat(LEDGER_MAX_STRING_LENGTH + 40),
    circular,
    nested: {
      rawHtml: hugeRaw
    }
  };

  const redacted = redactCommandPayloadForLedger(payload);

  assert.equal(redacted.tokenValue, "[redacted]");
  assert.equal(redacted.globalToken, "[redacted]");
  assert.equal(redacted.password, "[redacted]");
  assert.equal(redacted.payloadKey, "[redacted:payload-key]");
  assert.equal(redacted.renderedHtml, `[redacted:renderedHtml:${hugeRendered.length}]`);
  assert.equal(redacted.note, "[redacted:jwt]");
  assert.match(redacted.longString, /^\[truncated:/);
  assert.deepEqual(redacted.headers, {
    Authorization: "[redacted]",
    Cookie: "[redacted]"
  });
  assert.deepEqual(redacted.pages, {
    summary: "[array:1]",
    preview: ["[object:1]"]
  });
  assert.deepEqual(redacted.nested, {
    rawHtml: `[redacted:rawHtml:${hugeRaw.length}]`
  });
  assert.deepEqual(redacted.circular, {
    self: "[object:1]"
  });

  assert.doesNotThrow(() => JSON.stringify(redacted));
});

test("command ledger caps object keys and array preview sizes", () => {
  const payload = {
    rows: Array.from({ length: LEDGER_MAX_ARRAY_PREVIEW + 4 }, (_, index) => ({ v: index }))
  };
  for (let index = 0; index < LEDGER_MAX_OBJECT_KEYS + 3; index += 1) {
    payload[`k${index}`] = index;
  }

  const redacted = redactCommandPayloadForLedger(payload);

  const keys = Object.keys(redacted).filter((key) => key !== "__truncatedKeys");
  assert.equal(keys.length, LEDGER_MAX_OBJECT_KEYS);
  assert.equal(redacted.__truncatedKeys, 4);
  assert.deepEqual(redacted.rows, {
    summary: `[array:${LEDGER_MAX_ARRAY_PREVIEW + 4}]`,
    preview: Array.from({ length: LEDGER_MAX_ARRAY_PREVIEW }, () => "[object:1]")
  });
});

test("command ledger returns undefined for non-object payloads", () => {
  assert.equal(redactCommandPayloadForLedger(null), undefined);
  assert.equal(redactCommandPayloadForLedger("value"), undefined);
  assert.equal(redactCommandPayloadForLedger(10), undefined);
});
