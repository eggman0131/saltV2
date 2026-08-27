import { describe, it, expect, afterEach, vi } from 'vitest';

import { createSavedTick } from '../src/lib/savedTick.svelte.js';

/**
 * The indicator's whole job is that it goes away again, and the going-away is on a
 * timer. Driven here rather than waited on: a real 1.5 s is longer than the suite
 * spends in any one file, so whether the callback ever ran was decided by how busy
 * the host was — it fired on CI and not on macOS, which is how a module this small
 * came to measure differently on the two platforms (#967).
 */
describe('createSavedTick', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows on a save and clears itself once the flash has had its time', () => {
    vi.useFakeTimers();
    const saved = createSavedTick(1500);

    expect(saved.visible).toBe(false);

    saved.flash();
    expect(saved.visible).toBe(true);

    vi.advanceTimersByTime(1499);
    expect(saved.visible).toBe(true);

    vi.advanceTimersByTime(1);
    expect(saved.visible).toBe(false);
  });

  it('reads as one acknowledgement when two fields save in quick succession', () => {
    vi.useFakeTimers();
    const saved = createSavedTick(1500);

    saved.flash();
    vi.advanceTimersByTime(1400);
    // The second save restarts the clock rather than leaving the first one to
    // expire under it — two ticks racing is the thing this indicator exists to
    // avoid, so the second field's confirmation gets its full time.
    saved.flash();

    vi.advanceTimersByTime(1400);
    expect(saved.visible).toBe(true);

    vi.advanceTimersByTime(100);
    expect(saved.visible).toBe(false);
  });
});
