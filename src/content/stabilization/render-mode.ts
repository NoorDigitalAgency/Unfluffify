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

export type RenderModeCdpClient = Readonly<{
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}>;

export async function reloadWithoutJavascriptViaCdp(
  client: RenderModeCdpClient,
  reload: () => Promise<void> | void,
): Promise<void> {
  await client.send("Emulation.setScriptExecutionDisabled", { value: true });
  await reload();
}

export async function restoreJavascriptViaCdp(client: RenderModeCdpClient): Promise<void> {
  await client.send("Emulation.setScriptExecutionDisabled", { value: false });
}

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
