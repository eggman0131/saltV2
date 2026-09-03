import { describe, expect, it } from 'vitest';

import { isEpicTitle, isLedger, triageVerdict } from '../lib/boardRules.mjs';

describe('isLedger', () => {
  it('matches a campaign ledger, which carries no board fields', () => {
    expect(isLedger('campaign: fold the side nav away (#1143)')).toBe(true);
  });

  // The whole point of the untriaged rule is to catch these, and they are the
  // issue an agent files most often. Exempting them defeats the change.
  it('does NOT match a campaign follow-ups issue, which is ordinary work', () => {
    expect(isLedger('campaign follow-ups: fold the side nav away (#1194)')).toBe(false);
  });

  it('only matches at the start, so an issue merely mentioning one is work', () => {
    expect(isLedger('fix: /campaign: leaves the worktree behind')).toBe(false);
  });

  it('survives a title that is missing', () => {
    expect(isLedger(undefined)).toBe(false);
    expect(isLedger(null)).toBe(false);
  });
});

describe('isEpicTitle', () => {
  it('matches the live epics', () => {
    expect(isEpicTitle('epic: get recipes right — one authoring contract')).toBe(true);
    expect(isEpicTitle('epic: formulas, schedules and batches')).toBe(true);
  });

  // The regression this predicate replaced: both of these hold sub-issues and
  // both belong in a work band.
  it('does not match a work issue that happens to hold sub-issues', () => {
    expect(isEpicTitle('feat: the recipe phase timeline, the phase editor')).toBe(false);
    expect(isEpicTitle('feat: recipe timings as named phases')).toBe(false);
  });

  it('survives a title that is missing', () => {
    expect(isEpicTitle(undefined)).toBe(false);
  });
});

describe('triageVerdict', () => {
  it('a banded item is settled, whatever else is unset', () => {
    expect(triageVerdict({ queue: 'Low', status: null, size: null })).toBe('banded');
  });

  // The state Daniel asked for: the agent could not judge the band, so it said
  // so properly instead of inventing one. This must NOT read as a failure, or
  // the rule punishes the honest answer and gets ignored.
  it('the floor — Triage with a size — is waiting, not a failure', () => {
    expect(triageVerdict({ queue: null, status: 'Triage', size: 'M' })).toBe('waiting');
  });

  it('a floor that is not enforced is not a floor: Triage without a size fails', () => {
    expect(triageVerdict({ queue: null, status: 'Triage', size: null })).toBe('no-size');
  });

  // What adding an issue to the project actually leaves behind: every field
  // empty, Status included. Measured 2026-09-03 across nine open items.
  it('every field empty is abandoned, not waiting', () => {
    expect(triageVerdict({ queue: null, status: null, size: null })).toBe('abandoned');
  });

  it('a later workflow state with no band is abandoned too', () => {
    expect(triageVerdict({ queue: null, status: 'In progress', size: 'S' })).toBe('abandoned');
  });
});
