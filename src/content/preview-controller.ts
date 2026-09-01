import type {
  PreviewCurrentRequest,
  PreviewEmphasizeRequest,
  PreviewProjectRequest,
  PreviewProjection,
  PreviewProjectionIdentity,
  PreviewTargetRequest,
  PreviewTargetResponse,
} from "../domain/schema/preview";
import type { SelectorSet } from "../storage/config";

export type PreviewProjectionEngine = Readonly<{
  projectPreview(pageUrl: string, selectors: SelectorSet): PreviewProjection;
  currentPreviewProjection(): PreviewProjection | null;
  retirePreviewProjection(): void;
  emphasizePreviewRow(projectionId: string, rowId: string, active: boolean): boolean;
  activatePreviewRow(projectionId: string, rowId: string): boolean;
}>;

export type PreviewControllerOptions = Readonly<{
  currentPageUrl(): string;
  currentEngine(): PreviewProjectionEngine | null;
  ensureEngine(): PreviewProjectionEngine | null;
  interactionActive(): boolean;
}>;

function pageMatches(currentPageUrl: string, requestedPageUrl: string): boolean {
  return currentPageUrl !== "" && currentPageUrl === requestedPageUrl;
}

export function createPreviewController(options: PreviewControllerOptions) {
  return {
    current(request: PreviewCurrentRequest): PreviewProjectionIdentity | null {
      if (!pageMatches(options.currentPageUrl(), request.pageUrl)) {
        return null;
      }
      const projection = options.currentEngine()?.currentPreviewProjection() ?? null;
      if (!projection || projection.pageUrl !== request.pageUrl) {
        return null;
      }
      return {
        projectionId: projection.projectionId,
        revision: projection.revision,
        pageUrl: projection.pageUrl,
      };
    },
    project(request: PreviewProjectRequest): PreviewProjection {
      if (!pageMatches(options.currentPageUrl(), request.pageUrl)) {
        throw new Error("Preview pageUrl does not match the active document");
      }
      const engine = options.ensureEngine();
      if (!engine) {
        throw new Error("Preview projection requires an active document engine");
      }
      return engine.projectPreview(request.pageUrl, request.selectors);
    },
    retireProjection(): void {
      options.currentEngine()?.retirePreviewProjection();
    },
    emphasize(request: PreviewEmphasizeRequest): PreviewTargetResponse {
      if (
        !pageMatches(options.currentPageUrl(), request.pageUrl) ||
        (request.active && !options.interactionActive())
      ) {
        return { targeted: false };
      }
      return {
        targeted: options.currentEngine()?.emphasizePreviewRow(
          request.projectionId,
          request.rowId,
          request.active,
        ) ?? false,
      };
    },
    activate(request: PreviewTargetRequest): PreviewTargetResponse {
      if (!pageMatches(options.currentPageUrl(), request.pageUrl) || !options.interactionActive()) {
        return { targeted: false };
      }
      return {
        targeted: options.currentEngine()?.activatePreviewRow(
          request.projectionId,
          request.rowId,
        ) ?? false,
      };
    },
  };
}

export type PreviewController = ReturnType<typeof createPreviewController>;
