export const BUS_ERROR_CODES = Object.freeze({
  TIMEOUT: "timeout",
  NO_HANDLER: "no_handler",
  DUPLICATE_HANDLER: "duplicate_handler",
  HANDLER_FAILED: "handler_failed",
  TRANSPORT_FAILED: "transport_failed",
  INVALID_ENVELOPE: "invalid_envelope",
  UNREACHABLE_REALM: "unreachable_realm",
} as const);

export type BusErrorCode = typeof BUS_ERROR_CODES[keyof typeof BUS_ERROR_CODES];
export type BusErrorDetails = Readonly<Record<string, unknown>>;

export class BusError extends Error {
  code: string;
  details: BusErrorDetails;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "BusError";
    this.code = code;
    this.details = { ...details };
  }
}
