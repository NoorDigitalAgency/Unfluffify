export type LifecyclePhase = "started" | "running" | "completed" | "failed" | "cancelled";

export interface LifecycleEvent {
  key: string;
  phase: LifecyclePhase;
  tabId?: number;
  detail?: string;
  error?: string;
}

export interface SpinnerEntry {
  key: string;
  startedAt: number;
  tabId?: number;
}
