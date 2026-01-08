// Simple assert for testing purposes
function assert(condition, message) {
    if (!condition) {
        throw new Error(message || "Assertion failed");
    }
    console.log(`%c✔ Test Passed: ${message}`, 'color: green');
}

function assertEquals(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`Assertion failed: ${message}\nExpected: ${expected}\nActual:   ${actual}`);
    }
     console.log(`%c✔ Test Passed: ${message}`, 'color: green');
}

function runTests() {
    console.log('--- Running Selector Generation Tests ---');
    testSelectorGeneration();
    console.log('--- Running Visual Classification Tests ---');
    testVisualClassification();
    console.log('--- Running Constraint Checking Tests ---');
    testConstraintChecking();
}


// --- Test Setup --- 
function setupDOM() {
    document.body.innerHTML = `
        <div id="main-container" data-testid="container">
            <header>
                <h1>Welcome</h1>
            </header>
            <div class="content user-panel auth-panel">
                <p class="text-lead" data-qa="intro">This is an intro.</p>
                <button id="login-btn" class="btn btn-primary">Log In</button>
            </div>
            <div class="content" id="section-2">
                <div>
                     <span class="item">Item 1</span>
                     <span class="item active">Item 2</span>
                     <span class="item">Item 3</span>
                </div>
            </div>
        </div>
    `;
}

// --- Test Suites --- 

function testSelectorGeneration() {
    setupDOM();
    
    // Test for unique ID
    const loginBtn = document.getElementById('login-btn');
    assertEquals(generateSpecificStableSelector(loginBtn), '#login-btn', 'Should use unique ID');

    // Test for stable data attribute
    const introP = document.querySelector('[data-qa="intro"]');
    assertEquals(generateSpecificStableSelector(introP), '[data-qa="intro"]', 'Should use stable data-qa attribute');
    
    // Test for tag + class combination
    const h1 = document.querySelector('h1');
    assertEquals(generateSpecificStableSelector(h1), 'h1', 'Should use simple tag if unique');
    
    // Test for parent context
    const activeSpan = document.querySelector('.item.active');
    // Expected: div > span.item.active or #section-2 > div > span.item.active (depends on threshold)
    const activeSpanSelector = generateSpecificStableSelector(activeSpan, { specificityThreshold: 2 });
    assert(activeSpanSelector.includes('>'), 'Should use parent context for specificity');
    assert(isSelectorUnique(activeSpanSelector, activeSpan), 'Generated selector for span must be unique');

    // Test for nth-of-type as last resort
    const firstItem = document.querySelector('.item');
    const firstItemSelector = generateSpecificStableSelector(firstItem);
    assertEquals(firstItemSelector, '#section-2 > div > span:nth-of-type(1)', 'Should use nth-of-type for non-unique siblings');
}

function testVisualClassification() {
    setupDOM();

    const sets = {
        permanentExcludeSet: new Set(['header']),
        explicitExcludeSet: new Set(['#section-2']),
        explicitIncludeSet: new Set(['#login-btn', 'h1']), // Also target h1 to test precedence
        excludeSelectors: new Set(['.user-panel']),
        includeSelectors: new Set(['.text-lead'])
    };
    
    const header = document.querySelector('header');
    const section2 = document.getElementById('section-2');
    const loginBtn = document.getElementById('login-btn');
    const userPanel = document.querySelector('.user-panel');
    const textLead = document.querySelector('.text-lead');
    const h1 = document.querySelector('h1');

    assertEquals(getElementState(header, sets), ElementState.PERMANENT_EXCLUDE, 'Permanent exclude has the highest priority');
    assertEquals(getElementState(h1, sets), ElementState.PERMANENT_EXCLUDE, 'Permanent exclude overrides explicit include on a child element');
    assertEquals(getElementState(section2, sets), ElementState.EXPLICIT_EXCLUDE, 'Explicit exclude has second priority');
    assertEquals(getElementState(loginBtn, sets), ElementState.EXPLICIT_INCLUDE, 'Explicit include is next');
    assertEquals(getElementState(userPanel, sets), ElementState.INFERRED_EXCLUDE, 'Inferred exclude is next');
    assertEquals(getElementState(textLead, sets), ElementState.INFERRED_INCLUDE, 'Inferred include is last match');
    
    // Test that explicit include inside inferred exclude still wins for the element itself
    const btnInsideInferredExclude = userPanel.querySelector('#login-btn');
    assertEquals(getElementState(btnInsideInferredExclude, sets), ElementState.EXPLICIT_INCLUDE, 'Explicit include on child overrides parent\'s inferred exclude');
}

function testConstraintChecking() {
    setupDOM();
    document.body.innerHTML += `<div id="perm-excluded" data-testid="perm-excluded"><div id="outer" data-testid="outer"><div id="inner"><p id="text"></p></div></div></div>`;
    
    const outer = document.getElementById('outer');
    const inner = document.getElementById('inner');
    const text = document.getElementById('text');

    // Case 1: Ancestor is permanently excluded
    let sets1 = {
        permanentExcludeSet: new Set(['#perm-excluded']),
        explicitExcludeSet: new Set(),
        explicitIncludeSet: new Set(),
        excludeSelectors: new Set(),
        includeSelectors: new Set()
    };
    assertEquals(isMarkAllowed(text, ElementState.EXPLICIT_INCLUDE, sets1), false, 'Should not allow marking inside a permanently excluded ancestor');

    // Case 2: Ancestor is explicitly excluded
    let sets2 = {
        permanentExcludeSet: new Set(),
        explicitExcludeSet: new Set(['#outer']),
        explicitIncludeSet: new Set(),
        excludeSelectors: new Set(),
        includeSelectors: new Set()
    };
    assertEquals(isMarkAllowed(text, ElementState.EXPLICIT_INCLUDE, sets2), false, 'Should not allow marking inside an explicitly excluded ancestor');
    
    // Case 3: Ancestor is explicitly included
    let sets3 = {
        permanentExcludeSet: new Set(),
        explicitExcludeSet: new Set(),
        explicitIncludeSet: new Set(['#outer']),
        excludeSelectors: new Set(),
        includeSelectors: new Set()
    };
    assertEquals(isMarkAllowed(text, ElementState.EXPLICIT_EXCLUDE, sets3), true, 'Should allow marking inside an explicitly included ancestor (by default)');

    // Case 4: No authoritative ancestor
    let sets4 = {
        permanentExcludeSet: new Set(),
        explicitExcludeSet: new Set(),
        explicitIncludeSet: new Set(),
        excludeSelectors: new Set(['#outer']),
        includeSelectors: new Set()
    };
    assertEquals(isMarkAllowed(text, ElementState.EXPLICIT_INCLUDE, sets4), true, 'Should allow marking if ancestor is only inferred');
}

// To run in a browser console:
// copy-paste all files' content here, then call runTests();
// For example:
// Paste selectorGeneration.js
// Paste visualClassification.js
// Paste constraintChecking.js
// Paste tests.js
// runTests();
