import { z } from "zod";

import { LockRoleSchema, type LockRole } from "../domain/schema/facts";
import type { CommandEnvelope, CommandReply } from "../messaging/contracts";

const DirectiveSurfaceSchema = z.object({
  markingEditsBlocked: z.boolean().optional(),
  blockedReason: z.string().optional(),
  curtain: z.object({
    visible: z.boolean(),
    text: z.string(),
  }).optional(),
  banner: z.object({
    visible: z.boolean(),
    text: z.string(),
  }).optional(),
  blockOwner: z.enum(["lock", "popup"]).optional(),
  renderMode: z.enum(["rendered", "static"]).optional(),
}).default({});

export const ContentDirectiveSchema = z.object({
  baseUrl: z.string().url().optional(),
  configPresent: z.boolean().optional(),
  lockRole: LockRoleSchema.optional(),
  reconciliationPending: z.boolean().optional(),
  content: DirectiveSurfaceSchema.optional(),
});

export type ContentDirectivePatch = z.infer<typeof ContentDirectiveSchema>;
export type ContentDirectiveState = Readonly<{
  baseUrl: string;
  configPresent: boolean;
  lockRole: LockRole;
  reconciliationPending: boolean;
  content: Readonly<{
    markingEditsBlocked: boolean;
    blockedReason: string;
    curtain: Readonly<{ visible: boolean; text: string }>;
    banner: Readonly<{ visible: boolean; text: string }>;
    blockOwner?: "lock" | "popup";
    renderMode: "rendered" | "static";
  }>;
}>;

export type ContentCommandContext = Readonly<{
  pageUrl: string;
  baseUrl: string;
  directive: ContentDirectiveState;
}>;

export type ContentCommandHandler = (
  payload: unknown,
  command: CommandEnvelope,
) => Promise<unknown> | unknown;

export type ContentCommandRouterOptions = Readonly<{
  currentContext(): ContentCommandContext;
  handlers: Readonly<Record<string, ContentCommandHandler>>;
  applyDirective(patch: ContentDirectivePatch): ContentDirectiveState;
  pingActivity(command: CommandEnvelope): Promise<void> | void;
}>;

const DATA_AFFECTING_COMMANDS = new Set([
  "activateContentMain",
  "captureSubmissionSnapshot",
  "resetContentMain",
]);
const DIRECTIVE_EDIT_BLOCKED_COMMANDS = new Set([
  "activateContentMain",
  "captureSubmissionSnapshot",
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
  if (context.directive.baseUrl && commandBaseUrl && context.directive.baseUrl !== commandBaseUrl) {
    return failure("base-url-mismatch", "Content command baseUrl does not match the active directive");
  }
  if (!context.directive.configPresent) {
    return failure("config-missing", "Content command requires a loaded config directive");
  }
  if (context.directive.lockRole !== "editor") {
    return failure("property-lock", "Content command requires the editor property lock");
  }
  if (context.directive.reconciliationPending) {
    return failure("reconciliation-pending", "Content command is blocked while reconciliation is pending");
  }
  if (context.directive.content.markingEditsBlocked && DIRECTIVE_EDIT_BLOCKED_COMMANDS.has(command.name)) {
    return failure(context.directive.content.blockedReason || "directive-blocked", "Content directive currently blocks marking edits");
  }
  return null;
}

export function createDefaultContentDirective(pageUrl: string): ContentDirectiveState {
  return {
    baseUrl: baseUrlFor(pageUrl),
    configPresent: false,
    lockRole: "unknown",
    reconciliationPending: false,
    content: {
      markingEditsBlocked: false,
      blockedReason: "",
      curtain: { visible: false, text: "" },
      banner: { visible: false, text: "" },
      blockOwner: undefined,
      renderMode: "rendered",
    },
  };
}

export function mergeContentDirective(
  current: ContentDirectiveState,
  patch: ContentDirectivePatch,
): ContentDirectiveState {
  const incomingOwner = patch.content?.blockOwner;
  const incomingBlock = patch.content?.markingEditsBlocked;
  const canApplyBlockPatch =
    incomingBlock === undefined ||
    incomingBlock === true ||
    !current.content.markingEditsBlocked ||
    !current.content.blockOwner ||
    !incomingOwner ||
    incomingOwner === current.content.blockOwner;
  const content = canApplyBlockPatch
    ? {
      markingEditsBlocked: incomingBlock ?? current.content.markingEditsBlocked,
      blockedReason: patch.content?.blockedReason ?? current.content.blockedReason,
      curtain: patch.content?.curtain ?? current.content.curtain,
      banner: patch.content?.banner ?? current.content.banner,
      blockOwner: incomingBlock === false ? undefined : incomingOwner ?? current.content.blockOwner,
      renderMode: patch.content?.renderMode ?? current.content.renderMode,
    }
    : {
      ...current.content,
      renderMode: patch.content?.renderMode ?? current.content.renderMode,
    };
  return {
    baseUrl: patch.baseUrl ?? current.baseUrl,
    configPresent: patch.configPresent ?? current.configPresent,
    lockRole: patch.lockRole ?? current.lockRole,
    reconciliationPending: patch.reconciliationPending ?? current.reconciliationPending,
    content,
  };
}

export function createContentCommandRouter(options: ContentCommandRouterOptions) {
  return {
    async dispatch(command: CommandEnvelope): Promise<CommandReply> {
      try {
        if (command.name === "directive.content") {
          const parsed = ContentDirectiveSchema.safeParse(command.payload);
          if (!parsed.success) {
            return failure("invalid-directive", "Content directive payload is invalid");
          }
          return success({ ok: true, directive: options.applyDirective(parsed.data), tree: "rewrite" });
        }
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
