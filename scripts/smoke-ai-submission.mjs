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
    try { return await import(c); } catch {}
  }
  try { return await import('playwright'); } catch {}
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

  let snapshot = null;
  if (typeof targetTabId === 'number') {
    snapshot = await sw.evaluate(async (tabId) => {
      try {
        const resp = await chrome.tabs.sendMessage(tabId, {
          type: 'capturePageSnapshot',
          persist: true,
        });
        return { ok: true, resp };
      } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
      }
    }, targetTabId);
    console.log('  capturePageSnapshot:', JSON.stringify(snapshot).slice(0, 400));
  }

  // Inspect persisted submission xpaths from extension storage
  if (typeof targetTabId === 'number') {
    const stored = await sw.evaluate(async (href) => {
      const all = await chrome.storage.local.get(null);
      const matches = [];
      for (const [k, v] of Object.entries(all)) {
        if (!v || typeof v !== 'object') continue;
        const entries = v?.pageMarkings || v?.markings || null;
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            if (entry?.url === href || entry?.pageUrl === href) {
              matches.push({ key: k, rows: entry?.submissionXpaths?.length || 0,
                excluded: (entry?.submissionXpaths || []).filter((r) => r.excluded).length });
            }
          }
        }
      }
      return matches;
    }, url).catch((e) => ({ error: e.message }));
    console.log('  storage submissionXpaths:', JSON.stringify(stored).slice(0, 400));
  }

  // Probe live isVisibleForSubmission counts if helper is reachable
  const probe = await page.evaluate(() => {
    const w = window;
    const fn = w.__unfluffifyDebug?.isVisibleForSubmission
      || w.__unfluffify?.isVisibleForSubmission
      || null;
    if (!fn) return { available: false };
    let total = 0, visible = 0;
    document.querySelectorAll('*').forEach((el) => { total++; try { if (fn(el)) visible++; } catch {} });
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
