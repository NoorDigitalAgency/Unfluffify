const ElementState = {
    EXPLICIT_INCLUDE: 'explicit-include',
    EXPLICIT_EXCLUDE: 'explicit-exclude',
    INFERRED_INCLUDE: 'inferred-include',
    INFERRED_EXCLUDE: 'inferred-exclude',
    NONE: 'none'
};

const stateToClassMap = {
    [ElementState.EXPLICIT_INCLUDE]: 'gemini-explicit-include',
    [ElementState.EXPLICIT_EXCLUDE]: 'gemini-explicit-exclude',
    [ElementState.INFERRED_INCLUDE]: 'gemini-inferred-include',
    [ElementState.INFERRED_EXCLUDE]: 'gemini-inferred-exclude',
};

/**
 * Determines the classification state of an element based on inclusion/exclusion selectors.
 * The precedence order is: explicit exclude > explicit include > inferred exclude > inferred include.
 *
 * @param {Element} element The element to classify.
 * @param {object} sets The selector sets.
 * @param {Set<string>} sets.explicitExcludeSet Selectors for explicit exclusion.
 * @param {Set<string>} sets.explicitIncludeSet Selectors for explicit inclusion.
 * @param {Set<string>} sets.excludeSelectors Selectors for inferred exclusion.
 * @param {Set<string>} sets.includeSelectors Selectors for inferred inclusion.
 * @returns {ElementState} The classification state of the element.
 */
function getElementState(element, { explicitExcludeSet, explicitIncludeSet, excludeSelectors, includeSelectors }) {
    if (!element) return ElementState.NONE;

    for (const selector of explicitExcludeSet) {
        if (element.matches(selector)) return ElementState.EXPLICIT_EXCLUDE;
    }
    for (const selector of explicitIncludeSet) {
        if (element.matches(selector)) return ElementState.EXPLICIT_INCLUDE;
    }
    for (const selector of excludeSelectors) {
        if (element.matches(selector)) return ElementState.INFERRED_EXCLUDE;
    }
    for (const selector of includeSelectors) {
        if (element.matches(selector)) return ElementState.INFERRED_INCLUDE;
    }

    return ElementState.NONE;
}

/**
 * Applies a CSS class to an element based on its classification state.
 * @param {Element} element The element to apply the class to.
 * @param {ElementState} state The state returned from getElementState.
 */
function applyClassificationStyles(element, state) {
    if (!element) return;

    // First, remove any existing classification classes
    Object.values(stateToClassMap).forEach(className => {
        element.classList.remove(className);
    });

    // Then, add the new class if the state is not 'none'
    const newClass = stateToClassMap[state];
    if (newClass) {
        element.classList.add(newClass);
    }
}

/**
 * Updates the visual classification for all elements on the page.
 * @param {object} sets The selector sets for classification.
 */
function updateAllClassifications(sets) {
    document.querySelectorAll('*').forEach(el => {
        const state = getElementState(el, sets);
        applyClassificationStyles(el, state);
    });
}
