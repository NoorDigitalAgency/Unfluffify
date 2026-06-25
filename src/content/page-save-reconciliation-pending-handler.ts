type PageSaveReconciliationPendingDeps = {
  setPageSaveReconciliationPending: (
    targetBaseUrl: unknown,
    pageUrl: unknown,
    options: { reason: string }
  ) => Promise<unknown>;
};

type SetPendingArgs = {
  targetBaseUrl?: unknown;
  pageUrl?: unknown;
  reason?: unknown;
};

export function createPageSaveReconciliationPendingHandler(
  deps: PageSaveReconciliationPendingDeps
) {
  async function setPending({ targetBaseUrl, pageUrl, reason }: SetPendingArgs): Promise<{
    ok: true;
    reconciliation: unknown;
  }> {
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