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
      <label>Enable Marking<input id="toggle-enabled" type="checkbox" checked={presentation.enableToggleChecked} readOnly /></label>
      <label>Desktop Preview<input id="desktop-preview" type="checkbox" checked={presentation.desktopPreviewChecked} readOnly /></label>
      {presentation.countdownText ? <time data-run-countdown={presentation.countdownText}>{presentation.countdownText}</time> : null}
      {presentation.lockBanner.visible ? <aside data-lock-banner>{presentation.lockBanner.text}{presentation.lockBanner.countdownSeconds ? ` (${presentation.lockBanner.countdownSeconds})` : ""}</aside> : null}
      <section aria-label="Marked rows">
        {presentation.contentRows.map((row) => <div key={row.xpath} data-row-classification={row.classification}>{row.xpath}</div>)}
      </section>
      <section aria-label="AI selectors">
        {presentation.selectors.inclusionSelectors.map((selector) => <code key={`include:${selector}`} data-selector-kind="include">{selector}</code>)}
        {presentation.selectors.exclusionSelectors.map((selector) => <code key={`exclude:${selector}`} data-selector-kind="exclude">{selector}</code>)}
      </section>
      <output data-silent-mode={presentation.silentModeActive} data-temp-disabled={presentation.temporarilyDisabledOverlay} />
    </main>
  );
}
