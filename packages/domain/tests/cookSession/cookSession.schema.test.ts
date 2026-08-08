import { describe, it, expect } from 'vitest';
import { CookActiveTimerSchema, CookSessionSchema } from '@salt/domain/schemas';

// A timer's wire shape (issue #748). `id` is its identity; `stepId` is nullable
// (an ad-hoc timer belongs to no step); `label` and `durationMinutes` record what
// was actually started rather than what the recipe step happens to say now.
//
// The back-compat case is the one that matters most: cookSessions have no TTL and
// a cook can span days, so a session written BEFORE these fields existed must
// still parse — otherwise a live timer disappears across a deploy.

const LEGACY = { stepId: 's1', endsAt: '2026-07-22T18:35:00.000Z', notify: true } as const;

describe('CookActiveTimerSchema', () => {
  it('parses a full modern entry verbatim', () => {
    const entry = {
      id: 's1',
      stepId: 's1',
      label: 'Simmer the sauce',
      durationMinutes: 25,
      endsAt: '2026-07-22T18:35:00.000Z',
      notify: true,
    };
    expect(CookActiveTimerSchema.parse(entry)).toEqual(entry);
  });

  it('parses an ad-hoc entry — minted id, no step', () => {
    const parsed = CookActiveTimerSchema.parse({
      id: 'adhoc-1',
      stepId: null,
      label: 'Rice',
      durationMinutes: 12,
      endsAt: '2026-07-22T18:35:00.000Z',
      notify: false,
    });
    expect(parsed.stepId).toBeNull();
    expect(parsed.id).toBe('adhoc-1');
  });

  it('BACK-COMPAT: a legacy { stepId, endsAt, notify } entry parses, id backfilled from stepId', () => {
    const parsed = CookActiveTimerSchema.parse(LEGACY);
    expect(parsed.id).toBe(LEGACY.stepId);
    expect(parsed.stepId).toBe(LEGACY.stepId);
    expect(parsed.label).toBeNull();
    expect(parsed.durationMinutes).toBeNull();
    expect(parsed.endsAt).toBe(LEGACY.endsAt);
    expect(parsed.notify).toBe(true);
  });

  it('does not overwrite an explicit id with the step id', () => {
    const parsed = CookActiveTimerSchema.parse({ ...LEGACY, id: 'adhoc-9' });
    expect(parsed.id).toBe('adhoc-9');
  });

  it('rejects an entry with neither an id nor a step id to backfill from', () => {
    expect(
      CookActiveTimerSchema.safeParse({ stepId: null, endsAt: LEGACY.endsAt, notify: false })
        .success,
    ).toBe(false);
  });
});

describe('CookSessionSchema.activeTimers', () => {
  const base = {
    id: 'r1_u1',
    schemaVersion: 1,
    ownerUid: 'u1',
    recipeId: 'r1',
    recipeUpdatedAtAtStart: '2026-07-01T09:00:00.000Z',
    createdAt: '2026-07-22T18:30:00.000Z',
    updatedAt: '2026-07-22T18:30:00.000Z',
  };

  it('BACK-COMPAT: a whole session written before #748 still parses, timer intact', () => {
    const result = CookSessionSchema.safeParse({ ...base, activeTimers: [LEGACY] });
    expect(result.success).toBe(true);
    expect(result.success && result.data.activeTimers[0]).toEqual({
      id: 's1',
      stepId: 's1',
      label: null,
      durationMinutes: null,
      endsAt: LEGACY.endsAt,
      notify: true,
    });
  });

  it('still defaults activeTimers to [] when the field is absent', () => {
    const result = CookSessionSchema.safeParse(base);
    expect(result.success && result.data.activeTimers).toEqual([]);
  });
});
