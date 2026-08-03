import { describe, expect, it } from "vitest";

import { createRealmBus } from "../../../src/messaging/realms";
import { CommandEnvelopeSchema, FactEnvelopeSchema, SignalFrameSchema } from "../../../src/messaging/contracts";
import { applicationContract } from "../../../src/messaging/realms";

describe("corrective messaging application contracts", () => {
  it("validates command, fact, and signal envelopes", () => {
    expect(CommandEnvelopeSchema.parse({
      kind: "uf-command/1",
      name: "marking.enable",
      tabId: 1,
      payload: {},
    })).toMatchObject({ name: "marking.enable" });
    expect(FactEnvelopeSchema.parse({
      kind: "uf-fact/1",
      sensation: {
        tabId: 1,
        source: "content",
        reason: "status",
        facts: { tabId: 1, markingEnabled: true },
      },
    })).toMatchObject({ kind: "uf-fact/1" });
    expect(SignalFrameSchema.parse({
      kind: "uf-signal/1",
      tabId: 1,
      seq: 1,
      name: "marking.enabled",
      source: "brain",
      cause: "activate-ok",
      at: 1,
      payload: { baseUrl: "https://example.com" },
    })).toMatchObject({ name: "marking.enabled" });
  });

  it("creates realm bus factories over the application contract", async () => {
    const bus = createRealmBus({ realm: "background" });
    bus.onCommand("command.dispatch", () => ({ ok: true, data: { accepted: true } }));

    await expect(bus.request("command.dispatch", {
      kind: "uf-command/1",
      name: "marking.enable",
      tabId: 1,
      payload: {},
    })).resolves.toEqual({ ok: true, data: { ok: true, data: { accepted: true } } });
  });

  it("carries connection settings over the bus and rejects non-URL endpoints", () => {
    const save = applicationContract.commands["settings.save"];

    expect(save.request.parse({
      configEndpoint: "https://config.example.com/",
      aiEndpoint: "https://ai.example.com/",
      stageBase: "stage.example.com",
      token: "tok_abc",
    })).toMatchObject({ stageBase: "stage.example.com" });
    // Omitted, not blank: a cleared input must drop the key so the transport
    // falls back to "endpoint_unconfigured" instead of a malformed base URL.
    expect(save.request.parse({})).toEqual({});
    expect(save.request.safeParse({ configEndpoint: "" }).success).toBe(false);
    expect(save.request.safeParse({ aiEndpoint: "not-a-url" }).success).toBe(false);
    expect(applicationContract.commands["settings.load"].response.safeParse({ settings: {} }).success).toBe(true);
  });

  it("allows initial signal cursor pulls from afterSeq zero", () => {
    expect(applicationContract.commands["signals.pull"].request.parse({
      tabId: 1,
      afterSeq: 0,
      organId: "popup",
    })).toEqual({
      tabId: 1,
      afterSeq: 0,
      organId: "popup",
    });
  });
});
