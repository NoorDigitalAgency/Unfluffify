import { z } from "zod";

export const PublicationSnapshotStatusSchema = z.enum([
  "published",
  "already_published",
  "reconciliation_required",
  "candidate_removed",
  "candidate_feed_conflict",
]);

export const PublicationFailureStatusSchema = z.enum([
  "publication_unknown",
  "publication_rejected",
  "selector_fingerprint_mismatch",
  "todo_incomplete",
  "no_actionable_page_types",
  "no_selectors",
  "stale_fence",
  "revision_conflict",
  "operation_conflict",
  "operation_pending",
  "invalid_request",
  "authentication_required",
  "access_denied",
  "property_not_found",
  "environment_not_registered",
  "invalid_upstream",
  "upstream_unavailable",
]);

export const PublicationCommandStatusSchema = z.union([
  PublicationSnapshotStatusSchema,
  PublicationFailureStatusSchema,
  z.enum(["environment_unconfigured", "integrity_shrink"]),
]);

export type PublicationSnapshotStatus = z.infer<typeof PublicationSnapshotStatusSchema>;
export type PublicationFailureStatus = z.infer<typeof PublicationFailureStatusSchema>;
export type PublicationCommandStatus = z.infer<typeof PublicationCommandStatusSchema>;
