import { describe, expect, it } from "vitest";

import {
  buildLoginBody,
  buildLoginEndpointFromStageBase,
  buildValidateEndpointFromStageBase,
} from "../../../src/lynx/accounts";

describe("P4 locked accounts shapes", () => {
  it("derives account endpoints from stage base and trims login email", () => {
    expect(buildValidateEndpointFromStageBase("a.lynxdev.se")).toBe(
      "https://accounts.a.lynxdev.se/api/account/validate",
    );
    expect(buildLoginEndpointFromStageBase("a.lynxdev.se")).toBe(
      "https://accounts.a.lynxdev.se/api/account/login",
    );
    expect(buildLoginBody(" user@example.com ", "pw")).toEqual({
      email: "user@example.com",
      password: "pw",
    });
  });
});
