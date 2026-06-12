import { describe, it, expect } from 'vitest';
import { recipeItemAddDefault } from '@salt/domain';

describe('recipeItemAddDefault', () => {
  it('unmatched (null behavior) → add, no check', () => {
    expect(recipeItemAddDefault(null, 200, undefined)).toEqual({ add: true, check: false });
  });

  it("'needed' → add, no check", () => {
    expect(recipeItemAddDefault('needed', 200, 500)).toEqual({ add: true, check: false });
  });

  it("'check' → add and check", () => {
    expect(recipeItemAddDefault('check', null, undefined)).toEqual({ add: true, check: true });
  });

  it("'stocked' under threshold → neither", () => {
    expect(recipeItemAddDefault('stocked', 200, 500)).toEqual({ add: false, check: false });
  });

  it("'stocked' over threshold → add, no check (treated like needed)", () => {
    expect(recipeItemAddDefault('stocked', 750, 500)).toEqual({ add: true, check: false });
  });

  it("'stocked' with no threshold → neither (can't exceed an undefined threshold)", () => {
    expect(recipeItemAddDefault('stocked', 9999, undefined)).toEqual({ add: false, check: false });
  });

  it("'stocked' with no scaled amount → neither", () => {
    expect(recipeItemAddDefault('stocked', null, 500)).toEqual({ add: false, check: false });
  });

  it("'stocked' exactly at threshold → neither (strict greater-than)", () => {
    expect(recipeItemAddDefault('stocked', 500, 500)).toEqual({ add: false, check: false });
  });
});
