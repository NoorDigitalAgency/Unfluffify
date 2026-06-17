type PageToastWindow = {
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
  setTimeout: (fn: () => void, ms?: number) => ReturnType<typeof setTimeout>;
};

type PageToastDeps = {
  getDocument?: () => Document | null;
  getWindow?: () => PageToastWindow | null;
  PAGE_TOAST_STYLE_ID: string;
  PAGE_TOAST_ID: string;
  EXTENSION_UI_FONT_STACK: string;
  TOAST_VISIBLE_MS: unknown;
};

export function createPageToast(deps: PageToastDeps) {
  let toastTimer: ReturnType<typeof setTimeout> | 0 = 0;

  const getDocument = () => {
    if (typeof deps.getDocument === "function") {
      return deps.getDocument();
    }
    return globalThis.document || null;
  };

  const getWindow = (): PageToastWindow | null => {
    if (typeof deps.getWindow === "function") {
      return deps.getWindow();
    }
    return globalThis.window || null;
  };

  function ensureStyle() {
    const documentRef = getDocument();
    if (!documentRef) {
      return;
    }
    if (documentRef.getElementById(deps.PAGE_TOAST_STYLE_ID)) {
      return;
    }

    const style = documentRef.createElement("style");
    style.id = deps.PAGE_TOAST_STYLE_ID;
    style.textContent = `
      #${deps.PAGE_TOAST_ID} {
        position: fixed;
        left: 14px;
        right: 14px;
        top: 14px;
        padding: 10px 12px;
        background: rgba(47, 42, 36, 0.9);
        color: #fdf6ed;
        font-family: ${deps.EXTENSION_UI_FONT_STACK};
        font-size: 12px;
        border-radius: 10px;
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 0.2s ease, transform 0.2s ease;
        pointer-events: none;
        z-index: 2147483646;
        text-align: center;
        box-shadow: 0 8px 10px rgba(0, 0, 0, 0.35);
      }
      #${deps.PAGE_TOAST_ID}.uf-toast-show {
        opacity: 1;
        transform: translateY(0);
      }
    `;
    (documentRef.head || documentRef.documentElement).appendChild(style);
  }

  function show(message: string): void {
    const documentRef = getDocument();
    const windowRef = getWindow();
    if (!documentRef || !windowRef) {
      return;
    }

    ensureStyle();

    let toast = documentRef.getElementById(deps.PAGE_TOAST_ID);
    if (!toast) {
      toast = documentRef.createElement("div");
      toast.id = deps.PAGE_TOAST_ID;
      toast.setAttribute("data-uf-extension-ui", "true");
      (documentRef.body || documentRef.documentElement).appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add("uf-toast-show");
    if (toastTimer) {
      windowRef.clearTimeout(toastTimer as ReturnType<typeof setTimeout>);
    }
    const toastVisibleMs = Number.isFinite(deps.TOAST_VISIBLE_MS)
      ? (deps.TOAST_VISIBLE_MS as number)
      : 3000;
    toastTimer = windowRef.setTimeout(() => {
      if (toast) {
        toast.classList.remove("uf-toast-show");
      }
    }, toastVisibleMs);
  }

  function getStripSelectors() {
    return [
      `#${deps.PAGE_TOAST_ID}`,
      `#${deps.PAGE_TOAST_STYLE_ID}`
    ];
  }

  return {
    ensureStyle,
    getStripSelectors,
    show
  };
}
