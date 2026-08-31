// Turn raw GitHub Actions job records into a residual flake rate for one CI job.
//
// Pure: an array in, a summary out, no I/O. The `gh api` calls live in
// scripts/emulator-flake-rate.mjs, so the part worth testing is testable —
// the same split as specIssueShape.mjs / check-spec-shape.mjs.
//
// ── The two traps this exists to get right ──────────────────────────────────
//
// 1. A RE-RUN TO GREEN IS A FAILURE, NOT A SUCCESS. GitHub's
//    `/actions/runs/{id}/jobs` defaults to `filter=latest`, which returns only
//    the newest attempt: run 32876589235 reports a single `success` there, and
//    `filter=all` shows attempts 1 and 2 both failed before attempt 3 passed.
//    That is the precise case the measurement exists to catch, so the CLI must
//    pass `filter=all` and this file must fold a run's attempts together with
//    failure winning. It counts as ONE failure, not two, and never as a success.
//
// 2. `skipped` AND `cancelled` ARE NOT RUNS. ci.yml skips the emulator job for
//    non-app PRs and for branches behind origin/main, and docs/ci.md records
//    that a skipped required check PASSES. Concurrency cancellation retires
//    superseded PR runs the same way. Neither executed anything, so neither may
//    sit in the denominator — roughly a sixth of the records in a typical
//    window are skips, and counting them dilutes the rate by that much.
//
// ── The limit, stated because it cannot be closed ───────────────────────────
//
// This measures whether the JOB went red, which is the only signal the Actions
// API carries. It cannot say WHICH test row failed — that is in the job log.
// For a one-outcome-per-run job that is the right granularity (see #1136's
// decision record on why the e2e reporter's per-test shape has no analogue
// here), but do not read a rate from this and claim to know the cause.

/** The `name:` of the emulator job in .github/workflows/ci.yml. Matched exactly,
 *  not by substring: `E2E (Playwright)` is a sibling required check and a loose
 *  match would blend the two suites' rates into one meaningless number. */
export const EMULATOR_JOB_NAME = 'Vitest integration (emulator)';

/** Conclusions that mean the job actually ran the suite. `timed_out` is a real
 *  execution that went red — ci.yml bounds this job at 25 minutes precisely so
 *  a wedged stack surfaces, and reading that as "not a run" would hide it. */
const FAILED = new Set(['failure', 'timed_out']);
const SUCCEEDED = new Set(['success']);

/**
 * Fold one run's attempts into a single class. Precedence is deliberate and the
 * order is the whole point: failure beats success so a re-run to green stays a
 * failure; success beats cancelled so a superseded-then-retried run still
 * counts as executed; and anything with no completed attempt is `incomplete`
 * (a run still in flight), which is excluded rather than guessed at.
 *
 * @param {Array<{conclusion: string|null}>} attempts
 * @returns {'failure'|'success'|'cancelled'|'skipped'|'incomplete'}
 */
export function classifyRun(attempts) {
  const conclusions = attempts.map((attempt) => attempt.conclusion);
  if (conclusions.some((c) => FAILED.has(c))) return 'failure';
  if (conclusions.some((c) => SUCCEEDED.has(c))) return 'success';
  if (conclusions.includes('cancelled')) return 'cancelled';
  if (conclusions.includes('skipped')) return 'skipped';
  return 'incomplete';
}

/**
 * @param {Array<object>} jobs Raw job records from `/actions/runs/{id}/jobs?filter=all`.
 *   Records whose `name` is not `jobName` are ignored entirely — a workflow run
 *   that never contained the job contributes nothing, rather than contributing
 *   a zero-failure success and quietly inflating the denominator.
 * @param {{jobName?: string}} [options]
 */
export function summariseFlakeRate(jobs, { jobName = EMULATOR_JOB_NAME } = {}) {
  const matching = jobs.filter((job) => job.name === jobName);

  const records = {
    total: matching.length,
    success: 0,
    failure: 0,
    cancelled: 0,
    skipped: 0,
    other: 0,
  };
  for (const job of matching) {
    if (FAILED.has(job.conclusion)) records.failure += 1;
    else if (SUCCEEDED.has(job.conclusion)) records.success += 1;
    else if (job.conclusion === 'cancelled') records.cancelled += 1;
    else if (job.conclusion === 'skipped') records.skipped += 1;
    else records.other += 1;
  }

  const rerunAttempts = matching.filter((job) => (job.run_attempt ?? 1) > 1).length;

  /** @type {Map<number|string, Array<object>>} */
  const byRun = new Map();
  for (const job of matching) {
    const bucket = byRun.get(job.run_id);
    if (bucket) bucket.push(job);
    else byRun.set(job.run_id, [job]);
  }

  const runs = {
    total: byRun.size,
    executed: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
    incomplete: 0,
  };
  const failures = [];

  for (const [runId, attempts] of byRun) {
    const ordered = [...attempts].sort((a, b) => (a.run_attempt ?? 1) - (b.run_attempt ?? 1));
    const verdict = classifyRun(ordered);
    if (verdict === 'failure') {
      runs.failed += 1;
      runs.executed += 1;
      failures.push({
        runId,
        branch: ordered[0]?.head_branch ?? null,
        completedAt: ordered.at(-1)?.completed_at ?? null,
        // Every attempt, green ones included: "failed twice then passed" is the
        // shape a reader needs to see, and dropping the green attempt would
        // make a re-run-to-green indistinguishable from a run that just failed.
        attempts: ordered.map((job) => ({
          attempt: job.run_attempt ?? 1,
          conclusion: job.conclusion,
          url: job.html_url ?? null,
        })),
      });
    } else if (verdict === 'success') {
      runs.succeeded += 1;
      runs.executed += 1;
    } else {
      runs[verdict] += 1;
    }
  }

  failures.sort((a, b) => Number(b.runId) - Number(a.runId));

  return {
    jobName,
    records,
    rerunAttempts,
    runs,
    // `null`, never 0, when nothing executed. A window with no runs in it has no
    // rate, and printing "0.00%" for one would be the most flattering possible
    // lie about a suite nobody measured.
    rate: runs.executed === 0 ? null : runs.failed / runs.executed,
    failures,
  };
}

/** `0.4%` / `0.00%`-free rendering: an integer count over an integer count is
 *  the honest form at these sample sizes, and the percentage is the gloss. */
export function formatRate(summary) {
  if (summary.rate === null) return 'no executed runs in window — no rate';
  const percent = (summary.rate * 100).toFixed(2).replace(/\.?0+$/, '');
  return `${summary.runs.failed} / ${summary.runs.executed} executed runs (${percent}%)`;
}
