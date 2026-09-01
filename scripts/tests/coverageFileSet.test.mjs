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
  areasAffectedByDroppedFiles,
  bankableAreas,
  bankingDecision,
  countByArea,
  coveragePercent,
  diffCoverageFiles,
  expectedCoverageFiles,
  pinEntry,
  ratchetFindings,
  totalsByArea,
  trackedReportEntries,
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

  // PR #1139 review, finding 2: `Math.floor((covered / total) * 10000) / 100`
  // — the obvious rewrite of istanbul's formula, and what this function used
  // to be — is a DIFFERENT float path that reads a hundredth LOW on 4,218 of
  // the `(covered, total)` pairs with `total <= 12000`. None of the three
  // values above happen to be one of them, which is exactly how the bug
  // shipped undetected; this one is. istanbul-lib-coverage 3.2.2's actual
  // `percent()` (`lib/percent.js`) says 57, and the rewrite said 56.99.
  it('agrees with istanbul on a pair the obvious float rewrite gets wrong', () => {
    expect(coveragePercent(57, 100)).toBe(57);
    expect(coveragePercent(43, 125)).toBe(34.4);
    expect(coveragePercent(113, 200)).toBe(56.5);
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

describe('trackedReportEntries', () => {
  // BUG 1 OF ISSUE #1161, in the shape that produced it. Vitest's
  // `coverage.include` globs the working tree, so a source file that has been
  // written but not committed reaches the report — the routine state of any
  // in-progress branch. CI checks out only committed files and never sees one.
  // Counting it moved all four of an area's numbers and put them in a paste
  // block whose own instruction is "paste them, do not retype them", pinning
  // the repository to coverage no committed file can reproduce.
  const committed = {
    'packages/ui-components/src/Button.svelte': fileCoverage({
      lines: [1, 1, 0, 0],
      branches: [arms(1, 3)],
    }),
  };
  const scratch = {
    // Untracked, and BETTER covered than the area's average, so it drags the
    // ratio up as well as the count — the direction that produces a false
    // paste rather than merely a false red.
    'packages/ui-components/src/scratchUntracked.ts': fileCoverage({
      lines: [1, 1, 1, 0],
      branches: [arms(3, 1)],
    }),
  };
  const trackedFiles = Object.keys(committed);

  it('drops the entries git does not track and names them', () => {
    const { tracked, dropped } = trackedReportEntries({ ...committed, ...scratch }, trackedFiles);

    expect(Object.keys(tracked)).toEqual(Object.keys(committed));
    expect(dropped).toEqual(['packages/ui-components/src/scratchUntracked.ts']);
  });

  it('leaves the area measuring exactly what a clean checkout would measure', () => {
    const dirty = totalsByArea({ ...committed, ...scratch }, [AREA])[0];
    const clean = totalsByArea(committed, [AREA])[0];

    // The premise: counting the scratch file really does move every number,
    // and moves the ratio UPWARD while raising the untested count.
    expect(dirty.lines).toEqual({ covered: 5, total: 8, uncovered: 3, pct: 62.5 });
    expect(clean.lines).toEqual({ covered: 2, total: 4, uncovered: 2, pct: 50 });
    expect(dirty.branches.pct).toBeGreaterThan(clean.branches.pct);
    expect(dirty.branches.uncovered).toBeGreaterThan(clean.branches.uncovered);

    const filtered = totalsByArea(
      trackedReportEntries({ ...committed, ...scratch }, trackedFiles).tracked,
      [AREA],
    )[0];
    expect(filtered).toEqual(clean);
  });

  it('is a no-op on a clean tree, where every measured file is tracked', () => {
    const { tracked, dropped } = trackedReportEntries(committed, trackedFiles);
    expect(tracked).toEqual(committed);
    expect(dropped).toEqual([]);
  });
});

describe('areasAffectedByDroppedFiles', () => {
  // PR #1166 review, finding 3. The dropped-file note and the `regressed`
  // message's vitest caveat used to key off `dropped.length > 0` for the WHOLE
  // run, but `coverageInclude` reaches beyond the eight pinned areas —
  // `packages/shared-types/src/**` is measured and deliberately unfloored (see
  // `coverage.areas.mjs`), so a dropped file there moves no area's totals at
  // all. This is the scoping that separates "something was dropped somewhere"
  // from "this area's printed figures actually differ", which is the honest
  // fix the review asked for over merely softening "will" to "may".
  const AREAS = ['packages/domain/src/**', 'apps/web-pwa/src/components/**'];

  it('names the areas whose glob matches at least one dropped file', () => {
    expect(
      areasAffectedByDroppedFiles(['packages/domain/src/scratch.ts'], AREAS),
    ).toEqual(['packages/domain/src/**']);
  });

  it('is empty when the dropped file matches no pinned area, e.g. shared-types', () => {
    expect(
      areasAffectedByDroppedFiles(['packages/shared-types/src/scratch.ts'], AREAS),
    ).toEqual([]);
  });

  it('is empty when nothing was dropped', () => {
    expect(areasAffectedByDroppedFiles([], AREAS)).toEqual([]);
  });

  it('names every area a dropped file matches, not just the first', () => {
    expect(
      areasAffectedByDroppedFiles(
        ['packages/domain/src/a.ts', 'apps/web-pwa/src/components/b.svelte'],
        AREAS,
      ),
    ).toEqual(AREAS);
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
        // The ratio fell BELOW ITS FLOOR as well here (74.47 → 74.41), so
        // vitest is red too and the message may say so.
        ratio: 'regressed',
      },
    ]);
  });

  it('certifies a ceiling breach the ratio does not see, when the ratio clearly rose', () => {
    // The area GREW: 100 new branches, all covered. The ratio rises well clear
    // of the floor, so the floor is happy; one of them is untested, so the
    // ceiling is not.
    //
    // REWRITTEN for issue #1161. This used to sit at 74.50 against a floor of
    // 74.47 — a 0.03-point rise the corrected predicate cannot certify as
    // growth — and passed `staleAbove: 100` purely to suppress the stale
    // finding, which made the "grew" bar (`floor + staleAbove`) unreachable by
    // construction. A realistic tolerance and a rise big enough to mean
    // something is what the case was always trying to describe.
    const grown = {
      ...dedupAfter,
      'packages/ui-components/src/new.ts': fileCoverage({ branches: [arms(99, 1)] }),
    };
    const after = totalsByArea(grown, [AREA])[0];
    expect(after.branches.pct).toBe(77.05); // 732/950, a clear 2.58 above the floor

    const finding = ratchetFindings([after], pin(), { staleAbove: 1 }).find(
      ({ kind }) => kind === 'ceiling',
    );
    expect(finding).toMatchObject({ kind: 'ceiling', uncovered: 218, ratio: 'grew' });
  });

  // BUG 2 OF ISSUE #1161, at `firebase-sync`'s real pin. The staleness
  // tolerance lets an area sit up to a full point above its floor without the
  // ratchet firing, so the pin records where the area stood when it was last
  // BANKED, not where it stood on the last green run. Everything in that window
  // is room for a real loss of coverage to read as growth.
  const FS_AREA = 'packages/adapters/firebase-sync/src/**';
  const fsPin = {
    [FS_AREA]: { lines: 92, branches: 85.65, uncoveredLines: 54, uncoveredBranches: 34 },
  };
  // Branches sit exactly on both of their pins throughout, so only `lines` can
  // produce a finding and the assertions below are about one metric.
  const fsArea = (pct, uncovered) => ({
    glob: FS_AREA,
    lines: { pct, uncovered },
    branches: { pct: 85.65, uncovered: 34 },
  });

  it('cannot tell growth from a loss inside the staleness tolerance, and says so', () => {
    // Last green run: 716/770 = 92.98%, 54 uncovered — 0.98 above the floor,
    // inside the tolerance, so nothing was red and nothing was re-pinned. This
    // run: 709/770 = 92.07%, 61 uncovered. Seven covered lines became
    // uncovered, a real loss. It still clears the floor, so `pct >= floor` —
    // the predicate this replaced — called it growth, and the script offered
    // the block that banks the loss permanently.
    expect(ratchetFindings([fsArea(92.07, 61)], fsPin, { staleAbove: 1 })).toEqual([
      {
        kind: 'ceiling',
        glob: FS_AREA,
        metric: 'lines',
        uncovered: 61,
        ceiling: 54,
        ratio: 'unknown',
      },
    ]);
  });

  it('still certifies growth once the ratio clears floor plus the whole tolerance', () => {
    const finding = ratchetFindings([fsArea(93.44, 61)], fsPin, { staleAbove: 1 }).find(
      ({ kind }) => kind === 'ceiling',
    );
    expect(finding).toMatchObject({ ratio: 'grew' });
  });

  // The bar either side of the hundredth. Inclusive at exactly `floor +
  // staleAbove`, matching the staleness check, which leaves an area sitting
  // exactly a point clear alone — the two must agree or a band exists that is
  // neither certifiable nor stale.
  it('certifies an area sitting exactly floor plus the tolerance', () => {
    expect(ratchetFindings([fsArea(93, 61)], fsPin, { staleAbove: 1 })).toEqual([
      { kind: 'ceiling', glob: FS_AREA, metric: 'lines', uncovered: 61, ceiling: 54, ratio: 'grew' },
    ]);
  });

  it('cannot tell one hundredth below that bar', () => {
    const [finding] = ratchetFindings([fsArea(92.99, 61)], fsPin, { staleAbove: 1 });
    expect(finding).toMatchObject({ ratio: 'unknown' });
  });

  it('still reads a measurement below the floor as a plain regression', () => {
    const [finding] = ratchetFindings([fsArea(91.5, 61)], fsPin, { staleAbove: 1 });
    expect(finding).toMatchObject({ ratio: 'regressed' });
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
    // REWRITTEN for issue #1161. The behaviour under test is unchanged — the
    // `lines` metric has no ceiling here and is skipped rather than defaulted
    // — but the verdict is not: at a pct sitting EXACTLY on its floor the old
    // predicate said the ratio held, which is the whole of bug 2 in one value.
    // Exactly on the floor is the least certifiable position there is.
    expect(ratchetFindings([after], partial, { staleAbove: 1 })).toEqual([
      {
        kind: 'ceiling',
        glob: AREA,
        metric: 'branches',
        uncovered: 217,
        ceiling: 216,
        ratio: 'unknown',
      },
    ]);
  });
});

describe('bankableAreas', () => {
  // The PR #1139 review's blocking finding: deleting a firebase-sync test file
  // drops the ratio AND breaches the ceiling in the same direction — a plain
  // regression, `ratioHeld: false` — and the script printed the paste block for
  // it anyway, handing over a pin that is LOWER than the one committed. This is
  // that exact shape, reproduced without touching the real repo's coverage
  // report: a pin at 92.00%/54 uncovered, a measurement at 89.62%/70 uncovered.
  const FS_AREA = 'packages/adapters/firebase-sync/src/**';
  const regressedPin = {
    [FS_AREA]: { lines: 92.0, branches: 85.65, uncoveredLines: 54, uncoveredBranches: 91 },
  };
  const regressedMeasurement = {
    glob: FS_AREA,
    lines: { pct: 89.62, uncovered: 70 },
    branches: { pct: 85.65, uncovered: 91 },
  };

  it('withholds an area whose measured lines pct fell below its current pin', () => {
    expect(bankableAreas([regressedMeasurement], regressedPin)).toEqual([]);
  });

  it('still withholds it even though the OTHER metric (branches) is unchanged', () => {
    // Guards against a fix that only checks the metric a finding named: the
    // area must be withheld as a whole, because `pinEntry` pastes both metrics
    // together and a partial paste is not what either script prints.
    const partiallyRegressed = {
      ...regressedMeasurement,
      branches: { pct: 90, uncovered: 40 }, // improved and would be bankable alone
    };
    expect(bankableAreas([partiallyRegressed], regressedPin)).toEqual([]);
  });

  it('offers an area whose measurement clears its pin on both metrics', () => {
    const grown = {
      glob: FS_AREA,
      lines: { pct: 92.5, uncovered: 50 },
      branches: { pct: 86, uncovered: 88 },
    };
    expect(bankableAreas([grown], regressedPin)).toEqual([grown]);
  });

  it('offers an area sitting exactly at its current pin (no change, nothing lowered)', () => {
    const unchanged = {
      glob: FS_AREA,
      lines: { pct: 92.0, uncovered: 54 },
      branches: { pct: 85.65, uncovered: 91 },
    };
    expect(bankableAreas([unchanged], regressedPin)).toEqual([unchanged]);
  });

  it('withholds an area with no pin at all rather than treating it as bankable', () => {
    expect(bankableAreas([regressedMeasurement], {})).toEqual([]);
  });

  it('picks the bankable areas out of a mixed list, preserving the rest untouched', () => {
    const grown = {
      glob: 'packages/domain/src/**',
      lines: { pct: 99, uncovered: 10 },
      branches: { pct: 92, uncovered: 20 },
    };
    const pins = {
      ...regressedPin,
      [grown.glob]: { lines: 98, branches: 91, uncoveredLines: 12, uncoveredBranches: 22 },
    };
    expect(bankableAreas([regressedMeasurement, grown], pins)).toEqual([grown]);
  });
});

describe('bankingDecision', () => {
  // ISSUE #1161's withholding rule, made mechanical: the script must never
  // print "the fix is a test, never a bigger ceiling" and then hand over the
  // block that makes the ceiling bigger. This is the composition that decides,
  // so it is the only place that can be pinned without spawning the script.
  const FS_AREA = 'packages/adapters/firebase-sync/src/**';
  const pins = {
    [FS_AREA]: { lines: 92, branches: 85.65, uncoveredLines: 54, uncoveredBranches: 34 },
  };
  const measured = (pct, uncovered) => ({
    glob: FS_AREA,
    lines: { pct, uncovered },
    branches: { pct: 85.65, uncovered: 34 },
  });

  const decide = (area, opts = { staleAbove: 1 }) =>
    bankingDecision([area], ratchetFindings([area], pins, opts), pins);

  it('withholds a breach it cannot certify, which the pin bar alone would have offered', () => {
    const area = measured(92.07, 61); // bug 2's real figures
    // The bar this is ADDITIONAL to would hand the block straight over: the
    // measurement is at or above both floors, so banking lowers nothing. That
    // bar is right about its own question and must not be moved — it is what
    // lets a stale-only area bank while its other metric sits on its floor.
    expect(bankableAreas([area], pins)).toEqual([area]);

    expect(decide(area)).toEqual({ bankable: [], belowPin: [], uncertifiedGrowth: [area] });
  });

  it('offers a breach the ratio certifies as growth', () => {
    const area = measured(93.44, 61);
    expect(decide(area)).toEqual({ bankable: [area], belowPin: [], uncertifiedGrowth: [] });
  });

  it('reports a below-floor regression under the pin reason alone, not both', () => {
    const area = measured(89.62, 70);
    expect(decide(area)).toEqual({ bankable: [], belowPin: [area], uncertifiedGrowth: [] });
  });

  // #1133's Gap 1 flow, and the reason the ceiling bar is a second filter
  // rather than a higher bar inside `bankableAreas`: this area has no ceiling
  // breach at all, and its OTHER metric sits exactly on its floor — the case
  // that would have been wrongly withheld had the pin bar been raised.
  it('still offers the stale-only bank flow, with the other metric on its floor', () => {
    const area = measured(94, 54);
    const findings = ratchetFindings([area], pins, { staleAbove: 1 });
    expect(findings).toEqual([
      { kind: 'stale', glob: FS_AREA, metric: 'lines', pct: 94, floor: 92 },
    ]);
    expect(bankingDecision([area], findings, pins)).toEqual({
      bankable: [area],
      belowPin: [],
      uncertifiedGrowth: [],
    });
  });

  it('touches no area the run has no finding for', () => {
    const clean = measured(92, 54);
    const breached = { ...measured(92.07, 61), glob: 'packages/domain/src/**' };
    const domainPins = {
      ...pins,
      'packages/domain/src/**': pins[FS_AREA],
    };
    const findings = ratchetFindings([breached], domainPins, { staleAbove: 1 });
    expect(bankingDecision([clean, breached], findings, domainPins).uncertifiedGrowth).toEqual([
      breached,
    ]);
    expect(bankingDecision([clean, breached], findings, domainPins).bankable).toEqual([]);
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
