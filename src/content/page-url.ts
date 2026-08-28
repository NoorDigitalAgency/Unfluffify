/** Normalizes the URL identity of one live document route.
 * Fragments are view-local and do not identify a new document or property page. */
export function normalizedDocumentPageUrl(value: string, base?: string): string {
  if (!value) {
    return "";
  }
  try {
    const url = base ? new URL(value, base) : new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    const hashIndex = value.indexOf("#");
    return hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  }
}

export function sameDocumentPageUrl(left: string, right: string): boolean {
  const normalizedLeft = normalizedDocumentPageUrl(left, right || undefined);
  return normalizedLeft !== "" &&
    normalizedLeft === normalizedDocumentPageUrl(right, left || undefined);
}
