import type { Classification } from "../../domain/schema/marking";

export const OVERLAY_CLASS_BY_CLASSIFICATION: Readonly<Record<Classification, string>> = {
  "implicit-include": "uf-overlay-include",
  "explicit-include": "uf-overlay-explicit-include",
  exception: "uf-overlay-exception",
  immutable: "uf-overlay-immutable",
  "closed-shadow": "uf-overlay-closed-shadow",
};

export function overlayClassFor(classification: Classification): string {
  return OVERLAY_CLASS_BY_CLASSIFICATION[classification];
}
