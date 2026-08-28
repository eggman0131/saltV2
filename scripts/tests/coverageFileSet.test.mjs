import { describe, expect, it } from 'vitest';

import { coverageAreas, coverageExclude, coverageInclude } from '../../coverage.areas.mjs';
import { countByArea, diffCoverageFiles, expectedCoverageFiles } from '../lib/coverageFileSet.mjs';

const TRACKED = [
  'packages/domain/src/index.ts',
  'packages/domain/src/canon/queries/match.ts',
  'packages/ui-components/src/Button.svelte',
  'packages/ui-components/src/salt.css',
  'packages/adapters/firebase-sync/src/adapters/AisleStore.ts',
  'apps/web-pwa/src/lib/cook.svelte.ts',
  'apps/web-pwa/src/lib/weather-icons/README.md',
  'apps/web-pwa/src/lib/weather-icons/fog.webp',
  'apps/storybook/src/stories/_wrappers/DialogDemo.svelte',
  'apps/storybook/src/stories/Button.stories.ts',
  'packages/domain/tests/canon.test.ts',
  'docs/e2e.md',
];

const named = () =>
  expectedCoverageFiles(TRACKED, { include: coverageInclude, exclude: coverageExclude });

describe('expectedCoverageFiles', () => {
  it('names the .ts and .svelte sources under every measured src tree', () => {
    expect(named()).toEqual([
      'apps/web-pwa/src/lib/cook.svelte.ts',
      'packages/adapters/firebase-sync/src/adapters/AisleStore.ts',
      'packages/domain/src/canon/queries/match.ts',
      'packages/domain/src/index.ts',
      'packages/ui-components/src/Button.svelte',
    ]);
  });

  // The three that produced #974: assets cannot carry coverage, and the markdown
  // one was being handed to a JavaScript parser and dropped with a stack trace.
  it('names no asset that merely happens to live under a src tree', () => {
    expect(named()).not.toContain('apps/web-pwa/src/lib/weather-icons/README.md');
    expect(named()).not.toContain('apps/web-pwa/src/lib/weather-icons/fog.webp');
    expect(named()).not.toContain('packages/ui-components/src/salt.css');
  });

  // Storybook has no vitest project, so nothing can transform its .svelte files
  // — measuring it is not merely pointless, it is impossible.
  it('names nothing under apps/storybook, source or not', () => {
    expect(named().some((file) => file.startsWith('apps/storybook/'))).toBe(false);
  });

  it('names nothing outside a src tree', () => {
    expect(named()).not.toContain('packages/domain/tests/canon.test.ts');
    expect(named()).not.toContain('docs/e2e.md');
  });
});

describe('diffCoverageFiles', () => {
  const expected = ['a.ts', 'b.ts', 'c.ts'];

  it('reports a named file the report never received', () => {
    const { missing } = diffCoverageFiles(expected, ['a.ts', 'c.ts'], expected);
    expect(missing).toEqual(['b.ts']);
  });

  it('reports a tracked file the report received but no glob names', () => {
    const { unexpected, untracked } = diffCoverageFiles(
      expected,
      [...expected, 'd.ts'],
      [...expected, 'd.ts'],
    );
    expect(unexpected).toEqual(['d.ts']);
    expect(untracked).toEqual([]);
  });

  it('demotes an unnamed file git does not track to a note', () => {
    const { unexpected, untracked } = diffCoverageFiles(
      expected,
      [...expected, 'scratch.ts'],
      expected,
    );
    expect(unexpected).toEqual([]);
    expect(untracked).toEqual(['scratch.ts']);
  });

  it('is silent when the two sides agree', () => {
    expect(diffCoverageFiles(expected, [...expected], expected)).toEqual({
      missing: [],
      unexpected: [],
      untracked: [],
    });
  });
});

describe('countByArea', () => {
  it('counts the files behind each floor, in ratchet order', () => {
    const counts = countByArea(named(), coverageAreas);
    expect(counts.map(({ glob }) => glob)).toEqual(coverageAreas);
    expect(counts.find(({ glob }) => glob === 'packages/domain/src/**').count).toBe(2);
    expect(counts.find(({ glob }) => glob === 'apps/web-pwa/src/lib/**').count).toBe(1);
    expect(counts.find(({ glob }) => glob === 'apps/web-pwa/src/routes/**').count).toBe(0);
  });
});
