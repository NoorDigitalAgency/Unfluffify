// Live console + JS-stack observer for the launcher-owned managed Chromium.
//
// Streams console messages, uncaught exceptions, and Log.entryAdded warnings/errors
// from EVERY target (the bound popup, the target page, AND the background service
// worker) over the Chrome DevTools Protocol, so an agent can watch the full JS
// stack while a user exercises the extension.
//
// Prereq: a live browser started by `pnpm browser:live <url>` (which injects
// --remote-debugging-port=9222). Never point this at the OS Chrome.
//
// Usage:
//   node scripts/observe-live-console.mjs                 # defaults to http://127.0.0.1:9222
//   node scripts/observe-live-console.mjs http://127.0.0.1:9222 >> .temp/cdp-observer.log 2>&1
//
// Stop with Ctrl-C; it never closes the browser (it only reads).
import WebSocket from "ws";

const CDP_HTTP = process.argv[2] || process.env.UNFLUFFIFY_CDP_HTTP || "http://127.0.0.1:9222";

function nowIso() {
  return new Date().toISOString();
}

function shortUrl(url) {
  if (!url) return "?";
  if (url.startsWith("chrome-extension://")) {
    return `ext/${url.split("/").slice(3).join("/")}`;
  }
  return url.length > 80 ? `${url.slice(0, 80)}…` : url;
}

function line(tag, target, msg) {
  const where = target ? `${target.type}:${shortUrl(target.url)}` : "browser";
  process.stdout.write(`[obs ${nowIso()}] [${tag}] [${where}] ${msg}\n`);
}

function renderArg(arg) {
  if (!arg) return "";
  if (arg.type === "string") return arg.value;
  if ("value" in arg && arg.value !== undefined) return JSON.stringify(arg.value);
  if (arg.description) return arg.description;
  if (arg.preview) {
    const props = (arg.preview.properties || []).map((p) => `${p.name}: ${p.value}`).join(", ");
    return `${arg.preview.description || arg.className || "Object"}{ ${props} }`;
  }
  return arg.className || arg.subtype || arg.type || "";
}

function renderStack(stackTrace) {
  if (!stackTrace || !stackTrace.callFrames) return "";
  return stackTrace.callFrames
    .slice(0, 8)
    .map((f) => `    at ${f.functionName || "<anon>"} (${shortUrl(f.url)}:${f.lineNumber + 1}:${f.columnNumber + 1})`)
    .join("\n");
}

async function getJson(path) {
  const res = await fetch(`${CDP_HTTP}${path}`);
  return res.json();
}

async function main() {
  const version = await getJson("/json/version");
  const browserWsUrl = version.webSocketDebuggerUrl;
  line("init", null, `connecting to browser endpoint ${browserWsUrl}`);

  const ws = new WebSocket(browserWsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  let nextId = 1;
  const sessions = new Map(); // sessionId -> { type, url, targetId }

  function send(method, params = {}, sessionId) {
    const payload = { id: nextId++, method, params };
    if (sessionId) payload.sessionId = sessionId;
    ws.send(JSON.stringify(payload));
  }

  ws.on("open", () => {
    line("init", null, "browser CDP socket open");
    send("Target.setDiscoverTargets", { discover: true });
    send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  });

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    const { method, params, sessionId } = msg;
    if (!method) return;

    if (method === "Target.attachedToTarget") {
      const t = params.targetInfo;
      const sid = params.sessionId;
      for (const info of sessions.values()) {
        if (info.targetId === t.targetId) {
          // Already tracking this target via another session; drop the duplicate.
          send("Target.detachFromTarget", { sessionId: sid });
          return;
        }
      }
      sessions.set(sid, { type: t.type, url: t.url, targetId: t.targetId });
      line("attach", sessions.get(sid), `attached (${t.type})`);
      send("Runtime.enable", {}, sid);
      send("Log.enable", {}, sid);
      send("Runtime.setAsyncCallStackDepth", { maxDepth: 32 }, sid);
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
      for (const info of sessions.values()) {
        if (info.targetId === t.targetId) info.url = t.url;
      }
      return;
    }

    const target = sessions.get(sessionId);

    if (method === "Runtime.consoleAPICalled") {
      const level = params.type;
      const text = (params.args || []).map(renderArg).join(" ");
      const tag = level === "error" ? "console.error" : level === "warning" ? "console.warn" : `console.${level}`;
      let out = text;
      if (level === "error" || level === "warning") {
        const stack = renderStack(params.stackTrace);
        if (stack) out += `\n${stack}`;
      }
      line(tag, target, out);
      return;
    }

    if (method === "Runtime.exceptionThrown") {
      const d = params.exceptionDetails || {};
      const desc = d.exception?.description || d.text || "uncaught exception";
      const stack = renderStack(d.stackTrace);
      line("pageerror", target, stack ? `${desc}\n${stack}` : desc);
      return;
    }

    if (method === "Log.entryAdded") {
      const e = params.entry || {};
      if (e.level === "error" || e.level === "warning") {
        const loc = e.url ? ` (${shortUrl(e.url)}:${e.lineNumber ?? "?"})` : "";
        line(`log.${e.level}`, target, `${e.text}${loc}`);
      }
      return;
    }
  });

  ws.on("close", () => {
    line("init", null, "browser CDP socket closed");
    process.exit(0);
  });
  ws.on("error", (err) => {
    line("init", null, `socket error: ${err.message}`);
  });
}

main().catch((err) => {
  process.stdout.write(`[obs ${nowIso()}] [fatal] ${err.stack || err}\n`);
  process.exit(1);
});
