import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import type { Day, Member, Recipe } from '@salt/domain';

import MealDayEditor from '../src/routes/mealplan/MealDayEditor.svelte';

// Shop day and the day editor (issue #629, restated by #639, moved by #640).
//
// Nothing about the shop lives in this component any more. The DISPLAY left in
// #639 (a rule across the list, drawn by MealPlanWeekPage as a sibling of the
// rows) and the CONTROL left in #640 Phase 4: which day you shop is a fact about
// the WEEK, so it is set once at the week's own altitude — see
// MealPlanWeekPage.test.ts for the picker's coverage.
//
// What this file guards is the absence: a day's sheet offers no shop UI, in
// EITHER of the component's two shapes (the planner's dated day and the weekday
// template editor), so the edited-here / displayed-there split cannot come back.
// MealDayEditor is fully prop-driven, so these render it directly with no store
// mocking.

const alex: Member = { id: 'm1', name: 'Alex' } as Member;

const noop = () => {};

const emptyDay: Day = { note: '', recipeIds: [], chefs: [], attendees: [], guests: 0 };

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    label: 'Sat',
    day: emptyDay,
    members: [alex],
    testid: 'day',
    onNoteChange: noop,
    onChefToggle: noop,
    onAttendeeToggle: noop,
    onAttendeeHomeTime: noop,
    onAttendeeNote: noop,
    onGuestsChange: noop,
    ...overrides,
  };
}

// The planner's shape: every prop the dated week editor passes that the weekday
// template editor does not. This is the shape that used to carry the shop block.
function plannerProps(overrides: Record<string, unknown> = {}) {
  return baseProps({
    sublabel: '15',
    sheetTitle: 'Saturday 15 August',
    isToday: true,
    recipes: [] as readonly Recipe[],
    onRecipesChange: noop,
    onRecipeAddToList: noop,
    ...overrides,
  });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('MealDayEditor — the day knows nothing about the shop (#629/#639/#640)', () => {
  it('draws no shop pill on the row — the page draws the rule instead', () => {
    const { queryByTestId } = render(MealDayEditor, { props: plannerProps() });
    expect(queryByTestId('day-shop-marker')).not.toBeInTheDocument();
  });

  it('never washes a row grey, whatever its relation to the shop (#639)', () => {
    const { getByTestId } = render(MealDayEditor, { props: plannerProps() });
    const row = getByTestId('day');
    // The pre-shop shading and the attribute that drove it are both gone.
    expect(row).not.toHaveAttribute('data-pre-shop');
    expect(row.className).not.toContain('bg-muted');
  });

  it('offers no shop control in the planner day sheet (#640, Phase 4)', async () => {
    const { getByTestId, queryByTestId } = render(MealDayEditor, { props: plannerProps() });
    await fireEvent.click(getByTestId('day-summary')); // raise the day's sheet
    // The sheet is open (its detail is mounted) and holds no shop UI at all.
    expect(getByTestId('day-detail')).toBeInTheDocument();
    expect(queryByTestId('day-shop')).not.toBeInTheDocument();
    expect(queryByTestId('day-shop-am')).not.toBeInTheDocument();
    expect(queryByTestId('day-shop-pm')).not.toBeInTheDocument();
    // …nor the footnote that once explained the vanished pre-shop wash (#639).
    expect(queryByTestId('day-pre-shop-note')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Shopping day');
  });

  it('stays shop-free in the weekday template editor', async () => {
    const { queryByTestId, getByTestId } = render(MealDayEditor, { props: baseProps() });
    await fireEvent.click(getByTestId('day-summary')); // raise the day's sheet
    expect(queryByTestId('day-shop')).not.toBeInTheDocument();
    expect(queryByTestId('day-shop-marker')).not.toBeInTheDocument();
  });

  it('still gates its optional blocks on prop presence, shop props gone (#640)', async () => {
    // Removing shopSlot/onShopSlotChange removed one of the props that told the
    // two shapes apart; the rest still gate correctly, so the template editor is
    // recipe-free and dateless while the planner day is neither.
    const template = render(MealDayEditor, { props: baseProps() });
    await fireEvent.click(template.getByTestId('day-summary'));
    expect(template.queryByTestId('day-recipes')).not.toBeInTheDocument();
    expect(template.queryByTestId('day-date')).not.toBeInTheDocument();
    cleanup();
    document.body.innerHTML = '';

    const planner = render(MealDayEditor, { props: plannerProps() });
    await fireEvent.click(planner.getByTestId('day-summary'));
    expect(planner.getByTestId('day-recipes')).toBeInTheDocument();
    expect(planner.getByTestId('day-date')).toBeInTheDocument();
  });
});
