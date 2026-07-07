import type { XPathNodeView } from "../../domain/xpath";

export type FlattenInputNode = Readonly<{
  key: string;
  tagName: string;
  children?: readonly FlattenInputNode[];
  shadowChildren?: readonly FlattenInputNode[];
  closedShadow?: boolean;
  extensionUi?: boolean;
}>;

export function flattenNode(node: FlattenInputNode, parent: XPathNodeView | null = null): XPathNodeView | null {
  if (node.extensionUi) {
    return null;
  }
  if (node.closedShadow) {
    return {
      key: node.key,
      tagName: node.tagName,
      parent,
      closedShadow: true,
    };
  }
  const view = {
    key: node.key,
    tagName: node.tagName,
    parent,
  } as XPathNodeView & {
    shadowChildren?: readonly XPathNodeView[];
    children?: readonly XPathNodeView[];
  };
  const shadowChildren = (node.shadowChildren ?? [])
    .map((child) => flattenNode(child, view))
    .filter((child): child is XPathNodeView => child !== null);
  const children = (node.children ?? [])
    .map((child) => flattenNode(child, view))
    .filter((child): child is XPathNodeView => child !== null);
  view.shadowChildren = shadowChildren;
  view.children = children;
  return view;
}
