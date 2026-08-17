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

function contextFields(context: PropertyContextResponse) {
  return {
    environmentKey: context.environmentKey || null,
    siteId: context.siteId,
    baseUrl: context.baseUrl,
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
        ...contextFields(context),
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
        ...contextFields(preserved),
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
        ...contextFields(context),
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
      ...(preserved ? contextFields(preserved) : contextFields(context)),
      upstreamCode: context.upstreamCode ?? null,
    };
  };

  return {
    async resolve(request: Readonly<{ tabId: number; pageUrl: string }>): Promise<PageContextResolution> {
      let tab = tabs.get(request.tabId);
      if (!tab) {
        tab = { generation: 1, observedUrl: request.pageUrl, environmentKey: undefined };
        tabs.set(request.tabId, tab);
      } else if (tab.observedUrl !== request.pageUrl) {
        tab.generation += 1;
        tab.observedUrl = request.pageUrl;
        tab.environmentKey = undefined;
        tab.inFlight = undefined;
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
        tab.suspendedCandidate = undefined;
      }
      tab.environmentKey = environmentKey;
      generation = tab.generation;
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
        } else if (!await input.hasToken()) {
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
        return project(tabs.get(request.tabId)!, generation, request.pageUrl, context);
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
