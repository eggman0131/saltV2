import { describe, it, expect } from 'vitest';
import type { Suite, TestCase } from '@playwright/test/reporter';

import { readRunContext, toEvent, toEvents } from '../e2e/reporter/flakeReporter';

/**
 * The reporter is only ever exercised by a real CI run, where a mistake costs a
 * week of missing history before anyone notices. These tests pin the mapping —
 * outcome → status, attempts → retries, and the shard/branch stamping that
 * #669's per-shard breakdown depends on — against hand-built Playwright shapes.
 */

const ROOT = '/repo/apps/web-pwa';

type Attempt = { duration: number; startTime: Date; error?: { message: string } };

/** The slice of Playwright's Suite/TestCase graph the reporter actually walks. */
function makeTest(options: {
  id?: string;
  title?: string;
  file?: string;
  describes?: string[];
  project?: string;
  outcome?: ReturnType<TestCase['outcome']>;
  results?: Attempt[];
}): TestCase {
  const {
    id = 'test-id',
    title = 'does the thing',
    file = `${ROOT}/e2e/smoke.spec.ts`,
    describes = [],
    project = 'chromium',
    outcome = 'expected',
    results = [{ duration: 100, startTime: new Date('2026-08-01T10:00:00.000Z') }],
  } = options;

  let parent = { type: 'project', title: project, parent: undefined } as unknown as Suite;
  for (const describeTitle of describes) {
    parent = { type: 'describe', title: describeTitle, parent } as unknown as Suite;
  }

  return {
    id,
    title,
    location: { file, line: 1, column: 1 },
    parent,
    outcome: () => outcome,
    results,
  } as unknown as TestCase;
}

const CONTEXT = readRunContext({
  GITHUB_HEAD_REF: 'test/e2e-flake-telemetry-669',
  GITHUB_SHA: 'abc123',
  GITHUB_RUN_ID: '42',
  GITHUB_RUN_ATTEMPT: '2',
  GITHUB_REPOSITORY: 'eggman0131/saltV2',
  GITHUB_WORKFLOW: 'CI',
} as NodeJS.ProcessEnv);

describe('flake reporter — event mapping (#669)', () => {
  it('records a retry-recovered test as flaky, which is the whole point', () => {
    const event = toEvent(
      makeTest({
        outcome: 'flaky',
        results: [
          {
            duration: 900,
            startTime: new Date('2026-08-01T10:00:00.000Z'),
            error: { message: 'Error: locator resolved to hidden element' },
          },
          { duration: 400, startTime: new Date('2026-08-01T10:00:10.000Z') },
        ],
      }),
      CONTEXT,
      ROOT,
    );

    expect(event.properties.status).toBe('flaky');
    expect(event.properties.retries).toBe(1);
    // The FAILING attempt's error, not the passing retry's absence of one.
    expect(event.properties.error).toBe('Error: locator resolved to hidden element');
    // Duration is the attempt that decided the outcome (the last one).
    expect(event.properties.duration_ms).toBe(400);
  });

  it('maps Playwright outcomes onto the status vocabulary', () => {
    const statuses = (['expected', 'unexpected', 'flaky', 'skipped'] as const).map(
      (outcome) => toEvent(makeTest({ outcome }), CONTEXT, ROOT).properties.status,
    );
    expect(statuses).toEqual(['passed', 'failed', 'flaky', 'skipped']);
  });

  it('stamps every event with the run facts the trend charts break down by', () => {
    const event = toEvent(makeTest({}), { ...CONTEXT, shard: 2, shardTotal: 3 }, ROOT);

    expect(event.properties.shard).toBe(2);
    expect(event.properties.shard_total).toBe(3);
    expect(event.properties.branch).toBe('test/e2e-flake-telemetry-669');
    expect(event.properties.commit_sha).toBe('abc123');
    expect(event.properties.run_id).toBe('42');
    expect(event.properties.run_attempt).toBe(2);
    expect(event.properties.repository).toBe('eggman0131/saltV2');
  });

  it('keeps CI out of the person tables and labels the source', () => {
    const event = toEvent(makeTest({}), CONTEXT, ROOT);
    expect(event.properties.$process_person_profile).toBe(false);
    expect(event.properties.source).toBe('ci');
    expect(event.distinct_id).toBe('github-run-42');
  });

  it('prefers GITHUB_HEAD_REF, because GITHUB_REF_NAME is "123/merge" on a PR', () => {
    const onPr = readRunContext({
      GITHUB_HEAD_REF: 'feat/thing',
      GITHUB_REF_NAME: '123/merge',
    } as NodeJS.ProcessEnv);
    expect(onPr.branch).toBe('feat/thing');

    const onPush = readRunContext({ GITHUB_REF_NAME: 'main' } as NodeJS.ProcessEnv);
    expect(onPush.branch).toBe('main');
  });

  it('falls back to a local identity off CI rather than inventing a run', () => {
    const local = readRunContext({} as NodeJS.ProcessEnv);
    expect(local.runId).toBeNull();
    expect(local.runAttempt).toBeNull();
    expect(toEvent(makeTest({}), local, ROOT).distinct_id).toBe('local');
  });

  it('builds a title from the describe path and a repo-relative file', () => {
    const event = toEvent(
      makeTest({
        describes: ['shopping list', 'bulk delete'],
        title: 'removes every checked row',
        file: `${ROOT}/e2e/shopping-list-bulk-delete.spec.ts`,
      }),
      CONTEXT,
      ROOT,
    );

    expect(event.properties.test_title).toBe(
      'shopping list › bulk delete › removes every checked row',
    );
    expect(event.properties.test_file).toBe('e2e/shopping-list-bulk-delete.spec.ts');
    expect(event.properties.project).toBe('chromium');
  });

  it('de-colours and caps the error so a stack trace cannot become the property', () => {
    const message = `\u001B[31mError: expected 1\u001B[39m\nat some/file.ts:1:1\n${'x'.repeat(500)}`;
    const event = toEvent(
      makeTest({
        outcome: 'unexpected',
        results: [{ duration: 1, startTime: new Date(0), error: { message } }],
      }),
      CONTEXT,
      ROOT,
    );

    expect(event.properties.error).toBe('Error: expected 1');
  });

  it('keeps the locator and call log — the part that makes a failure diagnosable', () => {
    // The real shape of the failure that hard-failed CI twice (issue #669
    // follow-up). First-line-only reduced this to
    // "Error: expect(locator).toBeVisible() failed", which names neither the
    // locator nor what it was waiting for.
    const message = [
      'Error: expect(locator).toBeVisible() failed',
      '',
      "Locator: getByTestId('recipe-add-review-list')",
      'Expected: visible',
      'Timeout: 10000ms',
      'Error: element(s) not found',
      '',
      'Call log:',
      '  - Expect "toBeVisible" with timeout 10000ms',
      "  - waiting for getByTestId('recipe-add-review-list')",
    ].join('\n');
    const event = toEvent(
      makeTest({
        outcome: 'unexpected',
        results: [{ duration: 1, startTime: new Date(0), error: { message } }],
      }),
      CONTEXT,
      ROOT,
    );

    expect(event.properties.error).toContain("Locator: getByTestId('recipe-add-review-list')");
    expect(event.properties.error).toContain('Timeout: 10000ms');
    expect(event.properties.error).toContain('waiting for');
  });

  it('reports the FAILING attempt duration, not the retry that passed', () => {
    // The exact shape of every `detail page — change aisle` flake: attempt 1
    // burns the 30s test timeout, the retry passes in 5s. duration_ms keeps
    // reporting 5s (the dashboards are built on it); the new field carries the
    // 30s that actually happened.
    const event = toEvent(
      makeTest({
        outcome: 'flaky',
        results: [
          {
            duration: 30_000,
            startTime: new Date('2026-08-01T10:00:00.000Z'),
            error: { message: 'Error: locator.click: Test timeout of 30000ms exceeded.' },
          },
          { duration: 5_000, startTime: new Date('2026-08-01T10:00:31.000Z') },
        ],
      }),
      CONTEXT,
      ROOT,
    );

    expect(event.properties.duration_ms).toBe(5_000);
    expect(event.properties.failed_attempt_duration_ms).toBe(30_000);
    expect(event.properties.failure_kind).toBe('test-timeout');
  });

  it('leaves the failure-derived fields null when nothing failed', () => {
    const event = toEvent(makeTest({ outcome: 'expected' }), CONTEXT, ROOT);

    expect(event.properties.failed_attempt_duration_ms).toBeNull();
    expect(event.properties.failure_kind).toBeNull();
    expect(event.properties.error_fingerprint).toBeNull();
  });

  it('separates an assertion failure from a test-level timeout', () => {
    const assertion = toEvent(
      makeTest({
        outcome: 'unexpected',
        results: [
          {
            duration: 1,
            startTime: new Date(0),
            error: { message: 'Error: expect(locator).toBeVisible() failed\n\nTimeout: 10000ms' },
          },
        ],
      }),
      CONTEXT,
      ROOT,
    );
    const thrown = toEvent(
      makeTest({
        outcome: 'unexpected',
        results: [
          {
            duration: 1,
            startTime: new Date(0),
            error: { message: 'TypeError: undefined is not a function' },
          },
        ],
      }),
      CONTEXT,
      ROOT,
    );

    expect(assertion.properties.failure_kind).toBe('assertion');
    expect(thrown.properties.failure_kind).toBe('error');
  });

  it('fingerprints two runs of the same failure identically despite volatile ids', () => {
    const withVolatiles = (uuid: string, count: number) =>
      toEvent(
        makeTest({
          outcome: 'unexpected',
          results: [
            {
              duration: 1,
              startTime: new Date(0),
              error: {
                message: [
                  'Error: expect(page).toHaveURL(expected) failed',
                  `Received string: "http://127.0.0.1:5174/#/recipes/${uuid}"`,
                  `${count} x locator resolved to <html>`,
                  'e2e-9f2a@salt.test',
                ].join('\n'),
              },
            },
          ],
        }),
        CONTEXT,
        ROOT,
      ).properties.error_fingerprint;

    const a = withVolatiles('4cdde356-396d-9fc0-34b4-a17f60f6b4ef', 24);
    const b = withVolatiles('a2fd5b57-30e2-4ae0-b725-9fe156ee1d7d', 31);

    expect(a).toBe(b);
    // Still readable, and still names the assertion that failed.
    expect(a).toContain('toHaveURL');
    expect(a).toContain('<uuid>');
  });

  it('stamps shard position so "first spec of the shard" is chartable', () => {
    const events = toEvents(
      [
        makeTest({ id: 'a', file: `${ROOT}/e2e/aisles-seed.spec.ts` }),
        makeTest({ id: 'b', file: `${ROOT}/e2e/aisles-seed.spec.ts` }),
        makeTest({ id: 'c', file: `${ROOT}/e2e/canon-sync.spec.ts` }),
      ],
      CONTEXT,
      ROOT,
    );

    expect(events.map((e) => e.properties.test_index)).toEqual([0, 1, 2]);
    // File index is assignment order, so the shard's first file is 0.
    expect(events.map((e) => e.properties.file_index)).toEqual([0, 0, 1]);
  });

  it('caps a stack-free but runaway message by lines and characters', () => {
    const message = Array.from({ length: 40 }, (_, i) => `line ${i} ${'y'.repeat(200)}`).join('\n');
    const event = toEvent(
      makeTest({
        outcome: 'unexpected',
        results: [{ duration: 1, startTime: new Date(0), error: { message } }],
      }),
      CONTEXT,
      ROOT,
    );

    expect(event.properties.error!.length).toBeLessThanOrEqual(1200);
    expect(event.properties.error!.split('\n').length).toBeLessThanOrEqual(12);
  });

  it('emits one record per test, each with its own idempotency uuid', () => {
    const events = toEvents([makeTest({ id: 'a' }), makeTest({ id: 'b' })], CONTEXT, ROOT);
    expect(events.map((event) => event.properties.test_id)).toEqual(['a', 'b']);
    expect(new Set(events.map((event) => event.uuid)).size).toBe(2);
    expect(events.every((event) => event.event === 'e2e_test_result')).toBe(true);
  });
});
