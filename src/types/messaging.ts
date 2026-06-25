export type MessageSource = "popup" | "content" | "background" | "unknown";

export interface RuntimeMessage {
  type: string;
  source?: MessageSource | string;
  target?: MessageSource | string;
  tabId?: number;
  operationId?: string;
  kind?: string;
  phase?: string;
  message?: string;
  code?: string;
  error?: string;
  details?: unknown;
  payload?: unknown;
  [key: string]: unknown;
}

export interface RuntimeMessageReply {
  ok: boolean;
  code?: string;
  error?: string;
  message?: string;
  details?: unknown;
  result?: unknown;
  [key: string]: unknown;
}

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
