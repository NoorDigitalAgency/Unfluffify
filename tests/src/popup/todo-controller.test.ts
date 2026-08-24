import { describe, expect, it, vi } from "vitest";

import {
  createTodoController,
  EMPTY_TODO_COVERAGE,
  type TodoLoadResult,
  type TodoPageContext,
  type TodoRefreshCandidate,
  type TodoRefreshResult,
} from "../../../src/popup/todo-controller";
import { TODO_RECOVERY_INTERVAL_MS } from "../../../src/popup/todo-recovery";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function pageContext(
  status: TodoPageContext["status"] = "managed_candidate",
  covered = 1,
): TodoPageContext {
  return {
    status,
    observedUrl: "https://example.com/page",
    environmentKey: "stage.example.com",
    siteId: 42,
    baseUrl: "https://example.com",
    todo: { covered, actionable: covered, pageTypes: [] },
  };
}

function candidateOf(result: TodoRefreshResult): TodoRefreshCandidate {
  if (result.status !== "candidate") {
    throw new Error("expected Todo refresh candidate");
  }
  return result.candidate;
}

describe("popup Todo controller", () => {
  it("keeps an unresolved request inert until its candidate is authorized", async () => {
    let now = 1_000;
    const loadContext = vi.fn(async (): Promise<TodoLoadResult> => ({
      ok: true,
      data: pageContext(),
    }));
    const controller = createTodoController({ loadContext, now: () => now });

    expect(controller.snapshot()).toEqual({
      status: "unresolved",
      coverage: EMPTY_TODO_COVERAGE,
      refreshedAt: 0,
    });
    const candidate = candidateOf(await controller.requestRefresh({
      tabId: 77,
      pageUrl: "https://example.com/page",
    }));
    expect(loadContext).toHaveBeenCalledWith({
      tabId: 77,
      pageUrl: "https://example.com/page",
      refresh: false,
      backstop: false,
    });
    expect(controller.snapshot().status).toBe("unresolved");

    now = 1_050;
    expect(controller.adopt(candidate)).toBe(true);
    expect(controller.snapshot()).toEqual({
      status: "managed_candidate",
      coverage: pageContext().todo,
      refreshedAt: 1_000,
    });
  });

  it("refreshes a settled managed feed only at the exact recovery cadence", async () => {
    let now = 2_000;
    const loadContext = vi.fn(async (): Promise<TodoLoadResult> => ({
      ok: true,
      data: pageContext(),
    }));
    const controller = createTodoController({ loadContext, now: () => now });
    controller.adopt(candidateOf(await controller.requestRefresh({
      tabId: 77,
      pageUrl: "https://example.com/page",
    })));
    loadContext.mockClear();

    now += TODO_RECOVERY_INTERVAL_MS - 1;
    await expect(controller.requestRefresh({
      tabId: 77,
      pageUrl: "https://example.com/page",
    })).resolves.toEqual({ status: "skipped" });
    expect(loadContext).not.toHaveBeenCalled();

    now += 1;
    const due = await controller.requestRefresh({
      tabId: 77,
      pageUrl: "https://example.com/page",
    });
    expect(due.status).toBe("candidate");
    expect(loadContext).toHaveBeenCalledWith(expect.objectContaining({
      refresh: false,
      backstop: true,
    }));
  });

  it("samples suspended authority without forcing another Hub refresh", async () => {
    let now = 3_000;
    const loadContext = vi.fn(async (): Promise<TodoLoadResult> => ({
      ok: true,
      data: pageContext("suspended_candidate_removed"),
    }));
    const controller = createTodoController({ loadContext, now: () => now });
    controller.adopt(candidateOf(await controller.requestRefresh({
      tabId: 77,
      pageUrl: "https://example.com/page",
    })));
    loadContext.mockClear();

    now += TODO_RECOVERY_INTERVAL_MS;
    await controller.requestRefresh({ tabId: 77, pageUrl: "https://example.com/page" });
    expect(loadContext).toHaveBeenCalledWith(expect.objectContaining({ refresh: false }));

    loadContext.mockClear();
    await controller.requestRefresh({
      tabId: 77,
      pageUrl: "https://example.com/page",
      force: true,
    });
    expect(loadContext).toHaveBeenCalledWith(expect.objectContaining({ refresh: true }));
  });

  it("marks transport failure unavailable while retaining the last coverage", async () => {
    let now = 4_000;
    const loadContext = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: pageContext("managed_candidate", 3) })
      .mockRejectedValueOnce(new Error("transport unavailable"));
    const controller = createTodoController({ loadContext, now: () => now });
    controller.adopt(candidateOf(await controller.requestRefresh({
      tabId: 77,
      pageUrl: "https://example.com/page",
    })));

    now += TODO_RECOVERY_INTERVAL_MS;
    const failed = candidateOf(await controller.requestRefresh({
      tabId: 77,
      pageUrl: "https://example.com/page",
    }));
    expect(controller.adopt(failed)).toBe(true);
    expect(controller.snapshot()).toEqual({
      status: "unavailable",
      coverage: pageContext("managed_candidate", 3).todo,
      refreshedAt: now,
    });
  });

  it("fences a delayed old binding candidate after reset", async () => {
    const pending = deferred<TodoLoadResult>();
    const loadContext = vi.fn(async () => await pending.promise);
    const controller = createTodoController({ loadContext, now: () => 5_000 });

    const request = controller.requestRefresh({
      tabId: 77,
      pageUrl: "https://example.com/a",
    });
    controller.reset();
    pending.resolve({ ok: true, data: pageContext() });

    expect(controller.adopt(candidateOf(await request))).toBe(false);
    expect(controller.snapshot()).toEqual({
      status: "unresolved",
      coverage: EMPTY_TODO_COVERAGE,
      refreshedAt: 0,
    });
  });

  it("does not let an older concurrent response overwrite a newer winner", async () => {
    const older = deferred<TodoLoadResult>();
    const loadContext = vi.fn()
      .mockImplementationOnce(async () => await older.promise)
      .mockResolvedValueOnce({ ok: true, data: pageContext("managed_candidate", 6) });
    const controller = createTodoController({ loadContext, now: () => 6_000 });

    const first = controller.requestRefresh({ tabId: 77, pageUrl: "https://example.com/page" });
    const second = await controller.requestRefresh({
      tabId: 77,
      pageUrl: "https://example.com/page",
      force: true,
    });
    expect(controller.adopt(candidateOf(second))).toBe(true);
    older.resolve({ ok: true, data: pageContext("managed_candidate", 2) });

    expect(controller.adopt(candidateOf(await first))).toBe(false);
    expect(controller.snapshot().coverage.covered).toBe(6);
  });
});
