// The order in which a campaign lands a branch, behind an injected `run` so the
// order itself can be tested. Issue #1207.
//
// WHY THE ORDER IS WORTH A MODULE. The first version cleaned up locally and then
// enqueued, on the stated premise that `--delete-branch`'s local half needs the
// worktree gone first. Both halves of that were wrong on this repo. `gh pr merge`
// refuses `--delete-branch` outright whenever the target branch has a merge queue
// - a flag check, made before the PR is even looked at (confirmed live: the same
// error comes back for an already-merged PR) - so the enqueue failed on every
// single invocation, AFTER the worktree had been removed and the local branch
// deleted. Every landing attempt destroyed local state and enqueued nothing.
//
// Dropping the flag costs nothing: this repo has `delete_branch_on_merge = true`,
// so GitHub deletes the remote branch when the queue merges it. `--squash --auto`
// stay - neither is refused under a queue (also confirmed live; the issue's
// hand-run workaround dropped `--auto` too, but it did not have to).
//
// And with the flag gone, nothing couples the enqueue to local cleanup at all:
// `gh pr merge` acts on a PR number against GitHub and never reads the local
// checkout. So the order inverts, and that inversion - not the flag - is the
// actual fix:
//
//   NOTHING LOCAL IS TOUCHED UNTIL THE PR IS IN THE QUEUE.
//
// which generalises past the reported bug. An auth failure, a rate limit or a
// dropped connection now leaves the worktree and the branch exactly where they
// were, instead of leaving a campaign to rebuild them from the remote.

/**
 * The enqueue command. A named constant because the flag combination is the
 * subject of the regression test - `--delete-branch` must never come back.
 */
export const mergeArgs = (pr) => ['pr', 'merge', pr, '--squash', '--auto'];

/**
 * Post the note, enqueue, then clean up - in that order.
 *
 * `run(cmd, args)` returns `{ status, stderr, stdout }`; injecting it is what
 * lets the ordering guarantee be asserted without a network or a git repo.
 * `worktree` is the path git says holds `branch`, already validated by the
 * caller as sitting under `.claude/worktrees/`, or null.
 *
 * Returns `{ ok, lines, error }`. `lines` is what to print in order; a failure
 * carries `error` and whatever was printed before it. Cleanup failures are
 * warnings, never failures: by then the PR is in the queue, which is the
 * outcome that was asked for, and a stale worktree is a tidy-up rather than a
 * landing that did not happen.
 */
export function land({ pr, branch, worktree, repo, notePath, run }) {
  const lines = [];

  if (notePath) {
    const res = run('gh', ['pr', 'comment', pr, '--body-file', notePath]);
    if (res.status !== 0) {
      return {
        ok: false,
        lines,
        error: `failed to post the note on PR #${pr}: ${(res.stderr || '').trim()}`,
      };
    }
    lines.push(`noted: posted ${notePath} on #${pr}`);
  }

  const merge = run('gh', mergeArgs(pr));
  if (merge.status !== 0) {
    return {
      ok: false,
      lines,
      error: `failed to enqueue PR #${pr}: ${(merge.stderr || merge.stdout || '').trim()}\nNothing local was changed - the worktree and branch are untouched.`,
    };
  }
  lines.push(`enqueued: #${pr} (${branch})`);

  // Only now is anything local touched. The worktree must go before the branch:
  // git refuses to delete a branch that is checked out in one.
  if (worktree) {
    const res = run('git', ['-C', repo, 'worktree', 'remove', worktree]);
    lines.push(
      res.status === 0
        ? `cleaned: removed worktree ${worktree}`
        : `warning: could not remove worktree ${worktree} (${(res.stderr || '').trim()}) - #${pr} is enqueued regardless`,
    );
  }

  const del = run('git', ['-C', repo, 'branch', '-D', branch]);
  lines.push(
    del.status === 0
      ? `cleaned: deleted local branch ${branch}`
      : `cleaned: no local branch ${branch} to delete`,
  );

  return { ok: true, lines };
}
