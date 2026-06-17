// Minimal local declarations for the vendored Preact build. The popup uses
// hyperscript `h(...)` calls (not JSX); the official Preact types route these
// to a generic overload that provides no contextual typing for callbacks, so a
// lightweight permissive shim is the pragmatic fit here.
export const Fragment: unique symbol;

export function h(type: any, props?: any, ...children: any[]): any;

export function render(vnode: any, parent: Element | DocumentFragment): void;
