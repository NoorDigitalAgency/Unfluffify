(function () {
  const CHANNEL = "uf-page-bus/1";
  const ALLOWED = new Set([
    "ARM",
    "SET_MOTION_PAUSED",
    "SET_LAZY_LOADING_SUPPRESSED",
    "DESTROY",
  ]);
  let armed = false;
  let sessionNonce = "";

  function reply(source, request, ok, payload, failure) {
    source.postMessage({
      kind: CHANNEL,
      type: "response",
      nonce: request.nonce,
      command: request.command,
      ok,
      payload: ok ? payload : null,
      failure: ok ? undefined : failure,
    }, "*");
  }

  globalThis.addEventListener("message", (event) => {
    const request = event.data;
    if (!request || request.kind !== CHANNEL || request.type !== "request") {
      return;
    }
    if (!ALLOWED.has(request.command)) {
      reply(event.source || globalThis, request, false, null, {
        code: "PAGE_COMMAND_REJECTED",
        message: "Unsupported page-world command",
      });
      return;
    }
    if (typeof request.nonce !== "string" || request.nonce.length === 0) {
      reply(event.source || globalThis, request, false, null, {
        code: "PAGE_NONCE_REQUIRED",
        message: "Page-world command requires a nonce",
      });
      return;
    }
    if (request.command === "ARM") {
      if (armed && request.nonce !== sessionNonce) {
        reply(event.source || globalThis, request, false, null, {
          code: "PAGE_NONCE_MISMATCH",
          message: "Page-world command nonce did not match the armed session",
        });
        return;
      }
      armed = true;
      sessionNonce = request.nonce;
    } else if (!armed || request.sessionNonce !== sessionNonce) {
      reply(event.source || globalThis, request, false, null, {
        code: "PAGE_NONCE_MISMATCH",
        message: "Page-world command session nonce did not match the armed session",
      });
      return;
    }
    if (request.command === "DESTROY") {
      armed = false;
      sessionNonce = "";
    }
    reply(event.source || globalThis, request, true, { armed }, undefined);
  });
}());
