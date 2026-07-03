// REFLEX-ARC content overlay memory (MAIN PLAN §3.2, D-SCOPE).
//
// Per machine state, the COMPLETE page-overlay presentation: the inspection
// tint notice, the page-blocking curtain content, and the
// marking-temporarily-disabled class policy. The renderer consumes THE
// MACHINE STATE's memory; brain spinner broadcasts reduce to surface
// vocabulary (which surface is engaged), never content. The strings are the
// established product copy (common/text.ts) — memorized here per state so no
// downstream pass re-derives them.
//
// The renderer swap (spinner-layer / content-bus-client pageCurtain path
// consuming this instead of broadcast content) is the next §3.2 slice; this
// module is the memorized inventory it renders from.
import { ContentText, PopupText } from "../common/text";
import type { ContentMarkingMachineState } from "./marking-machine";

export type ContentPageCurtainMemory =
  | Readonly<{ visible: false }>
  | Readonly<{
      visible: true;
      message: string;
      // True when the curtain must also raise the REAL page input block
      // (data-affecting operations; see content-bus-client's pageCurtain
      // renderer contract).
      blocksPageInput: boolean;
    }>;

export type ContentOverlayMemory = Readonly<{
  // The persistent marking-paused notice class policy: previewing/restoring
  // only (the plan's explicit rule) — marking interactions stay live in
  // marking, and silent surfaces have nothing to pause.
  markingTemporarilyDisabled: boolean;
  pageCurtain: ContentPageCurtainMemory;
}>;

const HIDDEN_PAGE_CURTAIN: ContentPageCurtainMemory = Object.freeze({ visible: false });

export const CONTENT_OVERLAY_MEMORY: Readonly<
  Record<ContentMarkingMachineState, ContentOverlayMemory>
> = Object.freeze({
  silent: Object.freeze({
    markingTemporarilyDisabled: false,
    pageCurtain: HIDDEN_PAGE_CURTAIN
  }),
  marking: Object.freeze({
    markingTemporarilyDisabled: false,
    pageCurtain: HIDDEN_PAGE_CURTAIN
  }),
  // The AI-run lock: the page is input-blocked while the run computes (the
  // run rewrites markings — user interaction would race it).
  compute_lock: Object.freeze({
    markingTemporarilyDisabled: false,
    pageCurtain: Object.freeze({
      visible: true,
      message: PopupText.overlay.computingSelectors,
      blocksPageInput: true
    } as const)
  }),
  // Preview: the sidebar is the surface; the page shows the detection rects
  // with marking edits paused.
  preview: Object.freeze({
    markingTemporarilyDisabled: true,
    pageCurtain: HIDDEN_PAGE_CURTAIN
  }),
  // Exit restore in flight: marking stays paused until the restore settles;
  // the reveal/inspection notice narrates the preparation.
  restoring: Object.freeze({
    markingTemporarilyDisabled: true,
    pageCurtain: Object.freeze({
      visible: true,
      message: ContentText.marking.pageInspection,
      blocksPageInput: false
    } as const)
  })
});

export function resolveContentOverlayMemory(
  state: ContentMarkingMachineState
): ContentOverlayMemory {
  return CONTENT_OVERLAY_MEMORY[state] ?? CONTENT_OVERLAY_MEMORY.silent;
}
