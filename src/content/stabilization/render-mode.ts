export type RenderModeInspectionInput = Readonly<{
  captureRenderedHtml: () => Promise<string> | string;
  reloadWithoutJavascript: () => Promise<void> | void;
  captureStaticHtml: () => Promise<string> | string;
  restoreJavascript: () => Promise<void> | void;
  deviceSimulationEnabled: boolean;
}>;

export type RenderModeInspectionResult = Readonly<{
  renderedHtml: string;
  rawHtml: string;
  deviceSimulationEnabled: boolean;
  reclaimLockAfterReload: true;
}>;

export async function inspectRenderMode(input: RenderModeInspectionInput): Promise<RenderModeInspectionResult> {
  const renderedHtml = await input.captureRenderedHtml();
  let rawHtml: string;
  try {
    await input.reloadWithoutJavascript();
    rawHtml = await input.captureStaticHtml();
  } finally {
    await input.restoreJavascript();
  }
  return {
    renderedHtml,
    rawHtml,
    deviceSimulationEnabled: input.deviceSimulationEnabled,
    reclaimLockAfterReload: true,
  };
}
