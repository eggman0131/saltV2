import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';

import WeatherIcon from '../src/lib/weather-icons/WeatherIcon.svelte';

// WeatherIcon is purely presentational: it resolves a fixed weather-icon id to
// its bundled asset URL (via $lib/weather-icons) and renders a decorative <img>,
// or nothing when there is no icon. No stores to mock — Vite resolves the .webp
// imports under vitest just as it does in a real build, so we assert on the real
// resolved src. (Used as a faint watermark in MealDayEditor; positioning/opacity
// are the caller's job and not under test here.)

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('WeatherIcon', () => {
  it('renders an <img> with a non-empty src for a given icon id', () => {
    const { getByTestId } = render(WeatherIcon, { props: { icon: 'clear-day' } });

    const img = getByTestId('weather-icon-img') as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toBeTruthy();
    // Decorative: hidden from a11y tree, empty alt, not draggable, no pointer.
    expect(img.getAttribute('aria-hidden')).toBe('true');
    expect(img.getAttribute('alt')).toBe('');
    expect(img.className).toContain('pointer-events-none');
  });

  it('renders nothing (no <img>) when the icon is null', () => {
    const { queryByTestId } = render(WeatherIcon, { props: { icon: null } });

    expect(queryByTestId('weather-icon-img')).toBeNull();
  });

  it('renders nothing (no <img>) when the icon is undefined', () => {
    const { queryByTestId } = render(WeatherIcon, { props: { icon: undefined } });

    expect(queryByTestId('weather-icon-img')).toBeNull();
  });

  it('resolves day and night variants to different srcs', () => {
    const day = render(WeatherIcon, { props: { icon: 'clear-day' } });
    const daySrc = (day.getByTestId('weather-icon-img') as HTMLImageElement).getAttribute('src');
    cleanup();

    const night = render(WeatherIcon, { props: { icon: 'clear-night' } });
    const nightSrc = (night.getByTestId('weather-icon-img') as HTMLImageElement).getAttribute(
      'src',
    );

    expect(daySrc).toBeTruthy();
    expect(nightSrc).toBeTruthy();
    expect(daySrc).not.toBe(nightSrc);
  });
});
