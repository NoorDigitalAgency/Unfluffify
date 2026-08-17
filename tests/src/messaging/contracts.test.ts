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
    })).toMatchObject({ stageBase: "stage.example.com" });
    // Omitted, not blank: a cleared input must drop the key so the transport
    // falls back to "endpoint_unconfigured" instead of a malformed base URL.
    expect(save.request.parse({})).toEqual({});
    expect(save.request.safeParse({ configEndpoint: "" }).success).toBe(false);
    expect(save.request.safeParse({ aiEndpoint: "not-a-url" }).success).toBe(false);
  });

  it("keeps the JWT off the settings commands entirely", () => {
    // The token is owned by the login flow. A settings write that could carry
    // one could also drop one, so the field must not exist on this surface.
    const save = applicationContract.commands["settings.save"];
    const load = applicationContract.commands["settings.load"];

    expect(save.request.parse({ stageBase: "stage.example.com", token: "tok_abc" }))
      .toEqual({ stageBase: "stage.example.com" });
    expect(save.response.safeParse({ status: "ok", settings: {}, hasToken: true }).success).toBe(true);
    expect(load.response.safeParse({ settings: {}, hasToken: false }).success).toBe(true);
    // hasToken is how the popup learns about the credential — it is required.
    expect(load.response.safeParse({ settings: {} }).success).toBe(false);
    expect(load.response.parse({ settings: { token: "tok_abc" }, hasToken: true }))
      .toEqual({ settings: {}, hasToken: true });
  });

  it("accepts the accounts login, logout and validate commands", () => {
    const login = applicationContract.commands["accounts.login"];

    expect(login.request.parse({ email: "user@example.com", password: "pw" }))
      .toEqual({ email: "user@example.com", password: "pw" });
    expect(login.request.safeParse({ email: "", password: "pw" }).success).toBe(false);
    expect(login.request.safeParse({ email: "user@example.com", password: "" }).success).toBe(false);
    // The reply never carries the token — it is stored background-side.
    expect(login.response.parse({ status: "ok", token: "tok_abc" })).toEqual({ status: "ok" });
    expect(login.response.safeParse({ status: "rejected", httpStatus: 401, message: "Bad password" }).success).toBe(true);
    expect(applicationContract.commands["accounts.validate"].response.safeParse({ status: "invalid", httpStatus: 401 }).success).toBe(true);
    expect(applicationContract.commands["accounts.logout"].response.safeParse({ status: "ok" }).success).toBe(true);
  });

  it("allows initial signal cursor pulls from afterSeq zero", () => {
    expect("signals.emit" in applicationContract.commands).toBe(false);
    expect("signal.emitted" in applicationContract.events).toBe(false);
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

  it("scopes AI resume to environment-authoritative site identity and a relative page key", () => {
    const resume = applicationContract.commands["ai.resume"];

    expect(resume.request.parse({ tabId: 7, siteId: 42, pageKey: "/jobs/123?lang=sv" }))
      .toEqual({ tabId: 7, siteId: 42, pageKey: "/jobs/123?lang=sv" });
    expect(resume.request.safeParse({
      tabId: 7,
      siteId: 42,
      pageKey: "https://www.example.com/jobs/123",
    }).success).toBe(false);
    expect(resume.response.safeParse({
      status: "fresh",
      sessionId: "backend-run-1",
      clientRunId: "popup-run-1",
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
    }).success).toBe(true);
  });

  it("carries canonical Todo coverage and explicit feed refresh over page.context", () => {
    const context = applicationContract.commands["page.context"];

    expect(context.request.parse({ tabId: 7, pageUrl: "https://example.com/detail", refresh: true }))
      .toEqual({ tabId: 7, pageUrl: "https://example.com/detail", refresh: true });
    expect(context.response.safeParse({
      status: "managed_candidate",
      generation: 2,
      observedUrl: "https://example.com/detail",
      draftDisposition: "preserve",
      environmentKey: "stage.example.com",
      siteId: 42,
      baseUrl: "https://example.com",
      pageKey: "/detail",
      pageTypes: [{ pageType: "detail", pages: [{ pageKey: "/detail", wordsCount: 100 }] }],
      membershipFingerprint: "membership",
      assignmentFingerprint: "assignment",
      conflicts: [],
      upstreamCode: null,
      renderModeSet: true,
      todo: {
        covered: 1,
        actionable: 1,
        pageTypes: [{
          pageType: "detail",
          markedCount: 3,
          current: true,
          candidates: [{ pageKey: "/detail", wordsCount: 100, marked: true, current: true }],
        }],
      },
    }).success).toBe(true);
  });

  it("requires fenced Hub publication and an authoritative snapshot for definitive outcomes", () => {
    const publish = applicationContract.commands["config.publish"];
    const request = {
      operationId: "publish-1",
      environmentKey: "stage.example.com",
      siteId: 42,
      editorSessionId: "editor-1",
      lockToken: "lock-1",
      expectedPropertyRevision: 4,
      expectedFeedRevision: 2,
      expectedSelectorsFingerprint: "a".repeat(64),
    };

    expect(publish.request.parse(request)).toEqual(request);
    expect(publish.request.safeParse({ ...request, expectedSelectorsFingerprint: "not-a-hash" }).success).toBe(false);
    expect(publish.response.safeParse({ status: "published" }).success).toBe(false);
    expect(publish.response.safeParse({
      status: "publication_unknown",
      httpStatus: 409,
      reason: "response lost",
    }).success).toBe(true);
  });
});
