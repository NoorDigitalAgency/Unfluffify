export type NormalizedRow = Readonly<{
  xpath: string;
  excluded: boolean;
  explicit?: boolean;
}>;

export type SemanticSignature = Readonly<{
  rows: ReadonlyArray<Readonly<{
    id: string;
    xpath: string;
    excluded: boolean;
    explicit: boolean;
  }>>;
  classes: ReadonlyArray<Readonly<{ id: string; classification: string }>>;
  classificationCoverage: Readonly<{
    internalCount: number;
    canonicalCount: number;
    extraInternalCount: number;
  }>;
}>;

export function elementXpath(element: Element): string {
  const segments: string[] = [];
  let cursor: Element | null = element;
  while (cursor) {
    const tag = cursor.tagName.toLowerCase();
    let index = 1;
    let sibling = cursor.previousElementSibling;
    while (sibling) {
      if (sibling.tagName.toLowerCase() === tag) {
        index += 1;
      }
      sibling = sibling.previousElementSibling;
    }
    segments.unshift(`${tag}[${index}]`);
    cursor = cursor.parentElement;
  }
  return `/${segments.join("/")}`;
}

export function doubleAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export async function waitFor(
  predicate: () => boolean,
  description: string,
  timeoutMs = 12_000,
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
}

export function targetPoint(id: string): Readonly<{ x: number; y: number }> {
  const element = document.querySelector(`[data-p14-id="${CSS.escape(id)}"]`);
  if (!element) {
    throw new Error(`Missing fixture target ${id}`);
  }
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export type StorefrontMutationPressureResult = Readonly<{
  ticks: number;
  lateConsentInsertions: number;
  consentRootHidden: boolean;
}>;

/**
 * Exercise the same extraction-irrelevant churn produced by a dynamic consent
 * surface without adding benchmark-owned nodes to the canonical fixture rows.
 */
export function startStorefrontMutationPressure(): () => StorefrontMutationPressureResult {
  const consentRoot = document.createElement("aside");
  consentRoot.setAttribute("data-uf-consent-hidden", "");
  consentRoot.setAttribute("aria-hidden", "true");
  consentRoot.style.display = "none";
  consentRoot.append(document.createElement("span"));
  document.body.append(consentRoot);
  let ticks = 0;
  let lateConsentInsertions = 1;
  const interval = window.setInterval(() => {
    ticks += 1;
    consentRoot.dataset.pressureTick = String(ticks);
    consentRoot.firstElementChild!.textContent = `Consent mutation ${ticks}`;
    if (ticks % 4 === 0) {
      const late = document.createElement("button");
      late.textContent = `Late consent control ${ticks}`;
      consentRoot.append(late);
      lateConsentInsertions += 1;
      if (consentRoot.children.length > 5) {
        consentRoot.children[1]?.remove();
      }
    }
  }, 16);
  return () => {
    window.clearInterval(interval);
    const result = {
      ticks,
      lateConsentInsertions,
      consentRootHidden: consentRoot.hasAttribute("data-uf-consent-hidden")
        && consentRoot.style.display === "none",
    };
    consentRoot.remove();
    return result;
  };
}

export function normalizedFixtureRows(rows: readonly NormalizedRow[]): SemanticSignature["rows"] {
  const elementByXpath = new Map(
    Array.from(document.querySelectorAll<HTMLElement>("*"))
      .filter((element) => !element.closest?.('[data-uf-extension-ui="true"]'))
      .map((element) => [elementXpath(element), element]),
  );
  const ids = new Set<string>();
  const xpaths = new Set<string>();
  return rows.map((row) => {
    const xpath = row.xpath.toLowerCase();
    const element = elementByXpath.get(xpath);
    if (!element) {
      throw new Error(`Canonical row does not resolve to page-owned DOM: ${xpath}`);
    }
    const id = element.dataset.p14Id;
    if (!id) {
      throw new Error(`Canonical row resolved to an element without a stable fixture ID: ${xpath}`);
    }
    if (xpaths.has(xpath)) {
      throw new Error(`Duplicate canonical row XPath: ${xpath}`);
    }
    if (ids.has(id)) {
      throw new Error(`Duplicate canonical row fixture ID: ${id}`);
    }
    xpaths.add(xpath);
    ids.add(id);
    return {
      id,
      xpath,
      excluded: Boolean(row.excluded),
      explicit: row.explicit === true,
    };
  });
}

export function normalizedFixtureClasses(
  classifications: Iterable<readonly [string, string]>,
  rows: SemanticSignature["rows"],
): Readonly<{
  classes: SemanticSignature["classes"];
  coverage: SemanticSignature["classificationCoverage"];
}> {
  const elementByXpath = new Map(
    Array.from(document.querySelectorAll<HTMLElement>("*"))
      .filter((element) => !element.closest?.('[data-uf-extension-ui="true"]'))
      .map((element) => [elementXpath(element), element]),
  );
  const classificationByXpath = new Map<string, string>();
  for (const [rawXpath, rawClassification] of classifications) {
    const xpath = rawXpath.toLowerCase();
    if (classificationByXpath.has(xpath)) {
      throw new Error(`Duplicate internal classification XPath: ${xpath}`);
    }
    classificationByXpath.set(xpath, rawClassification);
  }
  const canonicalXpaths = new Set(rows.map((row) => row.xpath.toLowerCase()));
  const classes = rows.map((row) => {
    const xpath = row.xpath.toLowerCase();
    const element = elementByXpath.get(xpath);
    if (!element) {
      throw new Error(`Canonical classification does not resolve to page-owned DOM: ${xpath}`);
    }
    const id = element.dataset.p14Id;
    if (!id) {
      throw new Error(`Canonical classification resolved without a stable fixture ID: ${xpath}`);
    }
    // Both engines represent the sixth canonical state, `undetected`, by the
    // absence of an overlay/classification entry. Preserve that absence
    // literally; never reconstruct a class from submission-row booleans.
    const classification = classificationByXpath.get(xpath) ?? "undetected";
    return { id, classification };
  });
  if (classes.length !== rows.length) {
    throw new Error(`Canonical class cardinality mismatch: ${classes.length} != ${rows.length}`);
  }
  const extraInternalCount = [...classificationByXpath.keys()]
    .filter((xpath) => !canonicalXpaths.has(xpath)).length;
  return {
    classes,
    coverage: {
      internalCount: classificationByXpath.size,
      canonicalCount: classes.length,
      extraInternalCount,
    },
  };
}

export function createOperationClock() {
  let armedType = "";
  let startedAt = Number.NaN;
  const capture = (event: Event): void => {
    if (event.isTrusted && event.type === armedType && !Number.isFinite(startedAt)) {
      startedAt = performance.now();
    }
  };
  for (const type of ["mousemove", "click", "wheel"]) {
    document.addEventListener(type, capture, true);
  }
  return {
    arm(type: "mousemove" | "click" | "wheel"): void {
      armedType = type;
      startedAt = Number.NaN;
    },
    startProgrammatic(): void {
      armedType = "";
      startedAt = performance.now();
    },
    elapsed(): number {
      if (!Number.isFinite(startedAt)) {
        throw new Error(`No trusted ${armedType || "programmatic"} event reached the page clock`);
      }
      return performance.now() - startedAt;
    },
    dispose(): void {
      for (const type of ["mousemove", "click", "wheel"]) {
        document.removeEventListener(type, capture, true);
      }
    },
  };
}

export function insertMutationSentinel(): HTMLElement {
  const slot = document.getElementById("p14-mutation-slot");
  if (!slot) {
    throw new Error("Missing fixture mutation slot");
  }
  const element = document.createElement("p");
  element.dataset.p14Id = "mutation-target";
  element.textContent = "Mutation observer stabilization sentinel with deterministic content.";
  slot.appendChild(element);
  return element;
}

export function rectTop(element: Element | null): number | null {
  if (!element) {
    return null;
  }
  const raw = (element as HTMLElement).style.top;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : element.getBoundingClientRect().top;
}
