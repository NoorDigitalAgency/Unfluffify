/// <reference types="chrome" />

export {};

declare global {
	interface Window {
		__UNFLUFFIFY_TOGGLE_PERF__?: boolean;
	}
}
