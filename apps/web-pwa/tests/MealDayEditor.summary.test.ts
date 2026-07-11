import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import type { Day, Member } from '@salt/domain';
import type { WeatherDaySummary } from '@salt/domain/schemas';

import MealDayEditor from '../src/routes/mealplan/MealDayEditor.svelte';

// The restacked collapsed summary (#469): the cook is marked ONCE inside the
// roster (a chef-hat badge on their own avatar, never a duplicate column), the
// evening temperature rides beside the weather glyph in the header, the meal's
// first line sits beneath the avatars, and a "No cook" flag shows only when the
// day is unassigned. MealDayEditor is fully prop-driven, so these render it
// directly with no store mocking.

const alex: Member = { id: 'm1', name: 'Alex' } as Member;
const bea: Member = { id: 'm2', name: 'Bea' } as Member;

const noop = () => {};

function baseProps(day: Day, weather?: WeatherDaySummary) {
  return {
    label: 'Mon',
    sublabel: '30 Jun',
    day,
    members: [alex, bea],
    testid: 'day',
    weather,
    onNoteChange: noop,
    onChefToggle: noop,
    onAttendeeToggle: noop,
    onAttendeeHomeTime: noop,
    onAttendeeNote: noop,
    onGuestsChange: noop,
  };
}

const sunnyDay: WeatherDaySummary = {
  tempHigh: 24,
  tempLow: 16,
  apparentTemp: 23,
  humidity: 40,
  cloudCover: 10,
  precipitationChance: 5,
  weatherCode: 0,
  isDay: true,
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('MealDayEditor — collapsed summary (#469 restack)', () => {
  it('marks the cook once with a chef-hat badge, not a duplicate column', () => {
    const day: Day = {
      note: 'Roast',
      recipeIds: [],
      chefs: ['m1'],
      attendees: [{ memberId: 'm1', homeTime: null, note: '' }],
      guests: 0,
    };
    const { queryByTestId, queryAllByTestId } = render(MealDayEditor, {
      props: baseProps(day),
    });
    // The chef-hat badge sits on the chef's own avatar…
    expect(queryByTestId('day-cook-m1')).toBeInTheDocument();
    // …and there is exactly one avatar chip for that member (no second cook column).
    expect(queryAllByTestId('day-chip-m1')).toHaveLength(1);
    // A cook is assigned, so the "No cook" flag is absent.
    expect(queryByTestId('day-no-cook')).not.toBeInTheDocument();
  });

  it('flags an unassigned day with "No cook"', () => {
    const day: Day = {
      note: 'Roast',
      recipeIds: [],
      chefs: [],
      attendees: [],
      guests: 0,
    };
    const { queryByTestId } = render(MealDayEditor, { props: baseProps(day) });
    expect(queryByTestId('day-cook-m1')).not.toBeInTheDocument();
    expect(queryByTestId('day-no-cook')).toBeInTheDocument();
  });

  it('shows the evening high/low temperature beside the weather glyph', () => {
    const day: Day = {
      note: 'Roast',
      recipeIds: [],
      chefs: [],
      attendees: [],
      guests: 0,
    };
    const { getByTestId } = render(MealDayEditor, { props: baseProps(day, sunnyDay) });
    const temp = getByTestId('day-header-temp');
    expect(temp.textContent).toContain('24°');
    expect(temp.textContent).toContain('16°');
  });

  it('omits the header temperature when no weather is passed', () => {
    const day: Day = {
      note: 'Roast',
      recipeIds: [],
      chefs: [],
      attendees: [],
      guests: 0,
    };
    const { queryByTestId } = render(MealDayEditor, { props: baseProps(day) });
    expect(queryByTestId('day-header-temp')).not.toBeInTheDocument();
  });

  it('shows only the first line of a multi-line meal beneath the avatars', () => {
    const day: Day = {
      note: 'Roast chicken\nwith all the trimmings',
      recipeIds: [],
      chefs: [],
      attendees: [],
      guests: 0,
    };
    const summary = render(MealDayEditor, { props: baseProps(day) }).getByTestId('day-summary');
    expect(summary.textContent).toContain('Roast chicken');
    expect(summary.textContent).not.toContain('with all the trimmings');
  });
});
