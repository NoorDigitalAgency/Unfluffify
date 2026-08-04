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

/** Loads the tab with JavaScript on or off so the operator can compare the two
 *  views and decide the render mode themselves. Their eyes are the judge here —
 *  there is no automated verdict to second-guess. */
export async function loadPageWithJavascript(
  client: RenderModeCdpClient,
  reload: () => Promise<void> | void,
  javascriptEnabled: boolean,
): Promise<void> {
  await client.send("Emulation.setScriptExecutionDisabled", { value: !javascriptEnabled });
  await reload();
}

