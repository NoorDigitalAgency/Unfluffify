import type { ConfigSnapshot } from "./config";
import { ConfigSnapshotSchema } from "./config";

export type SessionDraft = Readonly<{
  baseline: ConfigSnapshot;
  draft: ConfigSnapshot;
  dirty: boolean;
}>;

function cloneSnapshot(snapshot: ConfigSnapshot): ConfigSnapshot {
  return ConfigSnapshotSchema.parse(structuredClone(snapshot));
}

export function createSessionDraft(baseline: ConfigSnapshot): SessionDraft {
  const parsed = ConfigSnapshotSchema.parse(baseline);
  return { baseline: cloneSnapshot(parsed), draft: cloneSnapshot(parsed), dirty: false };
}

export function updateSessionDraft(session: SessionDraft, draft: ConfigSnapshot): SessionDraft {
  return {
    ...session,
    draft: ConfigSnapshotSchema.parse(draft),
    dirty: true,
  };
}

export function discardSessionDraft(session: SessionDraft): SessionDraft {
  return {
    ...session,
    draft: cloneSnapshot(session.baseline),
    dirty: false,
  };
}

export function replaceBaselineFromLoad(session: SessionDraft, loaded: ConfigSnapshot): SessionDraft {
  const parsed = ConfigSnapshotSchema.parse(loaded);
  return {
    baseline: cloneSnapshot(parsed),
    draft: cloneSnapshot(parsed),
    dirty: false,
  };
}
