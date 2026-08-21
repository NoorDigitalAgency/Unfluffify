import type { TransientSurfaceManager } from "../../ui/transient-surface-manager";

export type MarkingMenuAction = Readonly<{
  id: "include" | "exclude" | "widen" | "clear";
  label: string;
  enabled: boolean;
  run: () => void;
}>;

/** One browser gesture may surface through more than one DOM event. */
export function createPhysicalActionDeduper() {
  const committed = new Set<string>();
  const order: string[] = [];
  const capacity = 32;
  return {
    accept(physicalId: number, targetKey: string, mode: string): boolean {
      const key = `${physicalId}\u0000${targetKey}\u0000${mode}`;
      if (committed.has(key)) {
        return false;
      }
      committed.add(key);
      order.push(key);
      if (order.length > capacity) {
        committed.delete(order.shift()!);
      }
      return true;
    },
  };
}

export function openMarkingContextMenu(options: Readonly<{
  document: Document;
  manager: TransientSurfaceManager;
  x: number;
  y: number;
  actions: readonly MarkingMenuAction[];
}>): () => void {
  const root = options.document.createElement("div");
  root.setAttribute("data-uf-extension-ui", "true");
  root.setAttribute("data-uf-marking-menu", "true");
  root.setAttribute("role", "menu");
  root.style.left = `${Math.max(8, Math.min(options.x, (options.document.documentElement.clientWidth || 320) - 174))}px`;
  root.style.top = `${Math.max(8, Math.min(options.y, (options.document.documentElement.clientHeight || 240) - 174))}px`;

  let closed = false;
  const remove = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    root.remove();
  };

  for (const action of options.actions) {
    const button = options.document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.setAttribute("data-uf-marking-menu-action", action.id);
    button.disabled = !action.enabled;
    button.textContent = action.label;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (action.enabled) {
        action.run();
      }
      close();
    });
    root.appendChild(button);
  }
  options.document.documentElement.appendChild(root);
  const surface = options.manager.open({
    id: "marking-context-menu",
    kind: "menu",
    root: () => root,
    outside: "dismiss",
    escape: "dismiss",
    dismiss: remove,
  });
  const close = (): void => {
    surface.close("context-change");
  };
  return close;
}
