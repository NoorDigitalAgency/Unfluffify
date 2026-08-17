import { AiRunPayloadSnapshotSchema, type AiRunPayloadPage, type AiRunPayloadSnapshot } from "../domain/schema/submission";
import { ConfigSnapshotSchema, type ConfigSnapshot } from "./config";

export class PropertySnapshotIntegrityError extends Error {
  readonly code = "integrity_shrink";

  constructor(message: string) {
    super(message);
    this.name = "PropertySnapshotIntegrityError";
  }
}

export function normalizeEnvironmentKey(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(candidate).hostname.replace(/\.$/, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

export function canonicalPageKey(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const absolute = new URL(trimmed);
    return `${absolute.pathname || "/"}${absolute.search}${absolute.hash}`;
  } catch {
    if (trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.includes("\\")) {
      return trimmed;
    }
    return null;
  }
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

/** Validates an authoritative replacement before the background adopts it.
 *  Ordinary responses may add/relabel pages, but a smaller corpus needs the
 *  exact newer reconciliation proof required by D19. */
export function adoptAuthoritativeSnapshot(
  previousValue: ConfigSnapshot | null | undefined,
  nextValue: unknown,
  expectedScope?: Readonly<{ environmentKey: string; siteId: number }>,
): ConfigSnapshot {
  const next = ConfigSnapshotSchema.parse(nextValue);
  if (expectedScope && (
    next.environmentKey !== expectedScope.environmentKey ||
    next.siteId !== expectedScope.siteId
  )) {
    throw new PropertySnapshotIntegrityError("Authoritative response does not match the requested property scope.");
  }
  if (!previousValue) {
    return next;
  }
  const previous = ConfigSnapshotSchema.parse(previousValue);
  if (previous.environmentKey !== next.environmentKey || previous.siteId !== next.siteId) {
    throw new PropertySnapshotIntegrityError("Authoritative response changed property scope.");
  }
  if (
    next.propertyRevision < previous.propertyRevision ||
    next.feedRevision < previous.feedRevision ||
    next.reconciliation.revision < previous.reconciliation.revision
  ) {
    throw new PropertySnapshotIntegrityError("Authoritative response decreased a property revision.");
  }

  const removed = sorted(Object.keys(previous.pages).filter((pageKey) => !(pageKey in next.pages)));
  if (removed.length === 0) {
    return next;
  }
  const provedRemoved = sorted(next.reconciliation.removedPageKeys);
  const proofMatches =
    next.reconciliation.revision > previous.reconciliation.revision &&
    next.feedRevision > previous.feedRevision &&
    next.reconciliation.feedFingerprint.trim().length > 0 &&
    removed.length === provedRemoved.length &&
    removed.every((pageKey, index) => pageKey === provedRemoved[index]);
  if (!proofMatches) {
    throw new PropertySnapshotIntegrityError(
      `Authoritative response removed ${removed.join(", ")} without exact reconciliation proof.`,
    );
  }
  return next;
}

function storedPageForAi(
  snapshot: ConfigSnapshot,
  pageKey: string,
): AiRunPayloadPage {
  const page = snapshot.pages[pageKey];
  const absoluteUrl = new URL(pageKey, snapshot.baseUrl).toString();
  return {
    url: absoluteUrl,
    renderedHtml: page.renderedHtml,
    ...(snapshot.renderMode === "static" ? { rawHtml: page.rawHtml } : {}),
    renderedXPaths: page.rows,
  };
}

/** Builds the AI corpus from the durable background baseline and replaces the
 *  current page with its live capture. The popup never owns or uploads a full
 *  persistence snapshot. */
export function overlayLivePageOnAuthoritativeCorpus(
  authoritative: ConfigSnapshot | null | undefined,
  liveValue: AiRunPayloadSnapshot,
): AiRunPayloadSnapshot {
  const live = AiRunPayloadSnapshotSchema.parse(liveValue);
  if (!authoritative) {
    return live;
  }
  const baseline = ConfigSnapshotSchema.parse(authoritative);
  const livePageKeys = new Set(
    live.pages.map((page) => canonicalPageKey(page.url)).filter((value): value is string => value !== null),
  );
  const storedPages = Object.keys(baseline.pages)
    .filter((pageKey) => !livePageKeys.has(pageKey))
    .sort()
    .map((pageKey) => storedPageForAi(baseline, pageKey));
  return AiRunPayloadSnapshotSchema.parse({
    ...live,
    pages: [...storedPages, ...live.pages],
  });
}
