export interface PageMarkingConfig {
  include: string[];
  exclude: string[];
}

export interface TabStateSnapshot {
  tabId: number;
  markingEnabled: boolean;
  dirty: boolean;
}
