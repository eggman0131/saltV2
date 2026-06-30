import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import type { Day, Member } from '@salt/domain';
import type { WeatherDaySummary } from '@salt/domain/schemas';

import MealDayEditor from '../src/routes/mealplan/MealDayEditor.svelte';

// MealDayEditor is fully prop-driven (it imports no stores), so it renders
// directly with a Day/members/weather and no store mocking. These tests pin the
// issue-#387 watermark wiring: the pictogram shows for an in-window day whose
// `weather` carries a weatherCode, and is wholly absent (no <img>, no box) when
// no `weather` is passed — the past / out-of-horizon / template behaviour.

const member: Member = { id: 'm1', name: 'Alex' } as Member;

const day: Day = {
  note: '',
  recipeIds: [],
  chefs: [],
  attendees: [],
  guests: 0,
};

const noop = () => {};

function baseProps(weather?: WeatherDaySummary) {
  return {
    label: 'Mon',
    sublabel: '30 Jun',
    day,
    members: [member],
    testid: 'day-2026-06-30',
    weather,
    onNoteChange: noop,
    onChefToggle: noop,
    onAttendeeToggle: noop,
    onAttendeeHomeTime: noop,
    onAttendeeNote: noop,
    onGuestsChange: noop,
  };
}

// A clear, sunny in-window day: weatherCode 0 + isDay true → a 'clear-day' icon.
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

describe('MealDayEditor — weather watermark (#387)', () => {
  it('renders the watermark when weather carries a weatherCode', () => {
    const { getByTestId } = render(MealDayEditor, { props: baseProps(sunnyDay) });

    const img = getByTestId('weather-icon-img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBeTruthy();
    expect(img.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders no watermark when no weather is passed (past/out-of-horizon/template)', () => {
    const { queryByTestId } = render(MealDayEditor, { props: baseProps(undefined) });

    expect(queryByTestId('weather-icon-img')).toBeNull();
  });

  it('renders no watermark when weather lacks a weatherCode (older cached doc)', () => {
    const noCode: WeatherDaySummary = { ...sunnyDay };
    delete (noCode as { weatherCode?: number }).weatherCode;

    const { queryByTestId } = render(MealDayEditor, { props: baseProps(noCode) });

    expect(queryByTestId('weather-icon-img')).toBeNull();
  });
});
