import { z } from "zod";

import {
  LockBannerVocabularySchema,
  LockReasonSchema,
  LockRoleSchema,
  type LockBannerVocabulary,
  type LockReason,
  type LockRole,
} from "../domain/schema/facts";
import type { CommandEnvelope, CommandReply } from "../messaging/contracts";
import { resolveContentLockCopy } from "./copy";
import type { ContentPresentation } from "./organ";

export const ContentLockStateSchema = z.object({
  baseUrl: z.string().url(),
  configPresent: z.boolean(),
  lockRole: LockRoleSchema,
  canEdit: z.boolean(),
  blockedReason: LockReasonSchema,
  banner: LockBannerVocabularySchema,
});

export type ContentLockState = z.infer<typeof ContentLockStateSchema>;
export type ContentLockBanner = Readonly<LockBannerVocabulary & { text: string }>;
export type ContentAuthorityState = Readonly<{
  baseUrl: string;
  configPresent: boolean;
  lockRole: LockRole;
  lockBlocked: boolean;
  blockedReason: LockReason | "";
  banner: ContentLockBanner;
}>;

export type ContentCommandContext = Readonly<{
  pageUrl: string;
  baseUrl: string;
  authority: ContentAuthorityState;
  presentation: ContentPresentation;
}>;

export type ContentCommandHandler = (
  payload: unknown,
  command: CommandEnvelope,
) => Promise<unknown> | unknown;

export type ContentCommandRouterOptions = Readonly<{
  currentContext(): ContentCommandContext;
  handlers: Readonly<Record<string, ContentCommandHandler>>;
  pingActivity(command: CommandEnvelope): Promise<void> | void;
}>;

const DATA_AFFECTING_COMMANDS = new Set([
  "activateContentMain",
  "captureSubmissionSnapshot",
  "resetContentMain",
]);
const LOCK_BLOCKED_COMMANDS = new Set([
  "activateContentMain",
  "captureSubmissionSnapshot",
]);
const PRESENTATION_EDIT_BLOCKED_COMMANDS = new Set([
  "activateContentMain",
]);

function baseUrlFor(url: string): string {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
}

function payloadObject(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

function success(data: unknown): CommandReply {
  return { ok: true, data };
}

function failure(code: string, message: string): CommandReply {
  return { ok: false, failure: { code, message } };
}

function commandDataSucceeded(data: unknown): boolean {
  return !(data && typeof data === "object" && !Array.isArray(data) && "ok" in data && data.ok === false);
}

function gateCommand(command: CommandEnvelope, context: ContentCommandContext): CommandReply | null {
  if (!DATA_AFFECTING_COMMANDS.has(command.name)) {
    return null;
  }
  const payload = payloadObject(command.payload);
  const commandPageUrl = typeof payload.pageUrl === "string" ? payload.pageUrl : context.pageUrl;
  const commandBaseUrl = typeof payload.baseUrl === "string" ? payload.baseUrl : baseUrlFor(commandPageUrl);
  if (context.authority.baseUrl && commandBaseUrl && context.authority.baseUrl !== commandBaseUrl) {
    return failure("base-url-mismatch", "Content command baseUrl does not match the active property lock");
  }
  if (!context.authority.configPresent) {
    return failure("config-missing", "Content command requires a loaded property config");
  }
  if (context.authority.lockRole !== "editor") {
    return failure("property-lock", "Content command requires the editor property lock");
  }
  if (context.presentation.reconciliationPending) {
    return failure("reconciliation-pending", "Content command is blocked while reconciliation is pending");
  }
  if (context.authority.lockBlocked && LOCK_BLOCKED_COMMANDS.has(command.name)) {
    return failure(
      context.authority.blockedReason || "property-lock",
      "Content state currently blocks marking edits",
    );
  }
  // Run AI enters its blocking presentation before it captures the immutable
  // snapshot, preventing page edits during the capture. The capture itself is
  // read-only and must remain available under that curtain.
  if (
    context.presentation.markingEditsBlocked &&
    PRESENTATION_EDIT_BLOCKED_COMMANDS.has(command.name)
  ) {
    return failure(
      context.presentation.blockedReason || "session-blocked",
      "Content state currently blocks marking edits",
    );
  }
  return null;
}

export function createDefaultContentAuthority(pageUrl: string): ContentAuthorityState {
  return {
    baseUrl: baseUrlFor(pageUrl),
    configPresent: false,
    lockRole: "unknown",
    lockBlocked: false,
    blockedReason: "",
    banner: { visible: false, reason: "editor", text: "" },
  };
}

export function authorityFromLockState(state: ContentLockState): ContentAuthorityState {
  return {
    baseUrl: state.baseUrl,
    configPresent: state.configPresent,
    lockRole: state.lockRole,
    lockBlocked: !state.canEdit,
    blockedReason: state.blockedReason,
    banner: {
      ...state.banner,
      text: resolveContentLockCopy(state.banner),
    },
  };
}

export function createContentCommandRouter(options: ContentCommandRouterOptions) {
  return {
    async dispatch(command: CommandEnvelope): Promise<CommandReply> {
      try {
        const handler = options.handlers[command.name];
        if (!handler) {
          return failure("unknown-command", `Unknown content command: ${command.name}`);
        }
        const gated = gateCommand(command, options.currentContext());
        if (gated) {
          return gated;
        }
        const data = await handler(command.payload, command);
        if (DATA_AFFECTING_COMMANDS.has(command.name) && commandDataSucceeded(data)) {
          await options.pingActivity(command);
        }
        return success(data);
      } catch (error) {
        return failure(
          "command-failed",
          error instanceof Error && error.message ? error.message : `Content command failed: ${command.name}`,
        );
      }
    },
  };
}
