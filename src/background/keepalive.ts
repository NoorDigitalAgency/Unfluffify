export type KeepAliveRelease = () => void;

export function createKeepAliveController() {
  const activeReasons = new Map<string, number>();
  return {
    acquire(reason: string): KeepAliveRelease {
      activeReasons.set(reason, (activeReasons.get(reason) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        const nextCount = (activeReasons.get(reason) ?? 0) - 1;
        if (nextCount > 0) {
          activeReasons.set(reason, nextCount);
        } else {
          activeReasons.delete(reason);
        }
      };
    },
    isActive(): boolean {
      return activeReasons.size > 0;
    },
    reasons(): readonly string[] {
      return [...activeReasons.keys()];
    },
  };
}
