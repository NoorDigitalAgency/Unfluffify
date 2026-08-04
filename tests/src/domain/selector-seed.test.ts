import { describe, expect, it } from "vitest";

import { applySelectorSeed } from "../../../src/domain/selector-seed";
import { MarkRowSchema } from "../../../src/domain/schema/marking";

const NAV = "/html[1]/body[1]/div[1]/nav[1]";
const PARA = "/html[1]/body[1]/div[1]/main[1]/p[1]";
const ASIDE = "/html[1]/body[1]/div[1]/aside[1]";

describe("selector seeding of a clean session", () => {
  it("keeps default markings the selectors say nothing about", () => {
    const seeded = applySelectorSeed(
      { rows: [{ xpath: NAV, excluded: true }] },
      { excludeXpaths: [], includeXpaths: [] },
    );

    expect(seeded.rows).toEqual([{ xpath: NAV, excluded: true }]);
  });

  it("lets an inclusion selector override a default exclusion", () => {
    const seeded = applySelectorSeed(
      { rows: [{ xpath: NAV, excluded: true }, { xpath: ASIDE, excluded: true }] },
      { excludeXpaths: [], includeXpaths: [NAV] },
    );

    expect(seeded.rows).toEqual([
      { xpath: NAV, excluded: false, explicit: true },
      { xpath: ASIDE, excluded: true },
    ]);
  });

  it("adds an exclusion the defaults never made", () => {
    const seeded = applySelectorSeed(
      { rows: [{ xpath: NAV, excluded: true }] },
      { excludeXpaths: [PARA], includeXpaths: [] },
    );

    expect(seeded.rows).toContainEqual({ xpath: PARA, excluded: true, explicit: true });
  });

  it("marks every seeded row explicit so it behaves as an operator mark", () => {
    // Non-explicit rows can be stripped by the widening logic; a decision that
    // came from the AI must survive the same way a click would.
    const seeded = applySelectorSeed(
      { rows: [] },
      { excludeXpaths: [NAV], includeXpaths: [PARA] },
    );

    expect(seeded.rows).toEqual([
      { xpath: NAV, excluded: true, explicit: true },
      { xpath: PARA, excluded: false, explicit: true },
    ]);
  });

  it("keeps an element named by both sets, because dropping content is worse", () => {
    const seeded = applySelectorSeed(
      { rows: [] },
      { excludeXpaths: [PARA], includeXpaths: [PARA] },
    );

    expect(seeded.rows).toEqual([{ xpath: PARA, excluded: false, explicit: true }]);
  });

  it("never seeds the document roots, which are not markable", () => {
    const seeded = applySelectorSeed(
      { rows: [] },
      { excludeXpaths: ["/html[1]", "/HTML[1]/BODY[1]", ""], includeXpaths: ["/html[1]/body[1]"] },
    );

    expect(seeded.rows).toEqual([]);
  });

  it("produces rows the mark schema accepts", () => {
    const seeded = applySelectorSeed({ rows: [] }, { excludeXpaths: [NAV], includeXpaths: [PARA] });

    for (const row of seeded.rows) {
      expect(() => MarkRowSchema.parse(row)).not.toThrow();
    }
  });

  it("does not mutate the mark set it was given", () => {
    const original = { rows: [{ xpath: NAV, excluded: true }] };

    applySelectorSeed(original, { excludeXpaths: [PARA], includeXpaths: [NAV] });

    expect(original.rows).toEqual([{ xpath: NAV, excluded: true }]);
  });
});
