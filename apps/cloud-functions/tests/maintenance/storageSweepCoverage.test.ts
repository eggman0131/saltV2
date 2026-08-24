import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SWEEPS, UNSWEPT } from '../../src/maintenance/storageSweepTargets.js';

// The weekly orphan sweep covers every Storage prefix, or says which it does not
// (issue #919, finding C3-004).
//
// `SWEEPS` listed five prefixes while `storage.rules` declared six. Nothing
// anywhere reconciled the two, so `batch-images/` was uncovered and unmentioned —
// and the sweep exists precisely because nothing else in this codebase deletes a
// Storage object, so an uncovered prefix accumulates orphans forever. Staging
// reached 165 orphans out of 168 objects the last time that went unnoticed.
//
// The fix is not a sixth row in a hand-written list; the hand-written list IS the
// defect. The rules file already enumerates every prefix this app will ever
// serve — a prefix with no `match` block is unreadable by the client and so
// cannot exist as a feature — which makes it the one place the full set can be
// DERIVED from. Anything it declares must be swept, or be recorded in `UNSWEPT`
// with a reason. A prefix in neither is a red test.
const RULES = fileURLToPath(new URL('../../../../storage.rules', import.meta.url));

/**
 * Top-level object prefixes declared by `storage.rules`, e.g. `canon-icons/`.
 *
 * Read from inside the `match /b/{bucket}/o` scope — that line is the bucket
 * itself, not a path — and the catch-all `{allPaths=**}` is skipped by the
 * regex, since it is the deny everything else falls through to rather than a
 * prefix anything is served from.
 */
function declaredPrefixes(): string[] {
  const rules = readFileSync(RULES, 'utf8');
  const scope = rules.indexOf('match /b/{bucket}/o');
  expect(scope, 'storage.rules no longer opens a /b/{bucket}/o scope').toBeGreaterThan(-1);

  const prefixes = new Set<string>();
  const inner = rules.slice(rules.indexOf('\n', scope));
  for (const [, segment] of inner.matchAll(/^\s*match \/([^/{\s]+)\//gm)) {
    prefixes.add(`${segment as string}/`);
  }
  return [...prefixes].sort();
}

describe('storage sweep coverage', () => {
  it('reads a non-trivial set of prefixes out of storage.rules', () => {
    // Anti-vacuity. A parser that silently matched nothing would make every
    // assertion below pass, which is the failure shape this whole test exists to
    // remove.
    const declared = declaredPrefixes();
    expect(declared).toContain('canon-icons/');
    expect(declared).toContain('batch-images/');
    expect(declared.length).toBeGreaterThanOrEqual(SWEEPS.length);
  });

  it('every prefix storage.rules declares is swept, or recorded as unswept', () => {
    const accounted = new Set([...SWEEPS.map((s) => s.prefix), ...Object.keys(UNSWEPT)]);
    const uncovered = declaredPrefixes().filter((prefix) => !accounted.has(prefix));

    expect(
      uncovered,
      `storage.rules serves these, and nothing sweeps them or says why not — ` +
        `add a SWEEPS row or an UNSWEPT entry: ${uncovered.join(', ')}`,
    ).toEqual([]);
  });

  it('sweeps nothing storage.rules does not serve', () => {
    // The other direction: a SWEEPS row for a prefix with no `match` block is a
    // bucket listing that can only ever return nothing, and it would read as
    // coverage.
    const declared = new Set(declaredPrefixes());
    const phantom = SWEEPS.map((s) => s.prefix).filter((prefix) => !declared.has(prefix));

    expect(phantom, `swept but not declared in storage.rules: ${phantom.join(', ')}`).toEqual([]);
  });

  it('gives every unswept prefix a reason', () => {
    // An empty string would satisfy the coverage check above while saying nothing,
    // which is the state `batch-images/` was already in.
    for (const [prefix, reason] of Object.entries(UNSWEPT)) {
      expect(reason.length, `${prefix} is exempt without a reason`).toBeGreaterThan(20);
    }
  });
});
