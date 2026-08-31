import { describe, it, expect } from 'vitest';
import { guidedContainerProblems } from '@salt/domain';
import type { GuidedPrepEntryDoc, GuidedStepNoteDoc } from '@salt/domain/schemas';

// The two ways an author can break the container-name join (issue #761, Phase 2).
// Both are reported, neither is an error: a plan carrying either is still cookable,
// and the point of asking is that the editor can say so while it can still be fixed.

function prep(id: string, container: string | null): GuidedPrepEntryDoc {
  return { id, text: `do ${id}`, container, ingredientIds: [] };
}

function note(stepId: string, container: string | null): GuidedStepNoteDoc {
  return {
    stepId,
    container,
    setup: null,
    cue: null,
    checkIns: [],
    lookahead: null,
    getAhead: null,
  };
}

describe('guidedContainerProblems — duplicate names', () => {
  it('finds nothing wrong with a plan whose bowls are all named apart', () => {
    const result = guidedContainerProblems(
      [prep('p1', 'onion bowl'), prep('p2', 'sugar bowl')],
      [note('s1', 'onion bowl')],
    );
    expect(result.duplicates).toEqual([]);
    expect(result.dangling).toEqual([]);
  });

  it('reports two jobs that set aside into the same-named bowl', () => {
    // The matcher takes the FIRST in plan order, so the second bowl's contents are
    // shown to nobody and the step that asks gets the wrong ones — silently.
    const result = guidedContainerProblems(
      [prep('p1', 'small bowl'), prep('p2', 'small bowl')],
      [],
    );
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]!.name).toBe('small bowl');
    expect(result.duplicates[0]!.prepIds).toEqual(['p1', 'p2']);
  });

  it('reports a clash the matcher would make, through case and whitespace', () => {
    // These are one bowl as far as `prepEntryForContainer` is concerned, so they are
    // one clash here. Reporting them as two distinct names would be a lie.
    const result = guidedContainerProblems(
      [prep('p1', 'Small Bowl'), prep('p2', '  small   bowl ')],
      [],
    );
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]!.prepIds).toEqual(['p1', 'p2']);
  });

  it('names the clash the way the FIRST job wrote it, not normalised', () => {
    // The reader is looking for this string on their own screen.
    const result = guidedContainerProblems(
      [prep('p1', 'Onion Bowl'), prep('p2', 'onion bowl')],
      [],
    );
    expect(result.duplicates[0]!.name).toBe('Onion Bowl');
  });

  it('lists all three when three jobs share a name', () => {
    const result = guidedContainerProblems(
      [prep('p1', 'small bowl'), prep('p2', 'small bowl'), prep('p3', 'small bowl')],
      [],
    );
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]!.prepIds).toEqual(['p1', 'p2', 'p3']);
  });

  it('reports each clashing name separately', () => {
    const result = guidedContainerProblems(
      [
        prep('p1', 'small bowl'),
        prep('p2', 'small bowl'),
        prep('p3', 'jug'),
        prep('p4', 'jug'),
        prep('p5', 'plate'),
      ],
      [],
    );
    expect(result.duplicates.map((d) => d.name)).toEqual(['small bowl', 'jug']);
  });

  it('never calls two jobs that set nothing aside a duplicate', () => {
    // "Open the tin", "Take the butter out" — both `container: null`, and nothing
    // is ever going to ask for either of them.
    const result = guidedContainerProblems([prep('p1', null), prep('p2', null)], []);
    expect(result.duplicates).toEqual([]);
  });

  it('treats a blank container as naming nothing, exactly as null does', () => {
    const result = guidedContainerProblems([prep('p1', '   '), prep('p2', '')], []);
    expect(result.duplicates).toEqual([]);
  });

  it('has nothing to report about an empty plan', () => {
    expect(guidedContainerProblems([], [])).toEqual({ duplicates: [], dangling: [] });
  });
});

describe('guidedContainerProblems — dangling step-note names', () => {
  const PREP = [prep('p1', 'onion bowl'), prep('p2', 'sugar bowl')];

  it('reports a step reaching for a container no job fills', () => {
    const result = guidedContainerProblems(PREP, [note('s1', 'the tureen')]);
    expect(result.dangling).toEqual([{ stepId: 's1', name: 'the tureen' }]);
  });

  it('catches the article the prompt exists to prevent', () => {
    // "onion bowl" on the job and "the onion bowl" on the step is the exact drift
    // the old prompt example taught; the matcher will not bridge it, so the editor
    // has to say so.
    const result = guidedContainerProblems(PREP, [note('s1', 'the onion bowl')]);
    expect(result.dangling.map((d) => d.name)).toEqual(['the onion bowl']);
  });

  it('stays quiet when the step names a job-s container exactly', () => {
    expect(guidedContainerProblems(PREP, [note('s1', 'onion bowl')]).dangling).toEqual([]);
  });

  it('stays quiet when the only difference is case or stray whitespace', () => {
    // The matcher bridges these, so they are not a problem — reporting them would
    // be sending the author to fix something that already works.
    expect(guidedContainerProblems(PREP, [note('s1', ' ONION  bowl ')]).dangling).toEqual([]);
  });

  it('says nothing about a step that wants nothing from the prep list', () => {
    expect(guidedContainerProblems(PREP, [note('s1', null), note('s2', '  ')]).dangling).toEqual(
      [],
    );
  });

  it('reports each offending step, so every one can be found', () => {
    const result = guidedContainerProblems(PREP, [note('s1', 'the tureen'), note('s2', 'the wok')]);
    expect(result.dangling).toEqual([
      { stepId: 's1', name: 'the tureen' },
      { stepId: 's2', name: 'the wok' },
    ]);
  });

  it('says the same thing about one step once', () => {
    // A hand-edited document may hold two notes for a step; one problem, one line.
    const result = guidedContainerProblems(PREP, [
      note('s1', 'the tureen'),
      note('s1', 'The Tureen'),
    ]);
    expect(result.dangling).toHaveLength(1);
  });

  it('dangles everything when the prep list fills nothing at all', () => {
    const result = guidedContainerProblems([prep('p1', null)], [note('s1', 'onion bowl')]);
    expect(result.dangling.map((d) => d.stepId)).toEqual(['s1']);
  });

  it('reports both kinds at once — they are independent faults', () => {
    const result = guidedContainerProblems(
      [prep('p1', 'small bowl'), prep('p2', 'small bowl')],
      [note('s1', 'the tureen')],
    );
    expect(result.duplicates).toHaveLength(1);
    expect(result.dangling).toHaveLength(1);
  });

  it('is pure — reads its inputs and writes nothing', () => {
    const prepList = [prep('p1', 'onion bowl'), prep('p2', 'onion bowl')];
    guidedContainerProblems(prepList, [note('s1', 'the tureen')]);
    expect(prepList.map((p) => p.container)).toEqual(['onion bowl', 'onion bowl']);
  });
});
