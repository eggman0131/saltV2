/**
 * Source guard: the unit-test spec's countable rules are counted (issue #1134).
 *
 * `docs/unit-test-spec.md` states 34 `UT-*` rules, 24 of them `MUST`, and until
 * this file nothing checked any of them. #1134 measured what that produced: in
 * the seven days after the spec was written the repo gained 76 test files, and
 * the two rules the spec supplies its own grep for got worse in ABSOLUTE terms —
 * nine of the ten files that newly breached the `vi.mock` cap did not exist when
 * the spec was written. Every one of them went through a PR that
 * `pr-doc-review.yml` routed to the spec, because that job asks whether the DOC
 * is stale, never whether the code obeys it. A written convention with no
 * mechanism measured no effect at all, which is CLAUDE.md Rule 12 exactly.
 *
 * Nine rules are countable off the source. This file counts them, compares each
 * area against `unit-test-spec.areas.mjs`, and reds on any difference in either
 * direction. The matchers live in `scripts/lib/unitTestSpec.mjs`; its header
 * carries the anti-vacuity argument and the honest limits of each one.
 *
 * The other twenty-five rules need a reader, and Phase 2 of #1134 marks them in
 * the spec as review-only rather than leaving them stated as absolutes that
 * nothing enforces.
 *
 * ── What stops it going vacuously green, and where that stops ───────────────
 *
 * Verified by breaking each property and watching the named test go red, not by
 * assertion: a 6th `vi.mock` and a hand-rolled `makeRecipe` each red their
 * area's row naming the file; removing a violation without lowering the ceiling
 * reds the same row the other way; and widening the UT-B1 matcher until it fires
 * on nothing reds its own self-test first.
 *
 * The honest limit is that anti-vacuity comes from two different places
 * depending on the rule. For a rule with a NON-ZERO ceiling somewhere, the
 * equality assertion is the anchor — a matcher that stops matching cannot stay
 * green. For a rule at zero everywhere (UT-C1, UT-G3, UT-G4 today) there is
 * nothing in the tree to anchor against, and the only thing standing between it
 * and a silent no-op is its `catches` sample. That is why the completeness test
 * insists every rule has one, and why a rule may not be added without it.
 *
 * ── What is NOT here, deliberately ──────────────────────────────────────────
 *
 * No violation is fixed. #941 is explicit that the safety net rides per issue,
 * never as a global backfill, and #923/#928/#929/#930 are about to move much of
 * this code. The 153 breaches are frozen, not scheduled.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { violationCeilings } from '../../unit-test-spec.areas.mjs';
import {
  AREA_RULES,
  FILE_RULES,
  SAMPLE_AREA,
  repoRoot,
  scanViolations,
  stripComments,
  testFilesIn,
  unitTestAreas,
} from '../lib/unitTestSpec.mjs';

const areas = unitTestAreas();
const violations = scanViolations();

/** Which rules bind a given area — a file rule may be scoped to one app. */
const rulesFor = (area) => [
  ...FILE_RULES.filter((r) => (r.areas ?? [area]).includes(area)).map((r) => r.id),
  ...AREA_RULES.map((r) => r.id),
];

const found = (area, rule) => violations.filter((v) => v.area === area && v.rule === rule);

/** Every (area, rule) pair the ratchet covers, as `it.each` rows. */
const grid = areas.flatMap((area) =>
  rulesFor(area).map((rule) => ({
    area,
    rule,
    what: [...FILE_RULES, ...AREA_RULES].find((r) => r.id === rule).what,
    ceiling: violationCeilings[area]?.[rule],
    // The title reads the string, not the number: vitest's `$ceiling` renders a
    // zero as `+0`, which looks like a defect in the guard rather than a clean
    // area.
    frozen: String(violationCeilings[area]?.[rule]),
  })),
);

/**
 * Write a file map into a throwaway directory and hand its root to `fn`.
 *
 * The config matchers read a directory layout off disk, so their samples have to
 * be one. Synthetic, never the real tree: a matcher pinned against the repo it
 * scans would agree with whatever the repo currently is.
 */
function withFixture(files, fn) {
  const root = mkdtempSync(join(tmpdir(), 'unit-test-spec-'));
  try {
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), body);
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('the unit-test spec is counted, not merely written', () => {
  // ─── Anti-vacuity: the scan still reaches what it claims to (UT-E2) ────────

  it('reads its areas out of the root vitest config, and the ratchet names those', () => {
    // Not an inventory — an anchor. A `projects` array this stopped parsing
    // would leave every assertion below iterating nothing.
    expect(areas.length).toBeGreaterThanOrEqual(8);
    expect(areas).toContain('packages/domain');
    expect(areas).toContain('apps/web-pwa');
    expect(areas).toContain('scripts');

    // Both directions. A project with no ceilings is not scanned by the ratchet;
    // a ceiling for no project is a row nothing can ever red.
    expect([...areas].sort()).toEqual(Object.keys(violationCeilings).sort());
  });

  it('declares a ceiling for every rule that binds an area, and none that does not', () => {
    for (const area of areas) {
      expect(Object.keys(violationCeilings[area]).sort(), `ceilings for ${area}`).toEqual(
        rulesFor(area).sort(),
      );
    }
  });

  it('still finds the test files it scans', () => {
    const counts = Object.fromEntries(areas.map((a) => [a, testFilesIn(a).length]));
    // A walk that narrowed — a `tests/` renamed, a suffix dropped — fails here
    // rather than counting zero violations in an area it can no longer see.
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBeGreaterThan(400);
    for (const area of areas) expect(counts[area], `test files in ${area}`).toBeGreaterThan(0);

    const paths = areas.flatMap((a) => testFilesIn(a).map((f) => f.path));
    expect(paths).toContain('apps/web-pwa/tests/sharedHelperGuard.test.ts');
    expect(paths).toContain('apps/cloud-functions/tests/aiTimeoutGuard.test.ts');
    expect(paths).toContain('scripts/tests/coverageFileSet.test.mjs');
  });

  it('strips comments off the real tree, so a rule quoted in prose is not an instance', () => {
    // Derived, not path-keyed: files whose RAW text carries a UT-E4 path escape
    // and whose stripped text does not are exactly the files that MENTION the
    // rule. #1134 found three, all of them guard headers explaining UT-E4. If
    // this ever reaches zero the stripper has stopped doing anything and the
    // must-not-match case below is being met by an empty set.
    const escape = /(?:\.\.\/){2,}(?:packages|apps)\//;
    const mentions = areas
      .flatMap((a) => testFilesIn(a))
      .filter((f) => !escape.test(f.code) && escape.test(rawOf(f.path)));
    expect(mentions.length).toBeGreaterThan(0);
  });

  // ─── Every matcher, against a violation it must catch and a near-miss ──────

  it('gives every rule both kinds of sample', () => {
    // The completeness check. A rule added without its two samples is a matcher
    // nothing pins, which is how the five guards #941 measured went quiet.
    for (const rule of [...FILE_RULES, ...AREA_RULES]) {
      expect(rule.catches?.length ?? 0, `${rule.id} positive samples`).toBeGreaterThan(0);
      expect(rule.misses?.length ?? 0, `${rule.id} near-miss samples`).toBeGreaterThan(0);
    }
  });

  it.each(FILE_RULES)('$id fires on a file that $what, and not on a near-miss', (rule) => {
    for (const sample of rule.catches) {
      expect(rule.violates(stripComments(sample)), `should catch: ${sample}`).toBe(true);
    }
    for (const sample of rule.misses) {
      expect(rule.violates(stripComments(sample)), `should ignore: ${sample}`).toBe(false);
    }
  });

  it.each(AREA_RULES)('$id fires on an area that $what, and not on a near-miss', (rule) => {
    for (const files of rule.catches) {
      const hits = withFixture(files, (root) => rule.violations(SAMPLE_AREA, root));
      expect(hits, `should catch: ${Object.keys(files).join(', ')}`).not.toEqual([]);
    }
    for (const files of rule.misses) {
      const hits = withFixture(files, (root) => rule.violations(SAMPLE_AREA, root));
      expect(hits, `should ignore: ${Object.keys(files).join(', ')}`).toEqual([]);
    }
  });

  // ─── The ratchet ──────────────────────────────────────────────────────────

  it.each(grid)('$area breaches $rule in exactly $frozen file(s)', (row) => {
    const files = found(row.area, row.rule).map((v) => v.file);
    expect(files.length, ratchetMessage(row, files)).toBe(row.ceiling);
  });
});

/** The failing file, the rule, the ceiling and the count — per #1134's spec. */
function ratchetMessage(row, files) {
  const direction =
    files.length > row.ceiling
      ? `Fix the file, or — if this breach is deliberate — raise the ceiling to ${files.length} in unit-test-spec.areas.mjs and say why in the diff.`
      : `A violation was fixed and the ratchet was not lowered: set ${row.rule} for ${row.area} to ${files.length} in unit-test-spec.areas.mjs.`;
  return [
    `${row.rule} (${row.what}) in ${row.area}: ${files.length} file(s), ceiling ${row.ceiling}.`,
    ...files.map((f) => `  ${f}`),
    direction,
    'The rule is in docs/unit-test-spec.md; the matcher is in scripts/lib/unitTestSpec.mjs.',
  ].join('\n');
}

/** A scanned file's bytes with its comments still in — the stripper's control. */
function rawOf(path) {
  return readFileSync(join(repoRoot, path), 'utf8');
}
