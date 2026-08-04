/** The popup's views, ported from the legacy client. Not every control belongs on
 *  every view: the configuration view is where a half-set-up extension is
 *  repaired, the render-mode view is where the one fact every capture depends on
 *  gets established, and the two session views differ in what they can even do —
 *  so showing all of them at once invites the operator to drive a session that
 *  cannot run.
 *
 *  Legacy carried the same five presentations under three `View` values, with the
 *  last three separated inside the Marking view by `renderModeSectionVisible`,
 *  `mainUiHidden` and `silentModeActive`. Naming all five makes the separation a
 *  single value to resolve, assert and style, rather than three flags that can
 *  contradict each other. */
export type PopupView = "loading" | "configuration" | "render-mode" | "marking" | "silent";

/** The views an operator can ask for. The rest are derived: whether the render
 *  mode is established and whether the session is silent are facts about the
 *  session, not preferences. */
export type PopupViewRequest = "configuration" | "marking" | "render-mode";

export type PopupViewInput = Readonly<{
  /** The view the operator last asked for, if any. Null means "no preference". */
  requested: PopupViewRequest | null;
  /** False while the stored settings have not been read; nothing can be decided
   *  about completeness yet, so no other view would be honest. */
  settingsLoaded: boolean;
  /** Legacy's configurationComplete: the config endpoint, the AI endpoint, the
   *  stage base and a token — all four, or the extension cannot work. */
  configurationComplete: boolean;
  /** Set when configuration forced the view. It is what lets the popup snap back
   *  to the session the moment setup completes, instead of stranding the operator
   *  on a configuration screen they have just finished with. */
  configViewLocked: boolean;
  /** False until the operator has established the render mode. Legacy gated every
   *  marking control on this and showed only the render-mode editor. */
  renderModeSet: boolean;
  /** The session is running silently: stored selectors are applied to the page
   *  and there is no marking to Run AI over, Save or Discard. */
  silentModeActive: boolean;
}>;

export type PopupViewResolution = Readonly<{
  view: PopupView;
  configViewLocked: boolean;
}>;

export const DEFAULT_POPUP_VIEW: PopupView = "marking";

/** Which of the three session views applies. Nothing here is a preference except
 *  a deliberate return to the render mode: the rest follows from the session. */
function resolveSessionView(input: PopupViewInput): PopupView {
  // The render mode is what every later capture and AI submission is taken as,
  // so until it is established there is nothing else worth showing — and the
  // operator can come back to change it.
  if (!input.renderModeSet || input.requested === "render-mode") {
    return "render-mode";
  }
  return input.silentModeActive ? "silent" : "marking";
}

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
    return { view: resolveSessionView(input), configViewLocked: false };
  }
  if (input.requested === "configuration") {
    return { view: "configuration", configViewLocked: false };
  }
  return { view: resolveSessionView(input), configViewLocked: false };
}
