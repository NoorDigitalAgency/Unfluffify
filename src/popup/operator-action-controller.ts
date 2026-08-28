export type OperatorActionKind =
  | "marking-preflight"
  | "marking-disable"
  | "ai-preflight"
  | "preview-open"
  | "save"
  | "discard"
  | "candidate-navigation"
  | "render-mode-set";

export type OperatorActionStage =
  | "admitted"
  | "context"
  | "signals"
  | "lock"
  | "emulation"
  | "reload"
  | "activation"
  | "rows"
  | "snapshot"
  | "xpaths"
  | "ai-start"
  | "ai-poll"
  | "preview"
  | "persist"
  | "navigation"
  | "terminal";

export type OperatorActionBinding = Readonly<{
  bindingKey: string | null;
  bindingOccurrence: number;
}>;

export type OperatorActionOccurrence = Readonly<{
  id: number;
  kind: OperatorActionKind;
  bindingKey: string | null;
  bindingOccurrence: number;
  startedAt: number;
}>;

export type OperatorActionState = OperatorActionOccurrence & Readonly<{
  stage: OperatorActionStage;
}>;

export type OperatorActionController = Readonly<{
  current(): OperatorActionState | null;
  begin(kind: OperatorActionKind, binding: OperatorActionBinding): OperatorActionOccurrence | null;
  advance(occurrence: OperatorActionOccurrence, stage: OperatorActionStage): boolean;
  clear(occurrence: OperatorActionOccurrence): boolean;
}>;

const STAGE_ORDER: Readonly<Record<OperatorActionKind, readonly OperatorActionStage[]>> = {
  "marking-preflight": [
    "admitted", "context", "signals", "lock", "emulation", "reload", "activation", "rows", "terminal",
  ],
  "ai-preflight": [
    "admitted", "context", "lock", "signals", "ai-start", "snapshot", "xpaths", "ai-poll", "preview", "terminal",
  ],
  "marking-disable": ["admitted", "context", "signals", "activation", "emulation", "terminal"],
  "preview-open": ["admitted", "context", "rows", "preview", "terminal"],
  save: ["admitted", "context", "signals", "lock", "snapshot", "persist", "terminal"],
  discard: ["admitted", "context", "lock", "activation", "emulation", "terminal"],
  "candidate-navigation": ["admitted", "context", "navigation", "terminal"],
  "render-mode-set": ["admitted", "persist", "terminal"],
};

function stageIndex(kind: OperatorActionKind, stage: OperatorActionStage): number {
  const index = STAGE_ORDER[kind].indexOf(stage);
  return index < 0 ? Number.POSITIVE_INFINITY : index;
}

function isSameOccurrence(
  state: OperatorActionState | null,
  occurrence: OperatorActionOccurrence,
): state is OperatorActionState {
  return state !== null &&
    state.id === occurrence.id &&
    state.kind === occurrence.kind &&
    state.bindingKey === occurrence.bindingKey &&
    state.bindingOccurrence === occurrence.bindingOccurrence;
}

/**
 * Owns the popup-local acknowledgement for one operator action. This state is
 * deliberately occurrence-fenced and ephemeral: it may describe transport
 * progress, but it cannot mutate or replace the brain-owned organ state.
 */
export function createOperatorActionController(options: Readonly<{
  now?: () => number;
  onChange?: (state: OperatorActionState | null) => void;
}> = {}): OperatorActionController {
  const now = options.now ?? Date.now;
  const onChange = options.onChange ?? (() => undefined);
  let nextId = 1;
  let state: OperatorActionState | null = null;

  return {
    current: () => state,
    begin(kind, binding) {
      if (state !== null) {
        return null;
      }
      const occurrence: OperatorActionOccurrence = {
        id: nextId,
        kind,
        bindingKey: binding.bindingKey,
        bindingOccurrence: binding.bindingOccurrence,
        startedAt: now(),
      };
      nextId += 1;
      state = { ...occurrence, stage: "admitted" };
      onChange(state);
      return occurrence;
    },
    advance(occurrence, stage) {
      const nextStageIndex = state ? stageIndex(state.kind, stage) : Number.POSITIVE_INFINITY;
      if (
        !isSameOccurrence(state, occurrence) ||
        !Number.isFinite(nextStageIndex) ||
        nextStageIndex < stageIndex(state.kind, state.stage)
      ) {
        return false;
      }
      if (state.stage === stage) {
        return true;
      }
      state = { ...state, stage };
      onChange(state);
      return true;
    },
    clear(occurrence) {
      if (!isSameOccurrence(state, occurrence)) {
        return false;
      }
      state = null;
      onChange(null);
      return true;
    },
  };
}
