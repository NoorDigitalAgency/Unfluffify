// @ts-nocheck
export function createPageSaveReconciliationPendingHandler(deps) {
  async function setPending({ targetBaseUrl, pageUrl, reason }) {
    const reconciliation = await deps.setPageSaveReconciliationPending(targetBaseUrl, pageUrl, {
      reason: typeof reason === "string" ? reason : "pending"
    });

    return {
      ok: true,
      reconciliation
    };
  }

  return {
    setPending
  };
}