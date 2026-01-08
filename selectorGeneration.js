/**
 * Heuristic to determine if a class name is likely unstable (e.g., auto-generated, hashed).
 * @param {string} className The class name to check.
 * @returns {boolean} True if the class is considered unstable.
 */
function isUnstableClass(className) {
    // Very long classes are suspicious
    if (className.length > 20) return true;
    // Classes with numbers are often dynamic
    if (/\d/.test(className)) return true;
    // Common patterns for generated classes (e.g., BEM-like with hashes, css-modules)
    if (className.includes('__') || className.includes('--') || className.includes('_')) return true;
    // Non-alphanumeric but allowing dashes
    if (/[^a-zA-Z0-9-]/.test(className)) return true;
    return false;
}

/**
 * Counts how many elements on the page match a given selector.
 * @param {string} selector The CSS selector to count.
 * @returns {number} The number of matching elements.
 */
function matchCount(selector) {
    try {
        return document.querySelectorAll(selector).length;
    } catch (e) {
        return Infinity; // Invalid selector
    }
}

/**
 * Checks if a selector uniquely identifies the given element.
 * @param {string} selector The CSS selector to test.
 * @param {Element} element The target element.
 * @returns {boolean} True if the selector results in exactly one match, which is the element.
 */
function isSelectorUnique(selector, element) {
    try {
        const matches = document.querySelectorAll(selector);
        return matches.length === 1 && matches[0] === element;
    } catch (e) {
        return false;
    }
}

/**
 * Generates a specific and stable CSS selector for a given DOM element.
 *
 * @param {Element} element The element to generate a selector for.
 * @param {object} [options={}] Options to configure selector generation.
 * @param {number} [options.specificityThreshold=10] The maximum number of matches a selector can have before needing more specificity.
 * @returns {string} A CSS selector for the element.
 */
function generateSpecificStableSelector(element, options = {}) {
    if (!element || !(element instanceof Element)) {
        return '';
    }

    const { specificityThreshold = 10 } = options;
    const stableDataAttributes = ['data-testid', 'data-qa', 'data-cy', 'data-test', 'data-id', 'data-component', 'data-tracking'];

    // 1. Prioritize unique ID
    if (element.id && isSelectorUnique(`#${element.id}`, element)) {
        return `#${CSS.escape(element.id)}`;
    }

    // 2. Prioritize stable data attributes
    for (const attr of stableDataAttributes) {
        const attrValue = element.getAttribute(attr);
        if (attrValue) {
            const selector = `[${attr}="${CSS.escape(attrValue)}"]`;
            if (isSelectorUnique(selector, element)) {
                return selector;
            }
        }
    }

    let selector = '';
    let currentElement = element;
    let path = [];

    while (currentElement && currentElement.nodeType === Node.ELEMENT_NODE) {
        let elementSelector = currentElement.tagName.toLowerCase();
        
        // Add stable classes
        const stableClasses = Array.from(currentElement.classList).filter(c => !isUnstableClass(c));
        if (stableClasses.length > 0) {
            // Find a minimal combination of classes
            let bestClassSelector = '';
            for (let i = 1; i <= stableClasses.length; i++) {
                // This is a simplified approach; a real implementation might check combinations.
                // For now, we just add them one by one.
                const classSelectorPart = '.' + stableClasses.slice(0, i).join('.');
                const tempSelector = elementSelector + classSelectorPart;
                if (matchCount(tempSelector) <= specificityThreshold) {
                    bestClassSelector = classSelectorPart;
                    break;
                }
            }
            elementSelector += bestClassSelector || ('.' + stableClasses.join('.'));
        }

        path.unshift(elementSelector);
        const prospectiveSelector = path.join(' > ');
        
        if (matchCount(prospectiveSelector) <= specificityThreshold && document.querySelector(prospectiveSelector) === element) {
             if (isSelectorUnique(prospectiveSelector, element)) {
                return prospectiveSelector;
             }
        }

        if (isSelectorUnique(elementSelector, currentElement)) {
             path = [elementSelector];
             break;
        }

        currentElement = currentElement.parentElement;
        // Stop at body or if we have a reasonably specific selector already
        if (currentElement === document.body) break;
    }
    
    selector = path.join(' > ');

    // 4. If still not unique, resort to nth-child as a last measure
    if (!isSelectorUnique(selector, element) && element.parentElement) {
        const siblings = Array.from(element.parentElement.children);
        const ownIndex = siblings.indexOf(element);
        if (ownIndex !== -1) {
             const sameTagSiblings = siblings.filter(sib => sib.tagName === element.tagName);
             if (sameTagSiblings.length > 1) {
                 const nthIndex = Array.from(element.parentElement.children)
                                      .filter(child => child.tagName === element.tagName)
                                      .indexOf(element) + 1;
                selector += `:nth-of-type(${nthIndex})`;
             }
        }
    }
    
    // Final check, if it's not specific, return the long path as best effort.
    if (isSelectorUnique(selector, element)) {
        return selector;
    }
    
    return path.join(' > ');
}
