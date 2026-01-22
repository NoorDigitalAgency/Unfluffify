export const TAB_STATE_PREFIX = "tabState:";
export const DEVICE_EMULATION_PREFIX = "deviceEmulation:";
export const SCRIPT_INJECTED_PREFIX = "scriptInjected:";

export const DEVICE_SCALE_DEFAULTS = {
  desktop: 0.7,
  mobile: 0.85
};

export const DEVICE_EMULATION_PRESETS = {
  desktop: {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false
  },
  mobile: {
    width: 412,
    height: 960,
    deviceScaleFactor: 1,
    mobile: true
  }
};
