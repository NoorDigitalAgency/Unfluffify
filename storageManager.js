/**
 * Manages storing and retrieving settings for the extension, specifically the
 * permanent exclusion selectors. Uses `chrome.storage.sync` to persist
 * settings across a user's devices.
 */

const PERMANENT_EXCLUSION_SELECTORS_KEY = 'permanentExclusionSelectors';

/**
 * Retrieves the set of permanent exclusion selectors from extension storage.
 *
 * @returns {Promise<Set<string>>} A promise that resolves to a Set of selectors.
 *                                  Returns an empty set if none are stored.
 */
function getPermanentExclusionSelectors() {
    return new Promise((resolve) => {
        chrome.storage.sync.get([PERMANENT_EXCLUSION_SELECTORS_KEY], (result) => {
            if (chrome.runtime.lastError) {
                console.error('Error getting permanent selectors:', chrome.runtime.lastError);
                resolve(new Set());
            } else {
                const selectors = result[PERMANENT_EXCLUSION_SELECTORS_KEY] || [];
                resolve(new Set(selectors));
            }
        });
    });
}

/**
 * Saves a new array of selectors as the permanent exclusion list.
 *
 * @param {string[] | Set<string>} selectors The array or Set of selectors to save.
 * @returns {Promise<void>} A promise that resolves when the save is complete.
 */
function setPermanentExclusionSelectors(selectors) {
    const selectorsArray = Array.from(selectors);
    return new Promise((resolve, reject) => {
        chrome.storage.sync.set({ [PERMANENT_EXCLUSION_SELECTORS_KEY]: selectorsArray }, () => {
            if (chrome.runtime.lastError) {
                console.error('Error setting permanent selectors:', chrome.runtime.lastError);
                reject(chrome.runtime.lastError);
            } else {
                console.log('Permanent exclusion selectors saved.');
                resolve();
            }
        });
    });
}

/**
 * Adds a single selector to the permanent exclusion list.
 *
 * @param {string} selector The selector to add.
 * @returns {Promise<void>}
 */
async function addPermanentExclusionSelector(selector) {
    if (!selector) return;
    const selectors = await getPermanentExclusionSelectors();
    selectors.add(selector);
    return setPermanentExclusionSelectors(selectors);
}

/**
 * Removes a single selector from the permanent exclusion list.
 *
 * @param {string} selector The selector to remove.
 * @returns {Promise<void>}
 */
async function removePermanentExclusionSelector(selector) {
    const selectors = await getPermanentExclusionSelectors();
    selectors.delete(selector);
    return setPermanentExclusionSelectors(selectors);
}


/*
 =================================================================================
  EXAMPLE USAGE IN A UI SCRIPT (e.g., popup.js or options.js)
 =================================================================================

 // In your options page, you might have a list and a form for adding selectors.

 const selectorListElement = document.getElementById('selector-list');
 const newSelectorInputElement = document.getElementById('new-selector-input');
 const addSelectorButton = document.getElementById('add-selector-btn');

 // Function to refresh the list in the UI
 async function refreshSelectorList() {
     selectorListElement.innerHTML = '';
     const selectors = await getPermanentExclusionSelectors();
     selectors.forEach(selector => {
         const li = document.createElement('li');
         li.textContent = selector;
         const removeBtn = document.createElement('button');
         removeBtn.textContent = 'Remove';
         removeBtn.onclick = async () => {
             await removePermanentExclusionSelector(selector);
             refreshSelectorList(); // Refresh UI after removing
         };
         li.appendChild(removeBtn);
         selectorListElement.appendChild(li);
     });
 }

 // Event listener for the "Add" button
 addSelectorButton.addEventListener('click', async () => {
     const newSelector = newSelectorInputElement.value.trim();
     if (newSelector) {
         await addPermanentExclusionSelector(newSelector);
         newSelectorInputElement.value = '';
         refreshSelectorList(); // Refresh UI after adding
     }
 });

 // Initial load of the list when the page is opened
 document.addEventListener('DOMContentLoaded', refreshSelectorList);

*/
