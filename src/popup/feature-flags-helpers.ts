import { FEATURE_FLAGS } from "../common/feature-flags";

type PopupFeatureFlags = Partial<Record<string, boolean>>;

export function isPopupFeatureEnabled(
  view: { featureFlags?: PopupFeatureFlags } | null | undefined,
  flagName: string,
): boolean {
  const featureFlags = view && typeof view.featureFlags === "object"
    ? view.featureFlags as PopupFeatureFlags
    : {};
  return Object.prototype.hasOwnProperty.call(FEATURE_FLAGS, flagName) &&
    featureFlags[flagName] === true;
}
