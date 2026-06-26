import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createExplicitMarkingHandler } from "../src/content/explicit-marking-handler.js";

const pageUrl = "https://example.com/page";
const baseUrl = "https://example.com";
const parentXpath = "/HTML/BODY/DIV[1]";
const childXpath = "/HTML/BODY/DIV[1]/P[1]";
const grandchildXpath = "/HTML/BODY/DIV[1]/P[1]/SPAN[1]";
const siblingXpath = "/HTML/BODY/ASIDE[1]";

function createElement(name, parent = null, options = {}) {
  return {
    name,
    nodeType: 1,
    parentNode: parent,
    defaultToggleable: Boolean(options.defaultToggleable),
    contains(other) {
      let current = other;
      while (current) {
        if (current === this) {
          return true;
        }
        current = current.parentNode || null;
      }
      return false;
    }
  };
}

function createDeps(entry, options = {}) {
  const calls = [];
  const parent = createElement("parent", null, { defaultToggleable: options.parentDefaultToggleable });
  const child = createElement("child", parent);
  const grandchild = createElement("grandchild", child);
  const sibling = createElement("sibling");
  const elements = new Map([
    [parentXpath, parent],
    [childXpath, child],
    [grandchildXpath, grandchild],
    [siblingXpath, sibling],
    ...(options.elements || [])
  ]);
  const config = { pageMarkings: { [pageUrl]: entry } };
  return {
    calls,
    canApplyExplicitInclude: options.canApplyExplicitInclude || (() => true),
    getConfig: () => config,
    getElementFromXPath: (xpath) => {
      calls.push(["getElementFromXPath", xpath]);
      return elements.has(xpath) ? elements.get(xpath) : null;
    },
    getPageMarkingEntry: () => entry,
    getPageUrl: () => pageUrl,
    isDefaultToggleableExcludedElement: (element) => Boolean(element && element.defaultToggleable),
    isPageDraftDirty: (...args) => {
      calls.push(["isPageDraftDirty", ...args]);
      return true;
    },
    isXPathDescendant: (parent, childValue) => Boolean(
      parent && childValue && childValue !== parent && childValue.startsWith(`${parent}/`)
    ),
    normalizePageEntryXpaths: (...args) => calls.push(["normalizePageEntryXpaths", ...args]),
    notifyDraftStatus: (...args) => calls.push(["notifyDraftStatus", ...args]),
    scheduleDraftPersist: (...args) => calls.push(["scheduleDraftPersist", ...args]),
    scheduleRender: () => calls.push(["scheduleRender"]),
    scheduleSnapshotSave: () => calls.push(["scheduleSnapshotSave"]),
    touchPageEntryTimestamp: (...args) => calls.push(["touchPageEntryTimestamp", ...args])
  };
}

function sideEffectCalls(deps) {
  return deps.calls.filter((call) => call[0] !== "getElementFromXPath");
}

test("explicit exclude prunes descendant marks and selector suppression", () => {
  const entry = {
    xpaths: [
      { xpath: childXpath, excluded: false },
      { xpath: siblingXpath, excluded: true, explicit: true }
    ],
    includeXpaths: [childXpath, siblingXpath],
    selectorSuppressedXpaths: [parentXpath, childXpath, siblingXpath]
  };
  const deps = createDeps(entry);
  const handler = createExplicitMarkingHandler(deps);

  const response = handler.setExplicitExclude({ targetBaseUrl: baseUrl, xpath: parentXpath, excluded: true });

  assert.deepEqual(response, { ok: true, dirty: true });
  assert.deepEqual(entry.xpaths, [
    { xpath: siblingXpath, excluded: true, explicit: true },
    { xpath: parentXpath, excluded: true, explicit: true }
  ]);
  assert.deepEqual(entry.includeXpaths, [siblingXpath]);
  assert.deepEqual(entry.selectorSuppressedXpaths, [siblingXpath]);
  assert.deepEqual(sideEffectCalls(deps), [
    ["touchPageEntryTimestamp", entry],
    ["normalizePageEntryXpaths", entry],
    ["scheduleRender"],
    ["scheduleSnapshotSave"],
    ["notifyDraftStatus", pageUrl],
    ["scheduleDraftPersist", baseUrl],
    ["isPageDraftDirty", pageUrl]
  ]);
});

test("explicit exclude converts a default-toggleable excluded ancestor to unexcluded", () => {
  const entry = {
    xpaths: [{ xpath: parentXpath, excluded: true, explicit: true }],
    includeXpaths: [grandchildXpath],
    selectorSuppressedXpaths: []
  };
  const deps = createDeps(entry, { parentDefaultToggleable: true });
  const handler = createExplicitMarkingHandler(deps);

  const response = handler.setExplicitExclude({ targetBaseUrl: baseUrl, xpath: childXpath, excluded: true });

  assert.deepEqual(response, { ok: true, dirty: true });
  assert.deepEqual(entry.xpaths, [
    { xpath: parentXpath, excluded: false },
    { xpath: childXpath, excluded: true, explicit: true }
  ]);
  assert.deepEqual(entry.includeXpaths, []);
});

test("explicit include fails without a resolvable target", () => {
  const entry = { xpaths: [], includeXpaths: [], selectorSuppressedXpaths: [] };
  const deps = createDeps(entry);
  const handler = createExplicitMarkingHandler(deps);

  const response = handler.setExplicitInclude({
    targetBaseUrl: baseUrl,
    xpath: "/HTML/BODY/MISSING[1]",
    included: true
  });

  assert.deepEqual(response, { ok: false });
  assert.deepEqual(sideEffectCalls(deps), []);
});

test("explicit include prunes descendant marks, includes, and selector suppression", () => {
  const entry = {
    xpaths: [
      { xpath: childXpath, excluded: true, explicit: true },
      { xpath: siblingXpath, excluded: true, explicit: true }
    ],
    includeXpaths: [grandchildXpath],
    selectorSuppressedXpaths: [parentXpath, childXpath, siblingXpath]
  };
  const deps = createDeps(entry);
  const handler = createExplicitMarkingHandler(deps);

  const response = handler.setExplicitInclude({ targetBaseUrl: baseUrl, xpath: parentXpath, included: true });

  assert.deepEqual(response, { ok: true, dirty: true });
  assert.deepEqual(entry.xpaths, [{ xpath: siblingXpath, excluded: true, explicit: true }]);
  assert.deepEqual(entry.includeXpaths, [parentXpath]);
  assert.deepEqual(entry.selectorSuppressedXpaths, [siblingXpath]);
});

test("explicit include removal records selector suppression", () => {
  const entry = {
    xpaths: [],
    includeXpaths: [parentXpath],
    selectorSuppressedXpaths: [childXpath]
  };
  const deps = createDeps(entry);
  const handler = createExplicitMarkingHandler(deps);

  const response = handler.setExplicitInclude({ targetBaseUrl: baseUrl, xpath: parentXpath, included: false });

  assert.deepEqual(response, { ok: true, dirty: true });
  assert.deepEqual(entry.includeXpaths, []);
  assert.deepEqual(entry.selectorSuppressedXpaths, [parentXpath]);
});