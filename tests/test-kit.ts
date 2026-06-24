const isDenoTestRuntime = typeof globalThis.Deno?.test === "function";

const denoAssertRuntime = isDenoTestRuntime ? await import("@std/assert") : null;
const denoBddRuntime = isDenoTestRuntime ? await import("@std/testing/bdd") : null;
const vitestRuntime = isDenoTestRuntime ? null : await import("vitest");

interface TestContextLike {
  after(callback: () => unknown | Promise<unknown>): void;
}

type TestFn = (context: TestContextLike) => unknown | Promise<unknown>;
type TestOptions = { timeout?: number };

type TestCallable = {
  (name: string, fn: TestFn, options?: TestOptions | number): void;
  beforeEach: (callback: () => unknown | Promise<unknown>) => void;
  afterEach: (callback: () => unknown | Promise<unknown>) => void;
};

const runtimeBeforeEach = isDenoTestRuntime
  ? denoBddRuntime.beforeEach
  : vitestRuntime.beforeEach;
const runtimeAfterEach = isDenoTestRuntime
  ? denoBddRuntime.afterEach
  : vitestRuntime.afterEach;

const test = ((name: string, fn: TestFn, options?: TestOptions | number): void => {
  const wrappedTest = async (...args: unknown[]) => {
    const afterCallbacks: Array<() => unknown | Promise<unknown>> = [];
    const baseContext = args[0] && typeof args[0] === "object" ? args[0] as Record<string, unknown> : {};
    const context = Object.assign(baseContext, {
      after(callback: () => unknown | Promise<unknown>): void {
        afterCallbacks.push(callback);
      },
    });

    try {
      await fn(context as TestContextLike);
    } finally {
      for (const callback of afterCallbacks.reverse()) {
        await callback();
      }
    }
  };

  if (isDenoTestRuntime) {
    denoBddRuntime.test(name, wrappedTest);
    return;
  }

  const timeout = typeof options === "number" ? options : options?.timeout;
  if (typeof timeout === "number" && Number.isFinite(timeout)) {
    vitestRuntime.it(name, wrappedTest, timeout);
    return;
  }

  vitestRuntime.it(name, wrappedTest);
}) as TestCallable;

test.beforeEach = runtimeBeforeEach;
test.afterEach = runtimeAfterEach;

export { test };

type AssertMatcher = RegExp | Error | ((error: unknown) => boolean) | undefined;

function fail(message: string): never {
  throw new Error(message);
}

function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function baseAssert(value: unknown, message?: string): void {
  if (!value) {
    fail(message || `Expected value to be truthy, got ${stringify(value)}`);
  }
}

function assertEqual(actual: unknown, expected: unknown, message?: string): void {
  if (isDenoTestRuntime) {
    denoAssertRuntime.assertEquals(actual, expected, message);
    return;
  }
  vitestRuntime.expect(actual, message).toEqual(expected);
}

function assertMatch(actual: string, matcher: RegExp, message?: string): void {
  if (isDenoTestRuntime) {
    denoAssertRuntime.assertMatch(actual, matcher, message);
    return;
  }
  vitestRuntime.expect(actual, message).toMatch(matcher);
}

function assertNotMatch(actual: string, matcher: RegExp, message?: string): void {
  if (isDenoTestRuntime) {
    denoAssertRuntime.assertNotMatch(actual, matcher, message);
    return;
  }
  vitestRuntime.expect(actual, message).not.toMatch(matcher);
}

function matchesExpected(error: unknown, expected?: AssertMatcher, message?: string): void {
  if (!expected) {
    return;
  }
  if (expected instanceof RegExp) {
    if (!expected.test(String(error))) {
      fail(message || `Expected error to match ${expected}`);
    }
    return;
  }
  if (expected instanceof Error) {
    if (!(error instanceof expected.constructor)) {
      fail(message || `Expected error to be an instance of ${expected.constructor.name}`);
    }
    return;
  }
  if (typeof expected === "function" && !expected(error)) {
    fail(message || "Expected error predicate to return true");
  }
}

async function toPromise(value: Promise<unknown> | (() => Promise<unknown>)): Promise<unknown> {
  return typeof value === "function" ? await value() : await value;
}

export const assert = Object.assign(baseAssert, {
  equal(actual: unknown, expected: unknown, message?: string): void {
    assertEqual(actual, expected, message);
  },
  deepEqual(actual: unknown, expected: unknown, message?: string): void {
    assertEqual(actual, expected, message);
  },
  notEqual(actual: unknown, expected: unknown, message?: string): void {
    if (actual == expected) {
      fail(message || `Expected ${stringify(actual)} not to equal ${stringify(expected)}`);
    }
  },
  match(actual: string, matcher: RegExp, message?: string): void {
    assertMatch(actual, matcher, message);
  },
  doesNotMatch(actual: string, matcher: RegExp, message?: string): void {
    assertNotMatch(actual, matcher, message);
  },
  ok(value: unknown, message?: string): void {
    baseAssert(value, message);
  },
  fail(message?: string): never {
    return fail(message || "Assertion failed");
  },
  doesNotThrow(fn: () => unknown, message?: string): void {
    try {
      fn();
    } catch (error) {
      fail(message || `Expected function not to throw, got ${String(error)}`);
    }
  },
  throws(fn: () => void, expected?: AssertMatcher, message?: string): void {
    try {
      fn();
    } catch (error) {
      matchesExpected(error, expected, message);
      return;
    }

    fail(message || "Expected function to throw");
  },
  async rejects(value: Promise<unknown> | (() => Promise<unknown>), expected?: AssertMatcher, message?: string): Promise<void> {
    try {
      await toPromise(value);
    } catch (error) {
      matchesExpected(error, expected, message);
      return;
    }

    fail(message || "Expected promise to reject");
  },
});
