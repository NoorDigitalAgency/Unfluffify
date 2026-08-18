import type {
  PageContextResolution,
  PropertyContextResponse,
} from "../domain/schema/context";

type Resolver = (environmentKey: string, url: string) => Promise<PropertyContextResponse>;

type ValidContext = Readonly<{
  observedUrl: string;
  context: PropertyContextResponse;
}>;

type TabContext = {
  generation: number;
  observedUrl: string;
  environmentKey: string | null | undefined;
  credentialPresent?: boolean;
  latest?: PageContextResolution;
  inFlight?: Readonly<{
    generation: number;
    promise: Promise<PageContextResolution>;
  }>;
  lastValid?: ValidContext;
  suspendedCandidate?: Readonly<{
    environmentKey: string;
    siteId: number;
    pageKey: string;
  }>;
};

const EMPTY_FIELDS = {
  environmentKey: null,
  siteId: null,
  baseUrl: null,
  pageKey: null,
  pageTypes: [],
  membershipFingerprint: null,
  assignmentFingerprint: null,
  conflicts: [],
  upstreamCode: null,
};

function identityOf(context: PropertyContextResponse): string | null {
  return context.siteId === null ? null : `${context.environmentKey}\u0000${context.siteId}`;
}

function absoluteBaseUrl(baseUrl: string | null, observedUrl: string): string | null {
  if (baseUrl === null) {
    return null;
  }
  try {
    const observed = new URL(observedUrl);
    const candidate = baseUrl.startsWith("//")
      ? `${observed.protocol}${baseUrl}`
      : baseUrl.includes("://")
        ? baseUrl
        : `${observed.protocol}//${baseUrl}`;
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : baseUrl;
  } catch {
    return baseUrl;
  }
}

function contextFields(context: PropertyContextResponse, observedUrl: string) {
  return {
    environmentKey: context.environmentKey || null,
    siteId: context.siteId,
    // Hub owns the canonical property host and may return it without a scheme
    // (for example, "bonliva.se"). Facts shared across extension realms require
    // an absolute URL, so add only the observed page's scheme while preserving
    // Hub's canonical host.
    baseUrl: absoluteBaseUrl(context.baseUrl, observedUrl),
    pageKey: context.pageKey,
    pageTypes: context.pageTypes,
    membershipFingerprint: context.membershipFingerprint,
    assignmentFingerprint: context.assignmentFingerprint,
    conflicts: context.conflicts,
    upstreamCode: context.upstreamCode ?? null,
  };
}

function isCandidate(context: PropertyContextResponse): boolean {
  return context.status === "managed_candidate" || (
    context.status === "candidate_feed_valid" &&
    context.pageKey !== null &&
    context.pageTypes.some((pageType) => pageType.pages.some((page) => page.pageKey === context.pageKey))
  );
}

function isManaged(context: PropertyContextResponse): boolean {
  return context.status === "managed_candidate" ||
    context.status === "managed_non_candidate" ||
    context.status === "candidate_feed_valid";
}

function sameCandidate(
  candidate: TabContext["suspendedCandidate"],
  context: PropertyContextResponse,
): boolean {
  return candidate !== undefined &&
    context.siteId !== null &&
    context.pageKey !== null &&
    candidate.environmentKey === context.environmentKey &&
    candidate.siteId === context.siteId &&
    candidate.pageKey === context.pageKey;
}

export function createPageContextRuntime(input: Readonly<{
  currentEnvironmentKey: () => Promise<string | null>;
  hasToken: () => Promise<boolean>;
  resolve: Resolver;
}>) {
  const tabs = new Map<number, TabContext>();

  const stale = (generation: number, observedUrl: string): PageContextResolution => ({
    status: "stale",
    generation,
    observedUrl,
    draftDisposition: "preserve",
    ...EMPTY_FIELDS,
  });

  const isCurrent = (tabId: number, generation: number, observedUrl: string): boolean => {
    const current = tabs.get(tabId);
    return current?.generation === generation && current.observedUrl === observedUrl;
  };

  const project = (
    tab: TabContext,
    generation: number,
    observedUrl: string,
    context: PropertyContextResponse,
  ): PageContextResolution => {
    const previous = tab.lastValid;
    const previousIdentity = previous ? identityOf(previous.context) : null;
    const nextIdentity = identityOf(context);
    const definitiveChange = previous !== undefined && (
      previous.observedUrl !== observedUrl ||
      (previousIdentity !== null && nextIdentity !== null && previousIdentity !== nextIdentity)
    );
    const common = { generation, observedUrl };

    if (isManaged(context)) {
      const candidate = isCandidate(context);
      const removed = !candidate && sameCandidate(tab.suspendedCandidate, context);
      if (candidate && context.siteId !== null && context.pageKey !== null) {
        tab.suspendedCandidate = {
          environmentKey: context.environmentKey,
          siteId: context.siteId,
          pageKey: context.pageKey,
        };
      } else if (!removed) {
        tab.suspendedCandidate = undefined;
      }
      tab.lastValid = { observedUrl, context };
      return {
        status: removed
          ? "suspended_candidate_removed"
          : candidate ? "managed_candidate" : "managed_non_candidate",
        ...common,
        draftDisposition: definitiveChange ? "terminate" : "preserve",
        ...contextFields(context, observedUrl),
      };
    }

    if (context.status === "candidate_feed_conflict") {
      const preserved = previous?.observedUrl === observedUrl &&
        previous.context.environmentKey === context.environmentKey
        ? previous.context
        : context;
      return {
        status: "suspended_candidate_feed_conflict",
        ...common,
        draftDisposition: definitiveChange ? "terminate" : "preserve",
        ...contextFields(preserved, observedUrl),
        conflicts: context.conflicts,
        upstreamCode: context.upstreamCode ?? null,
      };
    }

    if (context.status === "property_not_found") {
      tab.lastValid = undefined;
      tab.suspendedCandidate = undefined;
      return {
        status: "unmanaged",
        ...common,
        draftDisposition: previous ? "terminate" : "preserve",
        ...contextFields(context, observedUrl),
      };
    }

    const status = context.status === "authentication_required"
      ? "authentication_required"
      : context.status === "access_denied"
        ? "access_denied"
        : context.status === "environment_not_registered"
          ? "environment_not_registered"
          : "unavailable";
    const preserved = previous?.observedUrl === observedUrl &&
      previous.context.environmentKey === context.environmentKey
      ? previous.context
      : null;
    return {
      status,
      ...common,
      draftDisposition: "preserve",
      ...(preserved ? contextFields(preserved, observedUrl) : contextFields(context, observedUrl)),
      upstreamCode: context.upstreamCode ?? null,
    };
  };

  return {
    async resolve(request: Readonly<{ tabId: number; pageUrl: string; refresh?: boolean }>): Promise<PageContextResolution> {
      let tab = tabs.get(request.tabId);
      if (!tab) {
        tab = { generation: 1, observedUrl: request.pageUrl, environmentKey: undefined };
        tabs.set(request.tabId, tab);
      } else if (tab.observedUrl !== request.pageUrl) {
        tab.generation += 1;
        tab.observedUrl = request.pageUrl;
        tab.environmentKey = undefined;
        tab.credentialPresent = undefined;
        tab.inFlight = undefined;
        tab.latest = undefined;
        tab.suspendedCandidate = undefined;
      }
      let generation = tab.generation;
      const environmentKey = await input.currentEnvironmentKey();
      if (!isCurrent(request.tabId, generation, request.pageUrl)) {
        return stale(generation, request.pageUrl);
      }
      tab = tabs.get(request.tabId)!;
      if (tab.environmentKey !== undefined && tab.environmentKey !== environmentKey) {
        tab.generation += 1;
        tab.inFlight = undefined;
        tab.latest = undefined;
        tab.suspendedCandidate = undefined;
      }
      tab.environmentKey = environmentKey;
      generation = tab.generation;
      const credentialPresent = environmentKey ? await input.hasToken() : false;
      if (!isCurrent(request.tabId, generation, request.pageUrl)) {
        return stale(generation, request.pageUrl);
      }
      if (tab.credentialPresent !== undefined && tab.credentialPresent !== credentialPresent) {
        tab.generation += 1;
        tab.inFlight = undefined;
        tab.latest = undefined;
        tab.suspendedCandidate = undefined;
      }
      tab.credentialPresent = credentialPresent;
      generation = tab.generation;
      if (!request.refresh && tab.latest) {
        return tab.latest;
      }
      if (tab.inFlight?.generation === generation) {
        return tab.inFlight.promise;
      }

      const run = (async (): Promise<PageContextResolution> => {
        let context: PropertyContextResponse;
        if (!environmentKey) {
          context = {
            status: "environment_not_registered",
            environmentKey: "",
            siteId: null,
            baseUrl: null,
            pageKey: null,
            pageTypes: [],
            membershipFingerprint: null,
            assignmentFingerprint: null,
            conflicts: [],
            upstreamCode: null,
          };
        } else if (!credentialPresent) {
          context = {
            status: "authentication_required",
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
        } else {
          context = await input.resolve(environmentKey, request.pageUrl);
        }
        if (!isCurrent(request.tabId, generation, request.pageUrl)) {
          return stale(generation, request.pageUrl);
        }
        const projected = project(tabs.get(request.tabId)!, generation, request.pageUrl, context);
        const currentTab = tabs.get(request.tabId)!;
        if (
          currentTab.latest !== undefined ||
          projected.status === "managed_candidate" ||
          projected.status === "managed_non_candidate" ||
          projected.status === "suspended_candidate_removed" ||
          projected.status === "suspended_candidate_feed_conflict" ||
          projected.status === "unmanaged"
        ) {
          currentTab.latest = projected;
        }
        return projected;
      })();
      tab.inFlight = { generation, promise: run };
      try {
        return await run;
      } finally {
        const current = tabs.get(request.tabId);
        if (current?.inFlight?.promise === run) {
          current.inFlight = undefined;
        }
      }
    },
  };
}
