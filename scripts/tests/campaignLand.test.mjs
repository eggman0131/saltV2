// Regression for issue #1207. Two claims that `scripts/campaign-land.mjs`'s
// header makes and that nothing enforced, per CLAUDE.md Rule 12:
//
//   1. The enqueue never passes a flag `gh` refuses when a merge queue is
//      enabled. `--delete-branch` is rejected on a flag check, before the PR is
//      even read, so the old call failed on every invocation on this repo.
//   2. Nothing local is touched until the PR is actually in the queue. The old
//      order removed the worktree and deleted the branch first, so every failed
//      landing destroyed local state and enqueued nothing.
//
// Both are asserted against the injected `run` seam rather than a real repo:
// the subject here is the ORDER and the ARGUMENTS, and a fixture proves those
// far more directly than a checkout would.

import { describe, expect, it } from 'vitest';

import { land, mergeArgs } from '../lib/landSteps.mjs';

const PR = '1205';
const BRANCH = 'feat/recipe-phase-timeline-1202';
const WORKTREE = '/repo/.claude/worktrees/recipe-phase-timeline-1202';

/** A `run` that records every call and answers from a scripted outcome map. */
function recorder(outcomes = {}) {
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    for (const [match, result] of Object.entries(outcomes)) {
      if (calls[calls.length - 1].includes(match)) return result;
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  return { calls, run };
}

const base = (run) => ({ pr: PR, branch: BRANCH, worktree: WORKTREE, repo: '/repo', run });

// The exact refusal gh emits, reproduced live against this repo on 2026-09-03.
const QUEUE_REFUSAL = {
  status: 1,
  stdout: '',
  stderr: 'X Cannot use `-d` or `--delete-branch` when merge queue enabled',
};

describe('mergeArgs', () => {
  it('never passes --delete-branch, which a merge queue refuses outright', () => {
    expect(mergeArgs(PR)).not.toContain('--delete-branch');
    expect(mergeArgs(PR)).not.toContain('-d');
  });

  it('keeps --squash and --auto, which a merge queue accepts', () => {
    // The issue's hand-run workaround dropped --auto too; it did not have to,
    // and dropping it would lose enqueue-when-ready. Confirmed live.
    expect(mergeArgs(PR)).toEqual(['pr', 'merge', PR, '--squash', '--auto']);
  });
});

describe('land', () => {
  it('enqueues before touching anything local', () => {
    const { calls, run } = recorder();
    expect(land(base(run)).ok).toBe(true);

    const enqueue = calls.findIndex((c) => c.startsWith('gh pr merge'));
    const removeWorktree = calls.findIndex((c) => c.includes('worktree remove'));
    const deleteBranch = calls.findIndex((c) => c.includes('branch -D'));

    expect(enqueue).toBeGreaterThanOrEqual(0);
    expect(enqueue).toBeLessThan(removeWorktree);
    expect(enqueue).toBeLessThan(deleteBranch);
    // The worktree still has to go before the branch: git refuses to delete a
    // branch that is checked out in one.
    expect(removeWorktree).toBeLessThan(deleteBranch);
  });

  it('leaves the worktree and branch alone when the enqueue fails', () => {
    const { calls, run } = recorder({ 'gh pr merge': QUEUE_REFUSAL });
    const result = land(base(run));

    expect(result.ok).toBe(false);
    expect(calls.some((c) => c.includes('worktree remove'))).toBe(false);
    expect(calls.some((c) => c.includes('branch -D'))).toBe(false);
    expect(result.error).toContain('Nothing local was changed');
  });

  it('reports the enqueue failure verbatim so the reason is not lost', () => {
    const { run } = recorder({ 'gh pr merge': QUEUE_REFUSAL });
    expect(land(base(run)).error).toContain('merge queue enabled');
  });

  it('posts the note before enqueueing, and not at all once that fails', () => {
    const { calls, run } = recorder();
    land({ ...base(run), notePath: '/tmp/note.md' });
    expect(calls[0]).toBe(`gh pr comment ${PR} --body-file /tmp/note.md`);
    expect(calls[1]).toBe(`gh ${mergeArgs(PR).join(' ')}`);
  });

  it('does not enqueue if the note could not be posted', () => {
    const { calls, run } = recorder({ 'gh pr comment': { status: 1, stderr: 'nope' } });
    const result = land({ ...base(run), notePath: '/tmp/note.md' });
    expect(result.ok).toBe(false);
    expect(calls.some((c) => c.startsWith('gh pr merge'))).toBe(false);
  });

  it('skips worktree removal when the branch has no worktree', () => {
    const { calls, run } = recorder();
    expect(land({ ...base(run), worktree: null }).ok).toBe(true);
    expect(calls.some((c) => c.includes('worktree remove'))).toBe(false);
    expect(calls.some((c) => c.includes('branch -D'))).toBe(true);
  });

  it('treats a cleanup failure as a warning, because the PR is already queued', () => {
    // The landing succeeded; a leftover worktree is a tidy-up, not a failure to
    // land, and reporting it as one would send a campaign into recovery it does
    // not need.
    const { run } = recorder({ 'worktree remove': { status: 1, stderr: 'is dirty' } });
    const result = land(base(run));
    expect(result.ok).toBe(true);
    expect(result.lines.join('\n')).toMatch(/warning: could not remove worktree/);
    expect(result.lines.join('\n')).toContain('is enqueued regardless');
  });

  it('says so plainly when there was no local branch to delete', () => {
    const { run } = recorder({ 'branch -D': { status: 1, stderr: 'not found' } });
    const result = land(base(run));
    expect(result.ok).toBe(true);
    expect(result.lines.join('\n')).toContain(`no local branch ${BRANCH} to delete`);
  });
});
