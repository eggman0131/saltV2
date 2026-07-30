import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import type { Day, Member, Recipe } from '@salt/domain';
import type { WeatherDaySummary } from '@salt/domain/schemas';

import MealDayEditor from '../src/routes/mealplan/MealDayEditor.svelte';

// The Ledger row (#639, Phase 1): a dated rail (weekday over date, today in a
// filled teal disc), the recipe photograph as a clean rectangle, the meal title
// beneath it, and ONE grey meta line — cook · who is eating, by name · home
// times that have actually been set. The avatar roster it replaces is gone, so
// with it go the per-member chips, the chef-hat badge and the note badge; the
// "No cook" flag survives, inside the meta line. MealDayEditor is fully
// prop-driven, so these render it directly with no store mocking.
//
// The row is also the whole of what renders until it is tapped (#640): the day's
// detail is a sheet now, and an unopened sheet mounts nothing at all.

const alex: Member = { id: 'm1', name: 'Alex' } as Member;
const bea: Member = { id: 'm2', name: 'Bea' } as Member;

const roast: Recipe = {
  id: 'r1',
  title: 'Roast',
  image: { url: 'https://example.test/roast.jpg' },
  updatedAt: '2026-06-30T00:00:00.000Z',
} as unknown as Recipe;

const noop = () => {};

function baseProps(day: Day, weather?: WeatherDaySummary, extra: Record<string, unknown> = {}) {
  return {
    label: 'Mon',
    sublabel: '30',
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
    ...extra,
  };
}

function makeDay(overrides: Partial<Day> = {}): Day {
  return { note: 'Roast', recipeIds: [], chefs: [], attendees: [], guests: 0, ...overrides };
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

describe('MealDayEditor — the Ledger row (#639)', () => {
  it('names the cook and says "Everyone" when the whole household eats', () => {
    const day = makeDay({
      chefs: ['m1'],
      attendees: [
        { memberId: 'm1', homeTime: null, note: '' },
        { memberId: 'm2', homeTime: null, note: '' },
      ],
    });
    const { getByTestId, queryByTestId } = render(MealDayEditor, { props: baseProps(day) });
    const meta = getByTestId('day-meta');
    expect(meta.textContent).toContain('Alex cooking');
    expect(meta.textContent).toContain('Everyone');
    // A cook is assigned, so the "No cook" flag is absent.
    expect(queryByTestId('day-no-cook')).not.toBeInTheDocument();
    // The avatar roster the row replaces is gone entirely.
    expect(queryByTestId('day-chip-m1')).not.toBeInTheDocument();
    expect(queryByTestId('day-cook-m1')).not.toBeInTheDocument();
  });

  it('lists eaters by name when only some are eating, with guests appended', () => {
    const day = makeDay({
      chefs: ['m2'],
      attendees: [{ memberId: 'm1', homeTime: null, note: '' }],
      guests: 2,
    });
    const meta = render(MealDayEditor, { props: baseProps(day) }).getByTestId('day-meta');
    expect(meta.textContent).toContain('Bea cooking');
    expect(meta.textContent).toContain('Alex +2');
    expect(meta.textContent).not.toContain('Everyone');
  });

  it('shows only a home time that has actually been set', () => {
    const day = makeDay({
      chefs: ['m1'],
      attendees: [
        { memberId: 'm1', homeTime: '18:30', note: '' },
        { memberId: 'm2', homeTime: null, note: '' },
      ],
    });
    const meta = render(MealDayEditor, { props: baseProps(day) }).getByTestId('day-meta');
    expect(meta.textContent).toContain('Alex 18:30');
    // Bea has no home time, so she contributes nothing to the times segment.
    expect(meta.textContent).not.toContain('Bea 1');
  });

  it('flags an unassigned day with "No cook"', () => {
    const { queryByTestId } = render(MealDayEditor, { props: baseProps(makeDay()) });
    expect(queryByTestId('day-no-cook')).toBeInTheDocument();
  });

  it('renders the attached recipe photograph as a plain rectangle', () => {
    const day = makeDay({ recipeIds: ['r1'] });
    const { getByTestId } = render(MealDayEditor, {
      props: baseProps(day, undefined, { recipes: [roast] }),
    });
    const img = getByTestId('day-photo') as HTMLImageElement;
    expect(img.getAttribute('src')).toContain('https://example.test/roast.jpg');
    // No text over the photo and no scrim: the title is a sibling, not an overlay.
    expect(getByTestId('day-meal').textContent).toContain('Roast');
  });

  it('gives a photoless day the meal one step larger, with no placeholder tile', () => {
    const { getByTestId, queryByTestId } = render(MealDayEditor, { props: baseProps(makeDay()) });
    expect(queryByTestId('day-photo')).not.toBeInTheDocument();
    expect(getByTestId('day-meal').className).toContain('text-lg');
  });

  it("wears today's date in a filled disc, and no disc on any other day", () => {
    const { getByTestId, unmount } = render(MealDayEditor, {
      props: baseProps(makeDay(), undefined, { isToday: true }),
    });
    expect(getByTestId('day-date').className).toContain('bg-primary');
    unmount();

    const other = render(MealDayEditor, { props: baseProps(makeDay()) });
    expect(other.getByTestId('day-date').className).not.toContain('bg-primary');
  });

  it('shows the evening high/low temperature on the rail', () => {
    const { getByTestId } = render(MealDayEditor, { props: baseProps(makeDay(), sunnyDay) });
    const temp = getByTestId('day-header-temp');
    expect(temp.textContent).toContain('24°');
    expect(temp.textContent).toContain('16°');
  });

  it('omits the temperature when no weather is passed', () => {
    const { queryByTestId } = render(MealDayEditor, { props: baseProps(makeDay()) });
    expect(queryByTestId('day-header-temp')).not.toBeInTheDocument();
  });

  it('is the only thing on screen until it is tapped (#640)', () => {
    const { queryByRole, queryByTestId } = render(MealDayEditor, {
      props: baseProps(makeDay()),
    });
    expect(queryByRole('dialog')).not.toBeInTheDocument();
    expect(queryByTestId('day-detail')).not.toBeInTheDocument();
  });

  it('shows only the first line of a multi-line meal as the title', () => {
    const day = makeDay({ note: 'Roast chicken\nwith all the trimmings' });
    const summary = render(MealDayEditor, { props: baseProps(day) }).getByTestId('day-summary');
    expect(summary.textContent).toContain('Roast chicken');
    expect(summary.textContent).not.toContain('with all the trimmings');
  });
});
