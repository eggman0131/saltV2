import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import type { Day, Member } from '@salt/domain';

import MealDayEditor from '../src/routes/mealplan/MealDayEditor.svelte';

// Shop day on the planner (issue #629, restated by #639). The DISPLAY of the
// shop moved out of this component: it is now a rule across the list, drawn by
// MealPlanWeekPage as a sibling of the rows (see MealPlanWeekPage.test.ts). What
// stays here is the CONTROL — the AM/PM picker, which since #640 lives in the
// day's SHEET rather than a panel under the row (tapping the row still raises
// it, and the testids are unchanged) — plus the deletions #639 made: no pre-shop wash, no "using what's in" note, no per-row
// shop pill. MealDayEditor is fully prop-driven, so these render it directly
// with no store mocking; the parent owns which date is which.

const alex: Member = { id: 'm1', name: 'Alex' } as Member;

const noop = () => {};

const emptyDay: Day = { note: '', recipeIds: [], chefs: [], attendees: [], guests: 0 };

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    label: 'Sat',
    sublabel: '15 Aug',
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

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('MealDayEditor — shop day (#629, restated by #639)', () => {
  it('draws no shop pill on the row — the page draws the rule instead', () => {
    const { queryByTestId } = render(MealDayEditor, {
      props: baseProps({ shopSlot: 'am', onShopSlotChange: noop }),
    });
    expect(queryByTestId('day-shop-marker')).not.toBeInTheDocument();
  });

  it('never washes a row grey, whatever its relation to the shop (#639)', () => {
    const { getByTestId } = render(MealDayEditor, {
      props: baseProps({ shopSlot: null, onShopSlotChange: noop }),
    });
    const row = getByTestId('day');
    // The pre-shop shading and the attribute that drove it are both gone.
    expect(row).not.toHaveAttribute('data-pre-shop');
    expect(row.className).not.toContain('bg-muted');
  });

  it('reports the picked slot when a day is marked', async () => {
    const onShopSlotChange = vi.fn();
    const { getByTestId } = render(MealDayEditor, {
      props: baseProps({ shopSlot: null, onShopSlotChange }),
    });
    await fireEvent.click(getByTestId('day-summary')); // raise the day's sheet
    await fireEvent.click(getByTestId('day-shop-pm'));
    expect(onShopSlotChange).toHaveBeenCalledWith('pm');
  });

  it('clears the shop day when the slot already set is tapped again', async () => {
    // One control, three states — no separate "clear" affordance to find.
    const onShopSlotChange = vi.fn();
    const { getByTestId } = render(MealDayEditor, {
      props: baseProps({ shopSlot: 'am', onShopSlotChange }),
    });
    await fireEvent.click(getByTestId('day-summary')); // raise the day's sheet
    await fireEvent.click(getByTestId('day-shop-am'));
    expect(onShopSlotChange).toHaveBeenCalledWith(null);
  });

  it('drops the "using what\'s in" footnote (#639)', async () => {
    const { getByTestId, queryByTestId } = render(MealDayEditor, {
      props: baseProps({ shopSlot: null, onShopSlotChange: noop }),
    });
    await fireEvent.click(getByTestId('day-summary')); // raise the day's sheet
    // The AM/PM control survives; the note that explained the vanished wash does not.
    expect(getByTestId('day-shop')).toBeInTheDocument();
    expect(queryByTestId('day-pre-shop-note')).not.toBeInTheDocument();
  });

  it('stays shop-free in the weekday template editor', async () => {
    // The template editor omits onShopSlotChange (a shop day is a date-only
    // concept), so it gains no shop UI at all.
    const { queryByTestId, getByTestId } = render(MealDayEditor, { props: baseProps() });
    await fireEvent.click(getByTestId('day-summary')); // raise the day's sheet
    expect(queryByTestId('day-shop')).not.toBeInTheDocument();
    expect(queryByTestId('day-shop-marker')).not.toBeInTheDocument();
  });
});
