import { Component, createElement, type ErrorInfo, type ReactNode } from "react";
import { createRoot as createReactRoot, type Root } from "react-dom/client";

export type PopupReactRoot = Pick<Root, "render" | "unmount">;

type PopupErrorBoundaryProps = Readonly<{
  children?: ReactNode;
  onRecover: () => void;
  onError?: (error: Error, info: ErrorInfo) => void;
}>;

type PopupErrorBoundaryState = Readonly<{ failed: boolean }>;

export class PopupErrorBoundary extends Component<PopupErrorBoundaryProps, PopupErrorBoundaryState> {
  override state: PopupErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): PopupErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  override render(): ReactNode {
    if (!this.state.failed) {
      return this.props.children;
    }
    return createElement(
      "section",
      { className: "popup-root-recovery", role: "alert" },
      createElement("p", null, "The panel view stopped unexpectedly."),
      createElement(
        "button",
        { type: "button", onClick: this.props.onRecover },
        "Reload panel",
      ),
    );
  }
}

type PopupRootDocument = Pick<Document, "body" | "createElement" | "documentElement">;
type PopupRootHost = HTMLElement;
type ObserveMutations = (onMutation: () => void) => () => void;

export type PopupRootRecoveryOptions = Readonly<{
  document: PopupRootDocument;
  initialHost: PopupRootHost;
  createRoot?: (host: Element | DocumentFragment) => PopupReactRoot;
  observeMutations?: ObserveMutations;
  onRecover?: (reason: "detached" | "corrupted" | "react-error") => void;
  onError?: (error: Error, info: ErrorInfo) => void;
  enqueue?: (work: () => void) => void;
}>;

export type PopupRootRecovery = Readonly<{
  render: (node: ReactNode) => void;
  recover: (reason?: "detached" | "corrupted" | "react-error") => void;
  host: () => PopupRootHost;
  dispose: () => void;
}>;

function observeDocument(document: PopupRootDocument, onMutation: () => void): () => void {
  const view = document.documentElement.ownerDocument?.defaultView;
  const Observer = view?.MutationObserver ?? globalThis.MutationObserver;
  if (!Observer) {
    return () => undefined;
  }
  const observer = new Observer(onMutation);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-uf-popup-root-generation"],
    childList: true,
    subtree: true,
  });
  return () => observer.disconnect();
}

export function createPopupRootRecovery(options: PopupRootRecoveryOptions): PopupRootRecovery {
  const rootFactory = options.createRoot ?? ((host) => createReactRoot(host));
  const enqueue = options.enqueue ?? ((work) => queueMicrotask(work));
  let host = options.initialHost;
  let generation = 1;
  let root = rootFactory(host);
  let currentNode: ReactNode = null;
  let hasRendered = false;
  let recovering = false;
  let disposed = false;

  const markHost = (): void => {
    host.dataset.ufPopupRootGeneration = String(generation);
  };
  markHost();

  const renderCurrent = (): void => {
    if (!hasRendered || disposed) {
      return;
    }
    root.render(createElement(
      PopupErrorBoundary,
      {
        onRecover: () => requestRecovery("react-error"),
        onError: options.onError,
      },
      currentNode,
    ));
  };

  const requestRecovery = (reason: "detached" | "corrupted" | "react-error"): void => {
    if (recovering || disposed) {
      return;
    }
    recovering = true;
    enqueue(() => {
      if (disposed) {
        recovering = false;
        return;
      }
      try {
        root.unmount();
      } catch {
        // An externally detached/corrupted React root can reject unmount. The
        // replacement host is independent, so recovery can safely continue.
      }
      const replacement = options.document.createElement("div");
      replacement.id = host.id || "app";
      if (host.isConnected && host.parentElement) {
        host.replaceWith(replacement);
      } else {
        options.document.body.appendChild(replacement);
      }
      host = replacement;
      generation += 1;
      markHost();
      root = rootFactory(host);
      recovering = false;
      renderCurrent();
      options.onRecover?.(reason);
    });
  };

  const stopObserving = (options.observeMutations ?? ((callback) => observeDocument(options.document, callback)))(() => {
    if (!host.isConnected) {
      requestRecovery("detached");
      return;
    }
    if (host.dataset.ufPopupRootGeneration !== String(generation)) {
      requestRecovery("corrupted");
    }
  });

  return {
    render(node: ReactNode): void {
      currentNode = node;
      hasRendered = true;
      renderCurrent();
    },
    recover(reason = "corrupted"): void {
      requestRecovery(reason);
    },
    host(): PopupRootHost {
      return host;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopObserving();
      try {
        root.unmount();
      } catch {
        // Disposal is best effort after external root corruption.
      }
    },
  };
}
