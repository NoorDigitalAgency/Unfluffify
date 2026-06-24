export const REALMS = Object.freeze({
  BACKGROUND: "background",
  CONTENT: "content",
  POPUP: "popup",
  PAGE: "page",
} as const);

export const BUS_BROADCAST_TARGET = "broadcast" as const;

export type Realm = typeof REALMS[keyof typeof REALMS];
export type BusTarget = Realm | typeof BUS_BROADCAST_TARGET;

export function isRealm(value: unknown): value is Realm {
  return value === REALMS.BACKGROUND
    || value === REALMS.CONTENT
    || value === REALMS.POPUP
    || value === REALMS.PAGE;
}

export function normalizeTarget(value: unknown): BusTarget | null {
  if (value === BUS_BROADCAST_TARGET) {
    return BUS_BROADCAST_TARGET;
  }
  return isRealm(value) ? value : null;
}
