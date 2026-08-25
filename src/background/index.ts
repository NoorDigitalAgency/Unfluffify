import { createRewriteBrainRuntime } from "./rewrite-brain-runtime";
import { createPropertyLockRuntime, PROPERTY_LOCK_HEARTBEAT_ALARM } from "./lock-runtime";
import { createRenderEmulationRuntime } from "./render-emulation-runtime";
import {
  createRenderInspectionRuntime,
} from "./render-inspection-runtime";
import { managedEmulationDecision } from "./emulation-policy";
import { createRewriteBackgroundServices } from "./services";
import { createAuthTokenMonitor } from "./auth-token-monitor";
import { createPageContextRuntime } from "./page-context-runtime";
import { createShieldPostureRuntime } from "./shield-posture-runtime";
import {
  createLockBrowserLifecycle,
  type LockBrowserApi,
} from "./lock-browser-lifecycle";
import { connectionSettingsOf, replaceConnectionProfile } from "../storage/settings";
import { getBrowserRuntimeLastError, getInstalledBrowserApi } from "../common/browser";
import { createRealmBus } from "../messaging/realms";
import { createRuntimeTransport } from "../messaging/transports/runtime";
import {
  parseSenderDocumentId,
  parseSenderFrameId,
  parseSenderTabId,
} from "../messaging/rewrite-signals";
import { canonicalPageKey, PropertySnapshotIntegrityError } from "../storage/property-snapshot-authority";
import { projectTodoCoverage } from "../domain/todo";
import type { ConfigSnapshot } from "../storage/config";
import { fetchStaticPageHtml } from "./static-html";
import { createTransferPayloadStore } from "./transfer-payload-store";
import { actionIconStateForContext, createActionIconController } from "./action-icon";
import { clearDomainCache } from "../storage/domain-cache";
import { createInitialTabFacts } from "./brain/fold";
import type { ShieldPostureProjection } from "../messaging/shield-posture";

export { createRewriteBrain } from "./rewrite-brain";

type RewriteSidePanelApi = Readonly<{
  setOptions?: (options: { tabId?: number; path: string; enabled: boolean }) => Promise<void> | void;
  open?: (options: { tabId: number }) => Promise<void> | void;
}>;

type InstalledBrowserApi = NonNullable<ReturnType<typeof getInstalledBrowserApi>>;
type RewriteExtensionApi = InstalledBrowserApi & Readonly<{
  sidePanel?: RewriteSidePanelApi;
  offscreen?: Readonly<{
    hasDocument?: () => Promise<boolean> | boolean;
    createDocument?: (options: { url: string; reasons: string[]; justification: string }) => Promise<void> | void;
  }>;
}>;

function renderInspectionCurtainProofExpression(identity: Readonly<{
  token: string;
  generation: number;
  documentNonce: string;
}>): string {
  const expected = JSON.stringify(identity);
  return `(() => {
    const expected = ${expected};
    const root = document.documentElement;
    const curtain = document.querySelector('[data-uf-render-inspection-curtain="true"]');
    if (
      document.visibilityState !== 'visible' ||
      !root ||
      !curtain ||
      !curtain.isConnected ||
      curtain.parentElement !== root ||
      root.lastElementChild !== curtain ||
      curtain.getAttribute('data-uf-inspection-token') !== expected.token ||
      curtain.getAttribute('data-uf-inspection-generation') !== String(expected.generation) ||
      curtain.getAttribute('data-uf-document-nonce') !== expected.documentNonce
    ) {
      return false;
    }
    const style = getComputedStyle(curtain);
    const opacity = Number.parseFloat(style.opacity || '1');
    const rect = curtain.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? innerWidth;
    const viewportHeight = viewport?.height ?? innerHeight;
    return style.position === 'fixed' &&
      style.display !== 'none' &&
      style.visibility === 'visible' &&
      style.pointerEvents !== 'none' &&
      style.zIndex === '2147483647' &&
      Number.isFinite(opacity) && opacity === 1 &&
      rect.left <= viewportLeft && rect.top <= viewportTop &&
      rect.right >= viewportLeft + viewportWidth &&
      rect.bottom >= viewportTop + viewportHeight;
  })()`;
}

function reportRenderInspectionFallbackStage(
  stage: "fallback" | "acknowledged" | "rejected",
  generation: number,
  documentId: string,
  reason?: string,
): void {
  if (__UF_DEBUG_BUILD__) {
    console.debug("[Unfluffify][render-inspection] Curtain lifecycle", {
      stage,
      generation,
      documentId,
      ...(reason ? { reason } : {}),
    });
  }
}

function reportActionOpenFailure(error: unknown): void {
  console.error("[Unfluffify][rewrite] Unable to open side panel", error);
}

async function openRewriteSidePanelForTab(tab: Readonly<{ id?: number }>, api: RewriteExtensionApi): Promise<void> {
  if (typeof tab.id !== "number" || !api.sidePanel?.setOptions || !api.sidePanel.open) {
    reportActionOpenFailure(new Error("Missing tab id or sidePanel API"));
    return;
  }
  void Promise.resolve(api.sidePanel.setOptions({
    tabId: tab.id,
    path: "popup.html",
    enabled: true,
  })).catch(reportActionOpenFailure);
  await api.sidePanel.open({ tabId: tab.id });
}

async function ensureOffscreenDocument(api: RewriteExtensionApi): Promise<void> {
  if (!api.offscreen?.createDocument) {
    return;
  }
  const hasDocument = await Promise.resolve(api.offscreen.hasDocument?.() ?? false);
  if (hasDocument) {
    return;
  }
  await Promise.resolve(api.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["DOM_PARSER"],
    justification: "Refine Unfluffify XPath rows against captured HTML",
  }));
}

let rewriteBackgroundStarted = false;

export function startRewriteBackground(): void {
  const api = getInstalledBrowserApi() as RewriteExtensionApi | null;
  if (rewriteBackgroundStarted || !api?.runtime?.onMessage) {
    return;
  }
  rewriteBackgroundStarted = true;
  const services = createRewriteBackgroundServices();
  const transferPayloads = createTransferPayloadStore();
  const actionIcons = createActionIconController(api.action);
  /** An explicit Unregister must survive the reload it initiates. Content cannot
   *  own that fact because its realm is replaced by the reload. storage.session
   *  survives MV3 worker suspension/restart while remaining tab-session scoped. */
  type ConsentSuppressionTombstone = Readonly<{
    disabled: true;
    blockedDocumentKey: string | null;
  }>;
  /** Written only by webNavigation.onCommitted. Content messages may be the
   * first event observed by a freshly-created worker, but they never get to
   * replace an identity Chrome has already committed for this tab. A null
   * value means a navigation boundary was observed without a usable document
   * id, so content remains fenced until an authoritative id is available. */
  const mainDocumentByTab = new Map<number, string | null>();
  type MainNavigationState = Readonly<{
    epoch: number;
    pending: boolean;
    pageUrl: string | null;
  }>;
  const mainNavigationByTab = new Map<number, MainNavigationState>();
  const normalizedPageUrl = (pageUrl: string | null): string | null => {
    if (!pageUrl) return null;
    try {
      const parsed = new URL(pageUrl);
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return null;
    }
  };
  const advanceMainNavigation = (
    tabId: number,
    pending: boolean,
    pageUrl: string | null,
  ): MainNavigationState => {
    const state = {
      epoch: (mainNavigationByTab.get(tabId)?.epoch ?? 0) + 1,
      pending,
      pageUrl: normalizedPageUrl(pageUrl),
    };
    mainNavigationByTab.set(tabId, state);
    return state;
  };
  const mainDocumentWrites = new Map<number, Promise<void>>();
  const mainDocumentKey = (tabId: number): string => `uf:main-document:${tabId}`;
  const persistMainDocument = (tabId: number, documentId: string | null): void => {
    const previous = mainDocumentWrites.get(tabId) ?? Promise.resolve();
    const write = previous.then(async () => {
      await Promise.resolve(api.storage?.session?.set({
        [mainDocumentKey(tabId)]: { documentId },
      }));
    }).catch(() => undefined);
    mainDocumentWrites.set(tabId, write);
    void write.finally(() => {
      if (mainDocumentWrites.get(tabId) === write) {
        mainDocumentWrites.delete(tabId);
      }
    });
  };
  const observeMainDocument = (tabId: number, documentId: string | null): void => {
    mainDocumentByTab.set(tabId, documentId);
    // Navigation events are synchronous, while storage.session is not. Keep
    // writes ordered so a rapid C -> D commit cannot leave C as the cold-worker
    // fallback merely because its first write completed last.
    persistMainDocument(tabId, documentId);
  };
  type MainFrameAuthority = Readonly<{
    documentId: string | null;
    pageUrl: string | null;
  }>;
  const queryMainFrame = async (tabId: number): Promise<MainFrameAuthority | undefined> => {
    type FrameDetails = Readonly<{ documentId?: string; url?: string }> | null;
    type GetFrame = (
      details: Readonly<{ tabId: number; frameId: number }>,
      callback?: (details: FrameDetails) => void,
    ) => Promise<FrameDetails> | void;
    const navigation = api.webNavigation as unknown as { getFrame?: GetFrame } | undefined;
    const getFrame = navigation?.getFrame;
    if (!getFrame) {
      return undefined;
    }
    try {
      const frame = await new Promise<FrameDetails>((resolve, reject) => {
        let settled = false;
        const finish = (operation: () => void): void => {
          if (settled) return;
          settled = true;
          operation();
        };
        const maybePromise = getFrame.call(
          navigation,
          { tabId, frameId: 0 },
          (details) => {
            const lastError = getBrowserRuntimeLastError();
            finish(() => lastError
              ? reject(new Error(lastError.message || "Unable to read main frame"))
              : resolve(details));
          },
        );
        if (maybePromise && typeof maybePromise.then === "function") {
          void maybePromise.then(
            (details) => finish(() => resolve(details)),
            (error) => finish(() => reject(error)),
          );
        }
      });
      return {
        documentId: typeof frame?.documentId === "string" && frame.documentId
          ? frame.documentId
          : null,
        pageUrl: typeof frame?.url === "string" && frame.url
          ? normalizedPageUrl(frame.url)
          : null,
      };
    } catch {
      return undefined;
    }
  };
  const queryMainDocument = async (tabId: number): Promise<string | null | undefined> =>
    (await queryMainFrame(tabId))?.documentId;
  const queryTabPresence = async (
    tabId: number,
  ): Promise<"present" | "missing" | "unknown"> => {
    type TabDetails = Readonly<{ id?: number }> | null | undefined;
    type GetTab = (
      tabId: number,
      callback?: (tab: TabDetails) => void,
    ) => Promise<TabDetails> | void;
    const tabsApi = api.tabs as unknown as { get?: GetTab } | undefined;
    const getTab = tabsApi?.get;
    if (!getTab) {
      return "unknown";
    }
    try {
      const tab = await new Promise<TabDetails>((resolve, reject) => {
        let settled = false;
        const finish = (operation: () => void): void => {
          if (settled) return;
          settled = true;
          operation();
        };
        const maybePromise = getTab.call(tabsApi, tabId, (value) => {
          const lastError = getBrowserRuntimeLastError();
          finish(() => lastError
            ? reject(new Error(lastError.message || "Unable to read tab"))
            : resolve(value));
        });
        if (maybePromise && typeof maybePromise.then === "function") {
          void maybePromise.then(
            (value) => finish(() => resolve(value)),
            (error) => finish(() => reject(error)),
          );
        }
      });
      return tab && typeof tab.id === "number" ? "present" : "unknown";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return /no tab with id|invalid tab id|tab not found|unknown tab/i.test(message)
        ? "missing"
        : "unknown";
    }
  };
  const listBrowserAlarms = async (): Promise<readonly Readonly<{ name: string }>[]> => {
    type AlarmDetails = Readonly<{ name?: string }>;
    type GetAllAlarms = (
      callback?: (alarms: readonly AlarmDetails[]) => void,
    ) => Promise<readonly AlarmDetails[]> | void;
    const alarmsApi = api.alarms as unknown as { getAll?: GetAllAlarms } | undefined;
    const getAll = alarmsApi?.getAll;
    if (!getAll) {
      return [];
    }
    const alarms = await new Promise<readonly AlarmDetails[]>((resolve, reject) => {
      let settled = false;
      const finish = (operation: () => void): void => {
        if (settled) return;
        settled = true;
        operation();
      };
      try {
        const maybePromise = getAll.call(
          alarmsApi,
          (value) => {
            const lastError = getBrowserRuntimeLastError();
            finish(() => lastError
              ? reject(new Error(lastError.message || "Unable to list alarms"))
              : resolve(value));
          },
        );
        if (maybePromise && typeof maybePromise.then === "function") {
          void maybePromise.then(
            (value) => finish(() => resolve(value)),
            (error) => finish(() => reject(error)),
          );
        }
      } catch (error) {
        finish(() => reject(error));
      }
    });
    return alarms.flatMap((alarm) =>
      typeof alarm.name === "string" && alarm.name ? [{ name: alarm.name }] : []);
  };
  const loadMainDocument = async (
    tabId: number,
  ): Promise<Readonly<{ known: boolean; documentId: string | null }>> => {
    if (mainDocumentByTab.has(tabId)) {
      return { known: true, documentId: mainDocumentByTab.get(tabId) ?? null };
    }
    const queriedDocument = await queryMainDocument(tabId);
    if (mainDocumentByTab.has(tabId)) {
      return { known: true, documentId: mainDocumentByTab.get(tabId) ?? null };
    }
    if (queriedDocument !== undefined) {
      observeMainDocument(tabId, queriedDocument);
      return { known: true, documentId: queriedDocument };
    }
    const key = mainDocumentKey(tabId);
    try {
      const stored = await api.storage?.session?.get(key);
      // A navigation may have committed while the session read was pending.
      // Its synchronous in-memory observation always wins over older storage.
      if (mainDocumentByTab.has(tabId)) {
        return { known: true, documentId: mainDocumentByTab.get(tabId) ?? null };
      }
      const value = stored?.[key];
      if (value && typeof value === "object" && "documentId" in value) {
        const documentId = (value as { documentId?: unknown }).documentId;
        if (documentId === null || (typeof documentId === "string" && documentId)) {
          mainDocumentByTab.set(tabId, documentId);
          return { known: true, documentId };
        }
      }
    } catch {
      // An unavailable session store leaves the document unknown. That is safe
      // for a normal first load; terminal tombstones separately require known
      // navigation authority before they can be released.
    }
    return { known: false, documentId: null };
  };
  const isCurrentMainDocument = async (tabId: number, documentId: string): Promise<boolean> => {
    const current = await loadMainDocument(tabId);
    return !current.known || current.documentId === documentId;
  };
  type RenderInspectionDocumentFence = Readonly<{
    documentId: string;
    navigation: MainNavigationState;
    pageUrl: string;
  }>;
  const admitRenderInspectionDocument = async (
    tabId: number,
    documentId: string,
    pageUrl: string,
  ): Promise<RenderInspectionDocumentFence | null> => {
    const expectedPageUrl = normalizedPageUrl(pageUrl);
    const navigationBeforeFrame = mainNavigationByTab.get(tabId);
    if (!expectedPageUrl || navigationBeforeFrame?.pending) {
      return null;
    }
    // Content identity is never reconstructed from the sender or a persisted
    // document id alone. A fresh main-frame read closes the cold-worker gap in
    // which session storage still names A after Chrome has already installed B.
    const frame = await queryMainFrame(tabId);
    if (
      mainNavigationByTab.get(tabId) !== navigationBeforeFrame ||
      !frame?.documentId ||
      frame.documentId !== documentId ||
      !frame.pageUrl ||
      frame.pageUrl !== expectedPageUrl
    ) {
      return null;
    }
    if (
      mainDocumentByTab.has(tabId) &&
      mainDocumentByTab.get(tabId) !== documentId
    ) {
      return null;
    }
    if (!mainDocumentByTab.has(tabId)) {
      observeMainDocument(tabId, documentId);
    }
    let navigation = navigationBeforeFrame;
    if (!navigation) {
      navigation = { epoch: 0, pending: false, pageUrl: frame.pageUrl };
      mainNavigationByTab.set(tabId, navigation);
    }
    if (
      navigation.pending ||
      navigation.pageUrl !== frame.pageUrl ||
      mainDocumentByTab.get(tabId) !== documentId
    ) {
      return null;
    }
    return { documentId, navigation, pageUrl: frame.pageUrl };
  };
  const clearMainDocument = async (tabId: number): Promise<void> => {
    mainDocumentByTab.delete(tabId);
    mainNavigationByTab.delete(tabId);
    await mainDocumentWrites.get(tabId);
    await Promise.resolve(api.storage?.session?.remove(mainDocumentKey(tabId)))
      .catch(() => undefined);
  };
  const stalePageContextResponse = (pageUrl: string) => ({
    status: "stale" as const,
    generation: 1,
    observedUrl: pageUrl,
    draftDisposition: "preserve" as const,
    environmentKey: null,
    siteId: null,
    baseUrl: null,
    pageKey: null,
    pageTypes: [],
    membershipFingerprint: null,
    assignmentFingerprint: null,
    conflicts: [],
    upstreamCode: null,
    consentSuppressionAllowed: false,
    renderModeSet: false,
    todo: projectTodoCoverage([], null, new Set()),
    shieldPosture: { status: "inactive" as const, revision: 0 },
  });
  const consentSuppressionFallback = new Map<number, ConsentSuppressionTombstone>();
  const consentSuppressionKey = (tabId: number): string => `uf:consent-suppression-disabled:${tabId}`;
  const consentSuppressionTombstone = async (tabId: number): Promise<ConsentSuppressionTombstone | null> => {
    const key = consentSuppressionKey(tabId);
    try {
      const stored = await api.storage?.session?.get(key);
      if (stored) {
        const value = stored[key];
        if (value === true) {
          return { disabled: true, blockedDocumentKey: null };
        }
        if (
          value &&
          typeof value === "object" &&
          (value as { disabled?: unknown }).disabled === true
        ) {
          const documentKey = (value as { blockedDocumentKey?: unknown }).blockedDocumentKey;
          return {
            disabled: true,
            blockedDocumentKey: typeof documentKey === "string" && documentKey ? documentKey : null,
          };
        }
      }
    } catch {
      // Tests and older hosts can lack storage.session; retain safe process-local
      // behaviour rather than turning a storage failure into re-authorization.
    }
    return consentSuppressionFallback.get(tabId) ?? null;
  };
  const consentSuppressionDisabled = async (tabId: number): Promise<boolean> =>
    (await consentSuppressionTombstone(tabId)) !== null;
  const disableConsentSuppression = async (
    tabId: number,
    blockedDocumentKey: string | null,
  ): Promise<void> => {
    const tombstone: ConsentSuppressionTombstone = { disabled: true, blockedDocumentKey };
    consentSuppressionFallback.set(tabId, tombstone);
    await Promise.resolve(api.storage?.session?.set({ [consentSuppressionKey(tabId)]: tombstone }))
      .catch(() => undefined);
  };
  const clearConsentSuppression = async (tabId: number): Promise<void> => {
    consentSuppressionFallback.delete(tabId);
    await Promise.resolve(api.storage?.session?.remove(consentSuppressionKey(tabId)))
      .catch(() => undefined);
  };
  const registerConsentSuppression = async (
    tabId: number,
    documentKey: string,
  ): Promise<"ok" | "stale"> => {
    const tombstone = await consentSuppressionTombstone(tabId);
    const current = await loadMainDocument(tabId);
    // A durable terminal veto can only be released by a document Chrome has
    // authoritatively committed after it. On worker recreation, an unknown
    // document therefore cannot use a different token to clear the tombstone.
    if (
      (current.known && current.documentId !== documentKey) ||
      (tombstone !== null && !current.known) ||
      tombstone?.blockedDocumentKey === documentKey
    ) {
      return "stale";
    }
    await clearConsentSuppression(tabId);
    const afterClear = await loadMainDocument(tabId);
    if (afterClear.known && afterClear.documentId !== documentKey) {
      // webNavigation is intentionally not queued behind message work. If a
      // replacement commits while session storage is removing the veto, put
      // the exact terminal tombstone back before reporting the old register as
      // stale.
      if (tombstone) {
        await disableConsentSuppression(tabId, tombstone.blockedDocumentKey);
      }
      return "stale";
    }
    return "ok";
  };
  const runtime = createRewriteBrainRuntime({
    addMessageListener() {},
    rehydrateDurableFacts: services.persistence.rehydrateDurableFacts,
    createAlarm(name, info) {
      api.alarms?.create(name, info);
    },
    clearAlarm(name) {
      api.alarms?.clear(name);
    },
    addAlarmListener(listener) {
      api.alarms?.onAlarm?.addListener(listener);
    },
  });
  runtime.keepAlive.clearIfIdle();
  const authTokenMonitor = createAuthTokenMonitor({
    validate: () => services.accounts.validate(),
    createAlarm(name, info) {
      api.alarms?.create(name, info);
    },
    clearAlarm(name) {
      api.alarms?.clear(name);
    },
    onInvalid() {
      console.warn("[Unfluffify][rewrite] Stored auth token was rejected; sign in again");
    },
    onError(error) {
      console.error("[Unfluffify][rewrite] Auth token check failed", error);
    },
  });
  void authTokenMonitor.start();
  const bus = createRealmBus({
    realm: "background",
    transport: createRuntimeTransport(api.runtime),
  });
  let renderInspectionDetachHandler: ((tabId: number) => void) | null = null;
  const renderEmulation = createRenderEmulationRuntime({
    debuggerApi: api.debugger,
    tabs: api.tabs,
    onDebuggerDetached(tabId) {
      renderInspectionDetachHandler?.(tabId);
    },
  });
  const pageContextRuntime = createPageContextRuntime({
    currentEnvironmentKey: services.lynx.currentEnvironmentKey,
    hasToken: services.accounts.hasToken,
    resolve: services.lynx.resolvePropertyContext,
  });
  const shieldPosture = createShieldPostureRuntime({
    repo: services.repos.shieldPostureRepo,
  });
  type RenderInspectionOccurrence = Readonly<{
    tabId: number;
    documentId: string | null;
    sourceDocumentId: string | null;
    pageUrl: string;
  }>;
  const canRecoverRenderInspectionOccurrence = async (
    record: RenderInspectionOccurrence,
  ): Promise<boolean> => {
    const navigationBeforeRead = mainNavigationByTab.get(record.tabId);
    if (navigationBeforeRead?.pending) {
      return false;
    }
    const frame = await queryMainFrame(record.tabId);
    if (mainNavigationByTab.get(record.tabId) !== navigationBeforeRead) {
      return false;
    }
    const expectedDocumentId = record.documentId ?? record.sourceDocumentId;
    const expectedPageUrl = normalizedPageUrl(record.pageUrl);
    return Boolean(
      frame?.documentId &&
      frame.pageUrl &&
      expectedDocumentId &&
      frame.documentId === expectedDocumentId &&
      expectedPageUrl &&
      frame.pageUrl === expectedPageUrl
    );
  };
  const classifyRenderInspectionTabPresence = async (
    record: Readonly<{
      tabId: number;
    }>,
  ): Promise<"current" | "stale" | "unknown"> => {
    const presence = await queryTabPresence(record.tabId);
    return presence === "present"
      ? "current"
      : presence === "missing"
        ? "stale"
        : "unknown";
  };
  const renderInspection = createRenderInspectionRuntime({
    repo: services.repos.renderInspectionRepo,
    canRecover: canRecoverRenderInspectionOccurrence,
    classifyTabCleanupOccurrence: classifyRenderInspectionTabPresence,
    driver: {
      setJavascriptEnabled: (tabId, enabled) =>
        renderEmulation.setJavascriptEnabled(tabId, enabled),
      reload: (tabId) => renderEmulation.reload(tabId),
    },
    async createAlarm(name, info) {
      await Promise.resolve(api.alarms?.create(name, info));
    },
    async clearAlarm(name) {
      await Promise.resolve(api.alarms?.clear(name));
    },
    listAlarms: listBrowserAlarms,
  });
  renderInspectionDetachHandler = (tabId) => {
    void renderInspection.debuggerDetached(tabId).catch((error) => {
      console.error("[Unfluffify][rewrite] Render inspection debugger detach failed", error);
    });
  };
  const settleRenderInspection = async (
    label: string,
    operation: () => Promise<unknown>,
  ): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      // Inspection has already attempted its fail-open JavaScript restore. It
      // must never prevent the broader tab/property terminal cleanup.
      console.error(`[Unfluffify][rewrite] Render inspection ${label} failed`, error);
    }
  };
  const tabLifecycleOperations = new Map<number, Promise<void>>();
  const withTabLifecycleOperation = <T>(tabId: number, operation: () => Promise<T>): Promise<T> => {
    const previous = tabLifecycleOperations.get(tabId) ?? Promise.resolve();
    const queued = previous.then(operation, operation);
    const tail = queued.then(() => undefined, () => undefined);
    tabLifecycleOperations.set(tabId, tail);
    void tail.finally(() => {
      if (tabLifecycleOperations.get(tabId) === tail) {
        tabLifecycleOperations.delete(tabId);
      }
    });
    return queued;
  };
  const tabTerminations = new Map<number, Promise<void>>();
  const renderInspectionDocumentFenceIsCurrent = (
    tabId: number,
    fence: RenderInspectionDocumentFence,
  ): boolean => {
    const navigation = mainNavigationByTab.get(tabId);
    return navigation === fence.navigation &&
      !navigation.pending &&
      navigation.pageUrl === fence.pageUrl &&
      mainDocumentByTab.get(tabId) === fence.documentId;
  };
  const awaitTabTermination = async (tabId: number): Promise<void> => {
    while (tabTerminations.has(tabId)) {
      await tabTerminations.get(tabId);
    }
  };
  const clearTabContinuation = async (
    tabId: number,
    preserveSignalHead = true,
  ): Promise<void> => {
    const latestRun = await services.repos.runRecordRepo.loadLatestForTab(tabId);
    if (latestRun.ok && latestRun.value) {
      await services.repos.runRecordRepo.clear(latestRun.value.sessionId);
    }
    await services.repos.tabStateRepo.clear(tabId);
    const signalHead = preserveSignalHead ? runtime.retainedSignalHead(tabId) : 0;
    if (signalHead > 0) {
      await services.persistence.persistDurableFacts({
        ...createInitialTabFacts(tabId),
        lastSignalSeq: signalHead,
      });
    }
  };
  const beginTabCleanup = (
    tabId: number,
    cleanup: () => Promise<void>,
  ): Promise<void> => {
    const termination = withTabLifecycleOperation(tabId, cleanup);
    tabTerminations.set(tabId, termination);
    const clearTermination = () => {
      if (tabTerminations.get(tabId) === termination) {
        tabTerminations.delete(tabId);
      }
    };
    void termination.then(clearTermination, clearTermination);
    return termination;
  };
  const lockFactOperationTails = new Map<number, Promise<void>>();
  const enqueueLockFactOperation = <T>(
    tabId: number,
    operation: () => Promise<T>,
  ): Promise<T> => {
    // Queue thunks, rather than promises which have already started. Besides
    // making the durable writer deterministic for same-property A -> B facts,
    // this lets cleanup drain the one admitted tail before terminal clear.
    const previous = lockFactOperationTails.get(tabId) ?? Promise.resolve();
    const queued = previous.then(operation, operation);
    const tail = queued.then(() => undefined, () => undefined);
    lockFactOperationTails.set(tabId, tail);
    void tail.finally(() => {
      if (lockFactOperationTails.get(tabId) === tail) {
        lockFactOperationTails.delete(tabId);
      }
    });
    return queued;
  };
  const drainLockFactOperations = async (tabId: number): Promise<void> => {
    while (lockFactOperationTails.has(tabId)) {
      await lockFactOperationTails.get(tabId);
    }
  };
  const lockRuntime = createPropertyLockRuntime({
    services,
    context: pageContextRuntime,
    tabs: api.tabs,
    onAuthoritativeTransfer({ tabId, environmentKey, siteId }) {
      // A foreign/rotated fence is the ownership boundary. Clear only the old
      // continuation; the passive client remains connected for future handoff.
      return beginTabCleanup(tabId, async () => {
        await settleRenderInspection("property transfer cleanup", () => renderInspection.terminateProperty({
          tabId,
          environmentKey,
          siteId,
          reason: "extension-invalidated",
        }));
        await drainLockFactOperations(tabId);
        await runtime.forgetBrain(tabId);
        await shieldPosture.clearDocumentPosture(tabId);
        await clearTabContinuation(tabId);
      });
    },
    async observeLockFacts(facts) {
      // Terminal cleanup owns the boundary. A callback born after that boundary
      // is stale and must not wait through it and recreate facts in the next
      // document/session.
      if (tabTerminations.has(facts.tabId)) {
        return false;
      }
      // Admission is synchronous after the termination check. Cleanup cannot
      // pass an empty drain while this operation is awaiting the tombstone read.
      await enqueueLockFactOperation(facts.tabId, async () => {
        if (
          tabTerminations.has(facts.tabId) ||
          await consentSuppressionDisabled(facts.tabId) ||
          tabTerminations.has(facts.tabId)
        ) {
          return false;
        }
        await actionIcons.apply(facts.tabId, facts.canEdit ? "active" : "locked")
          .catch(() => undefined);
        if (tabTerminations.has(facts.tabId)) {
          return false;
        }
        const brain = await runtime.getBrain(facts.tabId);
        if (tabTerminations.has(facts.tabId)) {
          return false;
        }
        brain.observe({
          tabId: facts.tabId,
          source: "background",
          reason: "property-lock",
          facts: {
            tabId: facts.tabId,
            siteId: facts.siteId,
            baseUrl: facts.baseUrl,
            pageUrl: facts.pageUrl,
            lockRole: facts.lockRole,
            lockCanEdit: facts.canEdit,
            lockBlockedReason: facts.blockedReason,
            lockBanner: facts.lockBanner,
            configPresent: facts.configPresent,
          },
        });
        const snapshot = brain.snapshot();
        if (snapshot && !tabTerminations.has(facts.tabId)) {
          await services.persistence.persistDurableFacts(snapshot);
        }
        return !tabTerminations.has(facts.tabId);
      });
    },
  });
  const lockBrowserLifecycle = createLockBrowserLifecycle({
    api: api as unknown as LockBrowserApi,
    onMainDocumentNavigationStarted(tabId, pageUrl) {
      advanceMainNavigation(tabId, true, pageUrl);
      const expectedInspectionReload = renderInspection.observeNavigationStart(tabId, pageUrl);
      if (!expectedInspectionReload) {
        void settleRenderInspection("navigation-start cleanup", () =>
          renderInspection.navigationStarted(tabId));
      }
    },
    onMainDocumentNavigationFailed(tabId, pageUrl) {
      const failedState = mainNavigationByTab.get(tabId);
      if (
        !failedState?.pending ||
        !failedState.pageUrl ||
        normalizedPageUrl(pageUrl) !== failedState.pageUrl
      ) {
        return;
      }
      void settleRenderInspection("failed navigation cleanup", () =>
        renderInspection.navigationFailed(tabId));
      void queryMainFrame(tabId).then((frame) => {
        if (
          !failedState ||
          mainNavigationByTab.get(tabId) !== failedState ||
          !frame?.documentId ||
          !frame.pageUrl
        ) {
          return;
        }
        mainNavigationByTab.set(tabId, {
          epoch: failedState.epoch + 1,
          pending: false,
          pageUrl: frame.pageUrl,
        });
        observeMainDocument(tabId, frame.documentId);
      });
    },
    onMainDocumentCommitted(tabId, documentId, pageUrl) {
      const state = advanceMainNavigation(tabId, false, pageUrl);
      observeMainDocument(tabId, documentId);
      const commit = {
        tabId,
        documentId,
        pageUrl: state.pageUrl,
      };
      renderInspection.observeNavigationCommit(commit);
      // Inspection owns a narrower per-tab FIFO and its JavaScript restore is
      // safety-critical. Process the browser boundary immediately instead of
      // waiting behind remote page-context/config work in the broader cleanup.
      void settleRenderInspection("navigation cleanup", () =>
        renderInspection.navigationCommitted(commit));
    },
    onMainDocumentHistoryChanged(tabId, documentId, pageUrl) {
      const state = advanceMainNavigation(tabId, false, pageUrl);
      if (documentId) {
        observeMainDocument(tabId, documentId);
      }
      const commit = { tabId, documentId, pageUrl: state.pageUrl };
      renderInspection.observeNavigationCommit(commit);
      void settleRenderInspection("same-document navigation cleanup", () =>
        renderInspection.navigationCommitted(commit));
    },
    onPresenceChanged(tabId, presence) {
      lockRuntime.presenceChanged(tabId, presence);
    },
    onTabTerminated(tabId, reason) {
      // Navigation/reload and tab close are draft-terminal, unlike a transient
      // network failure. A close releases immediately; navigation retains only
      // the lease while its off-candidate/cross-property deadline is resolved.
      const preserveSignalHead = reason !== "tab-closed";
      return beginTabCleanup(tabId, async () => {
        if (reason === "tab-closed") {
          await settleRenderInspection("tab-close cleanup", () =>
            renderInspection.terminateTab(tabId, "tab-closed"));
          await clearConsentSuppression(tabId);
          await lockRuntime.terminateTab(tabId);
          await drainLockFactOperations(tabId);
          await runtime.forgetBrain(tabId, { preserveSignalHead: false });
          await shieldPosture.clearTab(tabId);
          await clearMainDocument(tabId);
        } else {
          lockRuntime.navigationCommitted(tabId);
          await shieldPosture.navigationCommitted(tabId);
          await drainLockFactOperations(tabId);
          await runtime.forgetBrain(tabId);
        }
        await clearTabContinuation(tabId, preserveSignalHead);
      });
    },
  });
  void lockBrowserLifecycle.start().catch((error) => {
    console.error("[Unfluffify][rewrite] Unable to initialize browser lock presence", error);
  });
  void renderInspection.initialize().catch((error) => {
    console.error("[Unfluffify][rewrite] Unable to recover render inspection", error);
  });
  // The lease belongs to the background editor session, not to the side-panel
  // document. Closing the panel therefore removes no client and no heartbeat.
  api.alarms?.create(PROPERTY_LOCK_HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
  api.alarms?.onAlarm?.addListener((alarm) => {
    runtime.keepAlive.handleAlarm(alarm);
    void authTokenMonitor.handleAlarm(alarm);
    void renderInspection.handleAlarm(alarm).catch((error) => {
      console.error("[Unfluffify][rewrite] Render inspection alarm failed", error);
    });
    if (alarm.name === PROPERTY_LOCK_HEARTBEAT_ALARM) {
      lockRuntime.heartbeat();
    }
  });
  bus.onCommand("signals.pull", async (request, meta) => {
    const tabId = request.tabId === 0 ? parseSenderTabId(meta.sourceInstance) ?? 0 : request.tabId;
    await awaitTabTermination(tabId);
    const brain = await runtime.getBrain(tabId);
    return [...(request.organId
      ? brain.pullForOrgan(request.organId, request.afterSeq)
      : brain.pullSignals(request.afterSeq))];
  });
  bus.onCommand("signals.consume", async (request, meta) => {
    const tabId = request.tabId === 0 ? parseSenderTabId(meta.sourceInstance) ?? 0 : request.tabId;
    await awaitTabTermination(tabId);
    const brain = await runtime.getBrain(tabId);
    brain.markConsumed(request.organId, request.seq);
    return { ok: true as const };
  });
  bus.on("fact.reported", async (envelope, meta) => {
    const tabId = envelope.sensation.tabId === 0
      ? parseSenderTabId(meta.sourceInstance) ?? 0
      : envelope.sensation.tabId;
    const report = async (): Promise<void> => {
      const brain = await runtime.getBrain(tabId);
      brain.observe({
        ...envelope.sensation,
        tabId,
        facts: {
          ...envelope.sensation.facts,
          tabId,
        },
      });
      const snapshot = brain.snapshot();
      if (snapshot) {
        await services.persistence.persistDurableFacts(snapshot);
        // This fact belongs to the tab, not the popup. Publishing it here keeps
        // heartbeats accurate while every UI surface is closed.
        lockRuntime.unsavedChanged(tabId, snapshot.hasUnsavedWork);
      }
      const siteId = typeof envelope.sensation.facts.siteId === "number" ? envelope.sensation.facts.siteId : snapshot?.siteId ?? null;
      if (envelope.sensation.reason === "activity-ping" && siteId !== null) {
        lockRuntime.activity(tabId, siteId);
      }
      if (envelope.sensation.reason === "content-started") {
        const baseUrl = typeof envelope.sensation.facts.baseUrl === "string" ? envelope.sensation.facts.baseUrl : "";
        const pageUrl = typeof envelope.sensation.facts.pageUrl === "string" ? envelope.sensation.facts.pageUrl : "";
        if (pageUrl) {
          await lockRuntime.directive({ tabId, pageUrl, baseUrl, hasUnsavedChanges: false });
        } else {
          lockRuntime.republish(tabId, baseUrl);
        }
      }
      await bus.emit("signals.available", { tabId }, { target: "popup" });
    };
    if (meta.source === "content") {
      const documentId = parseSenderDocumentId(meta.sourceInstance);
      const authorizedSender = tabId > 0 &&
        parseSenderTabId(meta.sourceInstance) === tabId &&
        parseSenderFrameId(meta.sourceInstance) === 0 &&
        documentId !== null;
      if (!authorizedSender) {
        return;
      }
      await withTabLifecycleOperation(tabId, async () => {
        if (
          !await isCurrentMainDocument(tabId, documentId) ||
          await consentSuppressionDisabled(tabId) ||
          !await isCurrentMainDocument(tabId, documentId)
        ) {
          return;
        }
        await report();
      });
      return;
    }
    await withTabLifecycleOperation(tabId, async () => {
      if (await consentSuppressionDisabled(tabId)) {
        return;
      }
      await report();
    });
  });
  const unavailableLockDirective = (request: Readonly<{
    pageUrl: string;
    baseUrl?: string;
  }>) => {
    let baseUrl = request.baseUrl ?? request.pageUrl;
    try {
      baseUrl = new URL(baseUrl).origin;
    } catch {
      baseUrl = "https://invalid.invalid";
    }
    return {
      status: "unavailable" as const,
      baseUrl,
      siteId: null,
      lockRole: "unknown" as const,
      configPresent: false,
      canEdit: false,
      blockedReason: "unavailable" as const,
      lockBanner: { visible: true, reason: "unavailable" as const },
    };
  };
  bus.onCommand("lock.directive", (request) =>
    withTabLifecycleOperation(request.tabId, async () => {
      if (await consentSuppressionDisabled(request.tabId)) {
        return unavailableLockDirective(request);
      }
      return lockRuntime.directive(request);
    }));
  bus.onCommand("lock.action", (request, meta) => {
    const tabId = request.tabId ?? parseSenderTabId(meta.sourceInstance) ?? 0;
    const contentDocumentId = meta.source === "content"
      ? parseSenderDocumentId(meta.sourceInstance)
      : null;
    const authorizedContent = meta.source !== "content" || (
      parseSenderTabId(meta.sourceInstance) === tabId &&
      parseSenderFrameId(meta.sourceInstance) === 0 &&
      contentDocumentId !== null
    );
    if (!authorizedContent) {
      return Promise.resolve({ status: "unavailable" as const });
    }
    return withTabLifecycleOperation(tabId, async () => {
      if (
        (contentDocumentId !== null && !await isCurrentMainDocument(tabId, contentDocumentId)) ||
        await consentSuppressionDisabled(tabId) ||
        (contentDocumentId !== null && !await isCurrentMainDocument(tabId, contentDocumentId))
      ) {
        return { status: "unavailable" as const };
      }
      return lockRuntime.action({ ...request, tabId });
    });
  });
  bus.onCommand("staticHtml.fetch", (request) => fetchStaticPageHtml(request.url));
  bus.onCommand("emulation.apply", (request) =>
    withTabLifecycleOperation(request.tabId, async () => {
      if (await consentSuppressionDisabled(request.tabId)) {
        return {
          mode: request.mode,
          width: request.mode === "mobile" ? 412 : 1280,
          height: request.mode === "mobile" ? 960 : 900,
          scale: request.scale,
          active: false,
          identityStale: false,
        };
      }
      return renderEmulation.apply(
        request.tabId,
        request.mode,
        request.scale,
        request.allowReload === true,
      );
    }));
  bus.onCommand("emulation.clear", async (request) => {
    await renderEmulation.clear(request.tabId);
    return { status: "ok" as const };
  });
  /** Render-mode knowledge is presentation data, not property classification.
   * Keep its last settled value by authoritative identity so a transient context
   * retry does not make a configured property appear unconfigured. */
  const renderModeByProperty = new Map<string, boolean>();
  /** A backend 404 is authoritative configuration state, not a transient load
   * failure. Share it across page-context and popup consumers so a property
   * binding performs one remote load until explicit Refresh or Save. */
  const definitiveConfigAuthority = new Map<string, "ok" | "not_found">();
  bus.onCommand("page.context", (request, meta) => {
    const tabId = request.tabId ?? parseSenderTabId(meta.sourceInstance) ?? 0;
    const incomingDocumentId = parseSenderDocumentId(meta.sourceInstance);
    const senderTabId = parseSenderTabId(meta.sourceInstance);
    const frameId = parseSenderFrameId(meta.sourceInstance);
    const mainContentSender = meta.source === "content" &&
      tabId > 0 &&
      senderTabId === tabId &&
      Boolean(incomingDocumentId) &&
      frameId === 0;
    if (meta.source === "content" && !mainContentSender) {
      return Promise.resolve(stalePageContextResponse(request.pageUrl));
    }
    return withTabLifecycleOperation(tabId, async () => {
    const currentContentDocument = async (): Promise<boolean> =>
      meta.source !== "content" || (
        incomingDocumentId !== null &&
        await isCurrentMainDocument(tabId, incomingDocumentId)
      );
    if (!await currentContentDocument()) {
      return stalePageContextResponse(request.pageUrl);
    }
    if (!await consentSuppressionDisabled(tabId)) {
      void actionIcons.apply(tabId, "connecting").catch(() => undefined);
    }
    const context = await pageContextRuntime.resolve({
      tabId,
      pageUrl: request.pageUrl,
      refresh: request.refresh,
      backstop: request.backstop,
    });
    if (!await currentContentDocument()) {
      return stalePageContextResponse(request.pageUrl);
    }
    const consentSuppressionAllowed = !await consentSuppressionDisabled(tabId);
    void actionIcons.apply(
      tabId,
      consentSuppressionAllowed ? actionIconStateForContext(context.status) : "unregistered",
    ).catch(() => undefined);
    if (!consentSuppressionAllowed) {
      return {
        ...context,
        consentSuppressionAllowed: false,
        renderModeSet: false,
        todo: projectTodoCoverage(context.pageTypes, context.pageKey, new Set()),
        shieldPosture: { status: "inactive" as const, revision: 0 },
      };
    }
    // Content asks for page context at load time, before a popup necessarily
    // exists. That is the earliest authoritative point at which the background
    // knows this is a managed property tab, so establish the standing mobile
    // posture here. An explicit desktop preview is a held override and remains
    // untouched until the popup turns it off or marking begins.
    const emulationDecision = managedEmulationDecision({
      recognized: consentSuppressionAllowed &&
        tabId > 0 &&
        Boolean(context.environmentKey) &&
        context.siteId !== null,
      heldMode: renderEmulation.heldMode(tabId),
    });
    if (emulationDecision) {
      await renderEmulation.apply(
        tabId,
        emulationDecision.mode,
        emulationDecision.scale,
        emulationDecision.allowReload,
      ).catch(() => undefined);
    }
    const propertyKey = context.environmentKey && context.siteId !== null
      ? `${context.environmentKey}\u0000${context.siteId}`
      : null;
    if (request.refresh === true && propertyKey) {
      definitiveConfigAuthority.delete(propertyKey);
    }
    let renderModeSet = propertyKey ? renderModeByProperty.get(propertyKey) ?? false : false;
    let authoritativeConfig: ConfigSnapshot | null = null;
    if (context.environmentKey && context.siteId !== null) {
      const stored = await services.repos.configRepo.load(context.environmentKey, context.siteId);
      authoritativeConfig = stored.ok && stored.value ? stored.value : null;
    }
    if (
      consentSuppressionAllowed &&
      propertyKey &&
      context.environmentKey &&
      context.siteId !== null &&
      (context.status === "managed_candidate" ||
        context.status === "managed_non_candidate" ||
        context.status === "suspended_candidate_removed" ||
        context.status === "suspended_candidate_feed_conflict")
    ) {
      if (!definitiveConfigAuthority.has(propertyKey)) {
        const loaded = await services.lynx.loadConfigSnapshot(context.environmentKey, context.siteId);
        const authority = await services.property.applyBackendLoad(
          context.environmentKey,
          context.siteId,
          loaded.status === "ok"
            ? { status: loaded.status, config: loaded.data }
            : { status: loaded.status },
        );
        if (loaded.status === "not_found") {
          definitiveConfigAuthority.set(propertyKey, "not_found");
          await shieldPosture.removeProperty(context.environmentKey, context.siteId);
        } else if (loaded.status === "ok") {
          definitiveConfigAuthority.set(propertyKey, "ok");
        }
        renderModeSet = authority.renderMode !== undefined;
        if (loaded.status === "ok" || loaded.status === "not_found") {
          renderModeByProperty.set(propertyKey, renderModeSet);
          const stored = await services.repos.configRepo.load(context.environmentKey, context.siteId);
          authoritativeConfig = stored.ok && stored.value ? stored.value : null;
        }
      }
    }
    const todo = projectTodoCoverage(
      context.pageTypes,
      context.pageKey,
      new Set(Object.keys(authoritativeConfig?.pages ?? {})),
    );
    const documentId = incomingDocumentId;
    let currentShieldPosture: ShieldPostureProjection = {
      status: "inactive" as const,
      revision: 0,
    };
    const managedContext = context.status === "managed_candidate" ||
      context.status === "managed_non_candidate" ||
      context.status === "suspended_candidate_removed" ||
      context.status === "suspended_candidate_feed_conflict";
    const transientContext = (
      context.status === "authentication_required" ||
      context.status === "access_denied" ||
      context.status === "unavailable"
    );
    const preservedTransientContext = transientContext &&
      context.draftDisposition === "preserve" &&
      Boolean(context.environmentKey) &&
      context.siteId !== null &&
      Boolean(context.baseUrl) &&
      authoritativeConfig !== null;
    const mainContentDocument = meta.source === "content" &&
      senderTabId === tabId &&
      documentId &&
      frameId === 0 &&
      await currentContentDocument();
    if (
      mainContentDocument &&
      (managedContext || preservedTransientContext) &&
      context.environmentKey &&
      context.siteId !== null &&
      context.baseUrl &&
      authoritativeConfig !== null
    ) {
      if (!await consentSuppressionDisabled(tabId)) {
        currentShieldPosture = await shieldPosture.bindDocument({
        tabId,
        documentId,
        contextGeneration: context.generation,
        environmentKey: context.environmentKey,
        siteId: context.siteId,
        baseUrl: context.baseUrl,
        pageUrl: context.observedUrl,
        configPresent: true,
        });
      }
    } else if (
      mainContentDocument &&
      transientContext &&
      context.draftDisposition === "preserve"
    ) {
      // A recreated MV3 worker has no in-memory PageContextRuntime history. The
      // durable property lease plus its validated property config is sufficient
      // to re-adopt a replacement document even after navigation deliberately
      // released the old document fence. A transient backend answer never gets
      // to invent identity: environment, page origin, and stored config must all
      // agree with the retained property scope.
      const retained = await shieldPosture.retainedSilentProperty({
        tabId,
        pageUrl: context.observedUrl,
      });
      if (
        retained &&
        context.environmentKey === retained.environmentKey
      ) {
        const stored = await services.repos.configRepo.load(
          retained.environmentKey,
          retained.siteId,
        );
        if (
          stored.ok &&
          stored.value &&
          new URL(stored.value.baseUrl).origin === new URL(retained.baseUrl).origin
        ) {
          if (!await consentSuppressionDisabled(tabId)) {
            currentShieldPosture = await shieldPosture.bindDocument({
            tabId,
            documentId,
            contextGeneration: context.generation,
            environmentKey: retained.environmentKey,
            siteId: retained.siteId,
            baseUrl: retained.baseUrl,
            pageUrl: context.observedUrl,
            configPresent: true,
            });
          }
        }
      }
    } else if (mainContentDocument && (
      context.status === "unmanaged" ||
      context.status === "environment_not_registered" ||
      context.draftDisposition === "terminate"
    )) {
      // Only a definitive property boundary may erase retained authority. A
      // same-page auth/access/network failure preserves the last validated
      // property and its durable config without pretending to revalidate it.
      await settleRenderInspection("property-exit cleanup", () =>
        renderInspection.terminateTab(tabId, "extension-invalidated"));
      // Revoke the canonical page/edit projection immediately. A popup request
      // queued behind this definitive context must not restart inspection from
      // the old property even when the SPA reused its document id.
      lockRuntime.navigationCommitted(tabId);
      await shieldPosture.clearTab(tabId);
    }
    return {
      ...context,
      consentSuppressionAllowed: !await consentSuppressionDisabled(tabId),
      renderModeSet,
      todo,
      shieldPosture: currentShieldPosture,
    };
    });
  });
  bus.onCommand("shield.posture.current", async (request, meta) => {
    const senderTabId = parseSenderTabId(meta.sourceInstance);
    const tabId = senderTabId ?? 0;
    const documentId = parseSenderDocumentId(meta.sourceInstance);
    if (
      meta.source !== "content" ||
      tabId <= 0 ||
      (request.tabId !== undefined && request.tabId !== tabId) ||
      !documentId ||
      parseSenderFrameId(meta.sourceInstance) !== 0
    ) {
      return { status: "unavailable" as const, reason: "main-content-document-required" };
    }
    await awaitTabTermination(tabId);
    return shieldPosture.current({ tabId, documentId, pageUrl: request.pageUrl });
  });
  bus.onCommand("shield.posture.adoptRetained", (request, meta) => {
    const senderTabId = parseSenderTabId(meta.sourceInstance);
    const tabId = senderTabId ?? 0;
    const documentId = parseSenderDocumentId(meta.sourceInstance);
    if (
      meta.source !== "content" ||
      tabId <= 0 ||
      (request.tabId !== undefined && request.tabId !== tabId) ||
      !documentId ||
      parseSenderFrameId(meta.sourceInstance) !== 0
    ) {
      return Promise.resolve({
        status: "unavailable" as const,
        reason: "main-content-document-required",
      });
    }
    return withTabLifecycleOperation(tabId, async () => {
      const staleDocument = async (): Promise<boolean> =>
        !await isCurrentMainDocument(tabId, documentId);
      if (await staleDocument()) {
        return { status: "unavailable" as const, reason: "stale-main-document" };
      }
      if (await consentSuppressionDisabled(tabId)) {
        return { status: "unavailable" as const, reason: "suppression-disabled" };
      }
      if (await staleDocument()) {
        return { status: "unavailable" as const, reason: "stale-main-document" };
      }
      const property = await shieldPosture.retainedSilentProperty({
        tabId,
        pageUrl: request.pageUrl,
      });
      if (await staleDocument()) {
        return { status: "unavailable" as const, reason: "stale-main-document" };
      }
      if (!property) {
        return { status: "unavailable" as const, reason: "no-retained-silent-posture" };
      }
      const stored = await services.repos.configRepo.load(property.environmentKey, property.siteId);
      if (await staleDocument()) {
        return { status: "unavailable" as const, reason: "stale-main-document" };
      }
      if (
        !stored.ok ||
        !stored.value ||
        new URL(stored.value.baseUrl).origin !== new URL(property.baseUrl).origin
      ) {
        await shieldPosture.removeProperty(property.environmentKey, property.siteId);
        return { status: "unavailable" as const, reason: "local-config-unavailable" };
      }
      if (await consentSuppressionDisabled(tabId)) {
        return { status: "unavailable" as const, reason: "suppression-disabled" };
      }
      if (await staleDocument()) {
        return { status: "unavailable" as const, reason: "stale-main-document" };
      }
      return shieldPosture.adoptRetainedDocument({
        tabId,
        documentId,
        pageUrl: request.pageUrl,
        property,
      });
    });
  });
  bus.onCommand("shield.posture.set", async (request, meta) => {
    const fromContent = meta.source === "content";
    const senderTabId = parseSenderTabId(meta.sourceInstance);
    const senderDocumentId = parseSenderDocumentId(meta.sourceInstance);
    const tabId = fromContent ? senderTabId ?? 0 : request.tabId ?? 0;
    const documentId = fromContent ? senderDocumentId : null;
    if (
      tabId <= 0 ||
      (meta.source !== "content" && meta.source !== "popup") ||
      (fromContent && (
        (request.tabId !== undefined && request.tabId !== senderTabId) ||
        !documentId ||
        parseSenderFrameId(meta.sourceInstance) !== 0
      )) ||
      (!fromContent && senderDocumentId !== null)
    ) {
      return { status: "unavailable" as const, reason: "authorized-shield-caller-required" };
    }
    await awaitTabTermination(tabId);
    return shieldPosture.set({
      tabId,
      documentId,
      expected: request.expected,
      posture: request.posture,
    });
  });
  bus.onCommand("shield.posture.clear", async (request, meta) => {
    const fromContent = meta.source === "content";
    const senderTabId = parseSenderTabId(meta.sourceInstance);
    const senderDocumentId = parseSenderDocumentId(meta.sourceInstance);
    const tabId = fromContent ? senderTabId ?? 0 : request.tabId ?? 0;
    const documentId = fromContent ? senderDocumentId : null;
    if (
      tabId <= 0 ||
      (meta.source !== "content" && meta.source !== "popup") ||
      (fromContent && (
        (request.tabId !== undefined && request.tabId !== senderTabId) ||
        !documentId ||
        parseSenderFrameId(meta.sourceInstance) !== 0
      )) ||
      (!fromContent && senderDocumentId !== null)
    ) {
      return { status: "unavailable" as const, reason: "authorized-shield-caller-required" };
    }
    await awaitTabTermination(tabId);
    return shieldPosture.clear({
      tabId,
      documentId,
      expected: request.expected,
      reason: request.reason,
    });
  });
  bus.onCommand("consent.suppression.register", (request, meta) => {
    const senderTabId = parseSenderTabId(meta.sourceInstance);
    const documentId = parseSenderDocumentId(meta.sourceInstance);
    if (
      meta.source !== "content" ||
      senderTabId !== request.tabId ||
      !documentId ||
      parseSenderFrameId(meta.sourceInstance) !== 0
    ) {
      return Promise.resolve({ status: "stale" as const });
    }
    return withTabLifecycleOperation(request.tabId, async () => ({
      status: await registerConsentSuppression(request.tabId, documentId),
    }));
  });
  bus.onCommand("renderInspection.start", async (request, meta) => {
    if (meta.source !== "popup" || parseSenderDocumentId(meta.sourceInstance) !== null) {
      throw new Error("render-inspection-popup-required");
    }
    await awaitTabTermination(request.tabId);
    return withTabLifecycleOperation(request.tabId, async () => {
      const sameUrl = (left: string, right: string): boolean => {
        try {
          const leftUrl = new URL(left);
          const rightUrl = new URL(right);
          leftUrl.hash = "";
          rightUrl.hash = "";
          return leftUrl.toString() === rightUrl.toString();
        } catch {
          return false;
        }
      };
      const sameBase = (left: string, right: string): boolean => {
        try {
          return new URL(left).origin === new URL(right).origin;
        } catch {
          return false;
        }
      };
      const navigationBeforeFrame = mainNavigationByTab.get(request.tabId);
      const queriedFrame = await queryMainFrame(request.tabId);
      if (mainNavigationByTab.get(request.tabId) !== navigationBeforeFrame) {
        throw new Error("render-inspection-navigation-changed");
      }
      if (queriedFrame?.documentId && !mainDocumentByTab.has(request.tabId)) {
        observeMainDocument(request.tabId, queriedFrame.documentId);
      }
      if (!navigationBeforeFrame && queriedFrame?.pageUrl) {
        mainNavigationByTab.set(request.tabId, {
          epoch: 0,
          pending: false,
          pageUrl: queriedFrame.pageUrl,
        });
      }
      const currentDocument = await loadMainDocument(request.tabId);
      const navigation = mainNavigationByTab.get(request.tabId);
      if (
        !currentDocument.known ||
        !currentDocument.documentId ||
        !navigation ||
        navigation.pending ||
        !navigation.pageUrl ||
        !sameUrl(navigation.pageUrl, request.pageUrl)
      ) {
        throw new Error("render-inspection-page-context-not-authorized");
      }
      const context = await pageContextRuntime.resolve({
        tabId: request.tabId,
        pageUrl: request.pageUrl,
        refresh: false,
      });
      const managedProperty = context.status === "managed_candidate" ||
        context.status === "managed_non_candidate" ||
        context.status === "suspended_candidate_removed" ||
        context.status === "suspended_candidate_feed_conflict";
      if (
        !managedProperty ||
        !context.environmentKey ||
        context.siteId === null ||
        !context.baseUrl ||
        context.environmentKey.trim().toLowerCase() !== request.property.environmentKey.trim().toLowerCase() ||
        context.siteId !== request.property.siteId ||
        !sameBase(context.baseUrl, request.property.baseUrl) ||
        !sameUrl(context.observedUrl, request.pageUrl) ||
        await consentSuppressionDisabled(request.tabId)
      ) {
        throw new Error("render-inspection-property-not-authorized");
      }
      const admittedNavigationEpoch = navigation.epoch;
      const admittedDocumentId = currentDocument.documentId;
      const stillCurrent = (): boolean => {
        const currentNavigation = mainNavigationByTab.get(request.tabId);
        return currentNavigation?.epoch === admittedNavigationEpoch &&
          !currentNavigation.pending &&
          Boolean(currentNavigation.pageUrl && sameUrl(currentNavigation.pageUrl, request.pageUrl)) &&
          mainDocumentByTab.get(request.tabId) === admittedDocumentId &&
          !tabTerminations.has(request.tabId);
      };
      // Context resolution and suppression storage both yield. Recheck the
      // admitted epoch before the runtime can perform even its first CDP write;
      // the runtime keeps the same callback for its own internal await points.
      if (!stillCurrent()) {
        throw new Error("render-inspection-navigation-changed");
      }
      const confirmedFrame = await queryMainFrame(request.tabId);
      if (
        !stillCurrent() ||
        confirmedFrame?.documentId !== admittedDocumentId ||
        !confirmedFrame.pageUrl ||
        !sameUrl(confirmedFrame.pageUrl, request.pageUrl)
      ) {
        throw new Error("render-inspection-navigation-changed");
      }
      return renderInspection.start({
        ...request,
        sourceDocumentId: admittedDocumentId,
        stillCurrent,
      });
    });
  });
  bus.onCommand("renderInspection.current", async (request, meta) => {
    if (meta.source !== "popup" || parseSenderDocumentId(meta.sourceInstance) !== null) {
      throw new Error("render-inspection-popup-required");
    }
    await awaitTabTermination(request.tabId);
    return withTabLifecycleOperation(request.tabId, () => renderInspection.current(request.tabId));
  });
  bus.onCommand("renderInspection.cancel", async (request, meta) => {
    if (meta.source !== "popup" || parseSenderDocumentId(meta.sourceInstance) !== null) {
      throw new Error("render-inspection-popup-required");
    }
    await awaitTabTermination(request.tabId);
    return withTabLifecycleOperation(request.tabId, () => renderInspection.cancel(request));
  });
  const renderInspectionDocument = (
    request: Readonly<{ tabId?: number }>,
    meta: Readonly<{ source: string; sourceInstance?: string }>,
  ): Readonly<{ tabId: number; documentId: string }> | null => {
    const senderTabId = parseSenderTabId(meta.sourceInstance);
    const documentId = parseSenderDocumentId(meta.sourceInstance);
    if (
      meta.source !== "content" ||
      senderTabId === null ||
      senderTabId <= 0 ||
      (request.tabId !== undefined && request.tabId !== senderTabId) ||
      parseSenderFrameId(meta.sourceInstance) !== 0 ||
      !documentId
    ) {
      return null;
    }
    return { tabId: senderTabId, documentId };
  };
  const staleRenderInspectionDocument = () => ({
    status: "stale" as const,
    reason: "stale-main-document",
  });
  const withRenderInspectionDocument = async <T>(
    sender: Readonly<{ tabId: number; documentId: string }>,
    pageUrl: string,
    operation: () => Promise<T>,
  ): Promise<T | ReturnType<typeof staleRenderInspectionDocument>> => {
    if (await consentSuppressionDisabled(sender.tabId)) {
      return staleRenderInspectionDocument();
    }
    const fence = await admitRenderInspectionDocument(
      sender.tabId,
      sender.documentId,
      pageUrl,
    );
    if (!fence || await consentSuppressionDisabled(sender.tabId)) {
      return staleRenderInspectionDocument();
    }
    const response = await operation();
    return renderInspectionDocumentFenceIsCurrent(sender.tabId, fence) &&
      !await consentSuppressionDisabled(sender.tabId)
      ? response
      : staleRenderInspectionDocument();
  };
  bus.onCommand("renderInspection.adopt", async (request, meta) => {
    const sender = renderInspectionDocument(request, meta);
    if (!sender) {
      return Promise.resolve({ status: "stale" as const, reason: "main-content-document-required" });
    }
    return withRenderInspectionDocument(sender, request.pageUrl, () =>
      renderInspection.adopt({
        tabId: sender.tabId,
        documentId: sender.documentId,
        pageUrl: request.pageUrl,
        documentNonce: request.documentNonce,
      }));
  });
  bus.onCommand("renderInspection.paintFallbackTick", async (request, meta) => {
    const sender = renderInspectionDocument(request, meta);
    if (!sender) {
      return Promise.resolve({ status: "stale" as const, reason: "main-content-document-required" });
    }
    return withRenderInspectionDocument(sender, request.pageUrl, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const current = await renderInspection.current(sender.tabId);
      const exact = current.status === "active" &&
        current.session.phase === "adopted" &&
        current.session.token === request.token &&
        current.session.generation === request.generation &&
        current.session.documentId === sender.documentId &&
        current.session.documentNonce === request.documentNonce;
      if (!exact) {
        return { status: "stale" as const, reason: "inspection-identity-changed" };
      }
      reportRenderInspectionFallbackStage("fallback", request.generation, sender.documentId);
      const curtainProven = await renderEmulation.evaluate(
        sender.tabId,
        renderInspectionCurtainProofExpression(request),
      ).catch(() => false);
      if (curtainProven !== true) {
        reportRenderInspectionFallbackStage(
          "rejected",
          request.generation,
          sender.documentId,
          "curtain-proof-rejected",
        );
        return { status: "stale" as const, reason: "curtain-proof-rejected" };
      }
      if (
        !await isCurrentMainDocument(sender.tabId, sender.documentId) ||
        await consentSuppressionDisabled(sender.tabId)
      ) {
        return { status: "stale" as const, reason: "inspection-document-changed" };
      }
      const acknowledged = await renderInspection.acknowledgePaint({
        tabId: sender.tabId,
        documentId: sender.documentId,
        token: request.token,
        generation: request.generation,
        pageUrl: request.pageUrl,
        documentNonce: request.documentNonce,
      });
      if (acknowledged.status !== "ok") {
        return {
          status: "stale" as const,
          reason: acknowledged.status === "stale" ? acknowledged.reason : "inspection-inactive",
        };
      }
      reportRenderInspectionFallbackStage("acknowledged", request.generation, sender.documentId);
      return { status: "acknowledged" as const };
    });
  });
  bus.onCommand("renderInspection.ackPaint", async (request, meta) => {
    const sender = renderInspectionDocument(request, meta);
    if (!sender) {
      return Promise.resolve({ status: "stale" as const, reason: "main-content-document-required" });
    }
    return withRenderInspectionDocument(sender, request.pageUrl, () =>
      renderInspection.acknowledgePaint({
        ...request,
        tabId: sender.tabId,
        documentId: sender.documentId,
      }));
  });
  bus.onCommand("renderInspection.fail", async (request, meta) => {
    const sender = renderInspectionDocument(request, meta);
    if (!sender) {
      return Promise.resolve({ status: "stale" as const, reason: "main-content-document-required" });
    }
    return withRenderInspectionDocument(sender, request.pageUrl, () =>
      renderInspection.fail({
        ...request,
        tabId: sender.tabId,
        documentId: sender.documentId,
      }));
  });
  bus.onCommand("transferPayload.put", async (request) => ({
    handle: await transferPayloads.put(request.scope, request.value),
  }));
  bus.onCommand("transferPayload.get", async (request, meta) => {
    if (meta.source !== "offscreen") {
      return { status: "missing" as const };
    }
    const value = await transferPayloads.get(request.handle);
    return value === null
      ? { status: "missing" as const }
      : { status: "ok" as const, value };
  });
  bus.onCommand("transferPayload.release", (request) => ({
    released: transferPayloads.releaseScope(request.scope),
  }));
  bus.onCommand("offscreen.refineXpaths", async (request) => {
    await ensureOffscreenDocument(api);
    const response = await bus.request("offscreen.refineXpaths", request, { target: "offscreen" });
    return response.ok ? response.data : { rows: request.rows };
  });
  bus.onCommand("ai.run", async (request) => {
    const releaseKeepAlive = runtime.keepAlive.acquireUntilRelease("ai.run");
    try {
      const environmentKey = await services.lynx.currentEnvironmentKey();
      if (!environmentKey) {
        return { status: "environment_unconfigured" };
      }
      if (!request.snapshot.pages.some((page) => canonicalPageKey(page.url) === request.pageKey)) {
        return { status: "invalid_page_scope" };
      }
      const snapshot = await services.property.overlayAiCorpus(
        environmentKey,
        request.siteId,
        request.snapshot,
      );
      const result = await services.lynx.runAiJob(snapshot, {
        tabId: request.tabId,
        clientRunId: request.clientRunId,
        editorSessionId: request.editorSessionId,
        environmentKey,
        siteId: request.siteId,
        pageKey: request.pageKey,
      });
      return result.status === "ok"
        ? { status: result.status, sessionId: result.sessionId, selectors: result.selectors }
        : { status: result.status, httpStatus: "httpStatus" in result ? result.httpStatus : undefined };
    } finally {
      releaseKeepAlive();
    }
  });
  bus.onCommand("ai.resume", async (request) => {
    const environmentKey = await services.lynx.currentEnvironmentKey();
    if (!environmentKey) {
      return { status: "environment_unconfigured" as const };
    }
    return await services.lynx.resumeAiJob({
      tabId: request.tabId,
      environmentKey,
      siteId: request.siteId,
      pageKey: request.pageKey,
      clientRunId: request.clientRunId,
      editorSessionId: request.editorSessionId,
    });
  });
  bus.onCommand("config.load", async (request) => {
    const environmentKey = await services.lynx.currentEnvironmentKey();
    if (!environmentKey) {
      return { status: "environment_unconfigured" as const, renderModeSource: "local" as const };
    }
    const propertyKey = `${environmentKey}\u0000${request.siteId}`;
    if (definitiveConfigAuthority.get(propertyKey) === "ok") {
      const stored = await services.repos.configRepo.load(environmentKey, request.siteId);
      if (stored.ok && stored.value) {
        return {
          status: "ok" as const,
          config: stored.value,
          renderMode: stored.value.renderMode,
          renderModeSource: "backend" as const,
        };
      }
      definitiveConfigAuthority.delete(propertyKey);
    }
    const result = definitiveConfigAuthority.get(propertyKey) === "not_found"
      ? { status: "not_found" as const, httpStatus: 404 }
      : await services.lynx.loadConfigSnapshot(environmentKey, request.siteId);
    // The rule lives in services, not here and not in the popup: one place
    // decides what local data survives a backend answer.
    try {
      if (result.status === "ok") {
        const applied = await services.property.applyBackendLoad(
          environmentKey,
          request.siteId,
          { status: "ok", config: result.data },
        );
        const snapshot = applied.snapshot;
        if (!snapshot) {
          throw new PropertySnapshotIntegrityError("Validated backend load did not produce a snapshot.");
        }
        await shieldPosture.authorizeProperty(environmentKey, request.siteId);
        definitiveConfigAuthority.set(propertyKey, "ok");
        if (applied.integrityWarning) {
          return {
            status: "integrity_shrink" as const,
            config: snapshot,
            renderMode: applied.renderMode,
            renderModeSource: "backend" as const,
            reason: applied.integrityWarning.message,
          };
        }
        return {
          status: "ok" as const,
          config: snapshot,
          ...(applied.renderMode ? { renderMode: applied.renderMode } : {}),
          renderModeSource: "backend" as const,
        };
      }
      const applied = await services.property.applyBackendLoad(
        environmentKey,
        request.siteId,
        { status: result.status },
      );
      if (result.status === "not_found") {
        definitiveConfigAuthority.set(propertyKey, "not_found");
        await shieldPosture.removeProperty(environmentKey, request.siteId);
      }
      return {
        status: result.status,
        httpStatus: result.httpStatus,
        ...(applied.renderMode ? { renderMode: applied.renderMode } : {}),
        renderModeSource: applied.source,
      };
    } catch (error) {
      if (error instanceof PropertySnapshotIntegrityError) {
        return { status: "invalid" as const, renderModeSource: "local" as const };
      }
      throw error;
    }
  });
  bus.onCommand("renderMode.remember", async (request) => {
    const environmentKey = await services.lynx.currentEnvironmentKey();
    if (!environmentKey) {
      return { stored: false as const, reason: "environment-unconfigured" as const };
    }
    const remembered = await services.property.rememberRenderMode(
      environmentKey,
      request.siteId,
      request.renderMode,
    );
    if (remembered.stored) {
      renderModeByProperty.set(`${environmentKey}\u0000${request.siteId}`, true);
    }
    return remembered;
  });
  bus.onCommand("config.save", async (request) => {
    const environmentKey = await services.lynx.currentEnvironmentKey();
    if (!environmentKey || environmentKey !== request.environmentKey) {
      return { status: "environment_unconfigured" as const };
    }
    const integrity = await services.property.mutationGate(request.environmentKey, request.siteId);
    if (!integrity.ok) {
      return { status: integrity.status, reason: integrity.reason };
    }
    const authorization = lockRuntime.authorizeMutation(request);
    if (!authorization.ok) {
      return {
        status: authorization.status,
        httpStatus: 409,
        reason: authorization.reason,
      };
    }
    const result = await services.lynx.saveConfigSnapshot(authorization.request);
    if (result.status === "ok") {
      // The backend acknowledgement is the durable Save boundary. The caller
      // will establish the replacement silent-selector posture after adopting
      // the returned authoritative selectors.
      await shieldPosture.clearProperty(request.environmentKey, request.siteId);
      try {
        const adoption = await services.property.applyBackendSave(
          request.environmentKey,
          request.siteId,
          result.data,
        );
        definitiveConfigAuthority.set(`${request.environmentKey}\u0000${request.siteId}`, "ok");
        return adoption.integrityWarning
          ? {
              status: "integrity_shrink" as const,
              config: adoption.snapshot,
              reason: adoption.integrityWarning.message,
            }
          : { status: "ok" as const, config: adoption.snapshot };
      } catch (error) {
        if (error instanceof PropertySnapshotIntegrityError) {
          return { status: "integrity_shrink" as const };
        }
        throw error;
      }
    }
    return result.status === "conflict"
      ? { status: result.status, httpStatus: result.httpStatus, ...(result.data ? { config: result.data } : {}) }
      : {
          status: result.status,
          httpStatus: result.httpStatus,
          ...("propertyRevision" in result
            ? { propertyRevision: result.propertyRevision, feedRevision: result.feedRevision }
            : {}),
          ...("duplicateOperation" in result && result.duplicateOperation !== undefined
            ? { duplicateOperation: result.duplicateOperation }
            : {}),
          ...("reason" in result && result.reason ? { reason: result.reason } : {}),
        };
  });
  bus.onCommand("config.publish", async (request) => {
    const environmentKey = await services.lynx.currentEnvironmentKey();
    if (!environmentKey || environmentKey !== request.environmentKey) {
      return { status: "environment_unconfigured" as const };
    }
    const integrity = await services.property.mutationGate(request.environmentKey, request.siteId);
    if (!integrity.ok) {
      return { status: integrity.status, reason: integrity.reason };
    }
    const authorization = lockRuntime.authorizeMutation(request);
    if (!authorization.ok) {
      return {
        status: authorization.status,
        httpStatus: 409,
        reason: authorization.reason,
      };
    }
    const result = await services.lynx.publishConfigSnapshot(authorization.request);
    if ("data" in result) {
      try {
        const adoption = await services.property.applyBackendSave(
          request.environmentKey,
          request.siteId,
          result.data,
        );
        if (adoption.integrityWarning) {
          return {
            status: "integrity_shrink" as const,
            config: adoption.snapshot,
            reason: adoption.integrityWarning.message,
          };
        }
        return {
          status: result.status,
          httpStatus: result.httpStatus,
          config: adoption.snapshot,
        };
      } catch (error) {
        if (error instanceof PropertySnapshotIntegrityError) {
          return { status: "integrity_shrink" as const };
        }
        throw error;
      }
    }
    return {
      status: result.status,
      httpStatus: result.httpStatus,
      ...(result.reason ? { reason: result.reason } : {}),
    };
  });
  bus.onCommand("settings.load", async () => {
    const stored = await services.settings.load();
    return {
      settings: connectionSettingsOf(stored),
      hasToken: Boolean(stored.token?.trim()),
    };
  });
  bus.onCommand("settings.save", async (settings) => {
    // The parsed request is the complete profile: clearing a field clears it.
    // Profile and credential land in one repository write, so no request can
    // observe a new backend paired with the old backend's JWT. Formatting-only
    // edits retain the credential because comparison uses normalized identity.
    const saved = await services.settings.update((current) => replaceConnectionProfile(current, settings));
    return {
      status: "ok" as const,
      settings: connectionSettingsOf(saved),
      hasToken: Boolean(saved.token?.trim()),
    };
  });
  bus.onCommand("cache.clearDomain", ({ origin }) => clearDomainCache(api.browsingData, origin));
  bus.onCommand("session.unregister", async ({ tabId }) => {
    await beginTabCleanup(tabId, async () => {
      const currentDocument = await loadMainDocument(tabId);
      const blockedDocumentKey = currentDocument.known
        ? currentDocument.documentId
        : await shieldPosture.adoptedDocumentKey(tabId);
      await disableConsentSuppression(tabId, blockedDocumentKey);
      await settleRenderInspection("Unregister cleanup", () =>
        renderInspection.terminateTab(tabId, "unregistered"));
      await lockRuntime.terminateTab(tabId);
      await drainLockFactOperations(tabId);
      await runtime.forgetBrain(tabId);
      await shieldPosture.clearTab(tabId);
      await clearTabContinuation(tabId);
      // Session authority is terminal even when Chrome cannot detach the CDP
      // posture (for example a tab that vanished between confirmation and this
      // command). The caller already deactivated content and can report that
      // cosmetic cleanup independently.
      await renderEmulation.clear(tabId).catch(() => undefined);
    });
    await actionIcons.apply(tabId, "unregistered").catch(() => undefined);
    return { status: "ok" as const };
  });
  bus.onCommand("accounts.login", async (credentials) => {
    const result = await services.accounts.login(credentials);
    return result.status === "ok"
      ? { status: result.status }
      : result.status === "skipped"
        ? { status: result.status }
        : result.status === "missing_token"
          ? { status: result.status, httpStatus: result.httpStatus }
          : { status: result.status, httpStatus: result.httpStatus, message: result.message };
  });
  bus.onCommand("accounts.logout", async () => {
    await services.accounts.logout();
    return { status: "ok" as const };
  });
  // Routed through the monitor so the manual check and the alarm share one
  // verdict rather than drifting apart.
  bus.onCommand("accounts.validate", async () => {
    const result = await authTokenMonitor.check();
    return result.status === "skipped"
      ? { status: result.status }
      : { status: result.status, httpStatus: result.httpStatus };
  });
  bus.onCommand("accounts.status", () => authTokenMonitor.status());
  void Promise.resolve(api.sidePanel?.setOptions?.({
    path: "popup.html",
    enabled: true,
  })).catch(reportActionOpenFailure);
  api.action?.onClicked?.addListener((tab: Readonly<{ id?: number }>) => {
    void openRewriteSidePanelForTab(tab, api).catch(reportActionOpenFailure);
  });
}
