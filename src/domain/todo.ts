import type { PropertyContextPageType } from "./schema/context";
import type { TodoCoverage } from "./schema/todo";

/** Project persisted coverage onto Hub's last valid canonical feed. Empty page
 * types are deliberately silent: they are not actionable work and therefore
 * count in neither the header denominator nor the rendered subsection list. */
export function projectTodoCoverage(
  pageTypes: readonly PropertyContextPageType[],
  currentPageKey: string | null,
  savedPageKeys: ReadonlySet<string>,
): TodoCoverage {
  const actionable = pageTypes.filter((pageType) => pageType.pages.length > 0).map((pageType) => {
    const candidates = pageType.pages.map((page) => ({
      pageKey: page.pageKey,
      wordsCount: page.wordsCount,
      marked: savedPageKeys.has(page.pageKey),
      current: page.pageKey === currentPageKey,
    }));
    return {
      pageType: pageType.pageType,
      markedCount: candidates.filter((candidate) => candidate.marked).length,
      current: candidates.some((candidate) => candidate.current),
      candidates,
    };
  });
  return {
    covered: actionable.filter((pageType) => pageType.markedCount > 0).length,
    actionable: actionable.length,
    pageTypes: actionable,
  };
}
