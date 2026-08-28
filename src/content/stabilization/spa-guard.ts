import { normalizedDocumentPageUrl } from "../page-url";

export type SpaReload = (url: string) => void;

export function createSpaGuard(reload: SpaReload) {
  let active = false;
  let currentUrl = "";
  let currentDocumentUrl = "";
  return {
    arm(url: string): void {
      active = true;
      currentUrl = url;
      currentDocumentUrl = normalizedDocumentPageUrl(url);
    },
    disarm(): void {
      active = false;
    },
    onUrlChange(nextUrl: string): void {
      const nextDocumentUrl = normalizedDocumentPageUrl(nextUrl, currentUrl || undefined);
      if (!active || nextDocumentUrl === currentDocumentUrl) {
        currentUrl = nextUrl;
        currentDocumentUrl = nextDocumentUrl;
        return;
      }
      currentUrl = nextUrl;
      currentDocumentUrl = nextDocumentUrl;
      reload(nextUrl);
    },
    isActive(): boolean {
      return active;
    },
  };
}
