// Assuming visualClassification.js is available in the same context
// Or import getElementState and ElementState

/**
 * Traverses up the DOM from a given element to find the first ancestor with an explicit classification.
 * @param {Element} element The starting element.
 * @param {object} classificationSets The selector sets for classification.
 * @returns {{state: ElementState, element: Element | null}} The state and the element that has it.
 */
function getNearestExplicitAncestorState(element, classificationSets) {
    let parent = element.parentElement;
    while (parent && parent !== document.body) {
        const state = getElementState(parent, classificationSets);
        if (state === ElementState.EXPLICIT_EXCLUDE || state === ElementState.EXPLICIT_INCLUDE) {
            return { state, element: parent };
        }
        parent = parent.parentElement;
    }
    return { state: ElementState.NONE, element: null };
}

/**
 * Validates whether a new selection (mark) is allowed based on ancestor classifications.
 * The primary rule is that no element can be included if it's a descendant of an explicitly excluded element.
 *
 * @param {Element} elementToMark The element being considered for selection.
 * @param {ElementState} proposedState The intended state for the element (e.g., EXPLICIT_INCLUDE).
 * @param {object} classificationSets The selector sets for classification.
 * @returns {boolean} True if the mark is allowed, false otherwise.
 */
function isMarkAllowed(elementToMark, proposedState, classificationSets) {
    const { state: ancestorState } = getNearestExplicitAncestorState(elementToMark, classificationSets);

    // Rule 1: Cannot include or exclude anything inside an explicitly excluded area.
    if (ancestorState === ElementState.EXPLICIT_EXCLUDE) {
        console.warn('Action denied: Cannot mark an element inside an explicitly excluded ancestor.', elementToMark);
        return false;
    }
    
    // Add more complex rules here if needed, for example:
    // if (ancestorState === ElementState.EXPLICIT_INCLUDE && proposedState === ElementState.EXPLICIT_EXCLUDE) {
    //    console.warn('Action denied: Cannot exclude an element inside an explicitly included ancestor.');
    //    return false;
    // }

    return true;
}
