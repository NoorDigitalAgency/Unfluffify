import { describe, expect, it } from "vitest";

import { createBus } from "../src/common/bus/bus.js";
import { SPINNER_EVENT_TYPES } from "../src/common/bus/contracts/spinner.js";
import { REALMS } from "../src/common/bus/realms.js";
import { startContentLayerHost } from "../src/content/layers/layer-host.js";
import { getLatestContentSpinnerState, setPageCurtainRenderer } from "../src/content/layers/spinner-layer.js";

describe("content layer host", () => {
  it("keeps banner and page-curtain spinner state separated", async () => {
    const bus = createBus({
      realm: REALMS.CONTENT,
      transport: {
        send() {
          return Promise.resolve(undefined);
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

  it("drives the page-curtain renderer from the brain pageCurtain broadcast", async () => {
    const calls: Array<{ visible: boolean; title: unknown }> = [];
    setPageCurtainRenderer((visible, state) => {
      calls.push({ visible, title: state ? state.title : null });
    });
    const bus = createBus({
      realm: REALMS.CONTENT,
      transport: {
        send() {
          return Promise.resolve(undefined);
        },
        onInbound() {},
        start() {},
        stop() {},
      },
    });
    const stop = startContentLayerHost(bus);

    await bus.publish(SPINNER_EVENT_TYPES.SET, {
      surface: "pageCurtain",
      state: { title: "Inspecting" },
    }, { target: REALMS.CONTENT });
    await bus.publish(SPINNER_EVENT_TYPES.CLEAR, {
      surface: "pageCurtain",
    }, { target: REALMS.CONTENT });

    expect(calls).toEqual([
      { visible: true, title: "Inspecting" },
      { visible: false, title: null },
    ]);

    setPageCurtainRenderer(null);
    stop();
  });
});
