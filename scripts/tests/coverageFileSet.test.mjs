import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  coverageAreas,
  coverageExclude,
  coverageInclude,
  coverageThresholds,
} from '../../coverage.areas.mjs';
import {
  countByArea,
  coveragePercent,
  diffCoverageFiles,
  expectedCoverageFiles,
  pinEntry,
  ratchetFindings,
  totalsByArea,
} from '../lib/coverageFileSet.mjs';

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

// ---------------------------------------------------------------------------
// The ratchet arithmetic (issue #1133)
// ---------------------------------------------------------------------------
// Hand-built istanbul shapes rather than a real report: the point of keeping
// this arithmetic pure is that it can be tested without first spending 40 s
// producing one, and a fixture can be built into states a real run cannot
// (a dedup's before and after, in the same test).

/** `lines` is hits per statement; `branches` is one array of arm hits per entry. */
const fileCoverage = ({ lines = [], branches = [], statementLines } = {}) => ({
  statementMap: Object.fromEntries(
    lines.map((_, i) => [i, { start: { line: statementLines ? statementLines[i] : i + 1 } }]),
  ),
  s: Object.fromEntries(lines.map((hits, i) => [i, hits])),
  b: Object.fromEntries(branches.map((arms, i) => [i, arms])),
});

const arms = (covered, uncovered) => [
  ...Array.from({ length: covered }, () => 1),
  ...Array.from({ length: uncovered }, () => 0),
];

const AREA = 'packages/ui-components/src/**';

describe('coveragePercent', () => {
  // Istanbul FLOORS. Rounding reads a hundredth high on six of this repo's
  // eight areas, and a pin a hundredth high is a red build — so a percentage
  // that rounded would be the one bug this whole module cannot afford.
  it('floors to two decimals rather than rounding', () => {
    expect(coveragePercent(633, 850)).toBe(74.47);
    expect(coveragePercent(649, 866)).toBe(74.94);
    // 2 / 3 is 66.666…: floored 66.66, rounded 66.67.
    expect(coveragePercent(2, 3)).toBe(66.66);
  });

  it('calls an empty area 100%, as istanbul does, rather than dividing by zero', () => {
    expect(coveragePercent(0, 0)).toBe(100);
  });
});

describe('totalsByArea', () => {
  it('buckets by area glob and reports covered, total and uncovered for both metrics', () => {
    const totals = totalsByArea(
      {
        'packages/ui-components/src/Button.svelte': fileCoverage({
          lines: [1, 1, 0],
          branches: [arms(1, 1)],
        }),
        'packages/ui-components/src/Dialog.svelte': fileCoverage({
          lines: [1, 0],
          branches: [arms(2, 0)],
        }),
        'packages/domain/src/index.ts': fileCoverage({ lines: [0, 0], branches: [arms(0, 3)] }),
      },
      [AREA, 'packages/domain/src/**'],
    );

    const ui = totals.find(({ glob }) => glob === AREA);
    expect(ui.files).toBe(2);
    expect(ui.lines).toEqual({ covered: 3, total: 5, uncovered: 2, pct: 60 });
    expect(ui.branches).toEqual({ covered: 3, total: 4, uncovered: 1, pct: 75 });

    const domain = totals.find(({ glob }) => glob === 'packages/domain/src/**');
    expect(domain.lines.uncovered).toBe(2);
    expect(domain.branches).toEqual({ covered: 0, total: 3, uncovered: 3, pct: 0 });
  });

  it('counts a line once, at the highest hit count of the statements starting on it', () => {
    // Three statements, two of them on line 1 — one never run, one run twice.
    // Istanbul calls that line covered, and an area is two lines, not three.
    const totals = totalsByArea(
      {
        'packages/ui-components/src/a.ts': fileCoverage({
          lines: [0, 2, 0],
          statementLines: [1, 1, 2],
        }),
      },
      [AREA],
    );
    expect(totals[0].lines).toEqual({ covered: 1, total: 2, uncovered: 1, pct: 50 });
  });

  it('reports an area no file matches as empty rather than omitting it', () => {
    const totals = totalsByArea({}, [AREA]);
    expect(totals).toHaveLength(1);
    expect(totals[0].files).toBe(0);
    expect(totals[0].branches.uncovered).toBe(0);
  });
});

describe('ratchetFindings', () => {
  const pin = (over = {}) => ({
    [AREA]: {
      lines: 100,
      branches: 74.47,
      uncoveredLines: 0,
      uncoveredBranches: 217,
      ...over,
    },
  });

  // THE #1113 REPRODUCTION, and the reason this whole module exists.
  //
  // `coverage.areas.mjs` claims, in prose, that "the uncovered count is the
  // invariant" — the test that separates a legitimate dedup re-measure from a
  // regression wearing a dedup's clothes. Nothing checked it. These two cases
  // are that claim made mechanical (CLAUDE.md Rule 12), at #1113's real
  // figures: 649/866 branches before the dedup, 633/850 after, 217 uncovered on
  // both sides. The ratio falls 74.94 → 74.47 and nothing became less tested.
  const dedupBefore = {
    'packages/ui-components/src/FieldState.ts': fileCoverage({ branches: [arms(16, 0)] }),
    'packages/ui-components/src/rest.ts': fileCoverage({ branches: [arms(633, 217)] }),
  };
  // The duplicate — 16 branches, every one covered — is gone.
  const dedupAfter = {
    'packages/ui-components/src/rest.ts': dedupBefore['packages/ui-components/src/rest.ts'],
  };

  it('passes a dedup that lowers the ratio while the uncovered count holds', () => {
    const before = totalsByArea(dedupBefore, [AREA])[0];
    const after = totalsByArea(dedupAfter, [AREA])[0];

    // The premise: the ratio really did fall, and the count really did hold.
    expect(before.branches.pct).toBe(74.94);
    expect(after.branches.pct).toBe(74.47);
    expect(after.branches.uncovered).toBe(before.branches.uncovered);
    expect(after.branches.uncovered).toBe(217);

    // Pinned at the post-dedup ratio, as #1113 correctly did, with the ceiling
    // at the invariant count. Nothing to report.
    expect(ratchetFindings([after], pin(), { staleAbove: 1 })).toEqual([]);
  });

  it('fails the same dedup with one more untested branch, naming the area and the delta', () => {
    const smuggled = {
      ...dedupAfter,
      'packages/ui-components/src/smuggled.ts': fileCoverage({ branches: [arms(0, 1)] }),
    };
    const after = totalsByArea(smuggled, [AREA])[0];
    expect(after.branches.uncovered).toBe(218);

    const findings = ratchetFindings([after], pin(), { staleAbove: 1 });
    expect(findings).toEqual([
      {
        kind: 'ceiling',
        glob: AREA,
        metric: 'branches',
        uncovered: 218,
        ceiling: 217,
        // The ratio fell as well here (74.47 → 74.41), so vitest is red too.
        ratioHeld: false,
      },
    ]);
  });

  it('names a ceiling breach that the ratio does not see as one the ratio does not see', () => {
    // The area GREW: 100 new branches, all covered. The ratio rises, so the
    // floor is happy; one of them is untested, so the ceiling is not.
    const grown = {
      ...dedupAfter,
      'packages/ui-components/src/new.ts': fileCoverage({ branches: [arms(99, 1)] }),
    };
    const after = totalsByArea(grown, [AREA])[0];
    expect(after.branches.pct).toBeGreaterThan(74.47);

    const [finding] = ratchetFindings([after], pin(), { staleAbove: 100 });
    expect(finding).toMatchObject({ kind: 'ceiling', uncovered: 218, ratioHeld: true });
  });

  it('reds an area that drifted more than the tolerance above its floor', () => {
    const after = totalsByArea(dedupAfter, [AREA])[0];
    const findings = ratchetFindings([after], pin({ branches: 73.4 }), { staleAbove: 1 });
    expect(findings).toEqual([
      { kind: 'stale', glob: AREA, metric: 'branches', pct: 74.47, floor: 73.4 },
    ]);
  });

  // The tolerance boundary, and the reason the comparison is done in integer
  // hundredths. 16.01 - 15.01 is 1.0000000000000018 in binary floating point,
  // so the obvious `pct - floor > staleAbove` reds an area sitting EXACTLY one
  // point clear. This pair is one of many — anyone simplifying the comparison
  // back to subtraction turns this test red.
  const AT_16_01 = {
    'packages/ui-components/src/a.ts': fileCoverage({ branches: [arms(1601, 8399)] }),
  };

  it('leaves an area sitting exactly the tolerance above its floor alone', () => {
    const area = totalsByArea(AT_16_01, [AREA])[0];
    expect(area.branches.pct).toBe(16.01);
    expect(16.01 - 15.01 > 1).toBe(true); // the trap this avoids

    expect(
      ratchetFindings([area], pin({ branches: 15.01, uncoveredBranches: 8399 }), { staleAbove: 1 }),
    ).toEqual([]);
  });

  it('reds the same area one hundredth further above its floor', () => {
    const area = totalsByArea(AT_16_01, [AREA])[0];
    expect(
      ratchetFindings([area], pin({ branches: 15, uncoveredBranches: 8399 }), { staleAbove: 1 }),
    ).toEqual([{ kind: 'stale', glob: AREA, metric: 'branches', pct: 16.01, floor: 15 }]);
  });

  it('skips an area with no pin rather than inventing a ceiling for it', () => {
    const after = totalsByArea(dedupAfter, [AREA])[0];
    expect(ratchetFindings([after], {}, { staleAbove: 1 })).toEqual([]);
  });

  it('skips a metric whose ceiling is absent, still checking the one that is present', () => {
    const after = totalsByArea(dedupAfter, [AREA])[0];
    const partial = { [AREA]: { branches: 74.47, uncoveredBranches: 216 } };
    expect(ratchetFindings([after], partial, { staleAbove: 1 })).toEqual([
      {
        kind: 'ceiling',
        glob: AREA,
        metric: 'branches',
        uncovered: 217,
        ceiling: 216,
        ratioHeld: true,
      },
    ]);
  });
});

describe('pinEntry', () => {
  // The replacement block the checker prints must be PASTEABLE — correct
  // JavaScript is not enough, because `pnpm format:check` rejects the one-line
  // form at printWidth 100 and the paste would go red for a reason that has
  // nothing to do with coverage. Asserting against the real file is what makes
  // that mechanical: this goes red if prettier's shape changes, if a field is
  // added or renamed, or if the entries stop being written this way.
  it('emits exactly the block coverage.areas.mjs already contains for each area', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = await readFile(path.join(here, '../../coverage.areas.mjs'), 'utf8');

    for (const glob of coverageAreas) {
      const { lines, branches, uncoveredLines, uncoveredBranches } = coverageThresholds[glob];
      const entry = pinEntry({
        glob,
        lines: { pct: lines, uncovered: uncoveredLines },
        branches: { pct: branches, uncovered: uncoveredBranches },
      });
      expect(source, `pinEntry output for ${glob} is not what the file holds`).toContain(entry);
    }
  });
});
