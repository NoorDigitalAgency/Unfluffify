export interface PageMarkingConfig {
  include: string[];
  exclude: string[];
}

export interface SelectorSet {
  exclusionSelectors: string[];
  inclusionSelectors: string[];
}

export interface XpathEntry {
  xpath: string;
  excluded: boolean;
  explicit?: boolean;
}

export interface PageMarkingEntry {
  title?: string;
  timestamp?: string;
  pageType?: string;
  xpaths: XpathEntry[];
  includeXpaths: string[];
  selectorSuppressedXpaths: string[];
  submissionXpaths: XpathEntry[];
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
  siteId?: string | number | null;
  token?: string;
  renderMode?: string;
  renderModeUpdatedAt?: string;
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
