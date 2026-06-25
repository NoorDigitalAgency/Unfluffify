export interface PageMarkingConfig {
  include: string[];
  exclude: string[];
}

export interface SelectorSet {
  includeXpaths: string[];
  excludeXpaths: string[];
  selectorSuppressedXpaths?: string[];
  submissionXpaths?: string[];
}

export interface PageMarkingEntry {
  title?: string;
  timestamp?: string;
  pageType?: string;
  xpaths: string[];
  includeXpaths: string[];
  selectorSuppressedXpaths: string[];
  submissionXpaths: string[];
  silentWhitespaceExcludedXpaths: string[];
  renderedHtml?: string;
  rawHtml?: string;
  [key: string]: unknown;
}

export interface PageMarkings {
  [pageUrl: string]: PageMarkingEntry;
}

export interface PageSaveReconciliation {
  status: string;
  baseUrl: string;
  pageUrl: string;
  reason: string;
  updatedAt: string;
}

export interface PropertyLockState {
  siteId?: string;
  baseUrl?: string;
  status?: string;
  connected?: boolean;
  clientId?: string;
  lockName?: string;
  lockIdentity?: string;
  secondsRemaining?: number | null;
  [key: string]: unknown;
}

export interface Config {
  baseUrl?: string;
  stageBase?: string;
  siteId?: string;
  token?: string;
  renderMode?: string;
  pageMarkings: PageMarkings;
  selectors?: SelectorSet;
  selectorsUpdatedAt?: string;
  submittedSelectorsFingerprint?: string;
  pageSaveReconciliations?: Record<string, PageSaveReconciliation>;
  propertyLockState?: PropertyLockState | null;
  [key: string]: unknown;
}

export interface TabStateSnapshot {
  tabId: number;
  markingEnabled: boolean;
  dirty: boolean;
}
