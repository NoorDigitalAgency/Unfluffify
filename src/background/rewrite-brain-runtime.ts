import { z } from "zod";

import { createKeepAliveController } from "./keepalive";
import { createRewriteBrain } from "./rewrite-brain";
import { BrainSensationSchema } from "./brain/fold";

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
}>;

export function createRewriteBrainRuntime(host: RuntimeHost) {
  const brains = new Map<number, ReturnType<typeof createRewriteBrain>>();
  const keepAlive = createKeepAliveController({
    createAlarm: host.createAlarm,
    clearAlarm: host.clearAlarm,
    addAlarmListener: host.addAlarmListener,
    holdMs: 30_000,
  });

  const getBrain = (tabId: number): ReturnType<typeof createRewriteBrain> => {
    let brain = brains.get(tabId);
    if (!brain) {
      brain = createRewriteBrain(tabId);
      brains.set(tabId, brain);
    }
    return brain;
  };

  const handle = (message: unknown, _sender?: unknown): unknown => {
    const parsed = RuntimeRequestSchema.safeParse(message);
    if (!parsed.success) {
      return undefined;
    }
    const request = parsed.data;
    if (request.type === "uf.rewriteBrain.observe") {
      const release = keepAlive.acquire("observe");
      try {
        return { ok: true, signals: getBrain(request.sensation.tabId).observe(request.sensation) };
      } finally {
        release();
      }
    }
    if (request.type === "uf.rewriteBrain.pull") {
      return {
        ok: true,
        signals: request.organId
          ? getBrain(request.tabId).pullForOrgan(request.organId, request.afterSeq)
          : getBrain(request.tabId).pullSignals(request.afterSeq),
      };
    }
    if (request.type === "uf.rewriteBrain.consume") {
      getBrain(request.tabId).markConsumed(request.organId, request.seq);
      return { ok: true };
    }
    return { ok: true, snapshot: getBrain(request.tabId).snapshot(), projection: getBrain(request.tabId).project() };
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
        sendResponse?.(result);
        return true;
      });
    },
    handle,
    getBrain,
    keepAlive,
  };
}

export type RewriteBrainRuntime = ReturnType<typeof createRewriteBrainRuntime>;
