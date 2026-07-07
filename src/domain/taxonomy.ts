import {
  DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS,
  DEFAULT_EXCLUDED_TAG_SELECTORS,
  DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS,
} from "./constants";

export function normalizeTagName(tagName: string): string {
  return tagName.trim().toUpperCase();
}

export function isImmutableTag(tagName: string): boolean {
  return DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS.includes(
    normalizeTagName(tagName) as (typeof DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS)[number],
  );
}

export function isToggleableDefaultTag(tagName: string): boolean {
  return DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS.includes(
    normalizeTagName(tagName) as (typeof DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS)[number],
  );
}

export function isDefaultExcluded(tagName: string): boolean {
  return DEFAULT_EXCLUDED_TAG_SELECTORS.includes(
    normalizeTagName(tagName) as (typeof DEFAULT_EXCLUDED_TAG_SELECTORS)[number],
  );
}
