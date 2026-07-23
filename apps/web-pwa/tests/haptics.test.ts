import { afterEach, describe, expect, it, vi } from 'vitest';
import { isHapticsSupported, tick } from '../src/lib/haptics.js';

// Haptics are progressive enhancement and nothing else: jsdom ships no
// `navigator.vibrate`, and neither does iOS Safari, so the ABSENT case is the
// real-world case for one in five of this app's users. These tests drive the
// three platforms that exist — no API, a working API, and an API that lies —
// and pin that a tap never fails because the phone declined to buzz.

function installVibrate(impl: (pattern: number | readonly number[]) => boolean) {
  Object.defineProperty(navigator, 'vibrate', { value: impl, configurable: true });
}

function removeVibrate() {
  Reflect.deleteProperty(navigator, 'vibrate');
}

afterEach(() => {
  removeVibrate();
});

describe('haptics — an unsupported platform (iOS, and jsdom)', () => {
  it('reports no support', () => {
    expect(isHapticsSupported()).toBe(false);
  });

  it('ticks silently rather than throwing', () => {
    expect(() => tick()).not.toThrow();
  });
});

describe('haptics — a supported platform (Android)', () => {
  it('reports support', () => {
    installVibrate(() => true);
    expect(isHapticsSupported()).toBe(true);
  });

  it('fires exactly one short pulse per tick', () => {
    const vibrate = vi.fn(() => true);
    installVibrate(vibrate);

    tick();

    expect(vibrate).toHaveBeenCalledTimes(1);
    const [pattern] = vibrate.mock.calls[0] as unknown as [number];
    // A tick, not a buzz: one pulse, short enough to read as a tap landing.
    expect(typeof pattern).toBe('number');
    expect(pattern).toBeGreaterThan(0);
    expect(pattern).toBeLessThanOrEqual(20);
  });

  it('swallows a refusal — vibrate needs user activation and may throw', () => {
    installVibrate(() => {
      throw new Error('vibrate requires user activation');
    });

    expect(() => tick()).not.toThrow();
  });
});

describe('haptics — reduced motion', () => {
  const realMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  it('stays silent on a device that could buzz but a user who asked it not to', () => {
    const vibrate = vi.fn(() => true);
    installVibrate(vibrate);
    window.matchMedia = ((query: string) => ({
      media: query,
      matches: query.includes('prefers-reduced-motion'),
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    tick();

    expect(vibrate).not.toHaveBeenCalled();
  });
});
