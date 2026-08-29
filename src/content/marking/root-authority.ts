const MARKING_ROOT_SELECTOR = '.uf-marking-layer-root[data-uf-extension-ui="true"]';

type RemovableMarkingRoot = Readonly<{
  isConnected?: boolean;
  remove(): void;
}>;

type MarkingRootDocument = Readonly<{
  querySelectorAll?(selector: string): ArrayLike<RemovableMarkingRoot>;
}>;

/** A content realm adopts one marking renderer at a time. A replaced realm or
 * overlapping transition can no longer dispose a root after losing its module
 * pointer, so the next authoritative construction retires connected leftovers
 * before mounting its own renderer. */
export function retireSupersededMarkingRoots(ownerDocument: MarkingRootDocument | null | undefined): number {
  if (typeof ownerDocument?.querySelectorAll !== "function") {
    return 0;
  }
  let retired = 0;
  for (const root of Array.from(ownerDocument.querySelectorAll(MARKING_ROOT_SELECTOR))) {
    if (root.isConnected !== true) {
      continue;
    }
    root.remove();
    retired += 1;
  }
  return retired;
}
