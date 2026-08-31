import { describe, expect, it } from 'vitest';

import {
  classifyRun,
  createdFilter,
  DEFAULT_SINCE,
  EMULATOR_JOB_NAME,
  formatRate,
  matchedNothing,
  summariseFlakeRate,
} from '../lib/emulatorFlakeRate.mjs';

// The whole value of this measurement is in three counting decisions, and every
// one of them is a way the number can be flatteringly wrong:
//
//   1. a job re-run to green is a FAILURE. GitHub's default `filter=latest`
//      shows only the winning attempt, so the honest reading of run 32876589235
//      is "failed, failed, then passed" and the flattering one is "success".
//   2. `skipped` is not a run. ci.yml skips the job for non-app PRs and for
//      branches behind main, and a skipped required check PASSES — so skips are
//      both numerous and invisible, and leaving them in the denominator deflates
//      the rate by roughly a sixth.
//   3. `cancelled` is not a run either (superseded PR runs).
//
// Each gets a test that goes red if the count moves, which is the pin CLAUDE.md
// rule 12 asks for: the script's header claims it handles these, and this file
// is what makes that claim checkable rather than decorative.

/** A job record shaped like the GitHub Actions API's, carrying only the fields
 *  the summariser reads. Defaults to the emulator job so a test naming another
 *  job name is visibly doing so on purpose. */
const job = (overrides) => ({
  name: EMULATOR_JOB_NAME,
  run_id: 1,
  run_attempt: 1,
  conclusion: 'success',
  html_url: 'https://github.com/eggmanorg/salt/actions/runs/1/job/1',
  head_branch: 'main',
  completed_at: '2026-08-30T00:00:00Z',
  ...overrides,
});

describe('classifyRun — attempt precedence', () => {
  it('reads a failed-then-re-run-green run as a failure, not a success', () => {
    expect(classifyRun([{ conclusion: 'failure' }, { conclusion: 'success' }])).toBe('failure');
  });

  it('counts timed_out as an execution that went red, not as a non-run', () => {
    expect(classifyRun([{ conclusion: 'timed_out' }])).toBe('failure');
  });

  it('lets a success outrank a cancelled earlier attempt', () => {
    expect(classifyRun([{ conclusion: 'cancelled' }, { conclusion: 'success' }])).toBe('success');
  });

  it('reports a run whose only attempt has no conclusion yet as incomplete', () => {
    expect(classifyRun([{ conclusion: null }])).toBe('incomplete');
  });
});

describe('summariseFlakeRate — the denominator', () => {
  it('counts a re-run-to-green as one failure and never as a success', () => {
    const summary = summariseFlakeRate([
      job({ run_id: 10, run_attempt: 1, conclusion: 'failure' }),
      job({ run_id: 10, run_attempt: 2, conclusion: 'failure' }),
      job({ run_id: 10, run_attempt: 3, conclusion: 'success' }),
    ]);

    expect(summary.runs.failed).toBe(1);
    expect(summary.runs.succeeded).toBe(0);
    expect(summary.runs.executed).toBe(1);
    expect(summary.rate).toBe(1);
    // The three attempts are still visible as records — the fold is in the run
    // count, not a discarding of evidence.
    expect(summary.records.total).toBe(3);
    expect(summary.rerunAttempts).toBe(2);
  });

  it('excludes skipped runs from the denominator and reports them separately', () => {
    const summary = summariseFlakeRate([
      job({ run_id: 20, conclusion: 'success' }),
      job({ run_id: 21, conclusion: 'skipped' }),
      job({ run_id: 22, conclusion: 'skipped' }),
      job({ run_id: 23, conclusion: 'skipped' }),
    ]);

    expect(summary.runs.executed).toBe(1);
    expect(summary.runs.skipped).toBe(3);
    expect(summary.rate).toBe(0);
  });

  it('excludes cancelled runs from the denominator and reports them separately', () => {
    const summary = summariseFlakeRate([
      job({ run_id: 30, conclusion: 'failure' }),
      job({ run_id: 31, conclusion: 'cancelled' }),
      job({ run_id: 32, conclusion: 'cancelled' }),
    ]);

    expect(summary.runs.executed).toBe(1);
    expect(summary.runs.cancelled).toBe(2);
    expect(summary.rate).toBe(1);
  });

  it('ignores a run that never contained the job, rather than counting it as a green run', () => {
    const summary = summariseFlakeRate([
      job({ run_id: 40, name: 'E2E (Playwright)', conclusion: 'success' }),
      job({ run_id: 41, name: 'Static checks', conclusion: 'success' }),
    ]);

    expect(summary.runs.total).toBe(0);
    expect(summary.runs.executed).toBe(0);
    expect(summary.records.total).toBe(0);
    // Not 0 — a window in which nothing ran has no rate, and printing 0% for it
    // would be the most flattering possible lie about an unmeasured suite.
    expect(summary.rate).toBeNull();
    expect(formatRate(summary)).toBe('no executed runs in window — no rate');
  });

  it('matches the job name exactly, so the e2e suite cannot dilute the rate', () => {
    const summary = summariseFlakeRate([
      job({ run_id: 50, conclusion: 'failure' }),
      job({ run_id: 50, name: 'Vitest integration (emulator) / shard 2', conclusion: 'success' }),
    ]);

    expect(summary.runs.total).toBe(1);
    expect(summary.runs.failed).toBe(1);
  });
});

describe('summariseFlakeRate — what it reports about the failures', () => {
  it('carries every attempt of a failing run, green ones included', () => {
    const summary = summariseFlakeRate([
      job({
        run_id: 60,
        run_attempt: 2,
        conclusion: 'success',
        html_url: 'https://example.invalid/60/2',
      }),
      job({
        run_id: 60,
        run_attempt: 1,
        conclusion: 'failure',
        head_branch: 'fix/thing-1',
        html_url: 'https://example.invalid/60/1',
      }),
    ]);

    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0].branch).toBe('fix/thing-1');
    expect(summary.failures[0].attempts).toEqual([
      { attempt: 1, conclusion: 'failure', url: 'https://example.invalid/60/1' },
      { attempt: 2, conclusion: 'success', url: 'https://example.invalid/60/2' },
    ]);
  });

  it('lists the newest failing run first', () => {
    const summary = summariseFlakeRate([
      job({ run_id: 70, conclusion: 'failure' }),
      job({ run_id: 90, conclusion: 'failure' }),
      job({ run_id: 80, conclusion: 'failure' }),
    ]);

    expect(summary.failures.map((f) => f.runId)).toEqual([90, 80, 70]);
  });
});

describe('formatRate', () => {
  it('states the rate as a count over the executed runs, with the percentage as gloss', () => {
    const summary = summariseFlakeRate([
      job({ run_id: 100, conclusion: 'failure' }),
      ...Array.from({ length: 249 }, (_, i) => job({ run_id: 200 + i, conclusion: 'success' })),
    ]);

    expect(formatRate(summary)).toBe('1 / 250 executed runs (0.4%)');
  });

  it('says zero without a trailing decimal', () => {
    const summary = summariseFlakeRate([job({ run_id: 300, conclusion: 'success' })]);

    expect(formatRate(summary)).toBe('0 / 1 executed runs (0%)');
  });
});

// #1148 review, finding 1: DEFAULT_SINCE must be the exact INSTANT #948 removed
// `retry: 2` (2026-08-23T12:21:56Z), not the calendar day. Two runs created
// earlier that same day — 32611277973 (01:49:05Z) and 32638736969 (12:12:35Z)
// — both still executed with `retry: 2` live, and a day-granularity default
// ('2026-08-23', i.e. midnight) would leave both inside the window the
// constant claims is retry-free — in the flattering direction, since a flake
// `retry: 2` absorbed on either run would report as a plain `success` here.
// This is the pin: if DEFAULT_SINCE ever drifts back to day granularity, the
// second assertion goes red because midnight-on-2026-08-23 is earlier than
// both timestamps below, so the `<` no longer holds.
describe('DEFAULT_SINCE — the retry-free boundary', () => {
  const PRE_MERGE_RUNS_STILL_ON_RETRY_2 = [
    '2026-08-23T01:49:05Z', // 32611277973, push/main
    '2026-08-23T12:12:35Z', // 32638736969, fix/recipe-range-timers
  ];

  it('is the exact instant #948 merged, not merely that calendar day', () => {
    expect(DEFAULT_SINCE).toBe('2026-08-23T12:21:56Z');
  });

  it('excludes both runs that ran with retry: 2 still live', () => {
    for (const createdAt of PRE_MERGE_RUNS_STILL_ON_RETRY_2) {
      expect(new Date(createdAt).getTime()).toBeLessThan(new Date(DEFAULT_SINCE).getTime());
    }
  });
});

// #1148 review, finding 2: `--until` has to exist for a dated window to be
// re-derivable at all — without it, `--since=X` alone returns a growing count
// every day it's re-run. GitHub's `created` qualifier takes the `A..B` range
// form on the same parameter as the open-ended `>=A` form (verified live
// against the Actions API during review), so this is the whole of what the CLI
// needs to build.
describe('createdFilter', () => {
  it('builds an open-ended filter when there is no until', () => {
    expect(createdFilter('2026-08-23T12:21:56Z', undefined)).toBe('>=2026-08-23T12:21:56Z');
  });

  it('builds a closed range when until is given, so the window is reproducible', () => {
    expect(createdFilter('2026-08-26', '2026-08-31')).toBe('2026-08-26..2026-08-31');
  });
});

// #1148 review, finding 3: "matched nothing" (the job never showed up in the
// window — e.g. renamed in ci.yml) is a measurement FAILURE and must be
// distinguishable from a genuine zero-failure rate (the job showed up, and
// truthfully had nothing red in it). Collapsing the two is the one silent
// failure mode the reviewer found: today a renamed job measures nothing and
// still exits 0.
describe('matchedNothing — measurement failure vs. a real zero-failure rate', () => {
  it('is true when not one run in the window ever contained the job', () => {
    const summary = summariseFlakeRate([
      job({ run_id: 40, name: 'E2E (Playwright)', conclusion: 'success' }),
    ]);

    expect(matchedNothing(summary)).toBe(true);
  });

  it('is false when the job matched but nothing in the window executed (e.g. all skipped)', () => {
    const summary = summariseFlakeRate([job({ run_id: 21, conclusion: 'skipped' })]);

    expect(summary.rate).toBeNull();
    expect(matchedNothing(summary)).toBe(false);
  });

  it('is false for an ordinary measured rate, zero or not', () => {
    const summary = summariseFlakeRate([job({ run_id: 22, conclusion: 'success' })]);

    expect(matchedNothing(summary)).toBe(false);
  });
});
