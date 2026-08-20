export type ActionIconState = "unregistered" | "connecting" | "active" | "locked" | "attention";

type ActionDetails = Readonly<{ tabId: number }>;
type ActionIconApi = Readonly<{
  setIcon?: (details: ActionDetails & { path: Readonly<Record<string, string>> }) => Promise<void> | void;
  setBadgeText?: (details: ActionDetails & { text: string }) => Promise<void> | void;
  setBadgeBackgroundColor?: (details: ActionDetails & { color: string }) => Promise<void> | void;
  setTitle?: (details: ActionDetails & { title: string }) => Promise<void> | void;
}>;

const DEFAULT_ICON = Object.freeze({
  16: "icons/default/icon16.png",
  32: "icons/default/icon32.png",
  48: "icons/default/icon48.png",
  128: "icons/default/icon128.png",
});

const ACTIVE_ICON = Object.freeze({
  16: "icons/active/icon16.png",
  32: "icons/active/icon32.png",
  48: "icons/active/icon48.png",
  128: "icons/active/icon128.png",
});

const PRESENTATION: Readonly<Record<ActionIconState, Readonly<{
  path: Readonly<Record<string, string>>;
  badge: string;
  color: string;
  title: string;
}>>> = {
  unregistered: { path: DEFAULT_ICON, badge: "", color: "#64748b", title: "Unfluffify — not registered on this tab" },
  connecting: { path: DEFAULT_ICON, badge: "…", color: "#2563eb", title: "Unfluffify — connecting" },
  active: { path: ACTIVE_ICON, badge: "", color: "#16a34a", title: "Unfluffify — active" },
  locked: { path: DEFAULT_ICON, badge: "L", color: "#d97706", title: "Unfluffify — property locked" },
  attention: { path: DEFAULT_ICON, badge: "!", color: "#dc2626", title: "Unfluffify — attention needed" },
};

export function actionIconStateForContext(status: string): ActionIconState {
  if (status === "managed_candidate" || status === "managed_non_candidate") {
    return "active";
  }
  if (status === "unmanaged" || status === "environment_not_registered") {
    return "unregistered";
  }
  return "attention";
}

export function createActionIconController(api: ActionIconApi | null | undefined) {
  const stateByTab = new Map<number, ActionIconState>();
  return {
    state(tabId: number): ActionIconState {
      return stateByTab.get(tabId) ?? "unregistered";
    },
    async apply(tabId: number, state: ActionIconState): Promise<void> {
      if (tabId <= 0 || stateByTab.get(tabId) === state) {
        return;
      }
      stateByTab.set(tabId, state);
      const presentation = PRESENTATION[state];
      await Promise.all([
        Promise.resolve(api?.setIcon?.({ tabId, path: presentation.path })),
        Promise.resolve(api?.setBadgeText?.({ tabId, text: presentation.badge })),
        Promise.resolve(api?.setBadgeBackgroundColor?.({ tabId, color: presentation.color })),
        Promise.resolve(api?.setTitle?.({ tabId, title: presentation.title })),
      ]);
    },
    forget(tabId: number): void {
      stateByTab.delete(tabId);
    },
  };
}
