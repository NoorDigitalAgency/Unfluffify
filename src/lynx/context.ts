import type { PropertyContextResponse } from "../domain/schema/context";
import { PropertyContextResponseSchema } from "../domain/schema/context";
import type { JsonTransport } from "./transport";

function unavailable(environmentKey: string): PropertyContextResponse {
  return {
    status: "upstream_unavailable",
    environmentKey,
    siteId: null,
    baseUrl: null,
    pageKey: null,
    pageTypes: [],
    membershipFingerprint: null,
    assignmentFingerprint: null,
    conflicts: [],
    upstreamCode: null,
  };
}

/** Resolve through Hub, not GraphQL. A typed Hub body wins over the HTTP status:
 * Hub has already classified misleading upstream statuses and forwarded token
 * rotation before this parser sees the response. */
export async function resolvePropertyContext(
  transport: JsonTransport,
  environmentKey: string,
  url: string,
): Promise<PropertyContextResponse> {
  try {
    const response = await transport({
      method: "POST",
      path: "/context",
      body: { environmentKey, url },
    });
    const parsed = PropertyContextResponseSchema.safeParse(response.body);
    return parsed.success ? parsed.data : unavailable(environmentKey);
  } catch {
    return unavailable(environmentKey);
  }
}
