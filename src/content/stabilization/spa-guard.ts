export type SpaReload = (url: string) => void;

export function createSpaGuard(reload: SpaReload) {
  let active = false;
  let currentUrl = "";
  return {
    arm(url: string): void {
      active = true;
      currentUrl = url;
    },
    disarm(): void {
      active = false;
    },
    onUrlChange(nextUrl: string): void {
      if (!active || nextUrl === currentUrl) {
        currentUrl = nextUrl;
        return;
      }
      currentUrl = nextUrl;
      reload(nextUrl);
    },
    isActive(): boolean {
      return active;
    },
  };
}
