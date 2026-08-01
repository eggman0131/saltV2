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

  it('emits one record per test, each with its own idempotency uuid', () => {
    const events = toEvents([makeTest({ id: 'a' }), makeTest({ id: 'b' })], CONTEXT, ROOT);
    expect(events.map((event) => event.properties.test_id)).toEqual(['a', 'b']);
    expect(new Set(events.map((event) => event.uuid)).size).toBe(2);
    expect(events.every((event) => event.event === 'e2e_test_result')).toBe(true);
  });
});
