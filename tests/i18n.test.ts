import { describe, expect, it } from "vitest";
import { checkCatalogs } from "../scripts/lib/i18n-check";

describe("localization catalogs", () => {
  it("all four languages have identical keys, no empty values and matching placeholders", () => {
    const problems = checkCatalogs();
    expect(problems).toEqual([]);
  });
});
