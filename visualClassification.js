/**
 * NOTE: Before using `getElementState`, the `permanentExcludeSet` should be fetched
 * from the extension's storage.
 *
 * Example in a content script:
 *
 * import { getPermanentExclusionSelectors } from './storageManager.js';
 *
 * async function runClassification() {
 *   const permanentExclusions = await getPermanentExclusionSelectors();
 *   const allElements = document.querySelectorAll('*');
 *
 *   const classificationSets = {
 *     permanentExcludeSet: permanentExclusions,
 *     explicitExcludeSet: new Set(), // From user actions on the page
 *     explicitIncludeSet: new Set(), // From user actions on the page
 *     excludeSelectors: new Set(),
 *     includeSelectors: new Set()
 *   };
 *
 *   allElements.forEach(el => {
 *     const state = getElementState(el, classificationSets);
 *     applyClassificationStyles(el, state);
 *   });
 * }
 */

const ElementState = {
    PERMANENT_EXCLUDE: 'permanent-exclude',
    EXPLICIT_INCLUDE: 'explicit-include',
    EXPLICIT_EXCLUDE: 'explicit-exclude',
    INFERRED_INCLUDE: 'inferred-include',
    INFERRED_EXCLUDE: 'inferred-exclude',
    NONE: 'none'
};

const stateToClassMap = {
    [ElementState.PERMANENT_EXCLUDE]: 'gemini-permanent-exclude',
    [ElementState.EXPLICIT_INCLUDE]: 'gemini-explicit-include',
    [ElementState.EXPLICIT_EXCLUDE]: 'gemini-explicit-exclude',
    [ElementState.INFERRED_INCLUDE]: 'gemini-inferred-include',
    [ElementState.INFERRED_EXCLUDE]: 'gemini-inferred-exclude',
};

/**
 * Determines the classification state of an element based on inclusion/exclusion selectors.
 * The precedence order is: permanent exclude > explicit exclude > explicit include > inferred exclude > inferred include.
 *
 * @param {Element} element The element to classify.
 * @param {object} sets The selector sets.
 * @param {Set<string>} sets.permanentExcludeSet Predefined, high-precedence selectors for permanent exclusion.
 * @param {Set<string>} sets.explicitExcludeSet Selectors for explicit exclusion.
 * @param {Set<string>} sets.explicitIncludeSet Selectors for explicit inclusion.
 * @param {Set<string>} sets.excludeSelectors Selectors for inferred exclusion.
 * @param {Set<string>} sets.includeSelectors Selectors for inferred inclusion.
 * @returns {ElementState} The classification state of the element.
 */
function getElementState(element, { permanentExcludeSet, explicitExcludeSet, explicitIncludeSet, excludeSelectors, includeSelectors }) {
    if (!element) return ElementState.NONE;

    if (permanentExcludeSet) {
        for (const selector of permanentExcludeSet) {
            if (element.matches(selector)) return ElementState.PERMANENT_EXCLUDE;
        }
    }
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
