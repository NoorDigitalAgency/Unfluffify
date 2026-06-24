#!/usr/bin/env node
// Resolve a playwright module from a few common locations; this script is a dev tool
// and the repo intentionally has no npm dependencies.
async function resolvePlaywright() {
  const candidates = [
    process.env.UNFLUFFIFY_PLAYWRIGHT_PATH,
    '/home/rojan/Desktop/test/node_modules/playwright/index.mjs',
    '/home/rojan/Documents/Git/GitHub/arcana-text/node_modules/playwright/index.mjs',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      return await import(c);
    } catch {
      // Try the next playwright candidate.
    }
  }
  try {
    return await import('playwright');
  } catch {
    // Fall back to the explicit resolution error below.
  }
  throw new Error('Could not resolve playwright; set UNFLUFFIFY_PLAYWRIGHT_PATH to a playwright/index.mjs');
}
const { chromium } = await resolvePlaywright();
import path from 'path';

const REPO = '/home/rojan/Documents/Git/GitHub/Unfluffify';
const PROFILE = path.join(REPO, '.mcp-browser-profile');
const CHROME = '/home/rojan/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';

const URLS = process.argv.slice(2);
if (URLS.length === 0) {
  console.error('Usage: smoke-ai-submission.mjs <url> [url ...]');
  process.exit(2);
}

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  executablePath: CHROME,
  ignoreDefaultArgs: ['--disable-extensions'],
  chromiumSandbox: false,
  args: [
    '--no-sandbox',
    `--load-extension=${REPO}`,
    `--disable-extensions-except=${REPO}`,
  ],
});

// Find the extension service worker to learn extension ID
let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
const extId = new URL(sw.url()).host;
console.log(`extension id: ${extId}`);

const results = [];
for (const url of URLS) {
  console.log(`\n=== ${url} ===`);
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`);
  });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    console.log(`  nav error: ${e.message}`);
  }
  // Allow extension content scripts to load + page to settle
  await page.waitForTimeout(4000);

  // Confirm content-loader injection
  const injected = await page.evaluate(() => ({
    hasFreezeNode: !!document.getElementById('unfluffify-page-motion-freeze-script'),
    hasDebugAttr: document.documentElement?.hasAttribute('data-uf-debug-tab-id') || false,
    href: location.href,
  })).catch((e) => ({ error: e.message }));
  console.log('  injected:', JSON.stringify(injected));

  // Drive capturePageSnapshot from the extension service worker context
  const targetTabId = await sw.evaluate(async (targetUrl) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.url === targetUrl) ||
                tabs.find((t) => t.url && t.url.startsWith(targetUrl.split('?')[0]));
    return tab ? tab.id : null;
  }, url).catch((e) => ({ error: e.message }));
  console.log('  tabId:', targetTabId);

  // Activate content-main first (content-loader loads it on demand)
  if (typeof targetTabId === 'number') {
    const activated = await sw.evaluate(async (tabId) => {
      try {
        const resp = await chrome.tabs.sendMessage(tabId, { type: 'activateContentMain' });
        return resp;
      } catch (e) { return { error: String(e && e.message || e) }; }
    }, targetTabId);
    console.log('  activateContentMain:', JSON.stringify(activated));
    await page.waitForTimeout(2000);
  }

  let snapshot = null;
  if (typeof targetTabId === 'number') {
    // Derive a baseUrl from the page origin so the snapshot can persist even on sites
    // not yet in the remote config — this gives us a verifiable artifact to validate.
    const derivedBaseUrl = new URL(url).origin.replace(/^https?:\/\/www\./, 'https://');
    snapshot = await sw.evaluate(async (args) => {
      try {
        const resp = await chrome.tabs.sendMessage(args.tabId, {
          type: 'capturePageSnapshot',
          persist: true,
          baseUrl: args.baseUrl,
        });
        return { ok: true, resp };
      } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
      }
    }, { tabId: targetTabId, baseUrl: derivedBaseUrl });
    console.log('  capturePageSnapshot outer:', JSON.stringify(snapshot).slice(0, 400));
    console.log('  capturePageSnapshot inner resp:', JSON.stringify(snapshot?.resp || null).slice(0, 400));
  }

  // Allow saveConfig to flush before reading IDB
  await page.waitForTimeout(2000);
  // Read submissionXpaths from the extension's IndexedDB via the service worker
  let submissionRows = null;
  if (typeof targetTabId === 'number') {
    submissionRows = await sw.evaluate(async (href) => {
      function openDb() {
        return new Promise((res, rej) => {
          const req = indexedDB.open('unfluffify', 1);
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
          req.onupgradeneeded = () => res(req.result);
        });
      }
      function readKey(db, key) {
        return new Promise((res, rej) => {
          const tx = db.transaction(['kv'], 'readonly');
          const store = tx.objectStore('kv');
          const req = store.get(key);
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
      }
      try {
        const db = await openDb();
        const configs = (await readKey(db, 'configs')) || {};
        const matches = [];
        const debug = { baseUrls: Object.keys(configs), entriesByBaseUrl: {} };
        for (const [baseUrl, cfg] of Object.entries(configs)) {
          const pm = cfg?.pageMarkings;
          const entryPairs = [];
          if (Array.isArray(pm)) for (const e of pm) entryPairs.push([e?.pageUrl || e?.url || '', e]);
          else if (pm && typeof pm === 'object') for (const [k, v] of Object.entries(pm)) entryPairs.push([k, v]);
          debug.entriesByBaseUrl[baseUrl] = entryPairs.length;
          for (const [key, entry] of entryPairs) {
            if (!key) continue;
            const normalized = key.replace(/\/$/, '').split('#')[0];
            const target = href.replace(/\/$/, '').split('#')[0];
            if (normalized === target) {
              matches.push({ baseUrl, pageUrl: key, rows: entry.submissionXpaths || [] });
            }
          }
        }
        // Dump first entry under bonliva for shape inspection
        const bonliva = configs['https://bonliva.no'];
        const firstEntry = bonliva?.pageMarkings && Object.values(bonliva.pageMarkings)[0];
        if (firstEntry) {
          debug.sampleEntry = {
            pageUrl: firstEntry.pageUrl || firstEntry.url || null,
            keys: Object.keys(firstEntry).slice(0, 20),
            submissionXpaths: (firstEntry.submissionXpaths || []).length,
          };
        }
        return { matches, debug };
      } catch (e) {
        return { error: String(e && e.message || e) };
      }
    }, url).catch((e) => ({ error: e.message }));
    if (submissionRows && submissionRows.debug) {
      console.log('  idb debug:', JSON.stringify(submissionRows.debug).slice(0, 300));
    }
    const matches = submissionRows?.matches || [];
    if (matches.length) {
      for (const m of matches) {
        const rows = m.rows;
        const excluded = rows.filter((r) => r.excluded);
        const included = rows.filter((r) => !r.excluded);
        const explicitExcluded = excluded.filter((r) => r.explicit);
        console.log(`  baseUrl=${m.baseUrl}`);
        console.log(`    rows=${rows.length} included=${included.length} excluded=${excluded.length} explicitExcluded=${explicitExcluded.length}`);

        // Resolve each xpath in the live page, classify visibility, and reconcile with the row's excluded flag.
        const verdict = await page.evaluate((xpathRows) => {
          // Temporarily detach extension-owned nodes so XPath indices match the sanitized view
          // used when submissionXpaths were computed. Re-attach them in a finally block.
          const detached = [];
          document.querySelectorAll('[data-uf-extension-ui], #unfluffify-page-motion-freeze-script').forEach((el) => {
            const parent = el.parentNode;
            const nextSibling = el.nextSibling;
            if (parent) {
              detached.push({ el, parent, nextSibling });
              parent.removeChild(el);
            }
          });
          function restoreDetached() {
            for (const d of detached) {
              try {
                d.parent.insertBefore(d.el, d.nextSibling);
              } catch {
                // Ignore restore ordering failures during DOM cleanup.
              }
            }
          }
          function resolveXPath(xp) {
            try {
              return document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            } catch { return null; }
          }
          function ancestorClipsToZero(el) {
            // Walks ancestors looking for height:0 or max-height:0 with overflow:hidden — a
            // common pattern for collapsed accordion content that still has measurable
            // descendant rects.
            let cursor = el.parentElement;
            while (cursor && cursor !== document.documentElement) {
              const cs = window.getComputedStyle(cursor);
              if (cs && (cs.overflow === 'hidden' || cs.overflowY === 'hidden')) {
                const h = cursor.getBoundingClientRect().height;
                if (h <= 1) return true;
              }
              cursor = cursor.parentElement;
            }
            return false;
          }
          function hasVisibleRect(el) {
            if (!el || !(el instanceof Element)) return false;
            try {
              if (typeof el.checkVisibility === 'function') {
                if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })) return false;
              }
            } catch {
              // Ignore visibility API failures for this element.
            }
            if (el.offsetParent === null && el.tagName !== 'BODY' && el.tagName !== 'HTML') {
              const cs = window.getComputedStyle(el);
              if (!cs || cs.position !== 'fixed') return false;
            }
            if (ancestorClipsToZero(el)) return false;
            const rects = el.getClientRects();
            for (const r of rects) {
              if (r.width <= 0 || r.height <= 0) continue;
              if (r.right > 0 && r.bottom > 0 && r.left < window.innerWidth + 2000 && r.top < document.documentElement.scrollHeight) {
                return true;
              }
            }
            return false;
          }
          function hasTextContent(el) {
            if (!el) return false;
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
            return t.length > 0;
          }
          const out = {
            includedVisible: 0,
            includedHidden: 0,
            excludedVisible: 0,
            excludedHidden: 0,
            unresolvedIncluded: 0,
            unresolvedExcluded: 0,
            includedHiddenSamples: [],
            excludedVisibleByTag: {},
            excludedVisibleNonDefaultSamples: [],
          };
          const DEFAULT_EXCLUDED_TAGS = new Set([
            'HEADER','FOOTER','NAV','ASIDE','BUTTON','FORM','INPUT','SELECT','TEXTAREA',
            'IFRAME','VIDEO','AUDIO','SVG','CANVAS','PICTURE','SOURCE','TRACK','MAP','AREA',
            'NOSCRIPT','SCRIPT','STYLE','TEMPLATE','SLOT','BR','HR','PROGRESS','METER','LABEL',
            'OPTION','OPTGROUP','FIELDSET','LEGEND','OUTPUT','DATALIST','SUMMARY','DETAILS',
            'DIALOG','MENU','MENUITEM',
          ]);
          // Build set of all included xpaths so we can spot Phase-B-style redundant ancestors
          const includedXpaths = new Set(xpathRows.filter((r) => !r.excluded).map((r) => r.xpath));
          const includedNodes = [];
          for (const xp of includedXpaths) {
            const n = resolveXPath(xp);
            if (n) includedNodes.push(n);
          }
          function hasIncludedDescendant(el) {
            for (const n of includedNodes) {
              if (n !== el && el.contains && el.contains(n)) return true;
            }
            return false;
          }
          for (const row of xpathRows) {
            const el = resolveXPath(row.xpath);
            if (!el) {
              if (row.excluded) out.unresolvedExcluded++; else out.unresolvedIncluded++;
              continue;
            }
            const visible = hasVisibleRect(el) && hasTextContent(el);
            if (!row.excluded) {
              if (visible) out.includedVisible++; else {
                out.includedHidden++;
                if (out.includedHiddenSamples.length < 3) out.includedHiddenSamples.push(row.xpath);
              }
            } else {
              if (visible) {
                // An excluded row that is visible is suspicious UNLESS:
                //  - it is explicit (user-marked excluded), OR
                //  - it has an included descendant (Phase B kept the visible descendant included; ancestor row is excluded but
                //    its visible content is carried by the descendant)
                const okPhaseB = hasIncludedDescendant(el);
                if (row.explicit || okPhaseB) out.excludedHidden++; else {
                  out.excludedVisible++;
                  // Walk self and ancestors for the nearest default-excluded structural tag.
                  let cursor = el;
                  let structural = null;
                  while (cursor && cursor !== document.documentElement) {
                    if (DEFAULT_EXCLUDED_TAGS.has(cursor.tagName)) { structural = cursor.tagName; break; }
                    cursor = cursor.parentElement;
                  }
                  const tag = structural || `<non-default:${el.tagName}>`;
                  out.excludedVisibleByTag[tag] = (out.excludedVisibleByTag[tag] || 0) + 1;
                  if (!structural && out.excludedVisibleNonDefaultSamples.length < 5) {
                    out.excludedVisibleNonDefaultSamples.push({
                      xpath: row.xpath,
                      tag: el.tagName,
                      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
                    });
                  }
                }
              } else out.excludedHidden++;
            }
          }
          restoreDetached();
          return out;
        }, rows);
        console.log('    verdict:', JSON.stringify(verdict));

        // For diagnostic insight, look up one of the non-default samples on the live page
        // and dump its bounding rect + ancestor chain so we can tell whether it's actually
        // visible to a human or a DOM ghost.
        if (verdict.excludedVisibleNonDefaultSamples?.length) {
          const sampleXp = verdict.excludedVisibleNonDefaultSamples[0].xpath;
          const diag = await page.evaluate((xp) => {
            const el = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (!el) return { found: false };
            const r = el.getBoundingClientRect();
            const cs = window.getComputedStyle(el);
            const chain = [];
            let c = el;
            while (c && c !== document.documentElement) {
              const cr = c.getBoundingClientRect();
              const ccs = window.getComputedStyle(c);
              chain.push({ tag: c.tagName, cls: (c.className && typeof c.className === 'string' ? c.className.slice(0, 50) : ''), w: Math.round(cr.width), h: Math.round(cr.height), top: Math.round(cr.top), display: ccs.display, visibility: ccs.visibility, opacity: ccs.opacity, overflow: ccs.overflow, transform: ccs.transform.slice(0, 60) });
              c = c.parentElement;
              if (chain.length > 12) break;
            }
            return { found: true, rect: { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left) }, style: { display: cs.display, visibility: cs.visibility, opacity: cs.opacity }, chain };
          }, sampleXp);
          console.log('    diag sample:', JSON.stringify(diag).slice(0, 1200));
        }
      }
    } else {
      console.log('  submissionRows: no entry matched href');
    }
  }

  // Probe live isVisibleForSubmission counts if helper is reachable
  const probe = await page.evaluate(() => {
    const w = window;
    const fn = w.__unfluffifyDebug?.isVisibleForSubmission
      || w.__unfluffify?.isVisibleForSubmission
      || null;
    if (!fn) return { available: false };
    let total = 0, visible = 0;
    document.querySelectorAll('*').forEach((el) => {
      total++;
      try {
        if (fn(el)) visible++;
      } catch {
        // Ignore per-element probe failures and keep scanning.
      }
    });
    return { available: true, total, visible };
  }).catch((e) => ({ error: e.message }));
  console.log('  isVisibleForSubmission probe:', JSON.stringify(probe));

  results.push({ url, injected, targetTabId, snapshot, consoleErrors: consoleErrors.slice(0, 10) });
  if (consoleErrors.length) {
    console.log(`  console errors (${consoleErrors.length}):`);
    consoleErrors.slice(0, 5).forEach((m) => console.log('   -', m.slice(0, 200)));
  }
  await page.close();
}

await ctx.close();
console.log('\n=== summary ===');
for (const r of results) {
  console.log(`${r.url} -> tabId=${r.targetTabId} snapshot.ok=${r.snapshot?.ok} errs=${r.consoleErrors.length}`);
}
