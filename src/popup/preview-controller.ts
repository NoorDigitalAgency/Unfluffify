import type {
  PreviewProjection,
  PreviewTargetResponse,
} from "../domain/schema/preview";
import type { PopupSelectorList } from "./organ/machine";

export type PopupPreviewOwner = Readonly<{
  tabId: number;
  requestKey: string;
  pageUrl: string;
}>;

export type PreviewProjectionCandidate = Readonly<{
  operationEpoch: number;
  projection: PreviewProjection;
  selectors: PopupSelectorList;
}>;

export type PopupPreviewControllerPorts = Readonly<{
  currentProjection(): PreviewProjection | null;
  setProjection(projection: PreviewProjection | null): void;
  requestProjection(input: Readonly<{
    tabId: number;
    pageUrl: string;
    selectors: PopupSelectorList;
  }>): Promise<PreviewProjection | null>;
  emphasize(input: Readonly<{
    tabId: number;
    pageUrl: string;
    projectionId: string;
    rowId: string;
    active: boolean;
  }>): Promise<PreviewTargetResponse | null>;
  activate(input: Readonly<{
    tabId: number;
    pageUrl: string;
    projectionId: string;
    rowId: string;
  }>): Promise<PreviewTargetResponse | null>;
  isOpen(): boolean;
  isCurrent(owner: PopupPreviewOwner): boolean;
  notify(label: string, detail: string): void;
  onChange(): void;
}>;

export type PopupPreviewController = Readonly<{
  bindingChanged(): void;
  previewClosed(): void;
  requestCandidate(
    owner: PopupPreviewOwner,
    selectors: PopupSelectorList,
  ): Promise<PreviewProjectionCandidate | null>;
  adoptCandidate(
    candidate: PreviewProjectionCandidate,
    owner: PopupPreviewOwner,
  ): PreviewProjection | null;
  adoptOpeningCandidate(
    candidate: PreviewProjectionCandidate,
    owner: PopupPreviewOwner,
  ): PreviewProjection | null;
  project(
    owner: PopupPreviewOwner,
    selectors?: PopupSelectorList,
  ): Promise<PreviewProjection | null>;
  recover(owner: PopupPreviewOwner, staleProjectionId: string): Promise<void>;
  hover(owner: PopupPreviewOwner, rowId: string, active: boolean): Promise<void>;
  activate(owner: PopupPreviewOwner, rowId: string): Promise<void>;
}>;

/**
 * Owns popup-local Preview projection revisions and target-response occurrence
 * fencing. The entrypoint still owns Preview brain transitions and tab binding;
 * content remains the sole producer and target resolver for row identities.
 */
export function createPopupPreviewController(
  ports: PopupPreviewControllerPorts,
): PopupPreviewController {
  let requestEpoch = 0;
  let indexedProjection: PreviewProjection | null = null;
  let indexedRowIds = new Set<string>();
  let adoptedSelectorAuthority: Readonly<{
    owner: PopupPreviewOwner;
    selectors: PopupSelectorList;
  }> | null = null;

  const copySelectors = (selectors: PopupSelectorList): PopupSelectorList => ({
    inclusionSelectors: [...selectors.inclusionSelectors],
    exclusionSelectors: [...selectors.exclusionSelectors],
  });

  const sameOwner = (left: PopupPreviewOwner, right: PopupPreviewOwner): boolean =>
    left.tabId === right.tabId &&
    left.requestKey === right.requestKey &&
    left.pageUrl === right.pageUrl;

  const rememberSelectorAuthority = (
    owner: PopupPreviewOwner,
    selectors: PopupSelectorList,
  ): void => {
    adoptedSelectorAuthority = {
      owner: { ...owner },
      selectors: copySelectors(selectors),
    };
  };

  const projectionContains = (projection: PreviewProjection, rowId: string): boolean => {
    if (indexedProjection !== projection) {
      indexedProjection = projection;
      indexedRowIds = new Set(projection.rows.map((row) => row.id));
    }
    return indexedRowIds.has(rowId);
  };

  const retire = (): void => {
    requestEpoch += 1;
    indexedProjection = null;
    indexedRowIds = new Set();
    adoptedSelectorAuthority = null;
  };

  const targetOccurrenceIsCurrent = (
    owner: PopupPreviewOwner,
    projectionId: string,
  ): boolean => {
    const current = ports.currentProjection();
    return ports.isOpen() &&
      ports.isCurrent(owner) &&
      current?.pageUrl === owner.pageUrl &&
      current.projectionId === projectionId;
  };

  const requestCandidate = async (
    owner: PopupPreviewOwner,
    selectors: PopupSelectorList,
  ): Promise<PreviewProjectionCandidate | null> => {
    const operationEpoch = ++requestEpoch;
    const requestedSelectors = copySelectors(selectors);
    const projection = await ports.requestProjection({
      tabId: owner.tabId,
      pageUrl: owner.pageUrl,
      selectors: copySelectors(requestedSelectors),
    });
    if (
      !projection ||
      projection.pageUrl !== owner.pageUrl ||
      !ports.isCurrent(owner) ||
      operationEpoch !== requestEpoch
    ) {
      return null;
    }
    return { operationEpoch, projection, selectors: requestedSelectors };
  };

  const adoptCandidate = (
    candidate: PreviewProjectionCandidate,
    owner: PopupPreviewOwner,
  ): PreviewProjection | null => {
    const { operationEpoch, projection, selectors } = candidate;
    if (
      !ports.isOpen() ||
      projection.pageUrl !== owner.pageUrl ||
      !ports.isCurrent(owner) ||
      operationEpoch !== requestEpoch
    ) {
      return null;
    }
    const current = ports.currentProjection();
    if (
      current?.pageUrl === projection.pageUrl &&
      current.projectionId === projection.projectionId &&
      projection.revision <= current.revision
    ) {
      if (!adoptedSelectorAuthority || !sameOwner(adoptedSelectorAuthority.owner, owner)) {
        rememberSelectorAuthority(owner, selectors);
      }
      return current;
    }
    ports.setProjection(projection);
    indexedProjection = projection;
    indexedRowIds = new Set(projection.rows.map((row) => row.id));
    rememberSelectorAuthority(owner, selectors);
    return projection;
  };

  const stageOpeningCandidate = (
    candidate: PreviewProjectionCandidate,
    owner: PopupPreviewOwner,
  ): PreviewProjection | null => {
    const { operationEpoch, projection, selectors } = candidate;
    if (
      projection.pageUrl !== owner.pageUrl ||
      !ports.isCurrent(owner) ||
      operationEpoch !== requestEpoch
    ) {
      return null;
    }
    const current = ports.currentProjection();
    if (
      current?.pageUrl === projection.pageUrl &&
      current.projectionId === projection.projectionId &&
      projection.revision <= current.revision
    ) {
      rememberSelectorAuthority(owner, selectors);
      return current;
    }
    ports.setProjection(projection);
    indexedProjection = projection;
    indexedRowIds = new Set(projection.rows.map((row) => row.id));
    rememberSelectorAuthority(owner, selectors);
    return projection;
  };

  const project = async (
    owner: PopupPreviewOwner,
    selectors?: PopupSelectorList,
  ): Promise<PreviewProjection | null> => {
    const retained = adoptedSelectorAuthority && sameOwner(adoptedSelectorAuthority.owner, owner)
      ? adoptedSelectorAuthority.selectors
      : selectors;
    if (!retained) {
      return null;
    }
    const candidate = await requestCandidate(owner, retained);
    return candidate ? adoptCandidate(candidate, owner) : null;
  };

  const recover = async (
    owner: PopupPreviewOwner,
    staleProjectionId: string,
  ): Promise<void> => {
    if (!targetOccurrenceIsCurrent(owner, staleProjectionId)) {
      return;
    }
    // Keep the last truthful list visible until its replacement is ready. A
    // transient receiver delay must not flash a false empty-state to the user.
    await project(owner);
    ports.onChange();
  };

  return {
    bindingChanged: retire,
    previewClosed: retire,
    requestCandidate,
    adoptCandidate,
    adoptOpeningCandidate(candidate, owner) {
      const adopted = ports.isOpen()
        ? adoptCandidate(candidate, owner)
        : stageOpeningCandidate(candidate, owner);
      const current = ports.currentProjection();
      const candidateIsStillDisplayed =
        current?.pageUrl === candidate.projection.pageUrl &&
        current.projectionId === candidate.projection.projectionId &&
        current.revision === candidate.projection.revision;
      const contextIsInvalid = !ports.isCurrent(owner);
      if (!adopted && candidateIsStillDisplayed && contextIsInvalid) {
        // A candidate that opened no current Preview must not survive. A newer
        // revision/occurrence is deliberately left untouched.
        ports.setProjection(null);
      }
      return adopted;
    },
    project,
    recover,
    async hover(owner, rowId, active) {
      const projection = ports.currentProjection();
      if (
        !ports.isOpen() ||
        !ports.isCurrent(owner) ||
        !projection ||
        !projectionContains(projection, rowId)
      ) {
        return;
      }
      const result = await ports.emphasize({
        tabId: owner.tabId,
        pageUrl: projection.pageUrl,
        projectionId: projection.projectionId,
        rowId,
        active,
      });
      if (!targetOccurrenceIsCurrent(owner, projection.projectionId)) {
        return;
      }
      if (
        result?.targeted === false &&
        ports.currentProjection()?.projectionId === projection.projectionId
      ) {
        await recover(owner, projection.projectionId);
      }
    },
    async activate(owner, rowId) {
      const projection = ports.currentProjection();
      if (
        !ports.isOpen() ||
        !ports.isCurrent(owner) ||
        !projection ||
        !projectionContains(projection, rowId)
      ) {
        return;
      }
      const result = await ports.activate({
        tabId: owner.tabId,
        pageUrl: projection.pageUrl,
        projectionId: projection.projectionId,
        rowId,
      });
      if (!targetOccurrenceIsCurrent(owner, projection.projectionId)) {
        return;
      }
      if (!result) {
        ports.notify("Preview row unavailable", "the page did not answer");
        ports.onChange();
        return;
      }
      if (!result.targeted) {
        ports.notify("Preview row changed", "refreshing detected content");
        await recover(owner, projection.projectionId);
      }
    },
  };
}
