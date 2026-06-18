import { assertEquals, assertMatch } from "jsr:@std/assert";
import { beforeEach as bddBeforeEach, afterEach as bddAfterEach, test as bddTest } from "jsr:@std/testing/bdd";

function test(name: string | Deno.TestDefinition, fn?: Deno.TestDefinition["fn"]): void {
  bddTest(name as never, fn as never);
}

test.beforeEach = bddBeforeEach;
test.afterEach = bddAfterEach;

export { test };

type AssertMatcher = RegExp | Error | ((error: unknown) => boolean) | undefined;

function baseAssert(value: unknown, message?: string): void {
  if (!value) {
    throw new Error(message || `Expected value to be truthy, got ${JSON.stringify(value)}`);
  }
}

function matchesExpected(error: unknown, expected?: AssertMatcher, message?: string): void {
  if (!expected) {
    return;
  }
  if (expected instanceof RegExp) {
    if (!expected.test(String(error))) {
      throw new Error(message || `Expected error to match ${expected}`);
    }
    return;
  }
  if (expected instanceof Error) {
    if (!(error instanceof expected.constructor)) {
      throw new Error(message || `Expected error to be an instance of ${expected.constructor.name}`);
    }
    return;
  }
  if (typeof expected === "function") {
    if (!expected(error)) {
      throw new Error(message || "Expected error predicate to return true");
    }
  }
}

async function toPromise(value: Promise<unknown> | (() => Promise<unknown>)): Promise<unknown> {
  return typeof value === "function" ? await value() : await value;
}

export const assert = Object.assign(baseAssert, {
  equal(actual: unknown, expected: unknown, message?: string): void {
    assertEquals(actual, expected, message);
  },
  deepEqual(actual: unknown, expected: unknown, message?: string): void {
    assertEquals(actual, expected, message);
  },
  match(actual: string, matcher: RegExp, message?: string): void {
    assertMatch(actual, matcher, message);
  },
  ok(value: unknown, message?: string): void {
    baseAssert(value, message);
  },
  doesNotThrow(fn: () => unknown, message?: string): void {
    try {
      fn();
    } catch (error) {
      throw new Error(message || `Expected function not to throw, got ${String(error)}`);
    }
  },
  throws(fn: () => void, expected?: AssertMatcher, message?: string): void {
    try {
      fn();
    } catch (error) {
      matchesExpected(error, expected, message);
      return;
    }

    throw new Error(message || "Expected function to throw");
  },
  async rejects(value: Promise<unknown> | (() => Promise<unknown>), expected?: AssertMatcher, message?: string): Promise<void> {
    try {
      await toPromise(value);
    } catch (error) {
      matchesExpected(error, expected, message);
      return;
    }

    throw new Error(message || "Expected promise to reject");
  }
});