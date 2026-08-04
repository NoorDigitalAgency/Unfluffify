/** The popup's views, ported from the legacy client's Loading / Configuration /
 *  Marking model. Not every control belongs on every view: the configuration
 *  view is where a half-set-up extension is repaired, and showing marking
 *  controls there invites the operator to drive a session that cannot run. */
export type PopupView = "loading" | "configuration" | "marking";

export type PopupViewInput = Readonly<{
  /** The view the operator last asked for, if any. Null means "no preference". */
  requested: PopupView | null;
  /** False while the stored settings have not been read; nothing can be decided
   *  about completeness yet, so neither view would be honest. */
  settingsLoaded: boolean;
  /** Legacy's configurationComplete: the config endpoint, the AI endpoint, the
   *  stage base and a token — all four, or the extension cannot work. */
  configurationComplete: boolean;
  /** Set when configuration forced the view. It is what lets the popup snap back
   *  to marking the moment setup completes, instead of stranding the operator on
   *  a configuration screen they have just finished with. */
  configViewLocked: boolean;
}>;

export type PopupViewResolution = Readonly<{
  view: PopupView;
  configViewLocked: boolean;
}>;

export const DEFAULT_POPUP_VIEW: PopupView = "marking";

export function resolvePopupView(input: PopupViewInput): PopupViewResolution {
  if (!input.settingsLoaded) {
    // Keep the lock as it was: this is "not known yet", not "known incomplete".
    return { view: "loading", configViewLocked: input.configViewLocked };
  }
  if (!input.configurationComplete) {
    return { view: "configuration", configViewLocked: true };
  }
  if (input.configViewLocked) {
    // Setup just completed, so leave the screen the operator was forced onto.
    return { view: "marking", configViewLocked: false };
  }
  return { view: input.requested ?? DEFAULT_POPUP_VIEW, configViewLocked: false };
}
