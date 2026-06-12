import { describe, it, expect } from 'vitest';
import { groupItemsByRecipe } from '@salt/domain';
import type { ShoppingListItem, SourceRef } from '@salt/domain';

const NOW = '2026-01-01T00:00:00.000Z';

function makeItem(id: string, overrides: Partial<ShoppingListItem> = {}): ShoppingListItem {
  return {
    id,
    rawText: 'test item',
    notes: '',
    sources: [{ kind: 'manual' }],
    canonId: null,
    matchState: 'pending',
    checked: false,
    needsCheck: false,
    schemaVersion: 1 as const,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function recipeSource(recipeId: string, label?: string): SourceRef {
  return { kind: 'recipe', recipeId, servings: 1, label };
}

describe('groupItemsByRecipe', () => {
  it('groups recipe-sourced items by their recipe', () => {
    const items = [
      makeItem('i1', { sources: [recipeSource('r1', 'Tacos')] }),
      makeItem('i2', { sources: [recipeSource('r1', 'Tacos')] }),
      makeItem('i3', { sources: [recipeSource('r2', 'Soup')] }),
    ];
    const result = groupItemsByRecipe(items);
    expect(result.recipes).toHaveLength(2);
    const tacos = result.recipes.find((r) => r.recipeId === 'r1')!;
    expect(tacos.recipeName).toBe('Tacos');
    expect(tacos.items.map((i) => i.id)).toEqual(['i1', 'i2']);
  });

  it('routes manual items to the Manual bucket', () => {
    const items = [makeItem('m1'), makeItem('r1', { sources: [recipeSource('rec', 'Pasta')] })];
    const result = groupItemsByRecipe(items);
    expect(result.manual.items.map((i) => i.id)).toEqual(['m1']);
    expect(result.recipes).toHaveLength(1);
  });

  it('treats items with no source as manual', () => {
    const items = [makeItem('i1', { sources: [] })];
    const result = groupItemsByRecipe(items);
    expect(result.manual.items).toHaveLength(1);
    expect(result.recipes).toHaveLength(0);
  });

  it('routes checked items to the checked bucket regardless of source', () => {
    const items = [
      makeItem('i1', { checked: true, sources: [recipeSource('r1', 'Tacos')] }),
      makeItem('i2', { checked: true }),
    ];
    const result = groupItemsByRecipe(items);
    expect(result.checked.contributors).toHaveLength(2);
    expect(result.recipes).toHaveLength(0);
    expect(result.manual.items).toHaveLength(0);
  });

  it('sorts recipes alphabetically by name', () => {
    const items = [
      makeItem('i1', { sources: [recipeSource('r1', 'Zucchini Bake')] }),
      makeItem('i2', { sources: [recipeSource('r2', 'Apple Pie')] }),
    ];
    const result = groupItemsByRecipe(items);
    expect(result.recipes.map((r) => r.recipeName)).toEqual(['Apple Pie', 'Zucchini Bake']);
  });

  it('falls back to a generic name when a recipe source has no label', () => {
    const items = [makeItem('i1', { sources: [recipeSource('r1')] })];
    const result = groupItemsByRecipe(items);
    expect(result.recipes[0].recipeName).toBe('Recipe');
  });

  it('orders items within a recipe and manual bucket by createdAt', () => {
    const items = [
      makeItem('m2', { createdAt: '2026-01-02T00:00:00.000Z' }),
      makeItem('m1', { createdAt: '2026-01-01T00:00:00.000Z' }),
    ];
    const result = groupItemsByRecipe(items);
    expect(result.manual.items.map((i) => i.id)).toEqual(['m1', 'm2']);
  });
});
