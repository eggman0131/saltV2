import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// dependabot-major-review.yml waits for the PR's own CI checks to settle before
// the assessment reads them, and it selects those checks BY NAME — job names
// copied out of ci.yml into a `want='…'` alternation, matched with jq `test()`.
//
// Two properties nothing else pins. First, a copy goes stale in silence: rename
// the aggregator and the poll stops waiting on the gate the prompt then
// attributes failures to, with no red check anywhere, because a pattern that
// matches nothing is indistinguishable from one whose checks have all passed.
// Second, `test()` matches a SUBSTRING, so an alternative can go on quietly
// resolving to a job nobody meant — `typecheck` matched only the aggregator
// `Lint, typecheck, test, boundary`, never the `Types` job it reads like.
//
// This is the pin CLAUDE.md rule 12 asks for: every alternative in `want` must
// still name a live ci.yml job. It is deliberately NOT part of the merge-queue
// guard, which pins ci.yml against the branch RULESET — an unreported required
// context jams the queue. This poll is neither required nor able to jam
// anything, and it points the other way: one workflow against ci.yml.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');

/** Job-level `name:` values — exactly four spaces of indent. A step's name is
 *  written `      - name:` and a workflow's at column 0, so neither collides. */
const jobNames = (text) => [...text.matchAll(/^ {4}name: (.+)$/gm)].map((match) => match[1].trim());

describe('dependabot-major-review check poll', () => {
  const review = read('.github/workflows/dependabot-major-review.yml');
  const names = jobNames(read('.github/workflows/ci.yml'));

  const want = review.match(/^\s*want='([^']+)'/m)?.[1];

  it('still declares the checks it polls for', () => {
    // Losing `want` doesn't break the loop — `$want` expands to nothing and
    // `test("")` matches every check, so the job would wait on itself until the
    // 15-minute cap. Fail loudly instead.
    expect(want, "no `want='…'` assignment in dependabot-major-review.yml").toBeDefined();
  });

  it.each((want ?? '').split('|'))(
    'polls for %o, which is a live ci.yml job name',
    (alternative) => {
      expect(
        names.filter((name) => new RegExp(alternative).test(name)),
        `\`want\` in dependabot-major-review.yml matches no job in ci.yml. ` +
          `Current job names: ${names.join(', ')}.`,
      ).not.toHaveLength(0);
    },
  );
});
