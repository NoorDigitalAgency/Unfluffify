import React from "react";

import type { PopupPresentation } from "./organ/memory";

export type PopupActionAvailability = Readonly<{
  runAi?: boolean;
  save?: boolean;
  discard?: boolean;
  preview?: boolean;
}>;

export function resolvePopupActionButtons(presentation: PopupPresentation, availability: PopupActionAvailability) {
  return {
    compute: {
      disabled: presentation.runAiDisabled || !availability.runAi,
      blockedReason: presentation.runAiDisabled ? presentation.runAiBlockedReason : availability.runAi ? "" : "not-implemented",
    },
    save: {
      disabled: presentation.saveDisabled || !availability.save,
      blockedReason: presentation.saveDisabled ? presentation.saveBlockedReason : availability.save ? "" : "not-implemented",
    },
    discard: {
      disabled: presentation.discardDisabled || !availability.discard,
      blockedReason: presentation.discardDisabled ? presentation.discardBlockedReason : availability.discard ? "" : "not-implemented",
    },
    preview: {
      disabled: presentation.showPreviewDisabled || !availability.preview,
      blockedReason: presentation.showPreviewDisabled ? presentation.showPreviewBlockedReason : availability.preview ? "" : "not-implemented",
    },
  };
}

export function App({ presentation, onEnableChange, onRunAi, onSave, onDiscard, onPreview }: Readonly<{
  presentation: PopupPresentation;
  onEnableChange?: (enabled: boolean) => void;
  onRunAi?: () => void;
  onSave?: () => void;
  onDiscard?: () => void;
  onPreview?: () => void;
}>) {
  const buttons = resolvePopupActionButtons(presentation, {
    runAi: Boolean(onRunAi),
    save: Boolean(onSave),
    discard: Boolean(onDiscard),
    preview: Boolean(onPreview),
  });
  return (
    <main data-main-hidden={presentation.mainUiHidden}>
      {presentation.curtainVisible ? <section role="status">{presentation.curtainText}</section> : null}
      <button id="compute" disabled={buttons.compute.disabled} data-blocked-reason={buttons.compute.blockedReason} onClick={onRunAi}>Run AI</button>
      <button id="page-save" disabled={buttons.save.disabled} data-blocked-reason={buttons.save.blockedReason} onClick={onSave}>Save</button>
      <button id="page-revert" disabled={buttons.discard.disabled} data-blocked-reason={buttons.discard.blockedReason} onClick={onDiscard}>Discard</button>
      <button id="marking-preview" disabled={buttons.preview.disabled} data-blocked-reason={buttons.preview.blockedReason} onClick={onPreview}>Show Content List</button>
      <label>Enable Marking<input id="toggle-enabled" type="checkbox" checked={presentation.enableToggleChecked} onChange={(event) => onEnableChange?.(event.currentTarget.checked)} /></label>
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
