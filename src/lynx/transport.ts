export type JsonRequest = Readonly<{
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}>;

export type JsonResponse = Readonly<{
  status: number;
  body: unknown;
  headers?: Readonly<Record<string, string>>;
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
