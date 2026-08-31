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
//   pnpm flake:emulator                       # since #948 merged
//   pnpm flake:emulator --since=2026-08-26    # any ISO date
//   pnpm flake:emulator --json                # machine-readable
//   pnpm flake:emulator --help
//
// Requires `gh` authenticated against the repo. Read-only: it issues GETs and
// writes nothing.

import { spawn } from 'node:child_process';

import {
  EMULATOR_JOB_NAME,
  formatRate,
  summariseFlakeRate,
} from './lib/emulatorFlakeRate.mjs';

const REPO = 'eggmanorg/salt';
const WORKFLOW = 'ci.yml';

// #948 removed `retry: 2`. Every run before it was insured against exactly the
// flake being measured, so it is the earliest date at which the number means
// what it says. Overridable, but this is the default for a reason.
const DEFAULT_SINCE = '2026-08-23';

// How many job listings to have in flight. The API is the whole cost here (one
// call per workflow run, several hundred of them); serial takes minutes.
const CONCURRENCY = 8;

const HELP = `Usage: pnpm flake:emulator [--since=YYYY-MM-DD] [--job="<name>"] [--json]

  --since=DATE  Only CI runs created on or after DATE. Default ${DEFAULT_SINCE}
                (the day #948 removed \`retry: 2\`).
  --job=NAME    The ci.yml job to measure. Default "${EMULATOR_JOB_NAME}".
  --json        Emit the summary as JSON instead of prose.
  --help        This.
`;

function parseArgs(argv) {
  const opts = { since: DEFAULT_SINCE, job: EMULATOR_JOB_NAME, json: false, help: false };
  for (const arg of argv) {
    const match = /^--([a-z]+)(?:=(.*))?$/.exec(arg);
    if (!match) throw new Error(`Unrecognised argument: ${arg}`);
    const [, key, value] = match;
    if (key === 'help') opts.help = true;
    else if (key === 'json') opts.json = true;
    else if (key === 'since') opts.since = value;
    else if (key === 'job') opts.job = value;
    else throw new Error(`Unrecognised argument: ${arg}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.since)) {
    throw new Error(`--since must be an ISO date (YYYY-MM-DD), got "${opts.since}"`);
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

async function listRunIds(since) {
  const path =
    `repos/${REPO}/actions/workflows/${WORKFLOW}/runs` +
    `?created=${encodeURIComponent(`>=${since}`)}&per_page=100`;
  const pages = await ghApi(path, { paginate: true });
  return pages.flatMap((page) => page.workflow_runs ?? []).map((run) => run.id);
}

/** `filter=all` is mandatory, not a nicety — the default `filter=latest` returns
 *  only the newest attempt, so a job that failed twice and was re-run green
 *  reports as a clean `success`. That is the exact case being measured. */
async function jobsForRun(runId) {
  const body = await ghApi(
    `repos/${REPO}/actions/runs/${runId}/jobs?filter=all&per_page=100`,
  );
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

function report(summary, { since, runsScanned }) {
  const { records, runs } = summary;
  const lines = [
    `Residual flake rate — ${summary.jobName}`,
    `  window        since ${since} (${runsScanned} CI runs scanned, ${runs.total} contained the job)`,
    '',
    `  RATE          ${formatRate(summary)}`,
    '',
    `  executed      ${runs.executed}   (${runs.succeeded} green, ${runs.failed} red)`,
    `  skipped       ${runs.skipped}   — non-app PR or branch behind main; a skip PASSES a required check`,
    `  cancelled     ${runs.cancelled}   — superseded PR run (ci.yml concurrency)`,
    `  in flight     ${runs.incomplete}`,
    `  re-run jobs   ${summary.rerunAttempts}   job records at attempt ≥ 2`,
    `  job records   ${records.total}   (${records.success} success, ${records.failure} failure, ${records.skipped} skipped, ${records.cancelled} cancelled, ${records.other} other)`,
  ];

  if (summary.failures.length > 0) {
    lines.push('', `  ${summary.failures.length} failing run${summary.failures.length === 1 ? '' : 's'}:`);
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

  const runIds = await listRunIds(opts.since);
  if (runIds.length === 0) {
    console.error(`No CI runs found since ${opts.since}.`);
    process.exitCode = 1;
    return;
  }

  const jobs = (await mapPool(runIds, CONCURRENCY, jobsForRun)).flat();
  const summary = summariseFlakeRate(jobs, { jobName: opts.job });

  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ since: opts.since, runsScanned: runIds.length, ...summary }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${report(summary, { since: opts.since, runsScanned: runIds.length })}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
