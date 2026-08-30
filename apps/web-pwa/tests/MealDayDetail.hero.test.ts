import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { appendCacheBuster, emptyRecipe } from '@salt/domain';
import type { Day, Member, Recipe } from '@salt/domain';

import MealDayDetail from '../src/routes/mealplan/MealDayDetail.svelte';

// This is issue #933's characterisation net for the "hero URL" rule — one of
// eight identical copies of `appendCacheBuster(recipe.image.url,
// recipe.imageRequestedAt ?? recipe.updatedAt)` scattered across web-pwa, here
// at MealDayDetail's attached-recipe row thumbnail
// (`${testid}-recipe-thumb-${id}`). It must stay green, UNMODIFIED, once all
// eight collapse onto one shared `@salt/domain` function. Expectations are
// computed by calling the REAL `appendCacheBuster` rather than hand-encoding a
// query string.
//
// MealDayDetail has no other test file (Phase 1 of #933 is the first suite to
// mount it directly), so this is a minimal, fully prop-driven harness — no
// store mocking needed except `flushMealPlanWrites`, which the component calls
// on blur/destroy and which this file never triggers.

vi.mock('../src/lib/mealPlanService.js', () => ({
  flushMealPlanWrites: vi.fn().mockResolvedValue(undefined),
}));

const alex: Member = { id: 'm1', name: 'Alex' } as Member;

const noop = () => {};
const noopRecipes = (_ids: string[]) => {};

function baseProps(day: Day, recipes: Recipe[]) {
  return {
    day,
    members: [alex],
    testid: 'detail',
    recipes,
    onNoteChange: noop,
    onChefToggle: noop,
    onAttendeeToggle: noop,
    onAttendeeHomeTime: noop,
    onAttendeeNote: noop,
    onGuestsChange: noop,
    // The attached-recipe rows (and their thumbnails) render only when this is
    // present — see MealDayDetail.svelte's own comment beside `{#if
    // onRecipesChange}`.
    onRecipesChange: noopRecipes,
  };
}

function makeDay(overrides: Partial<Day> = {}): Day {
  return { note: 'Dinner', recipeIds: [], chefs: [], attendees: [], guests: 0, ...overrides };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('MealDayDetail — hero URL rule (issue #933 characterisation)', () => {
  it.each([
    { name: 'busts with imageRequestedAt when present', imageRequestedAt: 5000 },
    {
      name: 'falls back to updatedAt when imageRequestedAt is absent',
      imageRequestedAt: undefined,
    },
  ])('$name', ({ imageRequestedAt }) => {
    const url = 'https://example.test/hero-rule.jpg';
    const heroRecipe: Recipe = {
      ...emptyRecipe('hero-rule', '2026-06-30T00:00:00.000Z'),
      title: 'Hero Rule',
      image: { url, source: 'ai' },
      updatedAt: '2026-07-01T00:00:00.000Z',
      ...(imageRequestedAt !== undefined ? { imageRequestedAt } : {}),
    };
    const day = makeDay({ recipeIds: ['hero-rule'] });
    const { getByTestId } = render(MealDayDetail, { props: baseProps(day, [heroRecipe]) });

    expect(getByTestId('detail-recipe-thumb-hero-rule')).toHaveAttribute(
      'src',
      appendCacheBuster(url, imageRequestedAt ?? heroRecipe.updatedAt),
    );
  });

  it('renders the fallback tile, not a thumb, when the attached recipe has no image', () => {
    const noHero: Recipe = {
      ...emptyRecipe('hero-none', '2026-06-30T00:00:00.000Z'),
      title: 'Hero None',
      updatedAt: '2026-07-01T00:00:00.000Z',
    };
    const day = makeDay({ recipeIds: ['hero-none'] });
    const { queryByTestId, getByTestId } = render(MealDayDetail, {
      props: baseProps(day, [noHero]),
    });

    expect(queryByTestId('detail-recipe-thumb-hero-none')).not.toBeInTheDocument();
    expect(getByTestId('detail-recipe-thumb-fallback-hero-none')).toBeInTheDocument();
  });
});
