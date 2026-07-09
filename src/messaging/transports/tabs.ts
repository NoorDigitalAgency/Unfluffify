import { BusFrameSchema, type BusFrame } from "../contract";
import type { Transport, Unsubscribe } from "../bus";

type TabsLike = Readonly<{
  sendMessage(tabId: number, message: unknown): Promise<unknown> | unknown;
}>;

function parseFrame(message: unknown): BusFrame | null {
  const parsed = BusFrameSchema.safeParse(message);
  return parsed.success ? parsed.data : null;
}

export function createTabTransport(tabs: TabsLike, tabId: number): Transport {
  return {
    async send(frame: BusFrame): Promise<BusFrame | void> {
      const response = await tabs.sendMessage(tabId, frame);
      return parseFrame(response) ?? undefined;
    },
    onReceive(): Unsubscribe {
      return () => undefined;
    },
  };
}
