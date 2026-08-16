import { describe, it, expect } from 'vitest';
import { withKitchenTimerStarted, withKitchenTimerDismissed } from '../../src/index.js';
import { KitchenTimersSchema } from '../../src/schemas/index.js';
import type { KitchenTimerDoc, KitchenTimersDoc } from '../../src/schemas/index.js';

// The two producers behind a timer that belongs to nobody's cook (issue #842).
// Both are pure and neither reads a clock: `endsAt` arrives already computed and
// `nowMs` is injected, which is what makes the day-old pruning testable without
// faking time.

const NOW = Date.parse('2026-08-16T18:00:00.000Z');
const MIN = 60_000;
const HOUR = 60 * MIN;

function timer(id: string, endsInMs: number, over: Partial<KitchenTimerDoc> = {}): KitchenTimerDoc {
  return {
    id,
    label: 'Eggs',
    endsAt: new Date(NOW + endsInMs).toISOString(),
    durationMinutes: 10,
    notify: true,
    ...over,
  };
}

function doc(timers: KitchenTimerDoc[] = []): KitchenTimersDoc {
  return { ownerUid: 'uid-a', timers };
}

describe('withKitchenTimerStarted', () => {
  it('adds a timer to an empty kitchen', () => {
    const next = withKitchenTimerStarted(doc(), timer('t1', 10 * MIN), NOW);
    expect(next.timers).toHaveLength(1);
    expect(next.timers[0]?.id).toBe('t1');
  });

  it('keeps the owner untouched', () => {
    const next = withKitchenTimerStarted(doc(), timer('t1', 10 * MIN), NOW);
    expect(next.ownerUid).toBe('uid-a');
  });

  it('never mutates the document it was given', () => {
    const before = doc([timer('t1', 5 * MIN)]);
    withKitchenTimerStarted(before, timer('t2', 10 * MIN), NOW);
    expect(before.timers).toHaveLength(1);
  });

  it('leaves other timers alone', () => {
    const next = withKitchenTimerStarted(doc([timer('t1', 5 * MIN)]), timer('t2', 10 * MIN), NOW);
    expect(next.timers.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  // ONE LIVE TIMER PER ID is the whole of "re-time a running timer": same id, a
  // fresh endsAt, through this same producer.
  it('replaces an entry sharing its id rather than doubling it up', () => {
    const started = withKitchenTimerStarted(doc(), timer('t1', 10 * MIN), NOW);
    const retimed = withKitchenTimerStarted(
      started,
      timer('t1', 25 * MIN, { label: 'Eggs, softer', durationMinutes: 25 }),
      NOW,
    );
    expect(retimed.timers).toHaveLength(1);
    expect(retimed.timers[0]?.label).toBe('Eggs, softer');
    expect(retimed.timers[0]?.durationMinutes).toBe(25);
    expect(retimed.timers[0]?.endsAt).toBe(new Date(NOW + 25 * MIN).toISOString());
  });

  // A fired timer RINGS UNTIL DISMISSED — that is the missed-timer signal, and
  // starting another one must not quietly wipe it.
  it('keeps a timer that fired moments ago', () => {
    const next = withKitchenTimerStarted(doc([timer('t1', -30_000)]), timer('t2', 10 * MIN), NOW);
    expect(next.timers.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('keeps one that fired well within the day', () => {
    const next = withKitchenTimerStarted(doc([timer('t1', -23 * HOUR)]), timer('t2', MIN), NOW);
    expect(next.timers.map((t) => t.id)).toContain('t1');
  });

  // ...but "until dismissed" cannot mean for ever. Anything still ringing a day
  // later was not missed, it was abandoned.
  it('prunes one that has been ringing for more than a day', () => {
    const next = withKitchenTimerStarted(doc([timer('t1', -25 * HOUR)]), timer('t2', MIN), NOW);
    expect(next.timers.map((t) => t.id)).toEqual(['t2']);
  });

  it('prunes several stale timers in one write', () => {
    const stale = doc([timer('t1', -30 * HOUR), timer('t2', -48 * HOUR), timer('t3', 5 * MIN)]);
    const next = withKitchenTimerStarted(stale, timer('t4', MIN), NOW);
    expect(next.timers.map((t) => t.id)).toEqual(['t3', 't4']);
  });

  // A timer nobody can time is the one worth leaving on screen for a human to
  // look at — the same call `timerHeat` makes when it reads NaN as `ringing`.
  it('does not prune a timer whose endsAt cannot be parsed', () => {
    const broken = doc([timer('t1', 0, { endsAt: 'not-a-date' })]);
    const next = withKitchenTimerStarted(broken, timer('t2', MIN), NOW);
    expect(next.timers.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('produces a document the schema still accepts', () => {
    const next = withKitchenTimerStarted(doc(), timer('t1', 10 * MIN), NOW);
    expect(KitchenTimersSchema.safeParse(next).success).toBe(true);
  });
});

describe('withKitchenTimerDismissed', () => {
  it('drops the timer with that id', () => {
    const next = withKitchenTimerDismissed(doc([timer('t1', 5 * MIN), timer('t2', 9 * MIN)]), 't1');
    expect(next.timers.map((t) => t.id)).toEqual(['t2']);
  });

  // Cancel and Dismiss are ONE operation seen from either side of `endsAt`.
  it('drops a fired timer the same way it drops a running one', () => {
    const next = withKitchenTimerDismissed(doc([timer('t1', -MIN)]), 't1');
    expect(next.timers).toEqual([]);
  });

  it('is idempotent for an id with no live timer', () => {
    const before = doc([timer('t1', 5 * MIN)]);
    const next = withKitchenTimerDismissed(before, 'nope');
    expect(next.timers.map((t) => t.id)).toEqual(['t1']);
    // Equal but NOT the same reference, so a dismiss always looks like a write.
    expect(next).not.toBe(before);
  });

  it('never mutates the document it was given', () => {
    const before = doc([timer('t1', 5 * MIN)]);
    withKitchenTimerDismissed(before, 't1');
    expect(before.timers).toHaveLength(1);
  });

  // No soft-delete, no tombstones: dismissed means gone from the array.
  it('leaves nothing behind to be filtered out on read', () => {
    const next = withKitchenTimerDismissed(doc([timer('t1', 5 * MIN)]), 't1');
    expect(next.timers).toEqual([]);
    expect(KitchenTimersSchema.safeParse(next).success).toBe(true);
  });
});

describe('KitchenTimersSchema', () => {
  it('reads a document with no timers array as an empty kitchen', () => {
    const parsed = KitchenTimersSchema.safeParse({ ownerUid: 'uid-a' });
    expect(parsed.success && parsed.data.timers).toEqual([]);
  });

  it('rejects a timer with no duration to sweep the dial with', () => {
    const bad = { ownerUid: 'uid-a', timers: [{ ...timer('t1', MIN), durationMinutes: 0 }] };
    expect(KitchenTimersSchema.safeParse(bad).success).toBe(false);
  });

  // Nullable on the cook schema so a legacy entry can fall back to its step; a
  // standalone timer has no step to fall back to, so a null would be a hole.
  it('rejects a timer with no label', () => {
    const bad = { ownerUid: 'uid-a', timers: [{ ...timer('t1', MIN), label: null }] };
    expect(KitchenTimersSchema.safeParse(bad).success).toBe(false);
  });
});
