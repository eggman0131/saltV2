import { describe, expect, it } from 'vitest';

import {
  auditMergeQueue,
  cancelsEveryEvent,
  jobNames,
  onBlock,
  triggersMergeGroup,
  triggersPushToMain,
} from '../lib/mergeQueueGuard.mjs';

/** A minimal stand-in for ci.yml: the two triggers the guard cares about, and
 *  one aggregator job carrying a required context. */
const ci = ({
  mergeGroup = true,
  push = true,
  context = 'E2E (Playwright)',
  cancel = "${{ github.event_name == 'pull_request' }}",
} = {}) =>
  [
    'name: CI',
    '',
    'on:',
    ...(push ? ['  push:', '    branches: [main]'] : []),
    '  pull_request:',
    '    branches: [main]',
    ...(mergeGroup ? ['  merge_group:'] : []),
    '',
    'concurrency:',
    '  group: ci-${{ github.ref }}',
    `  cancel-in-progress: ${cancel}`,
    '',
    'jobs:',
    '  e2e:',
    `    name: ${context}`,
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: Verify the e2e shards passed',
    '        run: echo ok',
    '',
  ].join('\n');

const workflows = (text) => [{ path: '.github/workflows/ci.yml', text }];
const CONTEXTS = ['E2E (Playwright)'];

describe('onBlock', () => {
  it('ends at the next top-level key, not at the end of the file', () => {
    const block = onBlock(ci());
    expect(block).toContain('merge_group:');
    expect(block).not.toContain('concurrency:');
  });

  it('is null for a workflow with no triggers at all', () => {
    expect(onBlock('name: nothing\njobs: {}\n')).toBeNull();
  });
});

describe('jobNames', () => {
  it('reads job names and ignores step names', () => {
    expect(jobNames(ci())).toEqual(['E2E (Playwright)']);
  });

  it('reads a name built from a matrix expression', () => {
    expect(jobNames('jobs:\n  s:\n    name: E2E shard ${{ matrix.shard }}/3\n')).toEqual([
      'E2E shard ${{ matrix.shard }}/3',
    ]);
  });
});

// The distinction that #1074 turned into a live hazard: it reverted the
// `merge_group:` key while comment prose describing it survived elsewhere.
describe('triggersMergeGroup', () => {
  it('is true for a real trigger', () => {
    expect(triggersMergeGroup(ci())).toBe(true);
  });

  it('is false when the trigger is only mentioned in a comment', () => {
    const commentedOut = ci({ mergeGroup: false }).replace(
      '  pull_request:',
      '  # merge_group:\n  pull_request:',
    );
    expect(triggersMergeGroup(commentedOut)).toBe(false);
  });
});

describe('triggersPushToMain', () => {
  it('is true for push: branches: [main]', () => {
    expect(triggersPushToMain(ci())).toBe(true);
  });

  it('is false when the push trigger is gone', () => {
    expect(triggersPushToMain(ci({ push: false }))).toBe(false);
  });

  it('is false when push targets some other branch', () => {
    expect(triggersPushToMain(ci().replace('branches: [main]', 'branches: [release]'))).toBe(false);
  });

  it('does not read pull_request\u2019s branches as push\u2019s', () => {
    const pushless =
      'on:\n  push:\n    tags: [v*]\n  pull_request:\n    branches: [main]\n\njobs: {}\n';
    expect(triggersPushToMain(pushless)).toBe(false);
  });
});

describe('cancelsEveryEvent', () => {
  it('permits the expression form ci.yml uses', () => {
    expect(cancelsEveryEvent(ci())).toBe(false);
  });

  it('rejects a literal true, which would cancel merge_group runs', () => {
    expect(cancelsEveryEvent(ci({ cancel: 'true' }))).toBe(true);
  });
});

// The four ways the queue jams. Each must go red — a guard that cannot fail is
// not a guard.
describe('auditMergeQueue', () => {
  it('passes a workflow that reports every required context on merge_group', () => {
    expect(auditMergeQueue(workflows(ci()), CONTEXTS)).toEqual([]);
  });

  it('fails when the required context has no merge_group trigger', () => {
    const [problem, ...rest] = auditMergeQueue(workflows(ci({ mergeGroup: false })), CONTEXTS);
    expect(rest).toEqual([]);
    expect(problem).toMatch(/no `merge_group:` trigger/);
  });

  it('fails when a required context has been renamed out of existence', () => {
    const [problem] = auditMergeQueue(workflows(ci({ context: 'E2E' })), CONTEXTS);
    expect(problem).toMatch(/is not the name of any job/);
  });

  it('fails when two workflows claim the same required context', () => {
    const both = [
      { path: '.github/workflows/ci.yml', text: ci() },
      { path: '.github/workflows/other.yml', text: ci() },
    ];
    expect(auditMergeQueue(both, CONTEXTS).join('\n')).toMatch(/claimed by 2 workflows/);
  });

  it('fails when cancel-in-progress would cancel merge_group runs', () => {
    expect(auditMergeQueue(workflows(ci({ cancel: 'true' })), CONTEXTS).join('\n')).toMatch(
      /cancel-in-progress: true/,
    );
  });

  it('fails when ci.yml loses the push-to-main trigger deploy-staging chains off', () => {
    expect(auditMergeQueue(workflows(ci({ push: false })), CONTEXTS).join('\n')).toMatch(
      /stops every staging deploy/,
    );
  });
});

// A reformat from `branches: [main]` to a YAML block sequence is cosmetic, and
// must not read as "the deploy-staging trigger is gone".
describe('triggersPushToMain, block-sequence form', () => {
  const on = (body) => `on:\n  push:\n${body}\n  pull_request:\n    branches: [main]\n\njobs: {}\n`;

  it('reads a listed main', () => {
    expect(triggersPushToMain(on('    branches:\n      - main'))).toBe(true);
  });

  it('reads a listed branch that is not main', () => {
    expect(triggersPushToMain(on('    branches:\n      - release'))).toBe(false);
  });

  it('does not mistake a paths list under push for branches', () => {
    expect(triggersPushToMain(on('    paths:\n      - main'))).toBe(false);
  });
});
