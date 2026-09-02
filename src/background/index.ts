import { createRewriteBrainRuntime } from "./rewrite-brain-runtime";
import { createPropertyLockRuntime, PROPERTY_LOCK_HEARTBEAT_ALARM } from "./lock-runtime";
import {
  createRenderEmulationRuntime,
  PHYSICAL_VIEWPORT_GUARD_ADMISSION_TIMEOUT_MS,
  type EmulationTransitionDelivery,
} from "./render-emulation-runtime";
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
import {
  createEmulationPostureRepo,
  createMemoryStore,
  type KeyValueStore,
} from "../storage";
import { getBrowserRuntimeLastError, getInstalledBrowserApi } from "../common/browser";
import { createRealmBus } from "../messaging/realms";
import { createRuntimeTransport } from "../messaging/transports/runtime";
import { createTabTransport } from "../messaging/transports/tabs";
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
import type { TabFacts } from "../domain/schema/facts";
import type { FactEnvelope } from "../messaging/contracts";
import type { ShieldPostureProjection } from "../messaging/shield-posture";
import {
  createPageWorldCapabilityRuntime,
  type PageWorldDocumentIdentity,
} from "./page-world-capability-runtime";
import {
  createOffscreenDocumentOwner,
  type OffscreenDocumentApi,
} from "./offscreen-document";
import type {
  EmulationTransitionRequest,
  EmulationTransitionResult,
} from "../content/emulation-transition-guardian";

export { createRewriteBrain } from "./rewrite-brain";

type RewriteSidePanelApi = Readonly<{
  setOptions?: (options: { tabId?: number; path: string; enabled: boolean }) => Promise<void> | void;
  open?: (options: { tabId: number }) => Promise<void> | void;
  onOpened?: Readonly<{
    addListener(listener: (info: Readonly<{ tabId?: number; windowId?: number }>) => void): void;
  }>;
  onClosed?: Readonly<{
    addListener(listener: (info: Readonly<{ tabId?: number; windowId?: number }>) => void): void;
  }>;
}>;

type InstalledBrowserApi = NonNullable<ReturnType<typeof getInstalledBrowserApi>>;
type RewriteExtensionApi = InstalledBrowserApi & Readonly<{
  sidePanel?: RewriteSidePanelApi;
  offscreen?: OffscreenDocumentApi["offscreen"];
  scripting?: Readonly<{
    executeScript?: <T>(
      injection: Readonly<{
        target: Readonly<{ tabId: number; documentIds: string[] }>;
        world: "MAIN";
        func: (...args: never[]) => T | Promise<T>;
        args: unknown[];
      }>,
      callback?: (results: readonly Readonly<{
        frameId?: number;
        documentId?: string;
        result?: T;
      }>[]) => void,
    ) => Promise<readonly Readonly<{
      frameId?: number;
      documentId?: string;
      result?: T;
    }>[]> | void;
  }>;
}>;

function emulationTransitionResult(value: unknown): EmulationTransitionResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const measured = candidate.measured;
  if (!measured || typeof measured !== "object" || Array.isArray(measured)) return null;
  const measurement = measured as Record<string, unknown>;
  const numericMeasurements = [
    "innerWidth",
    "innerHeight",
    "documentClientWidth",
    "documentClientHeight",
    "screenWidth",
    "screenHeight",
    "visualViewportWidth",
    "visualViewportHeight",
    "visualViewportScale",
  ];
  if (numericMeasurements.some((key) =>
    typeof measurement[key] !== "number" || !Number.isFinite(measurement[key]))) {
    return null;
  }
  if (
    typeof candidate.ok !== "boolean" ||
    typeof candidate.generation !== "number" ||
    !Number.isSafeInteger(candidate.generation) ||
    candidate.generation <= 0 ||
    (candidate.mode !== null && candidate.mode !== "mobile" && candidate.mode !== "desktop") ||
    !["released", "idle", "guarding", "paint-proven", "settling", "rejected"]
      .includes(String(candidate.stage)) ||
    typeof candidate.guarded !== "boolean" ||
    typeof candidate.coverage !== "boolean" ||
    typeof candidate.exactGeometry !== "boolean" ||
    !["none", "frame-two", "guarded-fallback"].includes(String(candidate.paintProof)) ||
    typeof candidate.reason !== "string"
  ) {
    return null;
  }
  return candidate as EmulationTransitionResult;
}

function browserDeliveryDetail(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.message === "string") return candidate.message;
    if (typeof candidate.code === "string") return candidate.code;
  }
  return String(value ?? "delivery-failed");
}

function contentReceiverUnavailable(value: unknown): boolean {
  return /receiving end does not exist|no receiver|message port closed|could not establish connection|did not return one reply/i
    .test(browserDeliveryDetail(value));
}

function renderInspectionCurtainProofExpression(identity: Readonly<{
  token: string;
  generation: number;
  documentNonce: string;
}>): string {
  const expected = JSON.stringify(identity);
  return `(() => {
    const expected = ${expected};
    const root = document.documentElement;
    const curtain = Array.from(
      document.querySelectorAll('[data-uf-render-inspection-curtain="true"]'),
    ).find((candidate) =>
      candidate.getAttribute('data-uf-inspection-token') === expected.token &&
      candidate.getAttribute('data-uf-inspection-generation') === String(expected.generation) &&
      candidate.getAttribute('data-uf-document-nonce') === expected.documentNonce
    );
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
      Number.isFinite(opacity) && opacity >= 0.999 &&
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

function reportPageWorldAuthorizationStage(
  stage: string,
  detail: Readonly<Record<string, unknown>>,
): void {
  if (__UF_DEBUG_BUILD__) {
    console.debug(
      "[Unfluffify][page-world-authority] Lifecycle",
      JSON.stringify({ stage, ...detail }),
    );
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

let rewriteBackgroundStarted = false;

export function startRewriteBackground(): void {
  const api = getInstalledBrowserApi() as RewriteExtensionApi | null;
  if (rewriteBackgroundStarted || !api?.runtime?.onMessage) {
    return;
  }
  rewriteBackgroundStarted = true;
  const services = createRewriteBackgroundServices();
  const sessionArea = api.storage?.session;
  const emulationPostureStore: KeyValueStore = sessionArea ? {
    async get(key) {
      const stored = await sessionArea.get(key);
      return stored?.[key];
    },
    async set(key, value) {
      await sessionArea.set({ [key]: value });
    },
    async remove(key) {
      await sessionArea.remove(key);
    },
    async clear() {
      // The repository owns one namespaced key and never requests a broad
      // session clear; clearing unrelated tab/session authority is forbidden.
    },
  } : createMemoryStore();
  const offscreenDocuments = createOffscreenDocumentOwner(api as OffscreenDocumentApi);
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
  type ManagedPageWorldAuthority = PageWorldDocumentIdentity;
  const managedPageWorldAuthorityByTab = new Map<number, ManagedPageWorldAuthority>();
  const managedPageWorldGenerationByTab = new Map<number, number>();
  const tabTerminations = new Map<number, Promise<void>>();
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
  const mainDocumentAuthorityKey = (tabId: number): string =>
    `uf:main-document-authority:${tabId}`;
  const persistMainDocument = (
    tabId: number,
    documentId: string | null,
    pageUrl: string | null,
  ): void => {
    const normalizedUrl = normalizedPageUrl(pageUrl);
    const previous = mainDocumentWrites.get(tabId) ?? Promise.resolve();
    const write = previous.then(async () => {
      await Promise.resolve(api.storage?.session?.set({
        [mainDocumentKey(tabId)]: { documentId },
        [mainDocumentAuthorityKey(tabId)]: { documentId, pageUrl: normalizedUrl },
      }));
    }).catch(() => undefined);
    mainDocumentWrites.set(tabId, write);
    void write.finally(() => {
      if (mainDocumentWrites.get(tabId) === write) {
        mainDocumentWrites.delete(tabId);
      }
    });
  };
  const observeMainDocument = (
    tabId: number,
    documentId: string | null,
    pageUrl: string | null = mainNavigationByTab.get(tabId)?.pageUrl ?? null,
  ): void => {
    mainDocumentByTab.set(tabId, documentId);
    // Navigation events are synchronous, while storage.session is not. Keep
    // writes ordered so a rapid C -> D commit cannot leave C as the cold-worker
    // fallback merely because its first write completed last.
    persistMainDocument(tabId, documentId, pageUrl);
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
    const queriedFrame = await queryMainFrame(tabId);
    if (mainDocumentByTab.has(tabId)) {
      return { known: true, documentId: mainDocumentByTab.get(tabId) ?? null };
    }
    if (queriedFrame !== undefined) {
      observeMainDocument(tabId, queriedFrame.documentId, queriedFrame.pageUrl);
      return { known: true, documentId: queriedFrame.documentId };
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
  const loadDurableMainDocumentAuthority = async (
    tabId: number,
  ): Promise<MainFrameAuthority | null> => {
    await mainDocumentWrites.get(tabId);
    const navigation = mainNavigationByTab.get(tabId);
    if (
      mainDocumentByTab.has(tabId) &&
      navigation &&
      !navigation.pending &&
      navigation.pageUrl
    ) {
      return {
        documentId: mainDocumentByTab.get(tabId) ?? null,
        pageUrl: navigation.pageUrl,
      };
    }
    const key = mainDocumentAuthorityKey(tabId);
    try {
      const stored = await api.storage?.session?.get(key);
      // A commit observed while the read was pending is newer than storage.
      const latestNavigation = mainNavigationByTab.get(tabId);
      if (
        mainDocumentByTab.has(tabId) &&
        latestNavigation &&
        !latestNavigation.pending &&
        latestNavigation.pageUrl
      ) {
        return {
          documentId: mainDocumentByTab.get(tabId) ?? null,
          pageUrl: latestNavigation.pageUrl,
        };
      }
      const value = stored?.[key];
      if (!value || typeof value !== "object") return null;
      const documentId = (value as { documentId?: unknown }).documentId;
      const pageUrl = normalizedPageUrl(
        typeof (value as { pageUrl?: unknown }).pageUrl === "string"
          ? (value as { pageUrl: string }).pageUrl
          : null,
      );
      return typeof documentId === "string" && documentId && pageUrl
        ? { documentId, pageUrl }
        : null;
    } catch {
      return null;
    }
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
      observeMainDocument(tabId, documentId, frame.pageUrl);
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
    await Promise.resolve(api.storage?.session?.remove(mainDocumentAuthorityKey(tabId)))
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
  const adoptManagedPageWorldAuthority = (
    tabId: number,
    documentId: string,
    pageUrl: string,
  ): ManagedPageWorldAuthority | null => {
    const normalizedUrl = normalizedPageUrl(pageUrl);
    if (!normalizedUrl) return null;
    const prior = managedPageWorldAuthorityByTab.get(tabId);
    if (
      prior?.documentId === documentId &&
      prior.pageUrl === normalizedUrl
    ) {
      return prior;
    }
    const generation = (managedPageWorldGenerationByTab.get(tabId) ?? 0) + 1;
    managedPageWorldGenerationByTab.set(tabId, generation);
    const authority = { tabId, documentId, pageUrl: normalizedUrl, generation };
    managedPageWorldAuthorityByTab.set(tabId, authority);
    return authority;
  };
  type ManagedPageWorldAuthorityCheck = Readonly<{
    retained: true;
    authority: ManagedPageWorldAuthority;
  }> | Readonly<{
    retained: false;
    reason: string;
  }>;
  const candidateManagedPageWorldAuthority = (
    identity: PageWorldDocumentIdentity,
  ): ManagedPageWorldAuthorityCheck => {
    if (tabTerminations.has(identity.tabId)) {
      return { retained: false, reason: "tab-terminating" };
    }
    const authority = managedPageWorldAuthorityByTab.get(identity.tabId);
    if (!authority || !(
      authority.documentId === identity.documentId &&
      authority.pageUrl === identity.pageUrl &&
      authority.generation === identity.generation
    )) {
      return { retained: false, reason: "managed-authority-mismatch" };
    }
    const navigation = mainNavigationByTab.get(identity.tabId);
    if (
      navigation?.pending ||
      (navigation?.pageUrl !== null &&
        navigation?.pageUrl !== undefined &&
        navigation.pageUrl !== identity.pageUrl)
    ) {
      return { retained: false, reason: "navigation-mismatch" };
    }
    const mainDocument = mainDocumentByTab.get(identity.tabId);
    if (typeof mainDocument === "string" && mainDocument !== identity.documentId) {
      return { retained: false, reason: "main-document-mismatch" };
    }
    // A durable tombstone is proved during asynchronous admission. Every
    // terminal write first updates this process-local map synchronously, so a
    // hot command cannot cross unregister/cleanup while storage.session settles.
    if (consentSuppressionFallback.has(identity.tabId)) {
      return { retained: false, reason: "consent-suppression-disabled" };
    }
    return { retained: true, authority };
  };
  const retainedManagedPageWorldAuthority = (
    identity: PageWorldDocumentIdentity,
  ): ManagedPageWorldAuthorityCheck => {
    const candidate = candidateManagedPageWorldAuthority(identity);
    if (!candidate.retained) {
      return candidate;
    }
    const navigation = mainNavigationByTab.get(identity.tabId);
    if (
      !navigation ||
      navigation.pending ||
      navigation.pageUrl !== identity.pageUrl ||
      mainDocumentByTab.get(identity.tabId) !== identity.documentId
    ) {
      return { retained: false, reason: "navigation-mismatch" };
    }
    return candidate;
  };
  let pageWorldAuthorizationSequence = 0;
  const pageWorld = createPageWorldCapabilityRuntime({
    executeScript: api.scripting?.executeScript,
    storage: api.storage?.session as unknown as Parameters<
      typeof createPageWorldCapabilityRuntime
    >[0]["storage"],
    async authorize(identity) {
      pageWorldAuthorizationSequence += 1;
      const sequence = pageWorldAuthorizationSequence;
      const startedAt = Date.now();
      const finish = (
        authorized: boolean,
        reason: string,
        detail: Readonly<Record<string, unknown>> = {},
      ): boolean => {
        reportPageWorldAuthorizationStage("settled", {
          tabId: identity.tabId,
          sequence,
          authorized,
          reason,
          durationMs: Date.now() - startedAt,
          ...detail,
        });
        return authorized;
      };
      reportPageWorldAuthorizationStage("started", {
        tabId: identity.tabId,
        sequence,
        generation: identity.generation,
      });
      const candidateBeforeFrame = candidateManagedPageWorldAuthority(identity);
      if (!candidateBeforeFrame.retained) {
        return finish(false, candidateBeforeFrame.reason);
      }
      const authority = candidateBeforeFrame.authority;
      const frameStartedAt = Date.now();
      const frame = await queryMainFrame(identity.tabId);
      const frameDurationMs = Date.now() - frameStartedAt;
      if (
        frame?.documentId !== identity.documentId ||
        frame.pageUrl !== identity.pageUrl
      ) {
        return finish(false, "main-frame-mismatch", { frameDurationMs });
      }
      const candidateAfterFrame = candidateManagedPageWorldAuthority(identity);
      if (!candidateAfterFrame.retained || candidateAfterFrame.authority !== authority) {
        return finish(
          false,
          candidateAfterFrame.retained ? "managed-authority-changed" : candidateAfterFrame.reason,
          { frameDurationMs },
        );
      }
      // A cold MV3 worker can physically prove the exact frame before it has an
      // in-memory webNavigation observation. Hydrate only missing facts from
      // that proof; any concurrently observed navigation remains authoritative.
      const navigationAfterFrame = mainNavigationByTab.get(identity.tabId);
      if (!navigationAfterFrame) {
        mainNavigationByTab.set(identity.tabId, {
          epoch: 0,
          pending: false,
          pageUrl: frame.pageUrl,
        });
      } else if (!navigationAfterFrame.pending && navigationAfterFrame.pageUrl === null) {
        mainNavigationByTab.set(identity.tabId, {
          ...navigationAfterFrame,
          pageUrl: frame.pageUrl,
        });
      }
      if (mainDocumentByTab.get(identity.tabId) === null || !mainDocumentByTab.has(identity.tabId)) {
        observeMainDocument(identity.tabId, frame.documentId, frame.pageUrl);
      }
      const consentStartedAt = Date.now();
      const suppressionDisabled = await consentSuppressionDisabled(identity.tabId);
      const consentDurationMs = Date.now() - consentStartedAt;
      if (suppressionDisabled) {
        return finish(false, "consent-suppression-disabled", {
          frameDurationMs,
          consentDurationMs,
        });
      }
      const retainedAfterFrame = retainedManagedPageWorldAuthority(identity);
      return finish(
        retainedAfterFrame.retained && retainedAfterFrame.authority === authority,
        retainedAfterFrame.retained && retainedAfterFrame.authority === authority
          ? "authorized"
          : retainedAfterFrame.retained
            ? "managed-authority-changed"
            : retainedAfterFrame.reason,
        { frameDurationMs, consentDurationMs },
      );
    },
    retain(identity) {
      const startedAt = Date.now();
      const retained = retainedManagedPageWorldAuthority(identity);
      reportPageWorldAuthorizationStage("retained", {
        tabId: identity.tabId,
        generation: identity.generation,
        retained: retained.retained,
        reason: retained.retained ? "retained" : retained.reason,
        durationMs: Date.now() - startedAt,
      });
      return retained.retained;
    },
  });
  const retireManagedPageWorldAuthority = (tabId: number): void => {
    managedPageWorldAuthorityByTab.delete(tabId);
    void pageWorld.retireTab(tabId).catch(() => undefined);
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
  const emitSignalsAvailableToContent = async (tabId: number): Promise<void> => {
    if (!api.tabs?.sendMessage || tabId <= 0) {
      return;
    }
    const contentBus = createRealmBus({
      realm: "background",
      transport: createTabTransport(api.tabs, tabId),
    });
    try {
      await contentBus.emit("signals.available", { tabId }, { target: "content" });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      if (!/receiving end does not exist|no receiver|message port closed|could not establish connection/i.test(detail)) {
        console.warn("[Unfluffify][rewrite] Unable to notify content about signals", error);
      }
    } finally {
      contentBus.dispose();
    }
  };
  const emitPageUrlChangedToContent = async (
    tabId: number,
    documentId: string,
    pageUrl: string,
  ): Promise<void> => {
    if (!api.tabs?.sendMessage || tabId <= 0) return;
    const contentBus = createRealmBus({
      realm: "background",
      transport: createTabTransport(api.tabs, tabId),
    });
    try {
      await contentBus.emit("page.urlChanged", { tabId, documentId, pageUrl }, { target: "content" });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      if (!/receiving end does not exist|no receiver|message port closed|could not establish connection/i.test(detail)) {
        console.warn("[Unfluffify][rewrite] Unable to notify content about navigation", error);
      }
    } finally {
      contentBus.dispose();
    }
  };
  const presentEmulationTransition = async (
    tabId: number,
    request: EmulationTransitionRequest,
  ): Promise<EmulationTransitionDelivery> => {
    if (!api.tabs?.sendMessage || tabId <= 0) {
      return { status: "no_receiver", reason: "content-messaging-unavailable" };
    }
    const retryDelays = [0, 40, 80] as const;
    for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
      const delay = retryDelays[attempt]!;
      if (delay > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
      const contentBus = createRealmBus({
        realm: "background",
        transport: createTabTransport(api.tabs, tabId),
      });
      try {
        const response = await contentBus.request("command.dispatch", {
          kind: "uf-command/1",
          name: "emulationTransition",
          tabId,
          payload: request,
        }, { target: "content" });
        if (!response.ok) {
          if (contentReceiverUnavailable(response.failure)) {
            if (attempt + 1 < retryDelays.length) continue;
            return { status: "no_receiver", reason: browserDeliveryDetail(response.failure) };
          }
          const reason = browserDeliveryDetail(response.failure);
          console.warn("[Unfluffify][rewrite] Emulation transition delivery failed", reason);
          return { status: "failed", reason };
        }
        if (!response.data.ok) {
          const reason = browserDeliveryDetail(response.data.failure);
          console.warn("[Unfluffify][rewrite] Emulation transition command failed", reason);
          return { status: "failed", reason };
        }
        const result = emulationTransitionResult(response.data.data);
        if (!result) {
          const reason = "invalid-emulation-transition-acknowledgement";
          console.warn("[Unfluffify][rewrite] Emulation transition acknowledgement was invalid");
          return { status: "failed", reason };
        }
        return { status: "ready", result };
      } catch (error) {
        if (contentReceiverUnavailable(error)) {
          if (attempt + 1 < retryDelays.length) continue;
          return { status: "no_receiver", reason: browserDeliveryDetail(error) };
        }
        const reason = browserDeliveryDetail(error);
        console.warn("[Unfluffify][rewrite] Unable to present emulation transition", error);
        return { status: "failed", reason };
      } finally {
        contentBus.dispose();
      }
    }
    return { status: "no_receiver", reason: "content-receiver-unavailable" };
  };
  const guardPhysicalEmulationViewport = async (
    tabId: number,
    mode: "mobile" | "desktop",
  ): Promise<number | null> => {
    if (!api.tabs?.sendMessage || tabId <= 0) return null;
    const contentBus = createRealmBus({
      realm: "background",
      transport: createTabTransport(api.tabs, tabId),
    });
    try {
      const response = await contentBus.request("command.dispatch", {
        kind: "uf-command/1",
        name: "emulationViewportGuard",
        tabId,
        payload: { mode },
      }, {
        target: "content",
        timeoutMs: PHYSICAL_VIEWPORT_GUARD_ADMISSION_TIMEOUT_MS,
      });
      if (!response.ok || !response.data.ok) return null;
      const result = emulationTransitionResult(response.data.data);
      if (
        !result?.ok ||
        result.mode !== mode ||
        (result.stage !== "guarding" && result.stage !== "paint-proven") ||
        !result.guarded ||
        !result.coverage ||
        !Number.isSafeInteger(result.generation) ||
        result.generation <= 0
      ) {
        return null;
      }
      return result.generation;
    } catch {
      return null;
    } finally {
      contentBus.dispose();
    }
  };
  let renderInspectionDetachHandler: ((tabId: number) => void) | null = null;
  const renderEmulation = createRenderEmulationRuntime({
    debuggerApi: api.debugger,
    tabs: api.tabs,
    windows: api.windows,
    postureRepo: createEmulationPostureRepo(emulationPostureStore),
    presentTransition: presentEmulationTransition,
    guardPhysicalViewport: guardPhysicalEmulationViewport,
    onDebuggerDetached(tabId) {
      renderInspectionDetachHandler?.(tabId);
    },
  });
  api.sidePanel?.onOpened?.addListener((info) => {
    if (typeof info.tabId === "number") {
      void renderEmulation.refit(info.tabId, { source: "side-panel" });
    }
  });
  api.sidePanel?.onClosed?.addListener((info) => {
    if (typeof info.tabId === "number") {
      void renderEmulation.refit(info.tabId, { source: "side-panel" });
    }
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
  const factPersistenceTails = new Map<number, Promise<void>>();
  const enqueueFactPersistence = (tabId: number, facts: TabFacts): Promise<void> => {
    const previous = factPersistenceTails.get(tabId) ?? Promise.resolve();
    const queued = previous.then(
      () => services.persistence.persistDurableFacts(facts),
      () => services.persistence.persistDurableFacts(facts),
    );
    const tail = queued.then(() => undefined, () => undefined);
    factPersistenceTails.set(tabId, tail);
    void tail.finally(() => {
      if (factPersistenceTails.get(tabId) === tail) {
        factPersistenceTails.delete(tabId);
      }
    });
    return queued;
  };
  const drainFactPersistence = async (tabId: number): Promise<void> => {
    while (factPersistenceTails.has(tabId)) {
      await factPersistenceTails.get(tabId);
    }
  };
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
    await services.lynx.retireAiRunForTab(tabId);
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
    const termination = withTabLifecycleOperation(tabId, async () => {
      await drainFactPersistence(tabId);
      await cleanup();
    });
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
          await enqueueFactPersistence(facts.tabId, snapshot);
        }
        return !tabTerminations.has(facts.tabId);
      });
    },
  });
  const lockBrowserLifecycle = createLockBrowserLifecycle({
    api: api as unknown as LockBrowserApi,
    async isDurableSameDocumentNavigation(tabId, commit) {
      const pageUrl = normalizedPageUrl(commit.pageUrl);
      if (!commit.documentId || !pageUrl) {
        return false;
      }
      // The lifecycle's process-local document map is empty after an MV3
      // restart. Every retained authority shares this durable main-frame
      // identity, so a first hash notification remains a true no-op even when
      // there is no active render-inspection record to classify it.
      const authority = await loadDurableMainDocumentAuthority(tabId);
      if (authority) {
        return authority.documentId === commit.documentId && authority.pageUrl === pageUrl;
      }
      return renderInspection.preservesNavigationCommit({ tabId, ...commit });
    },
    onMainDocumentNavigationStarted(tabId, pageUrl) {
      retireManagedPageWorldAuthority(tabId);
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
        observeMainDocument(tabId, frame.documentId, frame.pageUrl);
        void emitPageUrlChangedToContent(tabId, frame.documentId, frame.pageUrl);
      });
    },
    onMainDocumentCommitted(tabId, documentId, pageUrl) {
      retireManagedPageWorldAuthority(tabId);
      const state = advanceMainNavigation(tabId, false, pageUrl);
      observeMainDocument(tabId, documentId, state.pageUrl);
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
      const priorAuthority = managedPageWorldAuthorityByTab.get(tabId);
      const state = advanceMainNavigation(tabId, false, pageUrl);
      if (documentId) {
        observeMainDocument(tabId, documentId, state.pageUrl);
      }
      if (
        priorAuthority &&
        (priorAuthority.documentId !== documentId || priorAuthority.pageUrl !== state.pageUrl)
      ) {
        retireManagedPageWorldAuthority(tabId);
      }
      const commit = { tabId, documentId, pageUrl: state.pageUrl };
      renderInspection.observeNavigationCommit(commit);
      void settleRenderInspection("same-document navigation cleanup", () =>
        renderInspection.navigationCommitted(commit));
      if (documentId && state.pageUrl) {
        void emitPageUrlChangedToContent(tabId, documentId, state.pageUrl);
      }
    },
    onPresenceChanged(tabId, presence) {
      lockRuntime.presenceChanged(tabId, presence);
    },
    onTabTerminated(tabId, reason) {
      retireManagedPageWorldAuthority(tabId);
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
  const observeReportedFact = async (
    tabId: number,
    envelope: FactEnvelope,
    awaitNotifications: boolean,
  ): Promise<Readonly<{
    persistence: Promise<void> | null;
  }>> => {
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
    const persistence = snapshot
      ? enqueueFactPersistence(tabId, snapshot)
      : null;
    if (snapshot) {
      // This fact belongs to the tab, not the popup. Publishing it here keeps
      // heartbeats accurate while every UI surface is closed.
      lockRuntime.unsavedChanged(tabId, snapshot.hasUnsavedWork);
    }
    const reportedFacts = envelope.sensation.facts;
    if (
      reportedFacts.markingEnabled === false ||
      reportedFacts.savedSeq !== undefined ||
      reportedFacts.discardedSeq !== undefined
    ) {
      // Run metadata belongs to the active marking session. Increment the
      // continuation generation before clearing it so an in-flight stateless
      // AI poll cannot recreate a retired local record after Disable,
      // Discard, navigation, or Save ends that session.
      await services.lynx.retireAiRunForTab(tabId);
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
    const notifications = Promise.allSettled([
      bus.emit("signals.available", { tabId }, { target: "popup" }),
      emitSignalsAvailableToContent(tabId),
    ]).then(() => undefined);
    if (awaitNotifications) {
      await notifications;
    } else {
      void notifications;
    }
    return { persistence };
  };
  bus.onCommand("fact.reportAndPull", async (request, meta) => {
    const envelope = request.envelope;
    const tabId = envelope.sensation.tabId === 0
      ? parseSenderTabId(meta.sourceInstance) ?? 0
      : envelope.sensation.tabId;
    if (
      meta.source !== "popup" ||
      envelope.sensation.source !== "popup" ||
      tabId <= 0 ||
      tabTerminations.has(tabId)
    ) {
      return { accepted: false as const, signals: [] };
    }
    const result = await withTabLifecycleOperation(tabId, async () => {
      if (tabTerminations.has(tabId) || await consentSuppressionDisabled(tabId)) {
        return null;
      }
      const observed = await observeReportedFact(tabId, envelope, false);
      const brain = await runtime.getBrain(tabId);
      return {
        ...observed,
        signals: [...brain.pullSignals(request.afterSeq)],
      };
    });
    if (!result) {
      return { accepted: false as const, signals: [] };
    }
    // The durable write is already in the per-tab persistence queue. Operator
    // acknowledgement follows the brain's decision now; storage latency is not
    // allowed to hold the visible activation transaction open.
    void result.persistence?.catch((error) => {
      console.error("[Unfluffify][rewrite] Unable to persist priority popup fact", error);
    });
    return {
      accepted: true as const,
      signals: result.signals,
    };
  });
  bus.on("fact.reported", async (envelope, meta) => {
    const tabId = envelope.sensation.tabId === 0
      ? parseSenderTabId(meta.sourceInstance) ?? 0
      : envelope.sensation.tabId;
    // A replacement document can legitimately report content-started while
    // navigation cleanup is still retiring the prior document. Queue that
    // content occurrence behind cleanup, then let the authoritative document
    // and Unregister tombstone fences decide it. Popup facts have no document
    // identity and must remain terminally rejected at this boundary.
    if (tabTerminations.has(tabId) && meta.source !== "content") {
      return;
    }
    const report = (): Promise<Readonly<{
      persistence: Promise<void> | null;
    }>> => observeReportedFact(tabId, envelope, true);
    if (meta.source === "content") {
      const documentId = parseSenderDocumentId(meta.sourceInstance);
      const authorizedSender = tabId > 0 &&
        parseSenderTabId(meta.sourceInstance) === tabId &&
        parseSenderFrameId(meta.sourceInstance) === 0 &&
        documentId !== null;
      if (!authorizedSender) {
        return;
      }
      const result = await withTabLifecycleOperation(tabId, async () => {
        if (tabTerminations.has(tabId)) {
          return null;
        }
        if (
          !await isCurrentMainDocument(tabId, documentId) ||
          await consentSuppressionDisabled(tabId) ||
          !await isCurrentMainDocument(tabId, documentId)
        ) {
          return null;
        }
        return report();
      });
      await result?.persistence;
      return;
    }
    const result = await withTabLifecycleOperation(tabId, async () => {
      if (tabTerminations.has(tabId) || await consentSuppressionDisabled(tabId)) {
        return null;
      }
      return report();
    });
    await result?.persistence;
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
          width: request.mode === "mobile" ? 412 : 1920,
          height: request.mode === "mobile" ? 960 : 1080,
          scale: request.scale,
          active: false,
          identityStale: false,
          failureReason: "consent_suppression_disabled" as const,
        };
      }
      const current = await renderEmulation.current(
        request.tabId,
        request.mode,
        request.scale,
        request.physicalViewportHint,
      );
      if (current) {
        return current;
      }
      return renderEmulation.apply(
        request.tabId,
        request.mode,
        request.scale,
        request.allowReload === true,
        request.physicalViewportHint,
      );
    }));
  bus.onCommand("emulation.current", async (request) => {
    if (await consentSuppressionDisabled(request.tabId)) return null;
    return await renderEmulation.current(
      request.tabId,
      request.mode,
      request.scale,
      request.physicalViewportHint,
    );
  });
  bus.onCommand("emulation.clear", async (request) => {
    await renderEmulation.clear(request.tabId);
    return { status: "ok" as const };
  });
  bus.onCommand("emulation.refit", async (request, meta) => {
    const contentOwnedRequest = request.tabId === 0;
    const tabId = contentOwnedRequest
      ? parseSenderTabId(meta.sourceInstance) ?? 0
      : request.tabId;
    if (contentOwnedRequest) {
      const documentId = parseSenderDocumentId(meta.sourceInstance);
      const currentSender = meta.source === "content" &&
        parseSenderFrameId(meta.sourceInstance) === 0 &&
        tabId > 0 &&
        documentId !== null &&
        await isCurrentMainDocument(tabId, documentId);
      if (!currentSender) {
        return { status: "ok" as const };
      }
    }
    if (tabId > 0) {
      // A popup-originated generation was still created and measured by the
      // content guardian; the side panel only transports its acknowledgement
      // around Chromium's occasionally delayed worker bounds event.
      const retainedPresentationGeneration = request.presentationGeneration !== undefined &&
          (contentOwnedRequest || meta.source === "popup")
        ? request.presentationGeneration
        : undefined;
      await renderEmulation.refit(tabId, {
        source: retainedPresentationGeneration !== undefined || contentOwnedRequest
          ? "content"
          : "popup",
        ...(retainedPresentationGeneration !== undefined
          ? { presentationGeneration: retainedPresentationGeneration }
          : {}),
        ...(request.physicalViewportHint
          ? { physicalViewportHint: request.physicalViewportHint }
          : {}),
      });
    }
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
  type PropertyAuthorityLoad = Readonly<{
    result: Awaited<ReturnType<typeof services.lynx.loadConfigSnapshot>>;
    applied: Awaited<ReturnType<typeof services.property.applyBackendLoad>>;
  }>;
  type PropertyAuthorityLoadEntry = Readonly<{
    generation: number;
    operation: Promise<PropertyAuthorityLoad | null>;
  }>;
  const propertyAuthorityLoadGeneration = new Map<string, number>();
  const propertyAuthorityLoads = new Map<string, PropertyAuthorityLoadEntry>();
  const propertyAuthorityGeneration = (propertyKey: string): number =>
    propertyAuthorityLoadGeneration.get(propertyKey) ?? 0;
  const invalidatePropertyAuthority = (propertyKey: string): void => {
    definitiveConfigAuthority.delete(propertyKey);
    propertyAuthorityLoadGeneration.set(
      propertyKey,
      propertyAuthorityGeneration(propertyKey) + 1,
    );
  };
  const loadPropertyAuthority = async (
    environmentKey: string,
    siteId: number,
  ): Promise<PropertyAuthorityLoad> => {
    const propertyKey = `${environmentKey}\u0000${siteId}`;
    // Explicit invalidation can retire an in-flight request. Its callers join
    // the replacement generation instead of adopting or projecting the stale
    // answer, while ordinary page.context/config.load overlap shares one whole
    // remote-load-and-adoption operation.
    while (true) {
      const generation = propertyAuthorityGeneration(propertyKey);
      let entry = propertyAuthorityLoads.get(propertyKey);
      if (!entry || entry.generation !== generation) {
        const operation = (async (): Promise<PropertyAuthorityLoad | null> => {
          const result = await services.lynx.loadConfigSnapshot(environmentKey, siteId);
          if (propertyAuthorityGeneration(propertyKey) !== generation) {
            return null;
          }
          const applied = await services.property.applyBackendLoad(
            environmentKey,
            siteId,
            result.status === "ok"
              ? { status: result.status, config: result.data }
              : { status: result.status },
          );
          if (propertyAuthorityGeneration(propertyKey) !== generation) {
            return null;
          }
          if (result.status === "not_found") {
            definitiveConfigAuthority.set(propertyKey, "not_found");
            await shieldPosture.removeProperty(environmentKey, siteId);
          } else if (result.status === "ok") {
            definitiveConfigAuthority.set(propertyKey, "ok");
          }
          if (propertyAuthorityGeneration(propertyKey) !== generation) {
            return null;
          }
          return { result, applied };
        })();
        const created: PropertyAuthorityLoadEntry = { generation, operation };
        entry = created;
        propertyAuthorityLoads.set(propertyKey, created);
        const clear = (): void => {
          if (propertyAuthorityLoads.get(propertyKey) === created) {
            propertyAuthorityLoads.delete(propertyKey);
          }
        };
        void operation.then(clear, clear);
      }
      const outcome = await entry.operation;
      if (
        outcome !== null &&
        propertyAuthorityGeneration(propertyKey) === entry.generation
      ) {
        return outcome;
      }
    }
  };
  const pageWorldIdentityForContent = (
    pageUrl: string,
    meta: Readonly<{ source: string; sourceInstance?: string }>,
  ): PageWorldDocumentIdentity | null => {
    if (meta.source !== "content") return null;
    const tabId = parseSenderTabId(meta.sourceInstance);
    const frameId = parseSenderFrameId(meta.sourceInstance);
    const documentId = parseSenderDocumentId(meta.sourceInstance);
    const normalizedUrl = normalizedPageUrl(pageUrl);
    if (!tabId || frameId !== 0 || !documentId || !normalizedUrl) return null;
    const authority = managedPageWorldAuthorityByTab.get(tabId);
    return authority &&
      authority.documentId === documentId &&
      authority.pageUrl === normalizedUrl
      ? authority
      : null;
  };
  bus.onCommand("pageWorld.acquire", async (request, meta) => {
    const identity = pageWorldIdentityForContent(request.pageUrl, meta);
    return identity
      ? await pageWorld.acquire(identity)
      : { status: "stale" as const, reason: "document-authority-unavailable" };
  });
  bus.onCommand("pageWorld.command", async (request, meta) => {
    const identity = pageWorldIdentityForContent(request.pageUrl, meta);
    if (!identity) {
      return { status: "stale" as const, reason: "document-authority-unavailable" };
    }
    return await pageWorld.command(identity, {
      nonce: request.nonce,
      sessionNonce: request.sessionNonce,
      command: request.command,
      payload: request.payload,
    });
  });
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
      if (mainContentSender) {
        managedPageWorldAuthorityByTab.delete(tabId);
        void pageWorld.retireTab(tabId);
      }
      return {
        ...context,
        consentSuppressionAllowed: false,
        renderModeSet: false,
        todo: projectTodoCoverage(context.pageTypes, context.pageKey, new Set()),
        shieldPosture: { status: "inactive" as const, revision: 0 },
      };
    }
    if (mainContentSender && incomingDocumentId) {
      const managed = Boolean(context.environmentKey) && context.siteId !== null;
      if (managed) {
        const authority = adoptManagedPageWorldAuthority(tabId, incomingDocumentId, request.pageUrl);
        if (authority) {
          await pageWorld.acquire(authority).catch(() => ({
            status: "unavailable" as const,
            reason: "page-world-install-failed",
          }));
        }
      } else {
        managedPageWorldAuthorityByTab.delete(tabId);
        await pageWorld.retireTab(tabId).catch(() => undefined);
      }
    }
    // Content asks for page context at load time, before a popup necessarily
    // exists. That is the earliest authoritative point at which the background
    // knows this is a managed property tab, so establish the standing mobile
    // posture here. An explicit desktop preview is a held override and remains
    // untouched until the popup turns it off or marking begins.
    await renderEmulation.hydrate(tabId);
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
      invalidatePropertyAuthority(propertyKey);
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
        const { result: loaded, applied: authority } = await loadPropertyAuthority(
          context.environmentKey,
          context.siteId,
        );
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
        observeMainDocument(request.tabId, queriedFrame.documentId, queriedFrame.pageUrl);
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
      // The debugger realm can prove a JavaScript-off curtain while the page's
      // animation-frame queue is starved, but it must not terminalize the
      // session itself. Returning `ready` wakes the exact content controller;
      // that controller rechecks its local curtain identity/coverage, records
      // the fallback paint stage, and sends the ordinary document-fenced paint
      // acknowledgement. Keeping one acknowledgement owner also guarantees the
      // local curtain and shield are reconciled on the terminal response.
      return { status: "ready" as const };
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
  bus.onCommand("renderInspection.ackReload", async (request, meta) => {
    const sender = renderInspectionDocument(request, meta);
    if (!sender) {
      return Promise.resolve({ status: "stale" as const, reason: "main-content-document-required" });
    }
    return withRenderInspectionDocument(sender, request.pageUrl, () =>
      renderInspection.acknowledgeReload({
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
    await offscreenDocuments.ensure();
    const response = await bus.request("offscreen.refineXpaths", request, { target: "offscreen" });
    return response.ok ? response.data : { rows: request.rows };
  });
  bus.onCommand("ai.run", async (request) => {
    const releaseKeepAlive = runtime.keepAlive.acquireUntilRelease("ai.run");
    try {
      const environmentKey = await services.lynx.currentEnvironmentKey();
      if (!environmentKey) {
        return {
          status: "environment_unconfigured",
          failureStage: "start" as const,
          reason: "environment_unconfigured",
        };
      }
      if (!request.snapshot.pages.some((page) => canonicalPageKey(page.url) === request.pageKey)) {
        return {
          status: "invalid_page_scope",
          failureStage: "start" as const,
          reason: "invalid_page_scope",
        };
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
        : {
          status: result.status,
          sessionId: "sessionId" in result ? result.sessionId : undefined,
          httpStatus: "httpStatus" in result ? result.httpStatus : undefined,
          failureStage: result.failureStage,
          reason: result.reason,
        };
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
        const local = await services.repos.localPropertyRepo.load(environmentKey, request.siteId);
        const draft = local.ok ? local.value?.pendingRenderModeDraft : undefined;
        const pendingRenderMode = draft &&
          draft.basePropertyRevision === stored.value.propertyRevision &&
          draft.baseRenderModeUpdatedAt === stored.value.renderModeUpdatedAt
          ? draft.renderMode
          : undefined;
        if (draft && !pendingRenderMode && local.ok && local.value) {
          await services.repos.localPropertyRepo.save({
            environmentKey,
            siteId: request.siteId,
            backendConfigPresent: true,
            ...(local.value.renderMode ? { renderMode: local.value.renderMode } : {}),
            ...(local.value.integrityWarning ? { integrityWarning: local.value.integrityWarning } : {}),
            updatedAt: new Date().toISOString(),
          });
        }
        return {
          status: "ok" as const,
          config: stored.value,
          renderMode: stored.value.renderMode,
          ...(pendingRenderMode ? { pendingRenderMode } : {}),
          renderModeSource: "backend" as const,
        };
      }
      definitiveConfigAuthority.delete(propertyKey);
    }
    const cachedNotFound = definitiveConfigAuthority.get(propertyKey) === "not_found";
    const loaded = cachedNotFound
      ? null
      : await loadPropertyAuthority(environmentKey, request.siteId);
    const result = loaded?.result ?? { status: "not_found" as const, httpStatus: 404 };
    // The shared property-keyed loader owns remote adoption. Reading a settled
    // 404 projects its one documented local exception without rewriting the
    // same authoritative answer on every popup request.
    try {
      if (result.status === "ok") {
        const applied = loaded?.applied;
        if (!applied || applied.source !== "backend") {
          throw new PropertySnapshotIntegrityError("Validated backend load did not establish backend authority.");
        }
        const snapshot = applied.snapshot;
        if (!snapshot) {
          throw new PropertySnapshotIntegrityError("Validated backend load did not produce a snapshot.");
        }
        // page.context establishes document authority through bindDocument.
        // A popup-only load has no document to bind, so retain the former
        // config.load side effect here and keep it out of the shared adoption
        // operation; otherwise a same-document refresh increments the shield
        // fence once for authorize and once again for the exact bind.
        await shieldPosture.authorizeProperty(environmentKey, request.siteId);
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
      const applied = loaded?.applied ?? await (async () => {
        const existing = await services.repos.localPropertyRepo.load(environmentKey, request.siteId);
        return {
          renderMode: existing.ok ? existing.value?.renderMode : undefined,
          source: "local" as const,
        };
      })();
      const nonAuthoritativePendingRenderMode = "pendingRenderMode" in applied && (
        applied.pendingRenderMode === "rendered" || applied.pendingRenderMode === "static"
      ) ? applied.pendingRenderMode : undefined;
      return {
        status: result.status,
        httpStatus: result.httpStatus,
        ...(applied.renderMode ? { renderMode: applied.renderMode } : {}),
        ...(nonAuthoritativePendingRenderMode
          ? { pendingRenderMode: nonAuthoritativePendingRenderMode }
          : {}),
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
      // Save proves only that the remote mutation committed. Retire every
      // cached authority generation so the caller's mandatory post-commit
      // config.load performs a distinct remote Load and complete replacement.
      // Never adopt the Save response into the durable local baseline.
      await shieldPosture.clearProperty(request.environmentKey, request.siteId);
      invalidatePropertyAuthority(`${request.environmentKey}\u0000${request.siteId}`);
      return { status: "ok" as const };
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
        const adoption = await services.property.applyBackendLoad(
          request.environmentKey,
          request.siteId,
          { status: "ok", config: result.data },
        );
        if (adoption.source !== "backend") {
          throw new Error("Successful publication load did not produce backend authority");
        }
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
    const storedResult = await services.repos.settingsStore.load();
    if (!storedResult.ok) {
      return {
        status: "invalid" as const,
        settings: {},
        hasToken: false,
        reason: storedResult.error.code === "INVALID_STORED_VALUE"
          ? "The saved connection does not meet the current security requirements."
          : "The saved connection could not be read.",
      };
    }
    const stored = storedResult.value ?? {};
    return {
      status: "ok" as const,
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
      retireManagedPageWorldAuthority(tabId);
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
