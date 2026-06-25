import { describe, expect, it } from "vitest";

import { createBus } from "../common/bus/bus.js";
import { SPINNER_EVENT_TYPES } from "../common/bus/contracts/spinner.js";
import { REALMS } from "../common/bus/realms.js";
import { startContentLayerHost } from "../content/layers/layer-host.js";
import { getLatestContentSpinnerState } from "../content/layers/spinner-layer.js";

describe("content layer host", () => {
  it("keeps banner and page-curtain spinner state separated", async () => {
    const bus = createBus({
      realm: REALMS.CONTENT,
      transport: {
        async send() {
          return undefined;
        },
        onInbound() {},
        start() {},
        stop() {},
      },
    });

    const stop = startContentLayerHost(bus);

    await bus.publish(SPINNER_EVENT_TYPES.SET, {
      surface: "pageCurtain",
      state: { title: "Curtain" },
    }, { target: REALMS.CONTENT });
    await bus.publish(SPINNER_EVENT_TYPES.SET, {
      surface: "banner",
      state: { title: "Banner" },
    }, { target: REALMS.CONTENT });
    await bus.publish(SPINNER_EVENT_TYPES.CLEAR, {
      surface: "banner",
    }, { target: REALMS.CONTENT });

    expect(getLatestContentSpinnerState("pageCurtain")).toMatchObject({ title: "Curtain" });
    expect(getLatestContentSpinnerState("banner")).toBeNull();

    stop();
  });
});
