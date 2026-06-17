// @ts-nocheck
export const PAGE_WORLD_COMMANDS = Object.freeze({
  ARM: "PAGE_WORLD_ARM",
  SET_MOTION_PAUSED: "PAGE_WORLD_SET_MOTION_PAUSED",
  SET_LAZY_LOADING_SUPPRESSED: "PAGE_WORLD_SET_LAZY_LOADING_SUPPRESSED",
  DESTROY: "PAGE_WORLD_DESTROY"
});

export const PAGE_WORLD_RELAY_CHANNEL = "unfluffify:page-world-relay:v1";

export const PAGE_WORLD_RELAY_MESSAGE_KINDS = Object.freeze({
  REQUEST: "request",
  RESPONSE: "response"
});

export const PAGE_WORLD_RELAY_ALLOWED_COMMANDS = Object.freeze(new Set([
  PAGE_WORLD_COMMANDS.ARM,
  PAGE_WORLD_COMMANDS.SET_MOTION_PAUSED,
  PAGE_WORLD_COMMANDS.SET_LAZY_LOADING_SUPPRESSED,
  PAGE_WORLD_COMMANDS.DESTROY
]));

export function isPageWorldRelayCommand(value) {
  return typeof value === "string" && PAGE_WORLD_RELAY_ALLOWED_COMMANDS.has(value);
}