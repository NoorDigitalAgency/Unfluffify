import type { BrainProjection } from "../../background/brain/project";
import type { PopupState } from "./machine";

export function adoptProjection(projection: BrainProjection): PopupState {
  if (projection.phase === "locked" || !projection.canEdit && projection.phase === "marking") {
    return {
      name: "locked",
      lastConsumedSeq: projection.signalHead,
      reconciliationReason: "",
      projectionBlockedReason: projection.blockedReason || "property-lock",
    };
  }
  return {
    name: projection.phase === "silent" ? "silent" : projection.phase === "marking" ? "pre_ai_clean" : "reconciling",
    lastConsumedSeq: projection.signalHead,
    reconciliationReason: projection.phase === "reconciling" ? "syncing" : "",
  };
}
