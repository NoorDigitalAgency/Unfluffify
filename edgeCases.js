/**
 * This file documents limitations and provides guidance for handling complex web page features.
 */

// ==============
// 1. Shadow DOM
// ==============
/*
Limitation:
Standard CSS selectors used by `document.querySelectorAll` do not cross Shadow DOM boundaries.
A selector generated for an element inside a shadow root will not be found from the main document.
Similarly, `document.elementFromPoint` can return the host of a shadow root, but not elements *inside* it directly if the shadow root is closed.

Solution / Workaround:
To properly support Shadow DOM, you must recursively traverse into shadow roots. `elementFromPoint` works well here because it can return the host element. You can then check if that host has a `shadowRoot` and repeat the process.

Example of a recursive elementFromPoint:
*/
function getElementFromPointDeep(x, y) {
    let element = document.elementFromPoint(x, y);
    while (element && element.shadowRoot) {
        const innerElement = element.shadowRoot.elementFromPoint(x, y);
        if (innerElement) {
            element = innerElement;
        } else {
            // elementFromPoint can return null if the point is outside the shadow viewport
            break; 
        }
    }
    return element;
}

/*
For selector generation, you would need to modify `generateSpecificStableSelector` to detect when it hits a shadow host and then prepend a special notation or handle it separately, which is highly complex. A simpler approach is to document that only elements in the main DOM are fully supported.
*/


// ============
// 2. Iframes
// ============
/*
Limitation:
Scripts are bound by the Same-Origin Policy. You cannot access the content of an iframe from a different origin.
`document.querySelectorAll` and other DOM methods only operate on the current document.

Solution / Workaround (Same-Origin Iframes only):
For iframes that share the same origin as the parent page, you can access their content. The extension's content script would need to be aware of iframes and potentially inject itself or a listener into each one.

Example of accessing same-origin iframes:
*/
function handleSameOriginIframes(callback) {
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
        try {
            // Accessing contentDocument will throw a security error for cross-origin iframes
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            if (iframeDoc) {
                // You are now in the context of the iframe's document.
                // You could re-run your logic here or pass messages.
                console.log('Found same-origin iframe:', iframeDoc.title);
                if (callback) {
                    callback(iframeDoc);
                }
            }
        } catch (e) {
            console.warn('Could not access cross-origin iframe:', iframe.src, e);
        }
    }
}


// ==========================
// 3. Single Page Applications (SPAs)
// ==========================
/*
Limitation:
SPAs change content dynamically without full page reloads. Selections and classifications made on one "page" will be lost after the user navigates.

Solution / Workaround:
You must listen for URL and DOM changes and re-apply your logic (e.g., re-run `updateAllClassifications`).

1. Listen for History Changes:
Standard navigation events like `popstate` (for browser back/forward buttons) and `hashchange` are a good start.
*/
window.addEventListener('popstate', () => {
    console.log('URL changed via popstate. Re-applying logic.');
    // Example: updateAllClassifications(allSelectorSets);
});
window.addEventListener('hashchange', () => {
    console.log('URL hash changed. Re-applying logic.');
    // Example: updateAllClassifications(allSelectorSets);
});

/*
2. Monkey-patch `history.pushState` and `history.replaceState`:
These methods are often used by SPA routers but don't fire events. You can wrap them to dispatch a custom event.
*/
const originalPushState = history.pushState;
history.pushState = function(...args) {
    originalPushState.apply(this, args);
    window.dispatchEvent(new Event('pushstate'));
};

window.addEventListener('pushstate', () => {
    console.log('URL changed via pushState. Re-applying logic.');
    // Example: updateAllClassifications(allSelectorSets);
});

/*
3. Use MutationObserver:
This is the most robust way to detect any significant change to the DOM, which is common during SPA navigation.
*/
const spaObserver = new MutationObserver((mutations) => {
    // A simple heuristic: if a lot of nodes are added/removed, it's likely a page change.
    for (const mutation of mutations) {
        if (mutation.addedNodes.length > 5 || mutation.removedNodes.length > 5) {
             console.log('Significant DOM change detected. Re-applying logic.');
             // Debounce this call in a real application
             // Example: debounceUpdate();
             return;
        }
    }
});

function observeSPARoutes() {
    spaObserver.observe(document.body, {
        childList: true,
        subtree: true
    });
}
// Call observeSPARoutes() when your extension initializes.
