// Minimal local declarations for the vendored Preact build. The popup uses
// hyperscript `h(...)` calls (not JSX). This shim provides precise contextual
// typing for event callbacks and component props without the overhead of the
// official Preact types.

export const Fragment: unique symbol;

export type ComponentChild = VNode<any> | string | number | boolean | null | undefined;
export type ComponentChildren = ComponentChild[] | ComponentChild;

export interface VNode<P = any> {
	type: ComponentType<P> | string | typeof Fragment;
	props: P & { children?: ComponentChildren };
	key?: string | number | null;
}

export type FunctionComponent<P = {}> = (props: P) => VNode<any> | null;
export type ComponentType<P = {}> = FunctionComponent<P>;

// Curated HTML properties to enable contextual typing for common Preact event callbacks
export type DOMProps<Target extends HTMLElement> = Partial<Omit<Target, "style" | "children">> & {
	class?: string;
	className?: string;
	style?: string | Partial<CSSStyleDeclaration>;
	onClick?: (e: MouseEvent & { currentTarget: Target }) => void;
	onInput?: (e: Event & { currentTarget: Target }) => void;
	onChange?: (e: Event & { currentTarget: Target }) => void;
	onKeyDown?: (e: KeyboardEvent & { currentTarget: Target }) => void;
	onKeyUp?: (e: KeyboardEvent & { currentTarget: Target }) => void;
	onSubmit?: (e: SubmitEvent & { currentTarget: Target }) => void;
	// Fallback for custom elements, data-*, aria-*, and unmapped events
	[key: `data-${string}`]: string | boolean | undefined;
	[key: `aria-${string}`]: string | boolean | undefined;
	[key: string]: any;
};

// 1. Overload for Functional Components (infers props structurally)
export function h<P>(
	type: FunctionComponent<P>,
	props?: (P & { key?: string | number }) | null,
	...children: ComponentChildren[]
): VNode<P>;

// 2. Overload for built-in HTML Elements (provides contextual callback typing)
export function h<K extends keyof HTMLElementTagNameMap>(
	type: K,
	props?: DOMProps<HTMLElementTagNameMap[K]> | null,
	...children: ComponentChildren[]
): VNode<any>;

// 3. Overload for Fragment
export function h(
	type: typeof Fragment,
	props?: { key?: string | number } | null,
	...children: ComponentChildren[]
): VNode<any>;

// 4. Permissive fallback
export function h(type: any, props?: any, ...children: any[]): VNode<any>;

export function render(
	vnode: ComponentChild,
	parent: Element | DocumentFragment | ShadowRoot
): void;
