import { DEFAULT_SUBMISSION_VIEWPORT } from "./constants";

export type VisibilityRect = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

export type VisibilityStyle = Readonly<{
  display?: string;
  visibility?: string;
  opacity?: number;
  hidden?: boolean;
  ariaHidden?: boolean;
  srOnly?: boolean;
  interactionGated?: boolean;
  overflowY?: string;
  clientHeight?: number;
  scrollHeight?: number;
  webkitLineClamp?: number;
  textContent?: string;
}>;

export type VisibilityGeometry = Readonly<{
  rect: VisibilityRect;
  style?: VisibilityStyle;
  viewportWidth?: number;
  pageHeight?: number;
}>;

function hasVisibleClampPreview(style: VisibilityStyle | undefined, rect: VisibilityRect): boolean {
  if (!style) {
    return false;
  }
  const textPresent = (style.textContent ?? "").trim().length > 0;
  const overflowClips = style.overflowY === "hidden" || style.overflowY === "clip";
  const downwardClamp =
    overflowClips &&
    style.clientHeight !== undefined &&
    style.scrollHeight !== undefined &&
    style.scrollHeight > style.clientHeight;
  const lineClamp = (style.webkitLineClamp ?? 0) > 0;
  return textPresent && rect.height > 1 && (downwardClamp || lineClamp);
}

export function isUserVisible(_node: unknown, geometry: VisibilityGeometry): boolean {
  const { rect } = geometry;
  const style = geometry.style;
  if (style?.hidden || style?.ariaHidden || style?.interactionGated || style?.srOnly) {
    return false;
  }
  if (style?.display === "none") {
    return false;
  }
  if (style?.visibility === "hidden" || style?.visibility === "collapse") {
    return false;
  }
  if (style?.opacity === 0) {
    return false;
  }
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  const viewportWidth = geometry.viewportWidth ?? DEFAULT_SUBMISSION_VIEWPORT.width;
  if (rect.left + rect.width <= 0 || rect.left >= viewportWidth) {
    return false;
  }

  const pageHeight = geometry.pageHeight ?? Number.POSITIVE_INFINITY;
  if (rect.top + rect.height <= 0 || rect.top >= pageHeight) {
    return false;
  }

  if (hasVisibleClampPreview(style, rect)) {
    return true;
  }

  const overflowClips = style?.overflowY === "hidden" || style?.overflowY === "clip";
  const hasVerticalOverflow =
    style?.clientHeight !== undefined &&
    style.scrollHeight !== undefined &&
    style.scrollHeight > style.clientHeight;
  if (overflowClips && hasVerticalOverflow) {
    return false;
  }

  return true;
}
