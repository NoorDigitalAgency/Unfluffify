export const PROPERTY_LOCK_HEARTBEAT_INTERVAL_MS = 30_000;
export const PROPERTY_LOCK_ACTIVITY_DEBOUNCE_MS = 5_000;
export const PROPERTY_LOCK_EDITOR_IDLE_TIMEOUT_MS = 30 * 60_000;
export const PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS = 70_000;
export const PROPERTY_LOCK_PORT_DISCONNECT_DELAY_MS = 70_000;
export const PROPERTY_LOCK_OFF_CANDIDATE_WARNING_TIMEOUT_MS = 70_000;
export const PROPERTY_LOCK_CROSS_PROPERTY_COOLDOWN_TIMEOUT_MS = 30_000;
export const PROPERTY_LOCK_PASSIVE_RELEASE_COUNTDOWN_MS = 60_000;
export const PROPERTY_LOCK_NETWORK_CHECK_TIMEOUT_MS = 5_000;

export type BackendLockTimingState = Readonly<{
  expiresAtUtc?: string;
  secondsRemaining?: number;
}>;

export function mirrorBackendTimings(state: BackendLockTimingState): BackendLockTimingState {
  return {
    expiresAtUtc: state.expiresAtUtc,
    secondsRemaining: state.secondsRemaining,
  };
}

export function isNetworkReachable(input: Readonly<{
  websocketOpen: boolean;
  httpProbeReachable: boolean;
}>): boolean {
  return input.websocketOpen && input.httpProbeReachable;
}
