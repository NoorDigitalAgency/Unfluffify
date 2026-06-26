import { type Browser } from "../common/browser";
import {
  MESSAGE_ERROR_CODES,
  MESSAGE_TARGETS,
  createFailureEnvelope,
  isRequestEnvelope,
  type RequestEnvelope
} from "../common/message-protocol";

type DispatchInboundContentCommand = (
  message: RequestEnvelope,
  sender: Browser.runtime.MessageSender | undefined,
) => Promise<unknown>;

export type InboundContentRequestDispatchResult =
  | { handled: false }
  | { handled: true; reply?: Promise<unknown> };

export function routeInboundContentRequestMessage(
  message: unknown,
  sender: Browser.runtime.MessageSender | undefined,
  dispatchContentCommand: DispatchInboundContentCommand,
): InboundContentRequestDispatchResult {
  if (!isRequestEnvelope(message) || message.target !== MESSAGE_TARGETS.CONTENT) {
    return { handled: false };
  }

  const dispatchPromise = dispatchContentCommand(message, sender);
  if (message.expectsReply === false) {
    void dispatchPromise.catch(() => undefined);
    return { handled: true };
  }

  return {
    handled: true,
    reply: dispatchPromise.catch((error) => {
      return createFailureEnvelope(
        message,
        MESSAGE_ERROR_CODES.HANDLER_FAILED,
        (error && error.message) || "Content command failed",
      );
    }),
  };
}
