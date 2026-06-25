/// <reference types="chrome" />

export {};

declare global {
	interface Window {
		__UNFLUFFIFY_TOGGLE_PERF__?: boolean;
		__UNFLUFFIFY_POPUP_DEBUG__?: {
			getViewState?: () => Record<string, unknown>;
		};
	}
}
