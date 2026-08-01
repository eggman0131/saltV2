/**
 * A Playwright reporter that writes one NDJSON record per test — including the
 * ones that PASSED ON RETRY (issue #669).
 *
 * Why this exists: the flaky signal is the early warning, and CI was throwing it
 * away. The HTML report is only uploaded `if: failure()`, so a test that failed
 * once and passed on the retry left no trace at all, and workflow logs expire
 * after ~8 days — by the time a run goes red, the history that would show when
 * the rot started is already gone. #668 produced 128 retry-recovered flakes
 * against 13 red jobs, and the flakes began ten days before anyone noticed.
 *
 * The records are shaped as PostHog capture events so the CI step that ships
 * them is a `jq` wrap plus one `curl` (see the "Report e2e flakiness" step in
 * .github/workflows/ci.yml). That shaping is deliberate and is NOT a boundary
 * violation: this file imports no PostHog SDK, and must not — `posthog-js` /
 * `posthog-node` are confined to `@salt/observability` (CLAUDE.md rule 11), and
 * web-pwa cannot import `@salt/observability/server` either (cross-runtime).
 * Plain JSON over plain HTTP touches no boundary.
 *
 * One record per TEST, not per attempt: `TestCase.outcome()` already collapses
 * the attempts into passed / flaky / failed, which is exactly the distinction
 * the trend charts are built on. `retries` and `shard` are first-class
 * properties because #668's pattern was "flakiness follows shard POSITION, not
 * the test" — invisible without the per-shard breakdown.
 *
 * Telemetry must never break the suite: every failure here is caught and warned
 * about, and the run's exit code is untouched.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import type { FullConfig, Reporter, Suite, TestCase } from '@playwright/test/reporter';

/** Status vocabulary, collapsed from Playwright's `TestCase.outcome()`. */
export type TestStatus = 'passed' | 'flaky' | 'failed' | 'skipped';

/** A PostHog capture event, ready to be wrapped in a `/batch/` envelope. */
export type FlakeEvent = {
  event: 'e2e_test_result';
  distinct_id: string;
  uuid: string;
  timestamp: string;
  properties: {
    /** CI never mints person profiles — these are build facts, not people. */
    $process_person_profile: false;
    source: 'ci';
    test_id: string;
    test_file: string;
    test_title: string;
    project: string;
    shard: number | null;
    shard_total: number | null;
    status: TestStatus;
    retries: number;
    duration_ms: number;
    error: string | null;
    branch: string | null;
    commit_sha: string | null;
    run_id: string | null;
    run_attempt: number | null;
    repository: string | null;
    workflow: string | null;
  };
};

/** The run-level facts every event is stamped with. */
export type RunContext = {
  shard: number | null;
  shardTotal: number | null;
  branch: string | null;
  commitSha: string | null;
  runId: string | null;
  runAttempt: number | null;
  repository: string | null;
  workflow: string | null;
};

const OUTCOME_TO_STATUS: Record<ReturnType<TestCase['outcome']>, TestStatus> = {
  expected: 'passed',
  unexpected: 'failed',
  flaky: 'flaky',
  skipped: 'skipped',
};

/** Playwright colourises error messages; the raw codes are noise in a property. */
const ANSI = /\u001B\[[0-9;]*m/g;
const ERROR_MAX = 300;

/**
 * `GITHUB_REF_NAME` is `123/merge` on a pull_request event — the merge ref, not
 * anything a human recognises. `GITHUB_HEAD_REF` carries the source branch and
 * is set only for PR events, so it wins where present.
 */
export function readRunContext(env: NodeJS.ProcessEnv, config?: FullConfig): RunContext {
  const attempt = Number(env.GITHUB_RUN_ATTEMPT);
  return {
    shard: config?.shard?.current ?? null,
    shardTotal: config?.shard?.total ?? null,
    branch: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || null,
    commitSha: env.GITHUB_SHA ?? null,
    runId: env.GITHUB_RUN_ID ?? null,
    runAttempt: Number.isFinite(attempt) && attempt > 0 ? attempt : null,
    repository: env.GITHUB_REPOSITORY ?? null,
    workflow: env.GITHUB_WORKFLOW ?? null,
  };
}

/** `describe › describe › test` — the file and project are separate properties. */
function titleOf(test: TestCase): string {
  const parts: string[] = [];
  let suite: Suite | undefined = test.parent;
  while (suite && suite.type === 'describe') {
    if (suite.title) parts.unshift(suite.title);
    suite = suite.parent;
  }
  return [...parts, test.title].join(' › ');
}

function projectOf(test: TestCase): string {
  let suite: Suite | undefined = test.parent;
  while (suite && suite.type !== 'project') suite = suite.parent;
  return suite?.title ?? '';
}

/** First line of the first attempt that actually failed, de-coloured and capped. */
function errorOf(test: TestCase): string | null {
  const failed = test.results.find((result) => result.error?.message);
  const message = failed?.error?.message;
  if (!message) return null;
  const [firstLine = ''] = message.replace(ANSI, '').trim().split('\n');
  return firstLine.slice(0, ERROR_MAX) || null;
}

export function toEvent(test: TestCase, context: RunContext, rootDir: string): FlakeEvent {
  const last = test.results.at(-1);
  const startedAt = last?.startTime?.getTime() ?? 0;
  const duration = last?.duration ?? 0;

  return {
    event: 'e2e_test_result',
    // Person profiles are off, so this only groups the batch in the events
    // table. A run id beats a constant there; local runs fall back to `local`.
    distinct_id: context.runId ? `github-run-${context.runId}` : 'local',
    uuid: randomUUID(),
    timestamp: new Date(startedAt + duration).toISOString(),
    properties: {
      $process_person_profile: false,
      source: 'ci',
      test_id: test.id,
      test_file: path.relative(rootDir, test.location.file),
      test_title: titleOf(test),
      project: projectOf(test),
      shard: context.shard,
      shard_total: context.shardTotal,
      status: OUTCOME_TO_STATUS[test.outcome()],
      retries: Math.max(test.results.length - 1, 0),
      duration_ms: duration,
      error: errorOf(test),
      branch: context.branch,
      commit_sha: context.commitSha,
      run_id: context.runId,
      run_attempt: context.runAttempt,
      repository: context.repository,
      workflow: context.workflow,
    },
  };
}

export function toEvents(tests: TestCase[], context: RunContext, rootDir: string): FlakeEvent[] {
  return tests.map((test) => toEvent(test, context, rootDir));
}

export default class FlakeReporter implements Reporter {
  private config: FullConfig | undefined;
  private suite: Suite | undefined;

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.suite = suite;
  }

  onEnd(): void {
    const config = this.config;
    const suite = this.suite;
    if (!config || !suite) return;

    // `config.rootDir` is the resolved testDir (apps/web-pwa/e2e), so the file
    // lands beside playwright-report/ at the app root, which is where the CI
    // step and .gitignore both expect it.
    const appRoot = path.resolve(config.rootDir, '..');
    const outputFile =
      process.env.E2E_FLAKE_NDJSON ?? path.join(appRoot, 'e2e-flake-events.ndjson');

    try {
      const events = toEvents(suite.allTests(), readRunContext(process.env, config), appRoot);
      writeFileSync(outputFile, events.map((event) => JSON.stringify(event)).join('\n') + '\n');
      console.log(`[flake-reporter] wrote ${events.length} test results to ${outputFile}`);
    } catch (error) {
      // Never fail the suite over telemetry.
      console.warn(`[flake-reporter] skipped: ${error instanceof Error ? error.message : error}`);
    }
  }
}
