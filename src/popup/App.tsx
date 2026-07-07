import React from "react";

import type { PopupPresentation } from "./organ/memory";

export function App({ presentation }: Readonly<{ presentation: PopupPresentation }>) {
  return (
    <main data-main-hidden={presentation.mainUiHidden}>
      {presentation.curtainVisible ? <section role="status">{presentation.curtainText}</section> : null}
      <button id="compute" disabled={presentation.runAiDisabled} data-blocked-reason={presentation.runAiDisabled ? presentation.runAiBlockedReason : ""}>Run AI</button>
      <button id="page-save" disabled={presentation.saveDisabled} data-blocked-reason={presentation.saveDisabled ? presentation.saveBlockedReason : ""}>Save</button>
      <button id="page-revert" disabled={presentation.discardDisabled} data-blocked-reason={presentation.discardDisabled ? presentation.discardBlockedReason : ""}>Discard</button>
      <button id="marking-preview" disabled={presentation.showPreviewDisabled} data-blocked-reason={presentation.showPreviewDisabled ? presentation.showPreviewBlockedReason : ""}>Show Content List</button>
      <output data-silent-mode={presentation.silentModeActive} data-temp-disabled={presentation.temporarilyDisabledOverlay} />
    </main>
  );
}
