import { describe, it, expect } from 'vitest';
import {
  createKitchenTool,
  updateKitchenTool,
  kitchenToolSlug,
  resolveKitchenTool,
} from '../../src/kitchenTool/index.js';
import type { KitchenToolDoc } from '../../src/schemas/kitchenTool.js';

const NOW = '2026-08-22T10:00:00.000Z';

function tool(over: Partial<KitchenToolDoc> & { id: string; label: string }): KitchenToolDoc {
  return {
    schemaVersion: 1,
    matchers: [],
    thumbnail: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as KitchenToolDoc;
}

describe('kitchenToolSlug', () => {
  it('kebab-cases the label the way the seeded vocabulary was written', () => {
    expect(kitchenToolSlug('Mixing bowl')).toBe('mixing-bowl');
    expect(kitchenToolSlug('Potato masher')).toBe('potato-masher');
    // An apostrophe disappears rather than becoming a separator — the seed table
    // says `chefs-knife`, and a tool added by hand has to land on the same id.
    expect(kitchenToolSlug("Chef's knife")).toBe('chefs-knife');
    expect(kitchenToolSlug('Sauté pan')).toBe('saute-pan');
    expect(kitchenToolSlug('  Fish   slice  ')).toBe('fish-slice');
  });
});

describe('createKitchenTool', () => {
  it('mints a slug id, stamps both timestamps and states a null thumbnail', () => {
    const result = createKitchenTool({ label: 'Potato masher', matchers: [] }, [], NOW);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value).toEqual({
      id: 'potato-masher',
      schemaVersion: 1,
      label: 'Potato masher',
      matchers: [],
      // Stated, not omitted: the trigger's edge guard reads exactly this null on
      // the create write to decide to draw.
      thumbnail: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('refuses a label that is blank or slugs to nothing', () => {
    for (const label of ['', '   ', '???']) {
      const result = createKitchenTool({ label, matchers: [] }, [], NOW);
      expect(result.kind).toBe('err');
      if (result.kind === 'err') expect(result.error.kind).toBe('ValidationError');
    }
  });

  it('refuses to overwrite a tool whose id it would collide with', () => {
    // The id is derived from the label, so a plain write would replace a curated
    // tool — its matchers and its drawing — with a blank one.
    const result = createKitchenTool(
      { label: 'mixing bowl', matchers: [] },
      [tool({ id: 'mixing-bowl', label: 'Mixing bowl', matchers: ['batter bowl'] })],
      NOW,
    );

    expect(result.kind).toBe('err');
    if (result.kind === 'err') expect(result.error.kind).toBe('ConflictError');
  });

  it('tidies matchers, dropping blanks, duplicates and repeats of the label', () => {
    const result = createKitchenTool(
      {
        label: 'Frying pan',
        matchers: ['  skillet ', '', 'Skillets', 'frying pan', 'sauté  pan'],
      },
      [],
      NOW,
    );

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    // "Skillets" folds onto "skillet" and the first spelling wins; "frying pan"
    // only repeats the label, which the resolver already competes on equal terms.
    expect(result.value.matchers).toEqual(['skillet', 'sauté pan']);
  });
});

describe('updateKitchenTool', () => {
  it('keeps the id when the label is reworded', () => {
    // The id is the Storage key (`kit-icons/{id}.webp`) — re-slugging on an edit
    // would orphan the drawing and hand the tool a blank one for a typo fix.
    const existing = tool({ id: 'mixing-bowl', label: 'Mixing bowl' });
    const result = updateKitchenTool(existing, { label: 'Large mixing bowl', matchers: [] }, NOW);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.id).toBe('mixing-bowl');
    expect(result.value.label).toBe('Large mixing bowl');
    expect(result.value.updatedAt).toBe(NOW);
  });

  it('carries the drawing and the created date through untouched', () => {
    const existing = tool({
      id: 'whisk',
      label: 'Whisk',
      thumbnail: 'https://example.com/kit/whisk.webp',
    });
    const result = updateKitchenTool(
      existing,
      { label: 'Whisk', matchers: ['balloon whisk'] },
      NOW,
    );

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.thumbnail).toBe('https://example.com/kit/whisk.webp');
    expect(result.value.createdAt).toBe(existing.createdAt);
  });

  it('is the alias write: an appended phrase makes the tool answer to it', () => {
    const existing = tool({ id: 'potato-masher', label: 'Potato masher' });
    const result = updateKitchenTool(
      existing,
      { label: existing.label, matchers: [...existing.matchers, 'masher'] },
      NOW,
    );

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(resolveKitchenTool('masher', [result.value])).toBe(result.value);
  });

  it('makes appending a phrase the tool already answers to a no-op', () => {
    const existing = tool({ id: 'frying-pan', label: 'Frying pan', matchers: ['skillet'] });
    const result = updateKitchenTool(
      existing,
      { label: existing.label, matchers: [...existing.matchers, 'Skillet'] },
      NOW,
    );

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.matchers).toEqual(['skillet']);
  });

  it('refuses a blank label', () => {
    const result = updateKitchenTool(
      tool({ id: 'whisk', label: 'Whisk' }),
      {
        label: '  ',
        matchers: [],
      },
      NOW,
    );

    expect(result.kind).toBe('err');
    if (result.kind === 'err') expect(result.error.kind).toBe('ValidationError');
  });
});
