import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import type { Day, Member } from '@salt/domain';

import MealDayEditor from '../src/routes/mealplan/MealDayEditor.svelte';

// Shop day on the planner (issue #629). Three states per day: the shop itself
// (a marker in the collapsed header), a day BEFORE it ("using what's in" —
// shaded), and an ordinary day. MealDayEditor is fully prop-driven, so these
// render it directly with no store mocking; the parent owns which date is which.

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

describe('MealDayEditor — shop day (#629)', () => {
  it('marks the shop day in the collapsed header so the week reads at a glance', () => {
    const { getByTestId } = render(MealDayEditor, {
      props: baseProps({ shopSlot: 'am', onShopSlotChange: noop }),
    });
    expect(getByTestId('day-shop-marker')).toHaveTextContent('am');
  });

  it('shows no marker on an ordinary day', () => {
    const { queryByTestId } = render(MealDayEditor, {
      props: baseProps({ shopSlot: null, onShopSlotChange: noop }),
    });
    expect(queryByTestId('day-shop-marker')).not.toBeInTheDocument();
  });

  it('shades a day that falls before the shop', () => {
    const { getByTestId } = render(MealDayEditor, {
      props: baseProps({ preShop: true, onShopSlotChange: noop }),
    });
    const card = getByTestId('day');
    expect(card).toHaveAttribute('data-pre-shop', 'true');
    expect(card.className).toContain('bg-muted/50');
  });

  it('does not shade the shop day itself or a day after it', () => {
    const { getByTestId } = render(MealDayEditor, {
      props: baseProps({ shopSlot: 'pm', preShop: false, onShopSlotChange: noop }),
    });
    expect(getByTestId('day')).not.toHaveAttribute('data-pre-shop');
  });

  it('reports the picked slot when a day is marked', async () => {
    const onShopSlotChange = vi.fn();
    const { getByTestId } = render(MealDayEditor, {
      props: baseProps({ shopSlot: null, onShopSlotChange }),
    });
    await fireEvent.click(getByTestId('day-summary')); // expand
    await fireEvent.click(getByTestId('day-shop-pm'));
    expect(onShopSlotChange).toHaveBeenCalledWith('pm');
  });

  it('clears the shop day when the slot already set is tapped again', async () => {
    // One control, three states — no separate "clear" affordance to find.
    const onShopSlotChange = vi.fn();
    const { getByTestId } = render(MealDayEditor, {
      props: baseProps({ shopSlot: 'am', onShopSlotChange }),
    });
    await fireEvent.click(getByTestId('day-summary'));
    await fireEvent.click(getByTestId('day-shop-am'));
    expect(onShopSlotChange).toHaveBeenCalledWith(null);
  });

  it('explains the shading in plain language on a pre-shop day', async () => {
    const { getByTestId } = render(MealDayEditor, {
      props: baseProps({ preShop: true, onShopSlotChange: noop }),
    });
    await fireEvent.click(getByTestId('day-summary'));
    expect(getByTestId('day-pre-shop-note')).toHaveTextContent("Using what's in");
  });

  it('stays shop-free in the weekday template editor', async () => {
    // The template editor omits onShopSlotChange (a shop day is a date-only
    // concept), so it gains no shop UI at all.
    const { queryByTestId, getByTestId } = render(MealDayEditor, { props: baseProps() });
    await fireEvent.click(getByTestId('day-summary'));
    expect(queryByTestId('day-shop')).not.toBeInTheDocument();
    expect(queryByTestId('day-shop-marker')).not.toBeInTheDocument();
  });
});
