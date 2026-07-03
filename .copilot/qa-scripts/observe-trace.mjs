// Enhanced live console observer: like scripts/observe-live-console.mjs but
// expands OBJECT console args via Runtime.callFunctionOn(JSON.stringify) so
// [world-trace] payloads are fully readable. Read-only; never closes the browser.
// Usage: node .temp/observe-trace.mjs [cdpHttp] >> .temp/trace-observer.log 2>&1
import WebSocket from "ws";

const CDP_HTTP = process.argv[2] || "http://127.0.0.1:9222";

function nowIso() { return new Date().toISOString(); }
function shortUrl(url) {
  if (!url) return "?";
  if (url.startsWith("chrome-extension://")) return `ext/${url.split("/").slice(3).join("/")}`;
  return url.length > 80 ? `${url.slice(0, 80)}…` : url;
}
function line(tag, target, msg) {
  const where = target ? `${target.type}:${shortUrl(target.url)}` : "browser";
  process.stdout.write(`[obs ${nowIso()}] [${tag}] [${where}] ${msg}\n`);
}
async function getJson(path) {
  const res = await fetch(`${CDP_HTTP}${path}`);
  return res.json();
}

async function main() {
  const version = await getJson("/json/version");
  const ws = new WebSocket(version.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  let nextId = 1;
  const sessions = new Map();
  const pendingReplies = new Map(); // id -> resolve

  function send(method, params = {}, sessionId) {
    const id = nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    ws.send(JSON.stringify(payload));
    return id;
  }
  function call(method, params, sessionId) {
    return new Promise((resolve) => {
      const id = send(method, params, sessionId);
      pendingReplies.set(id, resolve);
      setTimeout(() => { if (pendingReplies.delete(id)) resolve(null); }, 3000);
    });
  }

  async function renderArgAsync(arg, sessionId) {
    if (!arg) return "";
    if (arg.type === "string") return arg.value;
    if ("value" in arg && arg.value !== undefined) return JSON.stringify(arg.value);
    if (arg.objectId) {
      const reply = await call("Runtime.callFunctionOn", {
        objectId: arg.objectId,
        functionDeclaration: "function(){ try { return JSON.stringify(this); } catch(e){ return '[unserializable ' + e.message + ']'; } }",
        returnByValue: true,
      }, sessionId);
      const v = reply?.result?.result?.value;
      if (typeof v === "string") return v;
    }
    if (arg.description) return arg.description;
    return arg.className || arg.subtype || arg.type || "";
  }

  ws.on("open", () => {
    line("init", null, "browser CDP socket open");
    send("Target.setDiscoverTargets", { discover: true });
    send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  });

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.id && pendingReplies.has(msg.id)) {
      const resolve = pendingReplies.get(msg.id);
      pendingReplies.delete(msg.id);
      resolve(msg);
      return;
    }
    const { method, params, sessionId } = msg;
    if (!method) return;

    if (method === "Target.attachedToTarget") {
      const t = params.targetInfo;
      const sid = params.sessionId;
      for (const info of sessions.values()) {
        if (info.targetId === t.targetId) { send("Target.detachFromTarget", { sessionId: sid }); return; }
      }
      sessions.set(sid, { type: t.type, url: t.url, targetId: t.targetId });
      line("attach", sessions.get(sid), `attached (${t.type})`);
      send("Runtime.enable", {}, sid);
      send("Log.enable", {}, sid);
      return;
    }
    if (method === "Target.detachedFromTarget") {
      const target = sessions.get(params.sessionId);
      if (target) line("detach", target, "detached");
      sessions.delete(params.sessionId);
      return;
    }
    if (method === "Target.targetInfoChanged") {
      const t = params.targetInfo;
      for (const info of sessions.values()) if (info.targetId === t.targetId) info.url = t.url;
      return;
    }

    const target = sessions.get(sessionId);

    if (method === "Runtime.consoleAPICalled") {
      const level = params.type;
      const ts = params.timestamp ? new Date(params.timestamp).toISOString() : nowIso();
      // Expand args asynchronously but log with the ORIGINAL event timestamp so
      // ordering can be reconstructed even if lines interleave.
      Promise.all((params.args || []).map((a) => renderArgAsync(a, sessionId))).then((parts) => {
        const tag = level === "error" ? "console.error" : level === "warning" ? "console.warn" : `console.${level}`;
        line(tag, target, `@${ts} ${parts.join(" ")}`);
      });
      return;
    }
    if (method === "Runtime.exceptionThrown") {
      const d = params.exceptionDetails || {};
      line("pageerror", target, d.exception?.description || d.text || "uncaught exception");
      return;
    }
    if (method === "Log.entryAdded") {
      const e = params.entry || {};
      if (e.level === "error" || e.level === "warning") {
        line(`log.${e.level}`, target, `${e.text}${e.url ? ` (${shortUrl(e.url)}:${e.lineNumber ?? "?"})` : ""}`);
      }
    }
  });

  ws.on("close", () => { line("init", null, "browser CDP socket closed"); process.exit(0); });
  ws.on("error", (err) => line("init", null, `socket error: ${err.message}`));
}

main().catch((err) => {
  process.stdout.write(`[obs ${nowIso()}] [fatal] ${err.stack || err}\n`);
  process.exit(1);
});
