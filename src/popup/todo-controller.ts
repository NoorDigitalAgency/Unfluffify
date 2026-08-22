import type { PageContextResolution } from "../domain/schema/context";
import type { TodoCoverage } from "../domain/schema/todo";
import { todoRefreshDue } from "./todo-recovery";

export type TodoStatus = PageContextResolution["status"] | "unresolved";

export const EMPTY_TODO_COVERAGE: TodoCoverage = Object.freeze({
  covered: 0,
  actionable: 0,
  pageTypes: [],
});

export type TodoSnapshot = Readonly<{
  status: TodoStatus;
  coverage: TodoCoverage;
  refreshedAt: number;
}>;

export type TodoPageContext = Pick<
  PageContextResolution,
  "status" | "observedUrl" | "environmentKey" | "siteId" | "baseUrl"
> & Readonly<{ todo: TodoCoverage }>;

export type TodoLoadResult =
  | Readonly<{ ok: true; data: TodoPageContext }>
  | Readonly<{ ok: false }>;

export type TodoRefreshInput = Readonly<{
  tabId: number;
  pageUrl: string;
  force?: boolean;
}>;

export type TodoRefreshCandidate = Readonly<{
  id: number;
  generation: number;
  completedAt: number;
  response: TodoLoadResult;
}>;

export type TodoRefreshResult =
  | Readonly<{ status: "skipped" }>
  | Readonly<{ status: "candidate"; candidate: TodoRefreshCandidate }>;

export type TodoControllerPorts = Readonly<{
  loadContext(input: Readonly<{
    tabId: number;
    pageUrl: string;
    refresh: boolean;
  }>): Promise<TodoLoadResult>;
  now?: () => number;
}>;

export type TodoController = Readonly<{
  snapshot(): TodoSnapshot;
  requestRefresh(input: TodoRefreshInput): Promise<TodoRefreshResult>;
  adopt(candidate: TodoRefreshCandidate): boolean;
  reset(): void;
}>;

const INITIAL_SNAPSHOT: TodoSnapshot = Object.freeze({
  status: "unresolved",
  coverage: EMPTY_TODO_COVERAGE,
  refreshedAt: 0,
});

function shouldAskHub(status: TodoStatus): boolean {
  return status !== "suspended_candidate_removed" &&
    status !== "suspended_candidate_feed_conflict";
}

/**
 * Owns Todo refresh cadence and projection ordering. Tab/page authority remains
 * with the popup entrypoint: a response is inert until main authorizes and
 * adopts its candidate against the exact current binding occurrence.
 */
export function createTodoController(ports: TodoControllerPorts): TodoController {
  const now = ports.now ?? Date.now;
  let current = INITIAL_SNAPSHOT;
  let generation = 0;
  let nextCandidateId = 1;
  let adoptedCandidateId = 0;

  return {
    snapshot: () => current,

    async requestRefresh(input) {
      const requestedAt = now();
      const due = todoRefreshDue(current.status, current.refreshedAt, requestedAt);
      if (current.status !== "unresolved" && input.force !== true && !due) {
        return { status: "skipped" };
      }
      const candidateGeneration = generation;
      const id = nextCandidateId;
      nextCandidateId += 1;
      let response: TodoLoadResult;
      try {
        response = await ports.loadContext({
          tabId: input.tabId,
          pageUrl: input.pageUrl,
          // The background owns suspension recovery while the panel is closed.
          // During either suspension, the popup samples that generation-safe
          // cached projection instead of forcing another Hub request.
          refresh: input.force === true || (due && shouldAskHub(current.status)),
        });
      } catch {
        response = { ok: false };
      }
      return {
        status: "candidate",
        candidate: {
          id,
          generation: candidateGeneration,
          completedAt: now(),
          response,
        },
      };
    },

    adopt(candidate) {
      if (candidate.generation !== generation || candidate.id <= adoptedCandidateId) {
        return false;
      }
      adoptedCandidateId = candidate.id;
      current = candidate.response.ok
        ? Object.freeze({
            status: candidate.response.data.status,
            coverage: candidate.response.data.todo,
            refreshedAt: candidate.completedAt,
          })
        : Object.freeze({
            status: "unavailable",
            coverage: current.coverage,
            refreshedAt: candidate.completedAt,
          });
      return true;
    },

    reset() {
      generation += 1;
      adoptedCandidateId = 0;
      current = INITIAL_SNAPSHOT;
    },
  };
}
