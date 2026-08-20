import { describe, expect, it } from "vitest";

import { applicationContract } from "../src/messaging/realms";

describe("large cross-realm HTML transfer contract", () => {
  it("uses scoped integrity handles for offscreen refinement", () => {
    const handle = {
      id: "payload-1",
      scope: "xpath-refinement:run-1",
      sha256: "a".repeat(64),
      byteLength: 42,
    };
    const request = applicationContract.commands["offscreen.refineXpaths"].request.parse({
      renderedHtmlRef: handle,
      rawHtmlRef: { ...handle, id: "payload-2", sha256: "b".repeat(64) },
      rows: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }],
    });

    expect(request).toMatchObject({ renderedHtmlRef: handle });
    expect(() => applicationContract.commands["offscreen.refineXpaths"].request.parse({
      renderedHtml: "<html>large payload must not cross this boundary</html>",
      rows: [],
    })).toThrow();
  });

  it("types repository put/get/release commands without exposing raw HTML in a handle", () => {
    const put = applicationContract.commands["transferPayload.put"].request.parse({
      scope: "xpath-refinement:run-1",
      value: "<html>captured once</html>",
    });
    expect(put.value).toContain("captured once");

    const handle = applicationContract.commands["transferPayload.put"].response.parse({
      handle: {
        id: "payload-1",
        scope: put.scope,
        sha256: "c".repeat(64),
        byteLength: 26,
      },
    }).handle;
    expect(handle).not.toHaveProperty("value");
    expect(applicationContract.commands["transferPayload.get"].request.parse({ handle })).toEqual({ handle });
    expect(applicationContract.commands["transferPayload.release"].request.parse({ scope: put.scope })).toEqual({ scope: put.scope });
  });
});
