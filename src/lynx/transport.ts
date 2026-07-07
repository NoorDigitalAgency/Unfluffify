export type JsonRequest = Readonly<{
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}>;

export type JsonResponse = Readonly<{
  status: number;
  body: unknown;
}>;

export type JsonTransport = (request: JsonRequest) => Promise<JsonResponse>;

export function okJson(body: unknown, status = 200): JsonResponse {
  return { status, body };
}
