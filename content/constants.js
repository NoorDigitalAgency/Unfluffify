export const HEADING_TAG_SELECTOR = ["h1", "h2", "h3", "h4", "h5", "h6"].join(",");

export const REMOVABLE_ELEMENT_SELECTORS = [
  ":not(body):not(html).backdrop",
  ":not(body):not(html).overlay",
  ":not(body):not(html).wcc-overlay",
  ":not(body):not(html).modal-backdrop",
  ":not(body):not(html)[role='dialog' i]",
  ":not(body):not(html)[class*='modal' i]",
  ":not(body):not(html)[class*='popup' i]",
  ":not(body):not(html)[id*='cookie' i]",
  ":not(body):not(html)[class*='cookie' i]",
  ":not(body):not(html)[id*='consent' i]",
  ":not(body):not(html)[class*='consent' i]",
  ":not(body):not(html)[class*='newsletter' i]",
  ":not(body):not(html)[class*='gdpr' i]",
  ":not(body):not(html)[id*='gdpr' i]",
  ":not(body):not(html)[class*='privacy' i]:not([class*='policy' i])",
  ":not(body):not(html)[id*='privacy' i]:not([id*='policy' i])",
  "[aria-label='Cookie banner']",
  "[aria-hidden='true']",
  "[role='dialog']",
  ".cookie",
  ".cookies",
  ".cookie-banner",
  ".newsletter",
  ".subscribe",
  ".modal",
  ".popup"
];

export const EXPLICITLY_REMOVABLE_ELEMENT_SELECTORS = [
  "#onetrust-consent-sdk",
  "#cookie-information-template-wrapper"
];
