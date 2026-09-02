import type { Classification } from "../../domain/schema/marking";

export const MARKING_OVERLAY_STYLE_ID = "unfluffify-marking-overlay-style";

/** The active marking vocabulary. Hidden decisions deliberately have no ghost
 * class: state survives invisibility, but presentation must not. */
export const MARKING_OVERLAY_CLASSES = [
  "uf-layer",
  "uf-scrolling",
  "uf-marking-temporarily-disabled",
  "uf-page-inspection-active",
  "uf-silent-presentation",
  "uf-preview-presentation",
  "uf-rect",
  "uf-hover",
  "uf-focus",
  "uf-hard-locked",
  "uf-default",
  "uf-ai-content",
  "uf-ai-content-overlay",
  "uf-explicit-include",
  "uf-explicit-exclude",
  "uf-interaction-ack",
] as const;

export const OVERLAY_CLASS_BY_CLASSIFICATION: Readonly<Record<Classification, string>> = {
  "implicit-include": "uf-default",
  "explicit-include": "uf-explicit-include",
  exception: "uf-explicit-exclude",
  immutable: "uf-hard-locked",
  // Closed shadow is rewrite-only, but it has the same immutable interaction
  // contract. Keep a marker class for diagnostics without inventing a sixth
  // colour in the legacy visual language.
  "closed-shadow": "uf-hard-locked uf-closed-shadow",
};

export const MARKING_OVERLAY_STYLES = `
.uf-marking-layer-root {
  position: fixed;
  inset: 0;
  z-index: 2147483647 !important;
  pointer-events: none;
  opacity: 1;
  transition: opacity 0.15s ease;
  will-change: opacity;
}
.uf-marking-layer-root .uf-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}
.uf-marking-layer-root .uf-layer[data-layer="hard"] { z-index: 2; }
.uf-marking-layer-root .uf-layer[data-layer="default"] { z-index: 3; }
.uf-marking-layer-root .uf-layer[data-layer="saved-explicit-exclude"] { z-index: 4; }
.uf-marking-layer-root .uf-layer[data-layer="saved-explicit-include"] { z-index: 5; }
.uf-marking-layer-root .uf-layer[data-layer="ai-content"] { z-index: 6; }
.uf-marking-layer-root .uf-layer[data-layer="silent-immutable"] { z-index: 6; }
.uf-marking-layer-root .uf-layer[data-layer="silent-content"] { z-index: 6; }
.uf-marking-layer-root .uf-layer[data-layer="silent-excluded"] { z-index: 6; }
.uf-marking-layer-root .uf-layer[data-layer="session-explicit-exclude"] { z-index: 7; }
.uf-marking-layer-root .uf-layer[data-layer="session-explicit-include"] { z-index: 8; }
.uf-marking-layer-root .uf-layer[data-layer="focus"] { z-index: 9; }
.uf-marking-layer-root .uf-layer[data-layer="hover"] { z-index: 10; }
.uf-marking-layer-root .uf-layer[data-layer="interaction"] { z-index: 11; }
.uf-marking-layer-root.uf-scrolling {
  /* One pre-composited root fade avoids invalidating a descendant selector
     across every overlay rectangle at the trusted scroll edge. Stale fixed
     coordinates disappear synchronously; removing the class restores them
     through the root's shared 150 ms transition. */
  opacity: 0;
  transition-duration: 0s;
}
.uf-marking-layer-root.uf-marking-temporarily-disabled .uf-layer {
  opacity: 0.28;
  filter: grayscale(0.75) saturate(0.55);
}
.uf-marking-layer-root.uf-marking-temporarily-disabled .uf-layer[data-layer="hover"],
.uf-marking-layer-root.uf-marking-temporarily-disabled .uf-layer[data-layer="interaction"] {
  opacity: 0;
}
.uf-marking-layer-root.uf-silent-presentation .uf-layer[data-layer="hard"],
.uf-marking-layer-root.uf-silent-presentation .uf-layer[data-layer="default"],
.uf-marking-layer-root.uf-silent-presentation .uf-layer[data-layer="saved-explicit-exclude"],
.uf-marking-layer-root.uf-silent-presentation .uf-layer[data-layer="saved-explicit-include"],
.uf-marking-layer-root.uf-silent-presentation .uf-layer[data-layer="ai-content"],
.uf-marking-layer-root.uf-silent-presentation .uf-layer[data-layer="session-explicit-exclude"],
.uf-marking-layer-root.uf-silent-presentation .uf-layer[data-layer="session-explicit-include"],
.uf-marking-layer-root.uf-silent-presentation .uf-layer[data-layer="focus"],
.uf-marking-layer-root.uf-silent-presentation .uf-layer[data-layer="hover"],
.uf-marking-layer-root.uf-silent-presentation .uf-layer[data-layer="interaction"] {
  /* Structural maintenance retains these boxes for an allocation-free return
     to Marking. Retention is not presentation authority: ordinary Silent owns
     only the three selector-result layers below. */
  opacity: 0;
}
.uf-marking-layer-root.uf-silent-presentation .uf-layer[data-layer="silent-immutable"],
.uf-marking-layer-root.uf-silent-presentation .uf-layer[data-layer="silent-content"],
.uf-marking-layer-root.uf-silent-presentation .uf-layer[data-layer="silent-excluded"] {
  opacity: 1;
  filter: none;
}
.uf-marking-layer-root.uf-preview-presentation .uf-layer[data-layer="hard"],
.uf-marking-layer-root.uf-preview-presentation .uf-layer[data-layer="default"],
.uf-marking-layer-root.uf-preview-presentation .uf-layer[data-layer="saved-explicit-exclude"],
.uf-marking-layer-root.uf-preview-presentation .uf-layer[data-layer="saved-explicit-include"],
.uf-marking-layer-root.uf-preview-presentation .uf-layer[data-layer="ai-content"],
.uf-marking-layer-root.uf-preview-presentation .uf-layer[data-layer="session-explicit-exclude"],
.uf-marking-layer-root.uf-preview-presentation .uf-layer[data-layer="session-explicit-include"],
.uf-marking-layer-root.uf-preview-presentation .uf-layer[data-layer="hover"],
.uf-marking-layer-root.uf-preview-presentation .uf-layer[data-layer="interaction"] {
  /* Content List is a read-only selector projection even when it was opened
     from Marking. Keep the retained marking boxes for an allocation-free
     restore, but expose only the Silent vocabulary and focus layer. */
  opacity: 0;
}
.uf-marking-layer-root.uf-preview-presentation .uf-layer[data-layer="silent-immutable"],
.uf-marking-layer-root.uf-preview-presentation .uf-layer[data-layer="silent-content"],
.uf-marking-layer-root.uf-preview-presentation .uf-layer[data-layer="silent-excluded"],
.uf-marking-layer-root.uf-preview-presentation .uf-layer[data-layer="focus"] {
  /* Preview may be opened while Marking's interaction posture is suspended.
     Its read-only annotations are nevertheless the ordinary Silent surface,
     not the grayed mutable-session affordance. */
  opacity: 1;
  filter: none;
}
.uf-marking-layer-root.uf-page-inspection-active .uf-layer {
  /* Reveal/freeze and Render view outrank Preview and paused Marking. The
     retained boxes remain allocated, but no annotation or hit surface paints. */
  opacity: 0 !important;
  pointer-events: none !important;
}
.uf-marking-layer-root.uf-marking-temporarily-disabled .uf-rect,
.uf-marking-layer-root.uf-marking-temporarily-disabled .uf-silent-rect {
  animation-play-state: paused !important;
}
.uf-marking-layer-root .uf-rect,
.uf-marking-layer-root .uf-silent-rect {
  position: absolute;
  box-sizing: border-box;
  pointer-events: none;
  border-radius: 4px;
}
.uf-marking-layer-root .uf-hover {
  border: 2px solid #ffb300;
  background: rgba(255, 179, 0, 0.1);
}
@keyframes uf-overlay-blink {
  0%, 100% { opacity: 0; }
  50% { opacity: 1; }
}
.uf-marking-layer-root .uf-focus {
  border: 3px solid #00acc1;
  background: rgba(0, 172, 193, 0.12);
  box-shadow: 0 0 5px 5px #00acc178;
  opacity: 1;
  animation: uf-overlay-blink 1s linear infinite !important;
}
.uf-marking-layer-root .uf-hard-locked {
  background: repeating-linear-gradient(
    45deg,
    rgba(225, 70, 70, 0.25),
    rgba(225, 70, 70, 0.25) 20px,
    rgba(225, 150, 70, 0.25) 20px,
    rgba(225, 150, 70, 0.25) 40px
  );
  border: 2px dashed rgba(225, 70, 70, 0.4);
}
.uf-marking-layer-root .uf-default {
  border: 1px solid #2e7d32;
  background: rgba(46, 125, 50, 0.08);
}
@keyframes uf-ai-content-dash {
  0% { background-position: 0 0, 0 100%, 0 0, 100% 0; }
  100% { background-position: 24px 0, -24px 100%, 0 -24px, 100% 24px; }
}
.uf-marking-layer-root .uf-ai-content {
  border: 1px solid transparent;
  background-color: rgba(46, 125, 50, 0.08);
  background-image:
    repeating-linear-gradient(90deg, #35943a 0 6px, transparent 6px 12px),
    repeating-linear-gradient(90deg, #35943a 0 6px, transparent 6px 12px),
    repeating-linear-gradient(0deg, #35943a 0 6px, transparent 6px 12px),
    repeating-linear-gradient(0deg, #35943a 0 6px, transparent 6px 12px);
  background-size: 24px 2px, 24px 2px, 2px 24px, 2px 24px;
  background-position: 0 0, 0 100%, 0 0, 100% 0;
  background-repeat: repeat-x, repeat-x, repeat-y, repeat-y;
  background-origin: border-box;
  background-clip: border-box;
  animation: uf-ai-content-dash 2s linear infinite !important;
}
.uf-marking-layer-root .uf-ai-content.uf-ai-content-overlay {
  background-color: transparent;
}
.uf-marking-layer-root .uf-explicit-include {
  border: 3px solid #1b5e20;
  background: rgba(27, 94, 32, 0.2);
}
.uf-marking-layer-root .uf-explicit-exclude {
  border: 3px solid #c62828;
  background: rgba(198, 40, 40, 0.2);
}
@keyframes uf-interaction-pulse {
  0% { opacity: 0.95; transform: scale(1); }
  100% { opacity: 0; transform: scale(1.02); }
}
.uf-marking-layer-root .uf-interaction-ack {
  animation: uf-interaction-pulse 160ms ease-out forwards;
}
.uf-marking-layer-root .uf-interaction-invalid {
  border: 3px dashed #c62828;
  background: rgba(198, 40, 40, 0.18);
  animation: uf-interaction-pulse 220ms ease-out forwards;
}
.uf-marking-layer-root .uf-silent-content {
  border: 2px dashed #44b532;
  background: rgba(68, 181, 50, 0.08);
}
.uf-marking-layer-root .uf-silent-immutable {
  border: 1px dashed rgba(156, 107, 107, 0.45);
  background: transparent;
}
.uf-marking-layer-root .uf-silent-excluded {
  border: 2px dashed #b03b3b;
  background: rgba(176, 59, 59, 0.08);
}
.uf-marking-layer-root [data-uf-silent-copy="true"] {
  pointer-events: auto;
  cursor: copy;
}
@media (prefers-reduced-motion: reduce) {
  .uf-marking-layer-root .uf-focus,
  .uf-marking-layer-root .uf-ai-content {
    animation: none !important;
  }
  .uf-marking-layer-root .uf-interaction-ack {
    animation: none;
    opacity: 0.6;
  }
}
`;

export function overlayClassFor(classification: Classification): string {
  return OVERLAY_CLASS_BY_CLASSIFICATION[classification];
}
