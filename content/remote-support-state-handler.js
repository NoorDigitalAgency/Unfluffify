export function createRemoteSupportStateHandler(deps) {
  function handleMessage(message = {}) {
    const remoteSupportState =
      message.type === "remoteSupportState" && message.state && typeof message.state === "object"
        ? message.state
        : message;

    deps.applyRemoteSupportSessionState(remoteSupportState || null);

    return {
      ok: true,
      mode: deps.getRemoteSupportMode(),
      role: deps.getRemoteSupportRole()
    };
  }

  return {
    handleMessage
  };
}
