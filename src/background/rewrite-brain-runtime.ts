import { z } from "zod";

import { createKeepAliveController } from "./keepalive";
import { createRewriteBrain } from "./rewrite-brain";
import { BrainSensationSchema } from "./brain/fold";
import type { TabFacts } from "../domain/schema/facts";

const RuntimeRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("uf.rewriteBrain.observe"),
    sensation: BrainSensationSchema,
  }),
  z.object({
    type: z.literal("uf.rewriteBrain.pull"),
    tabId: z.number().int().nonnegative(),
    afterSeq: z.number().int().nonnegative(),
    organId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("uf.rewriteBrain.consume"),
    tabId: z.number().int().nonnegative(),
    organId: z.string().min(1),
    seq: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("uf.rewriteBrain.snapshot"),
    tabId: z.number().int().nonnegative(),
  }),
]);

export type RewriteBrainRuntimeRequest = z.infer<typeof RuntimeRequestSchema>;

export type RuntimeHost = Readonly<{
  addMessageListener(listener: (message: unknown, sender?: unknown, sendResponse?: (response: unknown) => void) => unknown): void;
  createAlarm?: (name: string, info: { periodInMinutes: number }) => void | Promise<void>;
  clearAlarm?: (name: string) => void | Promise<void>;
  addAlarmListener?: (listener: (alarm: { name?: string }) => void) => void;
  rehydrateDurableFacts?: (tabId: number) => Promise<TabFacts | null>;
}>;

export function createRewriteBrainRuntime(host: RuntimeHost) {
  const brains = new Map<number, Promise<ReturnType<typeof createRewriteBrain>>>();
  const keepAlive = createKeepAliveController({
    createAlarm: host.createAlarm,
    clearAlarm: host.clearAlarm,
    addAlarmListener: host.addAlarmListener,
    holdMs: 30_000,
  });

  /** One tab gets one construction promise. Concurrent first messages all wait
   *  on the same durable read, so none can fold against an empty brain while a
   *  sibling request is still restoring the prior signal head. */
  const getBrain = (tabId: number): Promise<ReturnType<typeof createRewriteBrain>> => {
    let pending = brains.get(tabId);
    if (!pending) {
      pending = (async () => createRewriteBrain(
        tabId,
        await host.rehydrateDurableFacts?.(tabId) ?? null,
      ))();
      brains.set(tabId, pending);
      void pending.catch(() => {
        if (brains.get(tabId) === pending) {
          brains.delete(tabId);
        }
      });
    }
    return pending;
  };

  const handle = (message: unknown, _sender?: unknown): Promise<unknown> | undefined => {
    const parsed = RuntimeRequestSchema.safeParse(message);
    if (!parsed.success) {
      return undefined;
    }
    const request = parsed.data;
    return (async () => {
      if (request.type === "uf.rewriteBrain.observe") {
        const release = keepAlive.acquire("observe");
        try {
          const brain = await getBrain(request.sensation.tabId);
          return { ok: true, signals: brain.observe(request.sensation) };
        } finally {
          release();
        }
      }
      const brain = await getBrain(request.tabId);
      if (request.type === "uf.rewriteBrain.pull") {
        return {
          ok: true,
          signals: request.organId
            ? brain.pullForOrgan(request.organId, request.afterSeq)
            : brain.pullSignals(request.afterSeq),
        };
      }
      if (request.type === "uf.rewriteBrain.consume") {
        brain.markConsumed(request.organId, request.seq);
        return { ok: true };
      }
      return { ok: true, snapshot: brain.snapshot(), projection: brain.project() };
    })();
  };

  return {
    start(): void {
      keepAlive.clearIfIdle();
      host.addAlarmListener?.((alarm) => keepAlive.handleAlarm(alarm));
      host.addMessageListener((message, _sender, sendResponse) => {
        const result = handle(message, _sender);
        if (result === undefined) {
          return undefined;
        }
        void result.then(
          (response) => sendResponse?.(response),
          () => sendResponse?.({ ok: false, error: "brain-rehydrate-failed" }),
        );
        return true;
      });
    },
    handle,
    getBrain,
    keepAlive,
  };
}

export type RewriteBrainRuntime = ReturnType<typeof createRewriteBrainRuntime>;
