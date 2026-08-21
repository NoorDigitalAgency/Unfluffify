import {
  ShieldDocumentPostureSchema,
  ShieldPostureUpdateSchema,
  ShieldPropertyScopeSchema,
  type ShieldDirective,
  type ShieldExpectedScope,
  type ShieldMutationFence,
  type ShieldPostureClearReason,
  type ShieldPostureMutationResponse,
  type ShieldPostureProjection,
  type ShieldPostureReadResponse,
  type ShieldPostureUpdate,
  type ShieldPropertyScope,
} from "../messaging/shield-posture";
import type { SelectorSet } from "../storage/config";
import {
  ShieldPostureRecordSchema,
  type ShieldPostureRecord,
  type ShieldPostureRepo,
} from "../storage/repositories/shield-posture";

type AdoptInput = Readonly<ShieldPropertyScope & {
  tabId: number;
  documentId: string;
  contextGeneration: number;
  pageUrl: string;
  configPresent: boolean;
}>;

type MutationInput = Readonly<{
  tabId: number;
  documentId: string | null;
  expected: ShieldMutationFence;
}>;

const FULL_CLEAR_REASONS = new Set<ShieldPostureClearReason>([
  "save",
  "discard",
  "unregister",
  "property-exit",
  "config-removed",
  "extension-invalidation",
]);

function normalizedBaseUrl(value: string): string {
  const url = new URL(value);
  return url.origin;
}

function normalizedProperty(scope: ShieldPropertyScope): ShieldPropertyScope {
  return ShieldPropertyScopeSchema.parse({
    environmentKey: scope.environmentKey.trim().toLowerCase(),
    siteId: scope.siteId,
    baseUrl: normalizedBaseUrl(scope.baseUrl),
  });
}

function sameProperty(left: ShieldPropertyScope, right: ShieldPropertyScope): boolean {
  return left.environmentKey === right.environmentKey &&
    left.siteId === right.siteId &&
    left.baseUrl === right.baseUrl;
}

function belongsToProperty(pageUrl: string, property: ShieldPropertyScope): boolean {
  try {
    return new URL(pageUrl).origin === new URL(property.baseUrl).origin;
  } catch {
    return false;
  }
}

function hasSelectors(selectors: SelectorSet | null): selectors is SelectorSet {
  return selectors !== null;
}

function expectedScope(record: ShieldPostureRecord): ShieldExpectedScope | null {
  if (!record.adoptedDocument) {
    return null;
  }
  const { documentId, ...scope } = record.adoptedDocument;
  return { ...scope, documentKey: documentId };
}

function directiveOf(record: ShieldPostureRecord): ShieldDirective | null {
  const silentSelectors = hasSelectors(record.silentSelectors)
    ? record.silentSelectors
    : undefined;
  if (record.documentPosture?.kind === "preview") {
    const { kind: _kind, ...preview } = record.documentPosture;
    return {
      ...(silentSelectors ? { silentSelectors } : {}),
      organ: { state: "preview", ...preview },
    };
  }
  if (record.documentPosture?.kind === "blocked-organ") {
    const { kind: _kind, ...blocked } = record.documentPosture;
    return {
      ...(silentSelectors ? { silentSelectors } : {}),
      organ: { state: "blocked-organ", ...blocked },
    };
  }
  return silentSelectors
    ? { silentSelectors, organ: { state: "silent" } }
    : null;
}

function projectionOf(record: ShieldPostureRecord): ShieldPostureProjection {
  if (!record.configPresent) {
    return { status: "inactive", revision: record.revision };
  }
  const scope = expectedScope(record);
  const directive = scope ? directiveOf(record) : null;
  return scope && directive
    ? { status: "active", revision: record.revision, scope, directive }
    : {
        status: "inactive",
        revision: record.revision,
        ...(scope ? { scope } : {}),
      };
}

function mutationMatches(record: ShieldPostureRecord, input: MutationInput): boolean {
  const adopted = record.adoptedDocument;
  if (!adopted || input.expected.revision !== record.revision) {
    return false;
  }
  if (input.documentId !== null && adopted.documentId !== input.documentId) {
    return false;
  }
  const expectedProperty = normalizedProperty(input.expected);
  return sameProperty(record.property, expectedProperty) &&
    adopted.documentId === input.expected.documentKey &&
    adopted.contextGeneration === input.expected.contextGeneration &&
    adopted.pageUrl === input.expected.pageUrl;
}

export function createShieldPostureRuntime(input: Readonly<{
  repo: ShieldPostureRepo;
  now?: () => number;
}>) {
  const now = input.now ?? Date.now;
  let operations: Promise<unknown> = Promise.resolve();

  // Posture traffic is tiny, while property-wide save/removal teardown must be
  // ordered against every tab mutation to prevent a stale save from resurrecting
  // a directive after the property index was cleared.
  const withOperation = <T>(operation: () => Promise<T>): Promise<T> => {
    const queued = operations.then(operation, operation);
    operations = queued.catch(() => undefined);
    return queued;
  };

  const load = async (tabId: number): Promise<ShieldPostureRecord | null> => {
    const stored = await input.repo.load(tabId);
    if (stored.ok) {
      return stored.value;
    }
    // Invalid durable posture is never adopted. Remove it so a later valid
    // page-context bind can establish authority without repeating the error.
    await input.repo.clear(tabId);
    return null;
  };

  const save = async (record: ShieldPostureRecord): Promise<ShieldPostureRecord> => {
    const parsed = ShieldPostureRecordSchema.parse(record);
    await input.repo.save(parsed);
    return parsed;
  };

  return {
    adoptedDocumentKey(tabId: number): Promise<string | null> {
      return withOperation(async () => (await load(tabId))?.adoptedDocument?.documentId ?? null);
    },

    retainedSilentProperty(request: Readonly<{
      tabId: number;
      pageUrl: string;
    }>): Promise<ShieldPropertyScope | null> {
      return withOperation(async () => {
        const existing = await load(request.tabId);
        if (!existing?.configPresent || !hasSelectors(existing.silentSelectors)) {
          return null;
        }
        if (!belongsToProperty(request.pageUrl, existing.property)) {
          await input.repo.clear(request.tabId);
          return null;
        }
        return existing.property;
      });
    },

    adoptRetainedDocument(adoption: Readonly<{
      tabId: number;
      documentId: string;
      pageUrl: string;
      property: ShieldPropertyScope;
    }>): Promise<ShieldPostureReadResponse> {
      return withOperation(async () => {
        const existing = await load(adoption.tabId);
        if (!existing?.configPresent || !hasSelectors(existing.silentSelectors)) {
          return { status: "unavailable", reason: "no-retained-silent-posture" };
        }
        const property = normalizedProperty(adoption.property);
        if (!sameProperty(existing.property, property)) {
          return { status: "unavailable", reason: "retained-property-changed" };
        }
        if (!belongsToProperty(adoption.pageUrl, property)) {
          await input.repo.clear(adoption.tabId);
          return { status: "unavailable", reason: "different-property" };
        }
        if (existing.adoptedDocument) {
          return existing.adoptedDocument.documentId === adoption.documentId &&
            existing.adoptedDocument.pageUrl === adoption.pageUrl
            ? projectionOf(existing)
            : { status: "unavailable", reason: "document-already-bound" };
        }
        const record = await save({
          ...existing,
          adoptedDocument: {
            ...property,
            documentId: adoption.documentId,
            // This provisional epoch exists only to fence early mutations. The
            // authoritative page.context bind replaces it with Hub's generation.
            contextGeneration: existing.revision + 1,
            pageUrl: adoption.pageUrl,
          },
          revision: existing.revision + 1,
          documentPosture: null,
          updatedAt: now(),
        });
        return projectionOf(record);
      });
    },

    bindDocument(adoption: AdoptInput): Promise<ShieldPostureProjection> {
      return withOperation(async () => {
        const property = normalizedProperty(adoption);
        const existing = await load(adoption.tabId);
        const same = existing ? sameProperty(existing.property, property) : false;
        const revision = (existing?.revision ?? 0) + 1;
        const documentChanged = existing?.adoptedDocument?.documentId !== adoption.documentId ||
          existing?.adoptedDocument?.pageUrl !== adoption.pageUrl;
        const record = await save({
          version: 1,
          tabId: adoption.tabId,
          property,
          adoptedDocument: {
            ...property,
            documentId: adoption.documentId,
            contextGeneration: adoption.contextGeneration,
            pageUrl: adoption.pageUrl,
          },
          revision,
          configPresent: adoption.configPresent,
          silentSelectors: same && adoption.configPresent && existing?.configPresent
            ? existing?.silentSelectors ?? null
            : null,
          documentPosture: same && adoption.configPresent && existing?.configPresent && !documentChanged
            ? existing?.documentPosture ?? null
            : null,
          updatedAt: now(),
        });
        return projectionOf(record);
      });
    },

    current(request: Readonly<{
      tabId: number;
      documentId: string;
      pageUrl: string;
    }>): Promise<ShieldPostureReadResponse> {
      return withOperation(async () => {
        const existing = await load(request.tabId);
        if (!existing?.adoptedDocument) {
          return { status: "unavailable", reason: "document-unbound" };
        }
        if (existing.adoptedDocument.documentId !== request.documentId) {
          return { status: "unavailable", reason: "stale-document" };
        }
        if (existing.adoptedDocument.pageUrl === request.pageUrl) {
          return existing.configPresent
            ? projectionOf(existing)
            : { status: "unavailable", reason: "config-removed" };
        }
        if (!belongsToProperty(request.pageUrl, existing.property)) {
          await input.repo.clear(request.tabId);
          return { status: "inactive", revision: existing.revision + 1 };
        }
        // Same-document SPA motion is a document terminal for preview/busy
        // posture, but property-scoped silent selectors remain authoritative.
        const record = await save({
          ...existing,
          adoptedDocument: {
            ...existing.adoptedDocument,
            pageUrl: request.pageUrl,
          },
          revision: existing.revision + 1,
          documentPosture: null,
          updatedAt: now(),
        });
        return record.configPresent
          ? projectionOf(record)
          : { status: "unavailable", reason: "config-removed" };
      });
    },

    set(request: MutationInput & Readonly<{ posture: ShieldPostureUpdate }>): Promise<ShieldPostureMutationResponse> {
      return withOperation(async () => {
        const existing = await load(request.tabId);
        if (!existing?.adoptedDocument) {
          return { status: "unbound", reason: "document-unbound" };
        }
        if (!existing.configPresent) {
          return { status: "unbound", reason: "config-removed" };
        }
        if (!mutationMatches(existing, request)) {
          return { status: "stale", reason: "shield-scope-or-revision-changed" };
        }
        const posture = ShieldPostureUpdateSchema.parse(request.posture);
        const record = await save({
          ...existing,
          revision: existing.revision + 1,
          silentSelectors: posture.kind === "silent-selectors"
            ? posture.selectors
            : existing.silentSelectors,
          documentPosture: posture.kind === "silent-selectors"
            ? existing.documentPosture
            : ShieldDocumentPostureSchema.parse(posture),
          updatedAt: now(),
        });
        return { status: "ok", posture: projectionOf(record) };
      });
    },

    clear(request: MutationInput & Readonly<{ reason: ShieldPostureClearReason }>): Promise<ShieldPostureMutationResponse> {
      return withOperation(async () => {
        const existing = await load(request.tabId);
        if (!existing?.adoptedDocument) {
          return { status: "unbound", reason: "document-unbound" };
        }
        if (!existing.configPresent) {
          return { status: "unbound", reason: "config-removed" };
        }
        if (!mutationMatches(existing, request)) {
          return { status: "stale", reason: "shield-scope-or-revision-changed" };
        }
        if (request.reason === "silent-cleared") {
          const record = await save({
            ...existing,
            revision: existing.revision + 1,
            silentSelectors: null,
            updatedAt: now(),
          });
          return { status: "ok", posture: projectionOf(record) };
        }
        if (FULL_CLEAR_REASONS.has(request.reason)) {
          const record = await save({
            ...existing,
            revision: existing.revision + 1,
            silentSelectors: null,
            documentPosture: null,
            updatedAt: now(),
          });
          return { status: "ok", posture: projectionOf(record) };
        }
        const record = await save({
          ...existing,
          revision: existing.revision + 1,
          documentPosture: null,
          updatedAt: now(),
        });
        return { status: "ok", posture: projectionOf(record) };
      });
    },

    navigationCommitted(tabId: number): Promise<void> {
      return withOperation(async () => {
        const existing = await load(tabId);
        if (!existing) {
          return;
        }
        if (!hasSelectors(existing.silentSelectors)) {
          await input.repo.clear(tabId);
          return;
        }
        await save({
          ...existing,
          adoptedDocument: null,
          documentPosture: null,
          revision: existing.revision + 1,
          updatedAt: now(),
        });
      });
    },

    clearDocumentPosture(tabId: number): Promise<void> {
      return withOperation(async () => {
        const existing = await load(tabId);
        if (!existing?.documentPosture) {
          return;
        }
        await save({
          ...existing,
          documentPosture: null,
          revision: existing.revision + 1,
          updatedAt: now(),
        });
      });
    },

    clearTab(tabId: number): Promise<void> {
      return withOperation(() => input.repo.clear(tabId));
    },

    clearProperty(environmentKey: string, siteId: number): Promise<number> {
      return withOperation(() => input.repo.clearPropertyPostures(environmentKey, siteId, now()));
    },

    removeProperty(environmentKey: string, siteId: number): Promise<number> {
      return withOperation(() => input.repo.removePropertyPostures(environmentKey, siteId, now()));
    },

    authorizeProperty(environmentKey: string, siteId: number): Promise<number> {
      return withOperation(() => input.repo.authorizePropertyPostures(environmentKey, siteId, now()));
    },
  };
}
