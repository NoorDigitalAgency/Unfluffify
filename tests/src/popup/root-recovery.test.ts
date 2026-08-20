import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  PopupErrorBoundary,
  createPopupRootRecovery,
  type PopupReactRoot,
} from "../../../src/popup/root-recovery";

class FakeElement {
  id = "";
  isConnected = true;
  parentElement: FakeElement | null = null;
  readonly dataset: Record<string, string> = {};
  readonly children: FakeElement[] = [];

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    child.isConnected = this.isConnected;
    this.children.push(child);
    return child;
  }

  replaceWith(replacement: FakeElement): void {
    const parent = this.parentElement;
    if (!parent) return;
    const index = parent.children.indexOf(this);
    parent.children.splice(index, 1, replacement);
    this.isConnected = false;
    replacement.parentElement = parent;
    replacement.isConnected = true;
  }
}

function fixture() {
  const body = new FakeElement();
  const documentElement = new FakeElement();
  const initialHost = body.appendChild(new FakeElement());
  initialHost.id = "app";
  const roots: Array<PopupReactRoot & { renders: ReactNode[] }> = [];
  let mutationCallback: (() => void) | null = null;
  const document = {
    body,
    documentElement,
    createElement: () => new FakeElement(),
  };
  const createRoot = vi.fn(() => {
    const root = {
      renders: [] as ReactNode[],
      render(node: ReactNode) { this.renders.push(node); },
      unmount: vi.fn(),
    };
    roots.push(root);
    return root;
  });
  const observeMutations = (callback: () => void) => {
    mutationCallback = callback;
    return vi.fn();
  };
  return { body, createRoot, document, initialHost, observeMutations, roots, mutate: () => mutationCallback?.() };
}

describe("popup root recovery", () => {
  it("recreates a detached root, re-renders the latest UI, and rehydrates once", async () => {
    const test = fixture();
    const onRecover = vi.fn();
    const controller = createPopupRootRecovery({
      document: test.document as never,
      initialHost: test.initialHost as never,
      createRoot: test.createRoot as never,
      observeMutations: test.observeMutations,
      onRecover,
    });
    controller.render("authoritative-view");
    test.initialHost.isConnected = false;
    test.mutate();
    await Promise.resolve();

    expect(test.createRoot).toHaveBeenCalledTimes(2);
    expect(test.roots[0].unmount).toHaveBeenCalledTimes(1);
    expect(test.roots[1].renders).toHaveLength(1);
    expect(onRecover).toHaveBeenCalledTimes(1);
    expect(controller.host()).not.toBe(test.initialHost);
  });

  it("coalesces repeated corruption notifications into one recovery", async () => {
    const test = fixture();
    const controller = createPopupRootRecovery({
      document: test.document as never,
      initialHost: test.initialHost as never,
      createRoot: test.createRoot as never,
      observeMutations: test.observeMutations,
    });
    controller.render("view");
    test.initialHost.dataset.ufPopupRootGeneration = "corrupt";
    test.mutate();
    test.mutate();
    await Promise.resolve();
    expect(test.createRoot).toHaveBeenCalledTimes(2);
  });

  it("turns a React error into an explicit recovery action", () => {
    const onRecover = vi.fn();
    const onError = vi.fn();
    const boundary = new PopupErrorBoundary({ children: "view", onRecover, onError });
    boundary.state = { failed: true };
    boundary.componentDidCatch(new Error("broken"), { componentStack: "App" });
    const fallback = boundary.render() as { props: { children: Array<{ props?: { onClick?: () => void } }> } };
    const retry = fallback.props.children.find((child) => typeof child?.props?.onClick === "function");
    retry?.props?.onClick?.();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onRecover).toHaveBeenCalledTimes(1);
  });
});
