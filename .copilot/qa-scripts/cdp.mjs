// Raw-CDP driver: no Playwright, no persistent connectOverCDP (safe for dialogs).
// Usage: node /tmp/cdp.mjs <targetMatch> <awaitBool> '<expression>'
//   targetMatch: "popup" | "service_worker" | "page" | substring of target url
// Reads /json, picks the target, opens one WS, Runtime.evaluate, prints JSON, closes.

const CDP = "http://127.0.0.1:9222";

async function listTargets() {
  const r = await fetch(`${CDP}/json`);
  return await r.json();
}

function pickTarget(targets, match) {
  const norm = (t) => `${t.type} ${t.url}`;
  if (match === "popup") {
    return targets.find((t) => t.type === "page" && t.url.includes("/popup.html"));
  }
  if (match === "service_worker" || match === "sw") {
    return targets.find((t) => t.type === "service_worker");
  }
  if (match === "page") {
    return targets.find(
      (t) => t.type === "page" && !t.url.startsWith("chrome-extension://") && !t.url.startsWith("chrome://")
    );
  }
  return targets.find((t) => t.url.includes(match));
}

function evaluate(wsUrl, expression, awaitPromise) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const send = (method, params) => {
      const mid = ++id;
      pending.set(mid, method);
      ws.send(JSON.stringify({ id: mid, method, params }));
      return mid;
    };
    let evalId = -1;
    ws.onopen = () => {
      send("Runtime.enable", {});
      evalId = send("Runtime.evaluate", {
        expression,
        awaitPromise: !!awaitPromise,
        returnByValue: true,
        userGesture: true,
      });
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === evalId) {
        ws.close();
        if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
        const res = msg.result?.result;
        if (msg.result?.exceptionDetails) {
          return reject(new Error(JSON.stringify(msg.result.exceptionDetails)));
        }
        resolve(res?.value !== undefined ? res.value : res);
      }
    };
    ws.onerror = (e) => reject(new Error("ws error " + (e?.message || e)));
    setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error("cdp timeout"));
    }, 20000);
  });
}

const [, , match, awaitFlag, ...exprParts] = process.argv;
const expression = exprParts.join(" ");
const targets = await listTargets();
const t = pickTarget(targets, match || "popup");
if (!t) {
  console.error("NO_TARGET for match=" + match);
  console.error(targets.map((x) => `${x.type} ${x.url}`).join("\n"));
  process.exit(2);
}
try {
  const value = await evaluate(t.webSocketDebuggerUrl, expression, awaitFlag === "true");
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  process.exit(0);
} catch (e) {
  console.error("EVAL_ERROR:", e.message);
  process.exit(1);
}
