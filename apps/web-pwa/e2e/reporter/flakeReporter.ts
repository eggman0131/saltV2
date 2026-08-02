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

import type { FullConfig, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';

/** Status vocabulary, collapsed from Playwright's `TestCase.outcome()`. */
export type TestStatus = 'passed' | 'flaky' | 'failed' | 'skipped';

/**
 * `test-timeout` — the test itself ran out of budget, i.e. something hung with
 * no bound of its own. `assertion` — an `expect(...)` was evaluated and failed,
 * including one that polled to its own timeout. `error` — anything else thrown.
 */
export type FailureKind = 'test-timeout' | 'assertion' | 'error';

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
    /**
     * LAST attempt's duration. For a flaky test that is the retry that PASSED,
     * so it is not the cost of the failure — see failed_attempt_duration_ms.
     * Kept as-is because the live dashboard tiles are built on it.
     */
    duration_ms: number;
    /**
     * Duration of the attempt that actually FAILED, null when nothing failed.
     *
     * `duration_ms` alone was actively misleading: all six `detail page — change
     * aisle` flakes reported 4–5.5s, the passing retry, while the failing
     * attempt hit the 30s test timeout every time. A 6x understatement on
     * exactly the rows worth reading, and it hid that the failure was a timeout
     * rather than a slow pass.
     */
    failed_attempt_duration_ms: number | null;
    /**
     * How it failed, not just that it did: a test-level timeout (something hung
     * with no bound) reads very differently from an assertion that polled and
     * gave up. Null when nothing failed.
     */
    failure_kind: FailureKind | null;
    /**
     * Position in this shard's test list (0-based; run order under `workers: 1`),
     * and the index of the test's FILE in the order files first appear.
     *
     * Flakes cluster hard at the START of a shard — the cold-server class that
     * #668 chased and that came back. Establishing that took reconstructing the
     * order by hand with `playwright test --list`; as properties it is a
     * one-line breakdown and can be charted directly.
     */
    test_index: number | null;
    file_index: number | null;
    /**
     * The error with volatile bits (ids, counts, timeouts, seeded emails)
     * normalised out, so repeat occurrences GROUP BY CAUSE rather than by test
     * title. "Are these six the same bug?" currently needs six traces.
     */
    error_fingerprint: string | null;
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
// A stack frame is where the signal stops and the unbounded noise starts, so the
// stack — not a line count — is what this cuts on.
//
// It used to keep only the FIRST line, which for the most common failure shape
// throws away the entire diagnosis: `expect(locator).toBeVisible() failed` says
// nothing on its own — the locator, the expectation, the timeout and the
// "waiting for …" call log all live on the lines below it. A `change aisle`
// timeout reported as "Test timeout of 30000ms exceeded." with no call log is
// unactionable, and since flaky runs uploaded no trace there was nothing else to
// read. The caps below still bound the property.
const STACK_FRAME = /^\s*at\s/;
const ERROR_MAX = 1200;
const ERROR_MAX_LINES = 12;

// Failure classification. `Test timeout of Nms exceeded` is Playwright's wording
// for the test-level budget, and it prefixes whatever action was hanging
// ("locator.click: Test timeout of ..."), so a substring test is right.
const TEST_TIMEOUT = /Test timeout of \d+ms exceeded/i;
const EXPECT_CALL = /\bexpect(?:\.\w+)?\(/;

// Fingerprint normalisation. Ordered longest-pattern-first: emails and uuids
// contain digits, so blanking bare numbers has to come last or it eats them.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const SEEDED_EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const LONG_HEX = /\b[0-9a-f]{12,}\b/gi;
const NUMBER = /\d+/g;
const FINGERPRINT_LINES = 3;
const FINGERPRINT_MAX = 200;

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

/**
 * The one attempt every failure-derived property is read from, so the error,
 * its duration, its kind and its fingerprint always describe the SAME attempt.
 * Deriving them independently is how you end up with a duration from the retry
 * and an error from the first try.
 */
function failedResultOf(test: TestCase): TestResult | undefined {
  return test.results.find((result) => result.error?.message);
}

/**
 * The assertion block of the first attempt that actually failed — de-coloured,
 * stopped at the stack, and capped. Keeps the locator / expectation / call log
 * that make a failure diagnosable; drops the stack trace that made the old
 * first-line-only cut necessary.
 */
function errorOf(test: TestCase): string | null {
  const message = failedResultOf(test)?.error?.message;
  if (!message) return null;
  const kept: string[] = [];
  for (const line of message.replace(ANSI, '').trim().split('\n')) {
    if (STACK_FRAME.test(line)) break;
    kept.push(line);
    if (kept.length === ERROR_MAX_LINES) break;
  }
  return kept.join('\n').trim().slice(0, ERROR_MAX) || null;
}

/**
 * Classified from the error text, which is only possible now that more than the
 * first line survives. A test-level timeout wins over the assertion test because
 * `locator.click: Test timeout of 30000ms exceeded` mentions neither `expect` nor
 * anything else useful — it IS the unbounded-hang case.
 */
function failureKindOf(error: string | null): FailureKind | null {
  if (!error) return null;
  if (TEST_TIMEOUT.test(error)) return 'test-timeout';
  if (EXPECT_CALL.test(error)) return 'assertion';
  return 'error';
}

/**
 * A readable grouping key, not a hash — a hash would group correctly and tell
 * you nothing when you read it in PostHog. Built from the first few meaningful
 * lines with the volatile parts blanked, so the locator and the assertion (the
 * identifying bits) survive while ids, counts and timeouts do not.
 */
function fingerprintOf(error: string | null): string | null {
  if (!error) return null;
  const salient = error
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, FINGERPRINT_LINES)
    .join(' | ');
  const normalised = salient
    .replace(UUID, '<uuid>')
    .replace(SEEDED_EMAIL, '<email>')
    .replace(LONG_HEX, '<hex>')
    .replace(NUMBER, 'N');
  return normalised.slice(0, FINGERPRINT_MAX) || null;
}

/**
 * Where a test sits in its shard. Optional so `toEvent` stays callable on a
 * single test; `toEvents` supplies it because only the full list knows the order.
 */
export type ShardPosition = { testIndex: number; fileIndex: number };

export function toEvent(
  test: TestCase,
  context: RunContext,
  rootDir: string,
  position?: ShardPosition,
): FlakeEvent {
  const last = test.results.at(-1);
  const startedAt = last?.startTime?.getTime() ?? 0;
  const duration = last?.duration ?? 0;
  const failed = failedResultOf(test);
  const error = errorOf(test);

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
      failed_attempt_duration_ms: failed?.duration ?? null,
      failure_kind: failureKindOf(error),
      test_index: position?.testIndex ?? null,
      file_index: position?.fileIndex ?? null,
      error_fingerprint: fingerprintOf(error),
      error,
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
  // File index is assignment order, not alphabetical: `--shard` splits at file
  // granularity and a shard runs its files in list order, so "first file of the
  // shard" is exactly index 0 here — which is the position the flakes cluster at.
  const fileIndices = new Map<string, number>();
  for (const test of tests) {
    if (!fileIndices.has(test.location.file)) {
      fileIndices.set(test.location.file, fileIndices.size);
    }
  }
  return tests.map((test, testIndex) =>
    toEvent(test, context, rootDir, {
      testIndex,
      fileIndex: fileIndices.get(test.location.file) ?? 0,
    }),
  );
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
