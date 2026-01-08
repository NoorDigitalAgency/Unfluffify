/**
 * Holds the reference to the injected style and overlay elements.
 */
const freezer = {
    style: null,
    overlay: null,
    isFrozen: false
};

/**
 * Injects CSS to freeze page animations, transitions, and pointer events.
 * Adds an overlay to capture mouse events for the extension.
 * @param {function(Element): void} onElementHover - Callback function when an element is hovered.
 */
function freezePage(onElementHover) {
    if (freezer.isFrozen) return;

    // 1. Create and inject the style element to disable page interactions
    const css = `
        body, body * {
            pointer-events: none !important;
            animation-play-state: paused !important;
            animation-duration: 0s !important;
            transition-duration: 0s !important;
            transform: none !important;
            cursor: crosshair !important;
            user-select: none !important;
        }
    `;
    freezer.style = document.createElement('style');
    freezer.style.textContent = css;
    document.head.appendChild(freezer.style);

    // 2. Create the overlay
    freezer.overlay = document.createElement('div');
    freezer.overlay.id = 'gemini-page-freezer-overlay';
    Object.assign(freezer.overlay.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(0, 100, 255, 0.1)',
        zIndex: '2147483647', // Max z-index
        pointerEvents: 'auto', // It receives all pointer events
        cursor: 'crosshair'
    });
    document.body.appendChild(freezer.overlay);

    // 3. Implement hit testing on mouse move
    freezer.overlay.addEventListener('mousemove', (event) => {
        const underlyingElement = getElementUnderCursor(event);
        if (onElementHover && underlyingElement) {
            onElementHover(underlyingElement);
        }
    });

    freezer.isFrozen = true;
}

/**
 * Removes the freeze effect and the overlay.
 */
function unfreezePage() {
    if (!freezer.isFrozen) return;

    if (freezer.style && freezer.style.parentElement) {
        freezer.style.parentElement.removeChild(freezer.style);
    }
    if (freezer.overlay && freezer.overlay.parentElement) {
        freezer.overlay.parentElement.removeChild(freezer.overlay);
    }
    
    freezer.style = null;
    freezer.overlay = null;
    freezer.isFrozen = false;
}

/**
 * Identifies the element under the cursor by temporarily disabling the overlay's pointer events.
 * @param {MouseEvent} event The mouse event from the overlay.
 * @returns {Element | null} The element directly under the cursor.
 */
function getElementUnderCursor(event) {
    if (!freezer.overlay) return null;

    // Temporarily hide the overlay from pointer events
    freezer.overlay.style.pointerEvents = 'none';

    // Get the element at the cursor's position
    const element = document.elementFromPoint(event.clientX, event.clientY);

    // Immediately restore the overlay's pointer events
    freezer.overlay.style.pointerEvents = 'auto';

    // Don't return the overlay itself or the body/html
    if (element && element !== freezer.overlay && element.tagName !== 'BODY' && element.tagName !== 'HTML') {
        return element;
    }
    return null;
}
