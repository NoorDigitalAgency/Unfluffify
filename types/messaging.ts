export type MessageSource = "popup" | "content" | "background" | "unknown";

export interface MessageEnvelope<TPayload = unknown> {
  source: MessageSource;
  target?: MessageSource;
  type: string;
  payload?: TPayload;
}

export interface MessageReplyEnvelope<TResult = unknown> {
  ok: boolean;
  result?: TResult;
  error?: {
    code?: string;
    message: string;
  };
}
