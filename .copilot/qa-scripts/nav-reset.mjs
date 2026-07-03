// Navigate the page tab with beforeunload auto-accept ("Leave site?" dialog).
// Usage: node .temp/nav-reset.mjs <url>
const CDP = "http://127.0.0.1:9222";
const url = process.argv[2];
if (!url) { console.error("usage: nav-reset.mjs <url>"); process.exit(2); }
const targets = await (await fetch(`${CDP}/json`)).json();
const pageT = targets.find((t) => t.type === "page" && !t.url.startsWith("chrome-extension://") && !t.url.startsWith("chrome://") && !t.url.includes("tally.so"));
if (!pageT) { console.error("no page target"); process.exit(1); }
const ws = new WebSocket(pageT.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id;
  pending.set(mid, { res, rej });
  ws.send(JSON.stringify({ id: mid, method, params }));
  setTimeout(() => { if (pending.delete(mid)) rej(new Error(`timeout ${method}`)); }, 20000);
});
let loaded = false;
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === "Page.javascriptDialogOpening") {
    console.log(`[nav] auto-accepting dialog: ${msg.params.type} "${(msg.params.message || "").slice(0, 60)}"`);
    void send("Page.handleJavaScriptDialog", { accept: true });
    return;
  }
  if (msg.method === "Page.loadEventFired") { loaded = true; return; }
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.error) p.rej(new Error(JSON.stringify(msg.error))); else p.res(msg.result);
};
ws.onopen = async () => {
  try {
    await send("Page.enable");
    await send("Page.navigate", { url });
    const deadline = Date.now() + 45000;
    while (!loaded && Date.now() < deadline) { await new Promise((r) => setTimeout(r, 250)); }
    console.log(loaded ? "[nav] loaded" : "[nav] load-timeout (page may still be settling)");
    ws.close();
    process.exit(0);
  } catch (e) {
    console.error("[nav] failed:", e.message);
    process.exit(1);
  }
};
