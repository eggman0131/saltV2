import { describe, expect, it } from 'vitest';

import {
  classifyRun,
  EMULATOR_JOB_NAME,
  formatRate,
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
