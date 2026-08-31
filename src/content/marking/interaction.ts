/** One browser gesture may surface through more than one DOM event. */
export function createPhysicalActionDeduper() {
  const committed = new Set<string>();
  const order: string[] = [];
  const capacity = 32;
  return {
    accept(physicalId: number, targetKey: string, mode: string): boolean {
      const key = `${physicalId}\u0000${targetKey}\u0000${mode}`;
      if (committed.has(key)) {
        return false;
      }
      committed.add(key);
      order.push(key);
      if (order.length > capacity) {
        committed.delete(order.shift()!);
      }
      return true;
    },
  };
}
