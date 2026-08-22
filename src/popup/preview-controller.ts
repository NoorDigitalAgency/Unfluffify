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
}>;

export type PopupPreviewControllerPorts = Readonly<{
  selectors(): PopupSelectorList;
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
  requestCandidate(owner: PopupPreviewOwner): Promise<PreviewProjectionCandidate | null>;
  adoptCandidate(
    candidate: PreviewProjectionCandidate,
    owner: PopupPreviewOwner,
  ): PreviewProjection | null;
  adoptOpeningCandidate(
    candidate: PreviewProjectionCandidate,
    owner: PopupPreviewOwner,
  ): PreviewProjection | null;
  project(owner: PopupPreviewOwner): Promise<PreviewProjection | null>;
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

  const retire = (): void => {
    requestEpoch += 1;
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
  ): Promise<PreviewProjectionCandidate | null> => {
    const operationEpoch = ++requestEpoch;
    const selectors = ports.selectors();
    const projection = await ports.requestProjection({
      tabId: owner.tabId,
      pageUrl: owner.pageUrl,
      selectors: {
        inclusionSelectors: [...selectors.inclusionSelectors],
        exclusionSelectors: [...selectors.exclusionSelectors],
      },
    });
    if (
      !projection ||
      projection.pageUrl !== owner.pageUrl ||
      !ports.isCurrent(owner) ||
      operationEpoch !== requestEpoch
    ) {
      return null;
    }
    return { operationEpoch, projection };
  };

  const adoptCandidate = (
    candidate: PreviewProjectionCandidate,
    owner: PopupPreviewOwner,
  ): PreviewProjection | null => {
    const { operationEpoch, projection } = candidate;
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
      return current;
    }
    ports.setProjection(projection);
    return projection;
  };

  const project = async (owner: PopupPreviewOwner): Promise<PreviewProjection | null> => {
    const candidate = await requestCandidate(owner);
    return candidate ? adoptCandidate(candidate, owner) : null;
  };

  const recover = async (
    owner: PopupPreviewOwner,
    staleProjectionId: string,
  ): Promise<void> => {
    if (!targetOccurrenceIsCurrent(owner, staleProjectionId)) {
      return;
    }
    // Remove stale controls before asking content for the exact current bridge.
    ports.setProjection(null);
    await project(owner);
    ports.onChange();
  };

  return {
    bindingChanged: retire,
    previewClosed: retire,
    requestCandidate,
    adoptCandidate,
    adoptOpeningCandidate(candidate, owner) {
      const adopted = adoptCandidate(candidate, owner);
      const current = ports.currentProjection();
      const candidateIsStillDisplayed =
        current?.pageUrl === candidate.projection.pageUrl &&
        current.projectionId === candidate.projection.projectionId &&
        current.revision === candidate.projection.revision;
      const contextIsInvalid = !ports.isOpen() || !ports.isCurrent(owner);
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
        !projection.rows.some((row) => row.id === rowId)
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
        !projection.rows.some((row) => row.id === rowId)
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
