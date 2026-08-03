import { z } from "zod";

import { RenderModeSchema } from "../domain/schema/property";

export const URL_SEARCH_INFO_QUERY = `
query getUrlSearchInfo($url: String!, $includePageInfo: Boolean!) {
  urlSearchInfo(url: $url, includePageInfo: $includePageInfo) {
    domainId
    domainName
  }
}
`;

export const PROPERTY_PAGE_TYPES_QUERY = `
query getPropertyPageTypes($domainId: Int!) {
  propertyPageTypes(domainId: $domainId) {
    pageTypes {
      pageType
      pages {
        url
        wordsCount
      }
    }
  }
}
`;

export const CSS_INFO_QUERY = `
query cssInfo($url: String!) {
  cssInfo(url: $url) {
    domainId
    domainName
    exclusionCssSelectors
    inclusionCssSelectors
    isJavascriptRenderingEnabled
    usesUnfluffify
  }
}
`;

export const UPDATE_SCRAPING_CONDITIONS_MUTATION = `
mutation updateScrapingConditions($domainId: Int!, $includeCss: String!, $excludeCss: String!, $renderingMode: DomainRenderMode) {
  updateScrapingConditions(
    domainId: $domainId
    includeCss: $includeCss
    excludeCss: $excludeCss
    renderingMode: $renderingMode
  )
}
`;

export function buildUrlSearchInfoRequest(url: string) {
  return {
    query: URL_SEARCH_INFO_QUERY,
    variables: { url, includePageInfo: false },
  };
}

export function parseUrlSearchInfo(payload: unknown): { siteId: number | null; notFound: boolean } {
  const errorCode = z.object({
    errors: z.array(z.object({ extensions: z.object({ code: z.string() }).passthrough() }).passthrough()).optional(),
  }).safeParse(payload);
  if (errorCode.success && errorCode.data.errors?.some((error) => error.extensions.code === "NotFound")) {
    return { siteId: null, notFound: true };
  }
  const parsed = z.object({
    data: z.object({
      urlSearchInfo: z.object({
        domainId: z.number().int().positive().nullable(),
      }).nullable(),
    }),
  }).safeParse(payload);
  return {
    siteId: parsed.success ? parsed.data.data.urlSearchInfo?.domainId ?? null : null,
    notFound: false,
  };
}

/** GraphQL answers an auth failure with HTTP 200 and an `errors` envelope, which
 *  `parseUrlSearchInfo` cannot distinguish from a genuine miss — it reports both
 *  as "no site id". Reading the error code separately keeps a rejected token from
 *  being announced as "this page is not a managed property". Returns "" when the
 *  payload carries no error envelope. */
export function readGraphqlErrorCode(payload: unknown): string {
  const parsed = z.object({
    errors: z.array(z.object({
      extensions: z.object({ code: z.string() }).passthrough().optional(),
      message: z.string().optional(),
    }).passthrough()).min(1),
  }).safeParse(payload);
  if (!parsed.success) {
    return "";
  }
  const first = parsed.data.errors[0];
  return first.extensions?.code || first.message || "graphql_error";
}

export function buildPropertyPageTypesRequest(domainId: number) {
  return { query: PROPERTY_PAGE_TYPES_QUERY, variables: { domainId } };
}

export function buildCssInfoRequest(url: string) {
  return { query: CSS_INFO_QUERY, variables: { url } };
}

export function toDomainRenderMode(renderMode: unknown): "STATIC" | "RENDERED" | null {
  const parsed = RenderModeSchema.safeParse(renderMode);
  if (!parsed.success) {
    return null;
  }
  return parsed.data === "static" ? "STATIC" : "RENDERED";
}

export function buildUpdateScrapingConditionsRequest(input: Readonly<{
  domainId: number;
  includeCss: string;
  excludeCss: string;
  renderMode: unknown;
}>) {
  return {
    query: UPDATE_SCRAPING_CONDITIONS_MUTATION,
    variables: {
      domainId: input.domainId,
      includeCss: input.includeCss,
      excludeCss: input.excludeCss,
      renderingMode: toDomainRenderMode(input.renderMode),
    },
  };
}
