import { ui } from "./ui.js";
import { state } from "./state.js";

export function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    ui.toast.classList.remove("show");
  }, 1800);
}

export function setUiBusy(isBusy) {
  if (ui.uiCurtain) {
    ui.uiCurtain.hidden = !isBusy;
  }
  document.body.classList.toggle("is-busy", isBusy);
}

export function setConfigMenuOpen(open) {
  state.configMenuOpen = open;
  if (ui.configMenu) {
    ui.configMenu.hidden = !open;
  }
  if (ui.configToggle) {
    ui.configToggle.setAttribute("aria-expanded", open ? "true" : "false");
  }
}
