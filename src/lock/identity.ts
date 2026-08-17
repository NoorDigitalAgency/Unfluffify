import { z } from "zod";

export const EditorSessionSchema = z.object({
  environmentKey: z.string().trim().min(1),
  tabId: z.number().int().nonnegative(),
  siteId: z.number().int().positive(),
  editorSessionId: z.string().trim().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

/** A client-owned editing session. This is deliberately not the authenticated
 * backend identity and not the backend-issued fencing token. */
export type EditorSession = z.infer<typeof EditorSessionSchema>;

export function adoptEditorSession(
  previous: EditorSession | null,
  next: EditorSession,
): Readonly<{ current: EditorSession; previousInvalidated: boolean }> {
  const current = EditorSessionSchema.parse(next);
  return {
    current,
    previousInvalidated: Boolean(previous && (
      previous.environmentKey !== current.environmentKey ||
      previous.tabId !== current.tabId ||
      previous.siteId !== current.siteId ||
      previous.editorSessionId !== current.editorSessionId
    )),
  };
}
