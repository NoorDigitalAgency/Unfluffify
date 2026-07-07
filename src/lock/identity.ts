import { z } from "zod";

export const LockIdentitySchema = z.object({
  tabId: z.number().int().nonnegative(),
  siteId: z.number().int().positive(),
  identity: z.string().min(1),
  updatedAt: z.number().int().nonnegative(),
});

export type LockIdentity = z.infer<typeof LockIdentitySchema>;

export function adoptLockIdentity(
  previous: LockIdentity | null,
  next: LockIdentity,
): Readonly<{ current: LockIdentity; previousInvalidated: boolean }> {
  const current = LockIdentitySchema.parse(next);
  return {
    current,
    previousInvalidated: Boolean(previous && previous.identity !== current.identity),
  };
}
