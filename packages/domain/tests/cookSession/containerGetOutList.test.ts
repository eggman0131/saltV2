import { describe, it, expect } from 'vitest';
import { containerGetOutList, guidedGetOutProgress, withContainerChecked } from '@salt/domain';
import type { CookSessionDoc, GuidedPrepEntryDoc } from '@salt/domain/schemas';

// The Get-out stage's three pieces (issue #761, Phase 3): the vessels a plan names,
// how far through fetching them the cook is, and the tick itself.
//
// The governing property is COUNTING: the stage exists so that the number of rows
// answers "how many bowls?" before the first cut. Every case below is really asking
// whether the count is still right — for a well-formed plan, for one that repeats a
// name, and for jobs that set nothing aside at all.

function prep(id: string, container: string | null): GuidedPrepEntryDoc {
  return { id, text: `do ${id}`, container, ingredientIds: [] };
}

function session(checkedContainerNames: string[]): CookSessionDoc {
  return {
    id: 'r1_u1',
    schemaVersion: 1,
    ownerUid: 'u1',
    recipeId: 'r1',
    recipeUpdatedAtAtStart: '2026-07-01T09:00:00.000Z',
    checkedIngredientIds: ['i1'],
    checkedPrepIds: ['p1'],
    checkedContainerNames,
    completedStepIds: ['s1'],
    activeTimers: [],
    createdAt: '2026-08-08T18:30:00.000Z',
    updatedAt: '2026-08-08T18:30:00.000Z',
  };
}

describe('containerGetOutList', () => {
  it('lists every container the plan names, in plan order', () => {
    const rows = containerGetOutList([
      prep('p1', 'onion bowl'),
      prep('p2', 'sugar bowl'),
      prep('p3', 'jug'),
    ]);
    expect(rows.map((r) => r.name)).toEqual(['onion bowl', 'sugar bowl', 'jug']);
    // Unique names, so the grouping is invisible and the row count IS the count.
    expect(rows.map((r) => r.count)).toEqual([1, 1, 1]);
  });

  it('counts a repeated name once, with how many bowls it stands for', () => {
    // A stored plan can still repeat a name — an older plan, or a hand-edit — and
    // the cook needs two small bowls out, not one.
    const rows = containerGetOutList([
      prep('p1', 'small bowl'),
      prep('p2', 'small bowl'),
      prep('p3', 'jug'),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'small bowl', count: 2 });
    expect(rows[1]).toMatchObject({ name: 'jug', count: 1 });
  });

  it('groups by the one normaliser, so case and spacing are the same bowl', () => {
    // The same answer `prepEntryForContainer` gives. Two rows here would send the
    // cook for a bowl that does not exist.
    const rows = containerGetOutList([prep('p1', 'Small Bowl'), prep('p2', '  small   bowl ')]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.count).toBe(2);
  });

  it('shows the name the FIRST job authored, never the normalised form', () => {
    // The cook is about to write this on a bowl and read it back off a step note.
    const rows = containerGetOutList([prep('p1', 'Onion Bowl'), prep('p2', 'onion bowl')]);
    expect(rows[0]!.name).toBe('Onion Bowl');
    expect(rows[0]!.key).toBe('onion bowl');
  });

  it('trims the authored name without otherwise touching it', () => {
    expect(containerGetOutList([prep('p1', '  Le Creuset  ')])[0]!.name).toBe('Le Creuset');
  });

  it('ignores a job that sets nothing aside', () => {
    // "Open the tin", "Take the butter out" — no vessel to fetch.
    expect(containerGetOutList([prep('p1', null), prep('p2', 'jug')]).map((r) => r.name)).toEqual([
      'jug',
    ]);
  });

  it('treats a blank container as naming nothing, exactly as null does', () => {
    expect(containerGetOutList([prep('p1', '   '), prep('p2', '')])).toEqual([]);
  });

  it('is empty for a plan that names no containers at all — the stage is skipped', () => {
    expect(containerGetOutList([prep('p1', null)])).toEqual([]);
    expect(containerGetOutList([])).toEqual([]);
  });

  it('is pure — reads the plan and writes nothing', () => {
    const plan = [prep('p1', 'onion bowl'), prep('p2', 'onion bowl')];
    containerGetOutList(plan);
    expect(plan.map((p) => p.container)).toEqual(['onion bowl', 'onion bowl']);
  });
});

describe('guidedGetOutProgress', () => {
  const ROWS = containerGetOutList([
    prep('p1', 'onion bowl'),
    prep('p2', 'sugar bowl'),
    prep('p3', 'jug'),
  ]);

  it('counts nothing out to start with', () => {
    expect(guidedGetOutProgress(ROWS, new Set())).toEqual({
      total: 3,
      checked: 0,
      allChecked: false,
    });
  });

  it('counts the rows ticked, by their normalised key', () => {
    expect(guidedGetOutProgress(ROWS, new Set(['onion bowl', 'jug']))).toMatchObject({
      total: 3,
      checked: 2,
      allChecked: false,
    });
  });

  it('is done only when every row is out', () => {
    const all = new Set(ROWS.map((r) => r.key));
    expect(guidedGetOutProgress(ROWS, all).allChecked).toBe(true);
  });

  it('counts over the ROWS, never over the session-s list', () => {
    // A tick for a bowl the plan has since renamed must not inflate the count or
    // make an unfinished bench read as gathered — the same direction `miseProgress`
    // and `guidedMiseProgress` take.
    const progress = guidedGetOutProgress(ROWS, new Set(['tureen', 'gone', 'onion bowl']));
    expect(progress).toEqual({ total: 3, checked: 1, allChecked: false });
  });

  it('counts a repeated name as the one row it renders as', () => {
    const rows = containerGetOutList([prep('p1', 'small bowl'), prep('p2', 'small bowl')]);
    expect(guidedGetOutProgress(rows, new Set(['small bowl']))).toEqual({
      total: 1,
      checked: 1,
      allChecked: true,
    });
  });

  it('is never "done" with nothing to fetch — 0 of 0 out is not an accomplishment', () => {
    expect(guidedGetOutProgress([], new Set())).toEqual({
      total: 0,
      checked: 0,
      allChecked: false,
    });
  });
});

describe('withContainerChecked', () => {
  // [starting names, toggled name, expected names]
  const cases: Array<[string[], string, string[]]> = [
    [[], 'onion bowl', ['onion bowl']],
    [['onion bowl'], 'jug', ['onion bowl', 'jug']],
    [['onion bowl'], 'onion bowl', []],
    [['a', 'b', 'c'], 'b', ['a', 'c']],
  ];

  it.each(cases)('%j toggled by %s = %j', (start, name, expected) => {
    expect(withContainerChecked(session(start), name).checkedContainerNames).toEqual(expected);
  });

  it('stores the NORMALISED name, whichever form the row hands it', () => {
    // The tick has to survive a later case or whitespace edit to the plan, and the
    // group's identity is the normalised name.
    expect(withContainerChecked(session([]), '  Small   Bowl ').checkedContainerNames).toEqual([
      'small bowl',
    ]);
  });

  it('unticks a row whose name has since been recased', () => {
    expect(
      withContainerChecked(session(['small bowl']), 'Small Bowl').checkedContainerNames,
    ).toEqual([]);
  });

  it('round-trips: toggling the same name twice restores the original set', () => {
    const s = session(['onion bowl']);
    const back = withContainerChecked(withContainerChecked(s, 'jug'), 'jug');
    expect(back.checkedContainerNames).toEqual(s.checkedContainerNames);
  });

  it('is pure — never mutates the input session', () => {
    const s = session(['onion bowl']);
    withContainerChecked(s, 'jug');
    withContainerChecked(s, 'onion bowl');
    expect(s.checkedContainerNames).toEqual(['onion bowl']);
  });

  it('returns a new session and leaves updatedAt / every other list alone', () => {
    const s = session([]);
    const next = withContainerChecked(s, 'jug');
    expect(next).not.toBe(s);
    expect(next.updatedAt).toBe(s.updatedAt);
    // Three tick lists, three separate facts: a bowl on the bench is not a job done
    // and neither is an ingredient fetched.
    expect(next.checkedPrepIds).toEqual(s.checkedPrepIds);
    expect(next.checkedIngredientIds).toEqual(s.checkedIngredientIds);
    expect(next.completedStepIds).toEqual(s.completedStepIds);
  });

  it('keeps a tick for a container the plan no longer names', () => {
    const next = withContainerChecked(session(['gone', 'jug']), 'onion bowl');
    expect(next.checkedContainerNames).toEqual(['gone', 'jug', 'onion bowl']);
  });

  it('cannot duplicate a name', () => {
    const next = withContainerChecked(withContainerChecked(session([]), 'jug'), 'jug');
    expect(next.checkedContainerNames).toEqual([]);
  });

  it('copies the list instead of aliasing the caller-s array', () => {
    const start: string[] = [];
    const next = withContainerChecked(session(start), 'jug');
    expect(next.checkedContainerNames).not.toBe(start);
    expect(start).toEqual([]);
  });
});
