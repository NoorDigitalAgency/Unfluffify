import { DEVICE_EMULATION_PRESETS } from "../domain/constants";
import {
  fitDeviceScale,
  type EmulationMode,
} from "../domain/emulation";

export type PhysicalViewportSize = Readonly<{
  width: number;
  height: number;
}>;

export type EmulationCompositorPrefitBaseline = Readonly<{
  tabId: number;
  windowId: number;
  bindingOccurrence: number;
  tabViewport: PhysicalViewportSize;
  windowBounds: PhysicalViewportSize;
  panelViewport: PhysicalViewportSize;
}>;

export type EmulationCompositorPrefitState = Readonly<{
  tabId: number | null;
  bindingOccurrence: number;
  desiredMode: EmulationMode;
  appliedMode: EmulationMode | null;
  transitionPending: boolean;
}>;

export type EmulationCompositorPrefitMetrics = Readonly<{
  width: number;
  height: number;
  deviceScaleFactor: 1;
  mobile: boolean;
  scale: number;
}>;

export type EmulationCompositorPrefitAttempt = Readonly<{
  tabId: number;
  mode: EmulationMode;
  viewport: PhysicalViewportSize;
  scale: number;
  guardAdmission: Promise<number | undefined>;
  metricsCompletion: Promise<boolean>;
}>;

type BoundsChangedWindow = Readonly<{
  id?: number;
  width?: number;
  height?: number;
}>;

type BoundsChangedEvent = Readonly<{
  addListener(listener: (window: BoundsChangedWindow) => void): void;
  removeListener?(listener: (window: BoundsChangedWindow) => void): void;
}>;

type PopupGeometry = Readonly<{
  windowBounds: PhysicalViewportSize | null;
  panelViewport: PhysicalViewportSize | null;
}>;

type ControllerOptions = Readonly<{
  boundsChanged?: BoundsChangedEvent;
  currentState(): EmulationCompositorPrefitState;
  popupGeometry(): PopupGeometry;
  guard(tabId: number, mode: EmulationMode): Promise<number | undefined>;
  sendMetrics(
    tabId: number,
    metrics: EmulationCompositorPrefitMetrics,
  ): Promise<void> | void;
}>;

type ActiveBaseline = EmulationCompositorPrefitBaseline & Readonly<{
  projectedViewport: PhysicalViewportSize;
}>;

type ConfirmedPosture = Readonly<{
  tabId: number;
  bindingOccurrence: number;
  mode: EmulationMode;
  scale: number;
}>;

const VIEWPORT_EPSILON_PX = 0.5;

function validSize(value: PhysicalViewportSize | null | undefined): value is PhysicalViewportSize {
  return Boolean(value) &&
    Number.isFinite(value?.width) && Number(value?.width) > 0 &&
    Number.isFinite(value?.height) && Number(value?.height) > 0;
}

function sameSize(left: PhysicalViewportSize, right: PhysicalViewportSize): boolean {
  return Math.abs(left.width - right.width) <= VIEWPORT_EPSILON_PX &&
    Math.abs(left.height - right.height) <= VIEWPORT_EPSILON_PX;
}

function projectedTabViewport(
  baseline: EmulationCompositorPrefitBaseline,
  geometry: PopupGeometry,
): PhysicalViewportSize | null {
  if (!validSize(geometry.windowBounds) || !validSize(geometry.panelViewport)) {
    return null;
  }
  // The tab and side panel divide the same browser content width. An outer
  // resize contributes directly; a panel-width resize contributes inversely.
  const width = baseline.tabViewport.width +
    geometry.windowBounds.width - baseline.windowBounds.width -
    (geometry.panelViewport.width - baseline.panelViewport.width);
  // Popup content height and tab height share a stable chrome offset, while
  // outer height provides an independent estimate. Taking the smaller closes
  // whichever observation arrived first and can only make a shrink safer.
  const heightFromWindow = baseline.tabViewport.height +
    geometry.windowBounds.height - baseline.windowBounds.height;
  const heightFromPanel = baseline.tabViewport.height +
    geometry.panelViewport.height - baseline.panelViewport.height;
  const height = Math.min(heightFromWindow, heightFromPanel);
  return validSize({ width, height }) ? { width, height } : null;
}

/**
 * Keeps physical browser shrink ahead of Chromium's first resized WebContents
 * frame. The direct command is only an emergency compositor prefit: the
 * background runtime still owns attachment, proof, persistence and settlement.
 */
export function createEmulationCompositorPrefitController(options: ControllerOptions) {
  let baseline: ActiveBaseline | null = null;
  let confirmedPosture: ConfirmedPosture | null = null;
  let safeScaleCeiling: Readonly<{
    tabId: number;
    bindingOccurrence: number;
    mode: EmulationMode;
    scale: number;
  }> | null = null;
  let latestAttempt: EmulationCompositorPrefitAttempt | null = null;
  let disposed = false;
  let geometryRevision = 0;

  const eligibleState = (
    active: ActiveBaseline,
  ): EmulationCompositorPrefitState | null => {
    const state = options.currentState();
    return state.tabId === active.tabId &&
      state.bindingOccurrence === active.bindingOccurrence &&
      state.transitionPending === false &&
      state.appliedMode !== null &&
      state.appliedMode === state.desiredMode
      ? state
      : null;
  };

  const ceilingFor = (
    active: ActiveBaseline,
    mode: EmulationMode,
  ): number => {
    if (
      safeScaleCeiling?.tabId === active.tabId &&
      safeScaleCeiling.bindingOccurrence === active.bindingOccurrence &&
      safeScaleCeiling.mode === mode
    ) {
      return safeScaleCeiling.scale;
    }
    const physicalFit = fitDeviceScale(mode, active.projectedViewport, 1);
    const confirmed = confirmedPosture?.tabId === active.tabId &&
        confirmedPosture.bindingOccurrence === active.bindingOccurrence &&
        confirmedPosture.mode === mode
      ? confirmedPosture.scale
      : physicalFit;
    const scale = Math.min(confirmed, physicalFit);
    safeScaleCeiling = {
      tabId: active.tabId,
      bindingOccurrence: active.bindingOccurrence,
      mode,
      scale,
    };
    return scale;
  };

  const observe = (
    geometry: PopupGeometry,
  ): EmulationCompositorPrefitAttempt | null => {
    if (disposed || !baseline) return null;
    const nextViewport = projectedTabViewport(baseline, geometry);
    if (!nextViewport) return null;
    const priorViewport = baseline.projectedViewport;
    if (sameSize(priorViewport, nextViewport)) {
      return latestAttempt;
    }
    geometryRevision += 1;
    baseline = { ...baseline, projectedViewport: nextViewport };
    const physicallyShrinking =
      nextViewport.width < priorViewport.width - VIEWPORT_EPSILON_PX ||
      nextViewport.height < priorViewport.height - VIEWPORT_EPSILON_PX;
    if (!physicallyShrinking) {
      latestAttempt = null;
      return null;
    }
    const state = eligibleState(baseline);
    if (!state || state.appliedMode === null) {
      latestAttempt = null;
      return null;
    }
    const mode = state.appliedMode;
    const scale = Math.min(
      ceilingFor({ ...baseline, projectedViewport: priorViewport }, mode),
      fitDeviceScale(mode, nextViewport, 1),
    );
    safeScaleCeiling = {
      tabId: baseline.tabId,
      bindingOccurrence: baseline.bindingOccurrence,
      mode,
      scale,
    };
    if (
      latestAttempt?.tabId === baseline.tabId &&
      latestAttempt.mode === mode &&
      Math.abs(latestAttempt.scale - scale) <= 0.001
    ) {
      latestAttempt = { ...latestAttempt, viewport: nextViewport };
      return latestAttempt;
    }

    // Calling guard starts both content admission lanes synchronously. Do not
    // await its paint acknowledgement: the debugger command must enter Chrome's
    // own queue in this same popup event task.
    let guardAdmission: Promise<number | undefined>;
    try {
      guardAdmission = Promise.resolve(options.guard(baseline.tabId, mode))
        .catch(() => undefined);
    } catch {
      guardAdmission = Promise.resolve(undefined);
    }
    const preset = DEVICE_EMULATION_PRESETS[mode];
    let metricsCompletion: Promise<boolean>;
    try {
      metricsCompletion = Promise.resolve(options.sendMetrics(baseline.tabId, {
        width: preset.width,
        height: preset.height,
        deviceScaleFactor: 1,
        mobile: mode === "mobile",
        scale,
      })).then(() => true, () => false);
    } catch {
      // The authoritative background refit is already being admitted by the
      // same guard and remains the failure path for a missing debugger lease.
      metricsCompletion = Promise.resolve(false);
    }
    latestAttempt = {
      tabId: baseline.tabId,
      mode,
      viewport: nextViewport,
      scale,
      guardAdmission,
      metricsCompletion,
    };
    return latestAttempt;
  };

  const onBoundsChanged = (window: BoundsChangedWindow): void => {
    if (disposed || !baseline || window.id !== baseline.windowId) return;
    const width = Number(window.width);
    const height = Number(window.height);
    if (!validSize({ width, height })) return;
    const current = options.popupGeometry();
    observe({
      windowBounds: { width, height },
      panelViewport: current.panelViewport,
    });
  };

  options.boundsChanged?.addListener(onBoundsChanged);

  return {
    revision(): number {
      return geometryRevision;
    },
    prime(
      next: EmulationCompositorPrefitBaseline,
      expectedGeometryRevision = geometryRevision,
    ): boolean {
      if (
        disposed ||
        expectedGeometryRevision !== geometryRevision ||
        !Number.isInteger(next.tabId) || next.tabId <= 0 ||
        !Number.isInteger(next.windowId) || next.windowId < 0 ||
        !Number.isSafeInteger(next.bindingOccurrence) || next.bindingOccurrence < 0 ||
        !validSize(next.tabViewport) ||
        !validSize(next.windowBounds) ||
        !validSize(next.panelViewport)
      ) {
        return false;
      }
      const state = options.currentState();
      if (
        state.tabId !== next.tabId ||
        state.bindingOccurrence !== next.bindingOccurrence
      ) {
        return false;
      }
      baseline = { ...next, projectedViewport: next.tabViewport };
      latestAttempt = null;
      safeScaleCeiling = null;
      return true;
    },
    confirmPosture(
      tabId: number,
      bindingOccurrence: number,
      mode: EmulationMode,
      scale: number,
    ): boolean {
      const state = options.currentState();
      if (
        disposed || !Number.isFinite(scale) || scale <= 0 ||
        state.tabId !== tabId ||
        state.bindingOccurrence !== bindingOccurrence
      ) {
        return false;
      }
      confirmedPosture = { tabId, bindingOccurrence, mode, scale };
      if (
        baseline?.tabId === tabId &&
        baseline.bindingOccurrence === bindingOccurrence
      ) {
        safeScaleCeiling = {
          tabId,
          bindingOccurrence,
          mode,
          scale: Math.min(scale, fitDeviceScale(mode, baseline.projectedViewport, 1)),
        };
      }
      return true;
    },
    observePopupResize(): EmulationCompositorPrefitAttempt | null {
      return observe(options.popupGeometry());
    },
    reset(): void {
      geometryRevision += 1;
      baseline = null;
      confirmedPosture = null;
      safeScaleCeiling = null;
      latestAttempt = null;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      geometryRevision += 1;
      options.boundsChanged?.removeListener?.(onBoundsChanged);
      baseline = null;
      confirmedPosture = null;
      safeScaleCeiling = null;
      latestAttempt = null;
    },
  };
}
