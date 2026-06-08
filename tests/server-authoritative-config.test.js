import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const configSource = readFileSync(new URL("../common/config.js", import.meta.url), "utf8");
const utilitiesSource = readFileSync(new URL("../common/utilities.js", import.meta.url), "utf8");
const backgroundSource = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");

// #23 - server-authoritative property config stored in chrome.storage.session.

test("utilities expose session-scoped key/value helpers backed by chrome.storage.session", () => {
  assert.match(utilitiesSource, /export async function sessionKvGet\(keys\)/);
  assert.match(utilitiesSource, /export async function sessionKvSet\(items\)/);
  assert.match(utilitiesSource, /export async function sessionKvRemove\(keys\)/);
  const getBody = utilitiesSource.match(
    /export async function sessionKvGet\(keys\) \{([\s\S]*?)\n\}/
  )[1];
  // Extension context reads directly from chrome.storage.session.
  assert.match(getBody, /storageGet\(chrome\.storage\.session, keys\)/);
  // Content scripts cannot reach session storage directly, so they relay.
  assert.match(getBody, /sendRuntimeMessage\(\{ type: "sessionKvGet", keys \}\)/);
});

test("session helpers relay through the background service worker for content scripts", () => {
  const setBody = utilitiesSource.match(
    /export async function sessionKvSet\(items\) \{([\s\S]*?)\n\}/
  )[1];
  assert.match(setBody, /sendRuntimeMessage\(\{ type: "sessionKvSet", items \}\)/);
  assert.match(setBody, /storageSet\(chrome\.storage\.session, items\)/);
  const removeBody = utilitiesSource.match(
    /export async function sessionKvRemove\(keys\) \{([\s\S]*?)\n\}/
  )[1];
  assert.match(removeBody, /sendRuntimeMessage\(\{ type: "sessionKvRemove", keys \}\)/);
  assert.match(removeBody, /storageRemove\(chrome\.storage\.session, keys\)/);
});

test("background relays session key/value operations", () => {
  assert.match(backgroundSource, /message\.type === "sessionKvGet"/);
  assert.match(backgroundSource, /utils\.sessionKvGet\(message\.keys\)/);
  assert.match(backgroundSource, /message\.type === "sessionKvSet"/);
  assert.match(backgroundSource, /utils\.sessionKvSet\(message\.items\)/);
  assert.match(backgroundSource, /message\.type === "sessionKvRemove"/);
  assert.match(backgroundSource, /utils\.sessionKvRemove\(message\.keys\)/);
});

test("property data is persisted in chrome.storage.session, never IndexedDB", () => {
  // config.js must no longer import or use the IndexedDB primitives.
  assert.doesNotMatch(configSource, /\bidbGet\b/);
  assert.doesNotMatch(configSource, /\bidbSet\b/);
  assert.match(configSource, /sessionKvGet,\n\s*sessionKvSet/);
  // configs, backendSavedPageMarkings, and pageSaveReconciliations all live in
  // the session-scoped store.
  assert.match(configSource, /await sessionKvGet\("configs"\)/);
  assert.match(configSource, /await sessionKvSet\(\{ configs: normalizedConfigs \}\)/);
  assert.match(configSource, /sessionKvGet\(\{ \[BACKEND_SAVED_PAGE_MARKINGS_KEY\]: \{\} \}\)/);
  assert.match(configSource, /sessionKvSet\(\{ \[BACKEND_SAVED_PAGE_MARKINGS_KEY\]: store \}\)/);
  assert.match(configSource, /sessionKvGet\(\{ \[PAGE_SAVE_RECONCILIATIONS_KEY\]: \{\} \}\)/);
});

test("a computed AI selector set stays in memory and never touches the saved store", () => {
  const fnBody = popupSource.match(
    /async function applyComputedSelectorSet\([\s\S]*?\n\}\n\n/
  )[0];
  // Silent mode and lynx read the server-authoritative session store, so an
  // unsaved compute must not persist via updateConfig.
  assert.doesNotMatch(fnBody, /config\.updateConfig\(/);
  // The computed set is held only on the in-memory working config.
  assert.match(fnBody, /state\.currentConfig = config\.normalizeConfig\(/);
});
