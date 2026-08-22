import React from "react";

import type { TransientToast } from "../../ui/toast-controller";

export type PopupToastProps = Readonly<{
  toast: TransientToast | null;
  onDismiss?: (id: number) => void;
}>;

export function PopupToast({ toast, onDismiss }: PopupToastProps) {
  if (!toast) {
    return null;
  }
  const urgent = toast.tone === "danger";
  return (
    <output
      className={`popup-toast popup-toast--${toast.tone === "warning" ? "warn" : toast.tone}`}
      role={urgent ? "alert" : "status"}
      aria-live={urgent ? "assertive" : "polite"}
      data-popup-toast={toast.tone}
      data-toast-id={toast.id}
    >
      <span>{toast.message}</span>
      {onDismiss ? (
        <button
          type="button"
          className="popup-toast__dismiss"
          aria-label="Close notification"
          data-popup-toast-close={toast.id}
          onClick={() => onDismiss(toast.id)}
        >
          ×
        </button>
      ) : null}
    </output>
  );
}
