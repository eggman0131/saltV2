#!/usr/bin/env node
// Measure the residual flake rate of the `Vitest integration (emulator)` CI job
// (issues #944, #941, #1136).
//
// WHY THIS EXISTS
// The emulator suite deliberately carries no `retry` — see the NO-retry block in
// packages/adapters/firebase-sync/vitest.emulator.config.ts, and UT-G3 in
// docs/unit-test-spec.md. That decision is only defensible if somebody knows
// what the suite's actual failure rate is, and until this script existed nobody
// did: the honest answer to "is the emulator suite flaky?" was "nobody has
// looked", and the reflex was to click GitHub's re-run button and move on.
// scripts/soak-unit-tests.mjs makes the same argument for the unit suite ("that
// is unanswerable by re-running: 'it passed twice' and 'it is stable' look
// identical from one green run") and is the tonal model here. It is NOT the
// mechanism: `pnpm soak` runs `pnpm test`, and neither emulator config is in the
// root `projects` list, so it structurally cannot reach these files.
//
// WHAT IT DOES
// Reads history rather than generating it. Every CI run since a given date, and
// for each one the emulator job's outcome, straight off the GitHub Actions API —
// which already retains hundreds of genuine COLD runs, each on a fresh
// ubuntu-latest with `down -v` → `up --wait`. No new instrumentation, and no
// scratch-PR soak that would measure one commit repeatedly instead of the real
// rate across the commits that landed.
//
// IT IS NOT A GATE. It reports; it never fails CI on a finding, and must not be
// made to. Making it blocking would put the merge queue at the mercy of the
// GitHub API's availability, in order to measure a suite that already blocks the
// merge queue on its own. A non-zero rate is a finding to attribute or fix —
// never a reason to restore `retry`, and never a reason to widen CONVERGENCE_MS
// or WARMUP_MS.
//
// The classification is in scripts/lib/emulatorFlakeRate.mjs (pure, unit-tested
// in scripts/tests/emulatorFlakeRate.test.mjs), including the two traps that
// make or break the number: `filter=all`, and excluding skips from the
// denominator.
//
//   pnpm flake:emulator                                       # since #948 merged
//   pnpm flake:emulator --since=2026-08-26 --until=2026-08-31 # a reproducible, dated window
//   pnpm flake:emulator --json                                # machine-readable
//   pnpm flake:emulator --help
//
// Requires `gh` authenticated against the repo. Read-only: it issues GETs and
// writes nothing.

import { spawn } from 'node:child_process';

import {
  createdFilter,
  DEFAULT_SINCE,
  EMULATOR_JOB_NAME,
  formatRate,
  matchedNothing,
  summariseFlakeRate,
} from './lib/emulatorFlakeRate.mjs';

const REPO = 'eggmanorg/salt';
const WORKFLOW = 'ci.yml';

// How many job listings to have in flight. The API is the whole cost here (one
// call per workflow run, several hundred of them); serial takes minutes.
const CONCURRENCY = 8;

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?$/;

const HELP = `Usage: pnpm flake:emulator [--since=DATE] [--until=DATE] [--job="<name>"] [--json]

  --since=DATE  Only CI runs created on or after DATE. Default ${DEFAULT_SINCE}
                (the instant #948 removed \`retry: 2\`).
  --until=DATE  Only CI runs created before DATE. Unbounded (through "now") if
                omitted — which means the same --since returns a growing number
                every day. Pass this whenever the figure needs to be quoted
                somewhere and reproduced later.
  --job=NAME    The ci.yml job to measure. Default "${EMULATOR_JOB_NAME}".
  --json        Emit the summary as JSON instead of prose.
  --help        This.

  DATE is an ISO date (YYYY-MM-DD) or date-time (YYYY-MM-DDTHH:MM:SSZ).
`;

function parseArgs(argv) {
  const opts = {
    since: DEFAULT_SINCE,
    until: undefined,
    job: EMULATOR_JOB_NAME,
    json: false,
    help: false,
  };
  for (const arg of argv) {
    const match = /^--([a-z]+)(?:=(.*))?$/.exec(arg);
    if (!match) throw new Error(`Unrecognised argument: ${arg}`);
    const [, key, value] = match;
    if (key === 'help') opts.help = true;
    else if (key === 'json') opts.json = true;
    else if (key === 'since') opts.since = value;
    else if (key === 'until') opts.until = value;
    else if (key === 'job') opts.job = value;
    else throw new Error(`Unrecognised argument: ${arg}`);
  }
  if (!ISO_PATTERN.test(opts.since)) {
    throw new Error(
      `--since must be an ISO date or date-time (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ), got "${opts.since}"`,
    );
  }
  if (opts.until !== undefined && !ISO_PATTERN.test(opts.until)) {
    throw new Error(
      `--until must be an ISO date or date-time (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ), got "${opts.until}"`,
    );
  }
  return opts;
}

/** `gh api <path>`, parsed. Rejects with gh's own stderr, which says useful
 *  things like "gh auth login" and "HTTP 403 rate limit". */
function ghApiOnce(path, { paginate = false } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['api', path];
    if (paginate) args.push('--paginate', '--slurp');
    const child = spawn('gh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('error', (cause) =>
      reject(new Error(`could not run \`gh\` — is the GitHub CLI installed? (${cause.message})`)),
    );
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim() || `gh api ${path} exited ${code}`));
      try {
        resolve(JSON.parse(out));
      } catch (cause) {
        reject(new Error(`gh api ${path} returned unparseable JSON: ${cause.message}`));
      }
    });
  });
}

// One reading of the window is several hundred API calls, and a 502 somewhere in
// there is ordinary rather than exceptional (one showed up on the very first
// run of this script). A transient 5xx aborting the whole sweep would make the
// measurement feel unreliable when it is the network that was — so retry those,
// and only those. A 401/403/404 is a real answer and is not retried.
const TRANSIENT = /\b(50[0234]|429)\b|Server Error|rate limit/i;

async function ghApi(path, options) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await ghApiOnce(path, options);
    } catch (error) {
      if (attempt >= 4 || !TRANSIENT.test(error.message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    }
  }
}

async function listRunIds(since, until) {
  const path =
    `repos/${REPO}/actions/workflows/${WORKFLOW}/runs` +
    `?created=${encodeURIComponent(createdFilter(since, until))}&per_page=100`;
  const pages = await ghApi(path, { paginate: true });
  return pages.flatMap((page) => page.workflow_runs ?? []).map((run) => run.id);
}

/** `filter=all` is mandatory, not a nicety — the default `filter=latest` returns
 *  only the newest attempt, so a job that failed twice and was re-run green
 *  reports as a clean `success`. That is the exact case being measured. Pinned
 *  by a source-scan assertion in scripts/tests/emulatorFlakeRate.test.mjs, which
 *  reads this function body (not this comment) and reds if the parameter goes.
 *
 *  ASSUMPTION, un-pinned and stated rather than fixed: this reads ONE page and
 *  ignores `body.total_count`, unlike `listRunIds` above, which passes
 *  `{ paginate: true }`. ci.yml declares 9 jobs, one of them a 3-way matrix, so
 *  a run emits 11 records per attempt and would need roughly ten full re-runs
 *  before it overflowed `per_page=100`. The jobs API groups records by attempt
 *  in ASCENDING order (verified live against run 32876589235; undocumented, so
 *  this is still an assumption) — attempt 1's records always land inside the
 *  first 11, so a run can never leave the denominator entirely. Truncation
 *  instead drops the NEWEST attempts: the fail-then-rerun-green shape keeps its
 *  failing attempt and loses the green one, and `classifyRun`'s
 *  failure-beats-success fold returns `failure` either way — no understatement
 *  there. What DOES understate the rate: a run whose early attempts succeeded
 *  and whose ~10th-or-later attempt failed and fell past the boundary reads as
 *  `success`. Not paginated here because pagination costs a second API call on
 *  every one of several hundred runs to defend against a case that has not
 *  occurred; revisit if ci.yml grows a wide matrix. */
async function jobsForRun(runId) {
  const body = await ghApi(`repos/${REPO}/actions/runs/${runId}/jobs?filter=all&per_page=100`);
  return body.jobs ?? [];
}

/** Fixed-size pool over `items`, preserving nothing about order (the summary
 *  sorts what it needs to). Progress goes to stderr so `--json` stays pipeable. */
async function mapPool(items, size, worker) {
  const results = [];
  let next = 0;
  let done = 0;
  const isTty = process.stderr.isTTY;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results.push(await worker(items[index]));
      done += 1;
      if (isTty) process.stderr.write(`\r  ${done}/${items.length} runs read…`);
    }
  });
  await Promise.all(runners);
  if (isTty) process.stderr.write('\r\u001b[K');
  return results;
}

function report(summary, { since, until, runsScanned }) {
  const { records, runs } = summary;
  const windowLabel = until
    ? `${since} .. ${until}`
    : `since ${since} (open-ended — through "now")`;
  const lines = [
    `Residual flake rate — ${summary.jobName}`,
    `  window        ${windowLabel} (${runsScanned} CI runs scanned, ${runs.total} contained the job)`,
    '',
    `  RATE          ${formatRate(summary)}`,
    '',
    `  executed      ${runs.executed}   (${runs.succeeded} green, ${runs.failed} red)`,
    `  skipped       ${runs.skipped}   — non-app PR or branch behind main; a skip PASSES a required check`,
    `  cancelled     ${runs.cancelled}   — superseded PR run (ci.yml concurrency)`,
    // "in flight" is the common case and not the only one: `classifyRun` falls
    // through to `incomplete` for ANY conclusion it does not name, so `neutral`,
    // `action_required` and `stale` land here alongside a genuinely unfinished
    // run. All are excluded from the denominator, which is the intent — none of
    // them executed the suite to a verdict — but the label is narrower than the
    // bucket. Cross-check `records.other` below before reading a large number
    // here as "CI is busy".
    `  in flight     ${runs.incomplete}`,
    // These two count job RECORDS, the rows the API returned, not runs: the
    // per-run fold happens after them. A run that failed twice and was re-run
    // green contributes three records, two re-run attempts and exactly one run,
    // so `job records` is always ≥ the run total above and the two columns are
    // not comparable. `rate` is folded per-run and none of this reaches it.
    `  re-run jobs   ${summary.rerunAttempts}   job records at attempt ≥ 2`,
    `  job records   ${records.total}   (${records.success} success, ${records.failure} failure, ${records.skipped} skipped, ${records.cancelled} cancelled, ${records.other} other)`,
  ];

  if (summary.failures.length > 0) {
    lines.push(
      '',
      `  ${summary.failures.length} failing run${summary.failures.length === 1 ? '' : 's'}:`,
    );
    for (const failure of summary.failures) {
      const shape = failure.attempts.map((a) => `#${a.attempt} ${a.conclusion}`).join(', ');
      lines.push(`    ${failure.branch ?? '?'} — ${shape}`);
      lines.push(`      ${failure.attempts[0].url ?? `run ${failure.runId}`}`);
    }
    lines.push(
      '',
      '  A failure here is a defect to attribute or fix. It is NOT a reason to',
      '  restore `retry` (UT-G3) or to widen CONVERGENCE_MS / WARMUP_MS (UT-F1).',
    );
  }

  return lines.join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }

  const runIds = await listRunIds(opts.since, opts.until);
  if (runIds.length === 0) {
    console.error(
      `No CI runs found since ${opts.since}${opts.until ? ` and before ${opts.until}` : ''}.`,
    );
    process.exitCode = 1;
    return;
  }

  const jobs = (await mapPool(runIds, CONCURRENCY, jobsForRun)).flat();
  const summary = summariseFlakeRate(jobs, { jobName: opts.job });

  // Distinct from a genuine zero-failure rate (which prints happily and exits
  // 0, same as any other rate — this harvester is not a gate): here the job
  // named `opts.job` never showed up in a single one of the runIds.length runs
  // above, which means the instrument failed to measure anything at all — most
  // likely `ci.yml` renamed the job out from under `EMULATOR_JOB_NAME`. Silence
  // on that is exactly the failure mode a caller cannot tell apart from "it
  // measured and found nothing wrong".
  if (matchedNothing(summary)) {
    console.error(
      `${runIds.length} CI run(s) found in window, but none contained a job named "${opts.job}". ` +
        'Check --job, or that ci.yml still names the job this way.',
    );
    process.exitCode = 1;
    return;
  }

  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify({ since: opts.since, until: opts.until ?? null, runsScanned: runIds.length, ...summary }, null, 2)}\n`,
    );
    return;
  }
  process.stdout.write(
    `${report(summary, { since: opts.since, until: opts.until, runsScanned: runIds.length })}\n`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
