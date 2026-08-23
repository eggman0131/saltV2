import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { emptyRecipe } from '@salt/domain';
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
  ...emptyRecipe('r1', '2026-06-30T00:00:00.000Z'),
  title: 'Roast',
  image: { url: 'https://example.test/roast.jpg', source: 'ai' },
  updatedAt: '2026-06-30T00:00:00.000Z',
};

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
  it('names the cook and counts the table (#640)', () => {
    const day = makeDay({
      chefs: ['m1'],
      attendees: [
        { memberId: 'm1', homeTime: null, note: '' },
        { memberId: 'm2', homeTime: null, note: '' },
      ],
    });
    const { getByTestId, queryByTestId } = render(MealDayEditor, { props: baseProps(day) });
    const meta = getByTestId('day-meta');
    // The cook is named, and so is the table when the line has room for it: two
    // short names against a 36-character budget is nowhere near it.
    expect(meta.textContent).toContain('Alex');
    expect(getByTestId('day-eaters').textContent).toBe('Alex, Bea');
    expect(meta.textContent).not.toContain('Everyone');
    expect(meta.textContent).not.toContain('cooking');
    // A cook is assigned, so the "No cook" flag is absent.
    expect(queryByTestId('day-no-cook')).not.toBeInTheDocument();
    // The avatar roster the row replaces is gone entirely.
    expect(queryByTestId('day-chip-m1')).not.toBeInTheDocument();
    expect(queryByTestId('day-cook-m1')).not.toBeInTheDocument();
  });

  it('tallies guests on the end of the names — they have none to give', () => {
    const day = makeDay({
      chefs: ['m2'],
      attendees: [{ memberId: 'm1', homeTime: null, note: '' }],
      guests: 2,
    });
    const { getByTestId } = render(MealDayEditor, { props: baseProps(day) });
    expect(getByTestId('day-meta').textContent).toContain('Bea');
    // The household is named and the guests are counted. Anything else would be
    // inventing names for people the document does not hold.
    expect(getByTestId('day-eaters').textContent).toBe('Alex +2');
  });

  it('falls back to the head count when the names cannot fit, guests included', () => {
    // Five long names blow the line's 36-character budget, so the table gives way
    // to the one thing that survives any width — and a guest eats the same as
    // anyone else, so the number counts them in: 3 members + 2 guests = 5.
    const longRoster = [
      { id: 'm1', name: 'Alexandrina' },
      { id: 'm2', name: 'Beatrice-Rose' },
      { id: 'm3', name: 'Christopher' },
    ];
    const day = makeDay({
      chefs: ['m1'],
      attendees: longRoster.map((m) => ({ memberId: m.id, homeTime: null, note: '' })),
      guests: 2,
    });
    const { getByTestId, queryByTestId } = render(MealDayEditor, {
      props: { ...baseProps(day), members: longRoster },
    });
    expect(queryByTestId('day-eaters')).not.toBeInTheDocument();
    expect(getByTestId('day-meta').textContent).toContain('5');
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
