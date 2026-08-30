import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { emptyRecipe } from '@salt/domain';
import type { Recipe } from '@salt/domain';

/**
 * The recipe editor's tag field — a characterisation net (issue #1054, Phase 1).
 *
 * WHY THIS EXISTS. The editor has six suites and none of them touches tags, so
 * the rule that turns what you type into a stored tag was unasserted on the
 * client side while the server's `normaliseTags` was pinned by
 * `categoriseRecipe.test.ts`. Issue #1054 Phase 5 deletes the client copy and
 * points both apps at one domain function, which changes one of the answers
 * below. Pinning the CURRENT answers first is what makes that change a one-line
 * diff to a test rather than something absorbed silently (#941 Track B).
 *
 * THE ROW THAT WILL FLIP — Exception 1. `'vegetarian, quick'` arriving in the
 * field as a whole string (a paste, an autofill, a soft keyboard that does not
 * report the comma keydown) is stored today as the single tag
 * `'vegetarian,-quick'`, because the client normaliser kebab-cases whitespace
 * and never splits on commas. After Phase 5 it becomes two tags. Every other row
 * here is unchanged by that phase; a second flipped row means the phase is wrong.
 *
 * THE BOUNDARY OF THAT CLAIM, pinned rather than assumed. Typing the comma as a
 * KEYSTROKE already yields two tags today, because `handleTagKeydown` treats
 * `,` exactly as it treats Enter and commits the buffer before the comma can
 * reach the normaliser. So the divergence between the two implementations is
 * reachable only when the comma arrives inside the value rather than as a key —
 * and both paths are asserted below, so Phase 5 has to leave the keystroke path
 * alone.
 *
 * Driven with `fireEvent`, never `userEvent.type` (UT-F2): the field sits in a
 * page with focus-trapping siblings.
 */

const { mockRecipes, mockCanonItems } = await vi.hoisted(async () => {
  const { makeStore } = await import('./support/testStore.js');
  return {
    mockRecipes: makeStore<readonly Recipe[]>([]),
    mockCanonItems: makeStore<readonly { id: string }[]>([]),
  };
});

vi.mock('svelte-spa-router', () => ({
  push: vi.fn(),
  router: { querystring: undefined },
}));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/recipeService.js', () => ({
  recipes: mockRecipes,
  persistRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  parseIngredients: vi.fn(),
  matchIngredient: vi.fn(),
  takeImportedDraft: vi.fn().mockReturnValue(null),
}));
vi.mock('../src/lib/canonService.js', () => ({ canonItems: mockCanonItems }));

import RecipeEditPage from '../src/routes/recipes/RecipeEditPage.svelte';

/** A stored recipe, built from the domain's own factory (UT-C2). */
function makeRecipe(id: string, tags: string[]): Recipe {
  const base = emptyRecipe(id, '2026-01-01T00:00:00.000Z');
  return { ...base, metadata: { ...base.metadata, tags } };
}

function openEditor(): HTMLElement {
  render(RecipeEditPage, { props: { params: {} } });
  return screen.getByTestId('recipe-tags-input');
}

/** The tags actually on screen, in render order — each chip carries a remove button. */
function tagsOnScreen(): string[] {
  return screen
    .getAllByRole('button', { name: /^Remove / })
    .map((b) => b.getAttribute('aria-label')!.replace(/^Remove /, ''));
}

/** Put a whole string in the field the way a paste does, then commit it with Enter. */
async function pasteAndCommit(field: HTMLElement, raw: string): Promise<void> {
  await fireEvent.input(field, { target: { value: raw } });
  await fireEvent.keyDown(field, { key: 'Enter' });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  mockRecipes._set([]);
  mockCanonItems._set([]);
  vi.clearAllMocks();
});

describe('RecipeEditPage — the tag field, as it behaves today', () => {
  // One row per input shape, each naming itself (UT-D1/D2). These are the CURRENT
  // answers, not the desired ones.
  it.each([
    ['a plain word is stored as typed', 'vegetarian', ['vegetarian']],
    ['capitals are lowercased', 'Vegetarian', ['vegetarian']],
    ['a space becomes a hyphen', 'Comfort Food', ['comfort-food']],
    ['runs of whitespace collapse to one hyphen', 'batch   cook', ['batch-cook']],
    ['surrounding whitespace is trimmed', '   spicy  ', ['spicy']],
    // EXCEPTION 1 (issue #1054): a comma inside the value is kebab-cased rather
    // than split on, so two tags arrive as one malformed one. Phase 5 flips THIS
    // ROW ONLY, to ['vegetarian', 'quick'].
    ['a pasted comma list becomes ONE malformed tag', 'vegetarian, quick', ['vegetarian,-quick']],
  ])('%s', async (_name, raw, expected) => {
    const field = openEditor();
    await pasteAndCommit(field, raw);
    expect(tagsOnScreen()).toEqual(expected);
  });

  it('clears the field after committing a tag', async () => {
    const field = openEditor();
    await pasteAndCommit(field, 'vegetarian');
    expect((field as HTMLInputElement).value).toBe('');
  });

  it('splits on a comma KEYSTROKE — the path Exception 1 does not change', async () => {
    // `handleTagKeydown` commits the buffer on `,` exactly as it does on Enter,
    // so a person typing the list out gets two tags today. This is the boundary
    // of the Exception 1 claim above and must survive Phase 5 unchanged.
    const field = openEditor();
    await fireEvent.input(field, { target: { value: 'vegetarian' } });
    await fireEvent.keyDown(field, { key: ',' });
    await fireEvent.input(field, { target: { value: ' quick' } });
    await fireEvent.keyDown(field, { key: 'Enter' });
    expect(tagsOnScreen()).toEqual(['vegetarian', 'quick']);
  });

  it('does not add a tag that is already on the draft', async () => {
    const field = openEditor();
    await pasteAndCommit(field, 'vegetarian');
    await pasteAndCommit(field, 'Vegetarian');
    expect(tagsOnScreen()).toEqual(['vegetarian']);
  });

  it('adds nothing for whitespace alone, and leaves the field alone', async () => {
    const field = openEditor();
    await fireEvent.input(field, { target: { value: '   ' } });
    await fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.queryAllByRole('button', { name: /^Remove / })).toHaveLength(0);
  });

  it('removes the last tag on Backspace in an empty field', async () => {
    const field = openEditor();
    await pasteAndCommit(field, 'vegetarian');
    await pasteAndCommit(field, 'quick');
    await fireEvent.keyDown(field, { key: 'Backspace' });
    expect(tagsOnScreen()).toEqual(['vegetarian']);
  });

  it('adds a suggestion drawn from other recipes when its chip is clicked', async () => {
    // The suggestion pool is every tag on every stored recipe — which is why a
    // malformed tag created here goes on to be offered on every future draft.
    mockRecipes._set([makeRecipe('r1', ['quick', 'vegetarian,-quick'])]);
    openEditor();

    await fireEvent.click(screen.getByRole('button', { name: '+ quick' }));
    expect(tagsOnScreen()).toEqual(['quick']);

    // An already-normalised suggestion must survive the round trip untouched —
    // the property Phase 5's replacement has to keep.
    await fireEvent.click(screen.getByRole('button', { name: '+ vegetarian,-quick' }));
    expect(tagsOnScreen()).toEqual(['quick', 'vegetarian,-quick']);
  });
});
