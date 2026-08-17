import type { PageContextResolution } from "./schema/context";
import type { TodoCoverage } from "./schema/todo";
import type { ConfigSnapshot, SelectorSet } from "../storage/config";

export type PublicationChecklistGate =
  | Readonly<{ status: "ready" }>
  | Readonly<{ status: "context_unavailable" }>
  | Readonly<{ status: "config_unavailable" }>
  | Readonly<{ status: "no_actionable_page_types" }>
  | Readonly<{ status: "missing_page_types"; pageTypes: readonly string[] }>
  | Readonly<{ status: "no_selectors" }>
  | Readonly<{ status: "authority_unavailable" }>
  | Readonly<{ status: "revision_mismatch" }>;

export type PublicationAuthority = Readonly<{
  environmentKey: string;
  siteId: number;
  propertyRevision: number;
  feedRevision: number;
}>;

export function normalizeSavedSelectors(selectors: SelectorSet): SelectorSet {
  const normalize = (values: readonly string[]): string[] => [...new Set(
    values.map((value) => value.trim()).filter(Boolean),
  )].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  return {
    exclusionSelectors: normalize(selectors.exclusionSelectors),
    inclusionSelectors: normalize(selectors.inclusionSelectors),
  };
}

export async function savedSelectorsFingerprint(selectors: SelectorSet): Promise<string> {
  const normalized = normalizeSavedSelectors(selectors);
  const input = new TextEncoder().encode(JSON.stringify({
    exclusionSelectors: normalized.exclusionSelectors,
    inclusionSelectors: normalized.inclusionSelectors,
  }));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function evaluatePublicationChecklist(input: Readonly<{
  contextStatus: PageContextResolution["status"] | "unresolved";
  todo: TodoCoverage;
  config: ConfigSnapshot | null;
  authority: PublicationAuthority | null;
}>): PublicationChecklistGate {
  if (input.contextStatus !== "managed_candidate" && input.contextStatus !== "managed_non_candidate") {
    return { status: "context_unavailable" };
  }
  if (!input.config) {
    return { status: "config_unavailable" };
  }
  if (input.todo.actionable === 0) {
    return { status: "no_actionable_page_types" };
  }
  const missing = input.todo.pageTypes
    .filter((pageType) => pageType.markedCount < 1)
    .map((pageType) => pageType.pageType);
  if (missing.length > 0 || input.todo.covered < input.todo.actionable) {
    return { status: "missing_page_types", pageTypes: missing };
  }
  const selectors = normalizeSavedSelectors(input.config.selectors);
  if (selectors.exclusionSelectors.length === 0 && selectors.inclusionSelectors.length === 0) {
    return { status: "no_selectors" };
  }
  if (!input.authority) {
    return { status: "authority_unavailable" };
  }
  if (
    input.authority.environmentKey !== input.config.environmentKey ||
    input.authority.siteId !== input.config.siteId ||
    input.authority.propertyRevision !== input.config.propertyRevision ||
    input.authority.feedRevision !== input.config.feedRevision
  ) {
    return { status: "revision_mismatch" };
  }
  return { status: "ready" };
}
