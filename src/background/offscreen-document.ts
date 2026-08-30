export type OffscreenContext = Readonly<{
  contextType?: string;
  documentUrl?: string;
}>;

export type OffscreenDocumentApi = Readonly<{
  runtime?: Readonly<{
    getURL?: (path: string) => string;
    getContexts?: (filter: Readonly<{
      contextTypes: string[];
      documentUrls: string[];
    }>) => Promise<readonly OffscreenContext[]> | readonly OffscreenContext[];
  }>;
  offscreen?: Readonly<{
    hasDocument?: () => Promise<boolean> | boolean;
    createDocument?: (options: Readonly<{
      url: string;
      reasons: string[];
      justification: string;
    }>) => Promise<void> | void;
  }>;
}>;

export type OffscreenDocumentOwner = Readonly<{
  ensure(): Promise<void>;
}>;

const OFFSCREEN_PATH = "offscreen.html";

/** Owns the sole offscreen-document creation transaction for one worker.
 * Chrome 116 supplies runtime.getContexts, which lets us prove the exact
 * extension URL instead of treating any offscreen document as ours. */
export function createOffscreenDocumentOwner(api: OffscreenDocumentApi): OffscreenDocumentOwner {
  let inFlight: Promise<void> | null = null;

  const exactDocumentExists = async (): Promise<boolean> => {
    const documentUrl = api.runtime?.getURL?.(OFFSCREEN_PATH);
    if (documentUrl && api.runtime?.getContexts) {
      try {
        const contexts = await Promise.resolve(api.runtime.getContexts({
          contextTypes: ["OFFSCREEN_DOCUMENT"],
          documentUrls: [documentUrl],
        }));
        return contexts.some((context) =>
          context.contextType === "OFFSCREEN_DOCUMENT" && context.documentUrl === documentUrl);
      } catch {
        // Hosts exposing a partial getContexts implementation may still expose
        // the older offscreen-specific proof below.
      }
    }
    if (api.offscreen?.hasDocument) {
      return await Promise.resolve(api.offscreen.hasDocument());
    }
    return false;
  };

  const createAndProve = async (): Promise<void> => {
    const createDocument = api.offscreen?.createDocument;
    if (!createDocument) return;
    if (await exactDocumentExists()) return;
    let createError: unknown = null;
    try {
      await Promise.resolve(createDocument({
        url: OFFSCREEN_PATH,
        reasons: ["DOM_PARSER"],
        justification: "Refine Unfluffify XPath rows against captured HTML",
      }));
    } catch (error) {
      createError = error;
    }
    if (await exactDocumentExists()) return;
    if (createError) throw createError;
    throw new Error("Offscreen document creation completed without an exact context proof");
  };

  return {
    ensure() {
      if (inFlight) return inFlight;
      const operation = createAndProve();
      inFlight = operation;
      void operation.finally(() => {
        if (inFlight === operation) inFlight = null;
      }).catch(() => undefined);
      return operation;
    },
  };
}
