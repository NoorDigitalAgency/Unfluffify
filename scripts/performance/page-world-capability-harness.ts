import {
  createPageWorldCapabilityRuntime,
  type PageWorldDocumentIdentity,
} from "../../src/background/page-world-capability-runtime";
import type {
  PageWorldCapabilityInvocation,
  PageWorldCommandResult,
  PageWorldRequest,
} from "../../src/page-world/program";

type HarnessOptions = Readonly<{
  tabId: number;
  documentId: string;
  generation?: number;
  currentPageUrl(): string;
  onCommand?(command: string): void;
  failurePrefix?: string;
}>;

type HarnessState = {
  endpointKey: string;
  capability: string;
  armed: boolean;
  paused: boolean;
  lazySuppressed: boolean;
  navigationGuardActive: boolean;
  sessionNonce: string;
  phase: "idle" | "armed" | "frozen";
  initialDiscoveryComplete: boolean;
};

function result(
  ok: boolean,
  nonce: string,
  command: string,
  payload: Record<string, unknown> | null,
  failure?: Readonly<{ code: string; message: string }>,
): PageWorldCommandResult {
  return { ok, nonce, command, payload, ...(failure ? { failure } : {}) };
}

function normalizedCommand(command = ""): string {
  return command.startsWith("PAGE_WORLD_")
    ? command.slice("PAGE_WORLD_".length)
    : command;
}

export function createGatePageWorldCapabilityHarness(options: HarnessOptions) {
  const generation = options.generation ?? 1;
  const failurePrefix = options.failurePrefix ?? "Gate";
  const state: HarnessState = {
    endpointKey: "",
    capability: "",
    armed: false,
    paused: false,
    lazySuppressed: false,
    navigationGuardActive: false,
    sessionNonce: "",
    phase: "idle",
    initialDiscoveryComplete: false,
  };

  const reset = (): void => {
    Object.assign(state, {
      armed: false,
      paused: false,
      lazySuppressed: false,
      navigationGuardActive: false,
      sessionNonce: "",
      phase: "idle",
      initialDiscoveryComplete: false,
    });
  };
  const snapshot = (): Record<string, unknown> => ({
    armed: state.armed,
    paused: state.paused,
    lazySuppressed: state.lazySuppressed,
    navigationGuardActive: state.navigationGuardActive,
    sessionNonce: state.sessionNonce,
    phase: state.phase,
    initialDiscoveryComplete: state.initialDiscoveryComplete,
    motionErrorCount: 0,
  });

  const invoke = (
    endpointKey: string,
    capability: string,
    invocation: PageWorldCapabilityInvocation,
  ): PageWorldCommandResult => {
    if (endpointKey !== state.endpointKey || capability !== state.capability) {
      return result(false, "", "", null, {
        code: "PAGE_CAPABILITY_REJECTED",
        message: `${failurePrefix} page-world capability was rejected`,
      });
    }
    if (invocation.kind === "probe") {
      return result(true, "", "PROBE", { ready: true, version: 4 });
    }
    if (invocation.kind === "retire") {
      reset();
      return result(true, "", "RETIRE", { ready: false, retired: true, version: 4 });
    }

    const request = invocation.request;
    const nonce = request?.nonce ?? "";
    const originalCommand = request?.command ?? "";
    const command = normalizedCommand(originalCommand);
    options.onCommand?.(originalCommand || "unknown");
    if (!request || !nonce) {
      return result(false, nonce, originalCommand, null, {
        code: "PAGE_NONCE_REQUIRED",
        message: `${failurePrefix} page-world command requires a nonce`,
      });
    }
    if (command === "RECONCILE") {
      reset();
      return result(true, nonce, originalCommand, snapshot());
    }
    if (command === "ARM") {
      if (state.armed && nonce === state.sessionNonce) {
        return result(true, nonce, originalCommand, snapshot());
      }
      if (state.armed && nonce !== state.sessionNonce && (state.paused || state.lazySuppressed)) {
        return result(false, nonce, originalCommand, null, {
          code: "PAGE_NONCE_MISMATCH",
          message: `${failurePrefix} page-world command nonce did not match the active session`,
        });
      }
      Object.assign(state, {
        armed: true,
        paused: false,
        lazySuppressed: false,
        navigationGuardActive: false,
        sessionNonce: nonce,
        phase: "armed",
        initialDiscoveryComplete: false,
      });
      return result(true, nonce, originalCommand, snapshot());
    }
    if (command === "DESTROY" && !state.armed) {
      reset();
      return result(true, nonce, originalCommand, snapshot());
    }
    if (!state.armed || request.sessionNonce !== state.sessionNonce) {
      return result(false, nonce, originalCommand, null, {
        code: "PAGE_NONCE_MISMATCH",
        message: `${failurePrefix} page-world command session nonce did not match`,
      });
    }
    if (command === "SET_LAZY_LOADING_SUPPRESSED") {
      state.lazySuppressed = request.payload?.suppressed === true;
    } else if (command === "SET_NAVIGATION_GUARD") {
      state.navigationGuardActive = request.payload?.active === true;
    } else if (command === "SET_MOTION_PAUSED") {
      state.paused = request.payload?.paused === true;
      state.phase = state.paused ? "frozen" : "armed";
      if (state.paused) state.initialDiscoveryComplete = true;
    } else if (command === "DESTROY") {
      reset();
    }
    return result(true, nonce, originalCommand, snapshot());
  };

  const identity = (pageUrl: string): PageWorldDocumentIdentity => ({
    tabId: options.tabId,
    documentId: options.documentId,
    pageUrl,
    generation,
  });
  const runtime = createPageWorldCapabilityRuntime({
    async executeScript<T>({ func, args }) {
      void func;
      const endpointKey = String(args[0] ?? "");
      const capability = String(args[1] ?? "");
      const invocation = args[2] as PageWorldCapabilityInvocation | undefined;
      if (!invocation) {
        state.endpointKey = endpointKey;
        state.capability = capability;
        return [{
          frameId: 0,
          documentId: options.documentId,
          result: result(true, "", "PROBE", { ready: true, version: 4 }) as T,
        }];
      }
      return [{
        frameId: 0,
        documentId: options.documentId,
        result: invoke(endpointKey, capability, invocation) as T,
      }];
    },
    async authorize(candidate) {
      return candidate.tabId === options.tabId
        && candidate.documentId === options.documentId
        && candidate.generation === generation
        && candidate.pageUrl === options.currentPageUrl();
    },
    retain(candidate) {
      return candidate.tabId === options.tabId
        && candidate.documentId === options.documentId
        && candidate.generation === generation
        && candidate.pageUrl === options.currentPageUrl();
    },
  });

  return {
    acquire(pageUrl: string) {
      return runtime.acquire(identity(pageUrl));
    },
    command(pageUrl: string, request: PageWorldRequest) {
      return runtime.command(identity(pageUrl), request);
    },
    retire() {
      return runtime.retireTab(options.tabId);
    },
    snapshot,
  };
}
