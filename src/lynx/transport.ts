export type JsonRequest = Readonly<{
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  /** Optional caller-owned cancellation. The transport never mutates it. */
  signal?: AbortSignal;
  /** Absolute wall-clock deadline. The transport also applies its own default. */
  deadlineAt?: number;
}>;

export type JsonTransportFailureKind = "timeout" | "cancelled" | "network" | "invalid_response";
export type JsonTransportFailure = Readonly<{
  kind: JsonTransportFailureKind;
  message: string;
  /** Bounded service detail for debug diagnostics; never operator copy. */
  diagnostic?: string;
}>;

export type JsonResponse = Readonly<{
  status: number;
  body: unknown;
  headers?: Readonly<Record<string, string>>;
  transportFailure?: JsonTransportFailure;
}>;

export type JsonTransport = (request: JsonRequest) => Promise<JsonResponse>;

export function okJson(body: unknown, status = 200, headers: Readonly<Record<string, string>> = {}): JsonResponse {
  return { status, body, headers };
}

export function getResponseHeader(response: JsonResponse, name: string): string {
  const lower = name.toLowerCase();
  const entry = Object.entries(response.headers ?? {}).find(([key]) => key.toLowerCase() === lower);
  return entry?.[1] ?? "";
}
