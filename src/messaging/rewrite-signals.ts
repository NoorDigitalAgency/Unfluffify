import type { createRealmBus } from "./realms";

export type RewriteSignalBus = ReturnType<typeof createRealmBus>;

export function parseSenderTabId(sourceInstance?: string): number | null {
  const match = sourceInstance?.match(/(?:^|:)tab:(\d+):/);
  if (!match) {
    return null;
  }
  const tabId = Number.parseInt(match[1], 10);
  return Number.isFinite(tabId) ? tabId : null;
}

export function parseSenderFrameId(sourceInstance?: string): number | null {
  const match = sourceInstance?.match(/(?:^|:)frame:(\d+)(?::|$)/);
  if (!match) {
    return null;
  }
  const frameId = Number.parseInt(match[1], 10);
  return Number.isFinite(frameId) ? frameId : null;
}

export function parseSenderDocumentId(sourceInstance?: string): string | null {
  const match = sourceInstance?.match(/(?:^|:)document:([^:]+)(?::|$)/);
  if (!match) {
    return null;
  }
  try {
    const documentId = decodeURIComponent(match[1]);
    return documentId ? documentId : null;
  } catch {
    return null;
  }
}

export async function pullRewriteSignals(
  bus: RewriteSignalBus,
  input: Readonly<{ tabId: number; afterSeq: number; organId?: string }>,
) {
  return await bus.request("signals.pull", input, { target: "background" });
}
