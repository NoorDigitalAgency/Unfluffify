/// <reference types="chrome" />

export {};

declare global {
	// Build-time debug gate, defined by Vite (`__UF_DEBUG_BUILD__` in wxt.config.ts).
	// `false` in a plain production build; `true` only in a `UNFLUFFIFY_DEBUG=1` build.
	var __UF_DEBUG_BUILD__: boolean;
	interface Window {
		__UNFLUFFIFY_TOGGLE_PERF__?: boolean;
		__UNFLUFFIFY_POPUP_DEBUG__?: {
			getViewState?: () => Record<string, unknown>;
			directModeActive?: boolean;
			activateDirectMode?: () => void;
		};
	}
}
