import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SLICE_SIZE, parsePairs, sliceForRun } from '../lib/duplicationPairs.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const registerPath = path.join(repoRoot, '.github/duplication-pairs.md');
const register = parsePairs(readFileSync(registerPath, 'utf8'));

const FIXTURE = `
# Policy-twin register

Prose with a ## heading of its own that is not an entry.

## How this file is used

More prose naming \`some/path/in/prose.ts\` that is not a registered file.

## 1. First pair

**Files:** \`a/one.ts\` ↔ \`a/two.ts\`

Why they might disagree.

## 2. Second pair

**Files:** \`b/one.ts\` ↔ \`b/two.ts\` ↔ \`b/three.ts\`

## 3. Third pair

**Files:** \`c/one.ts\` ↔ \`c/two.ts\`
`;

describe('parsePairs', () => {
  it("reads only the numbered entries, not the file's own prose headings", () => {
    const entries = parsePairs(FIXTURE);
    expect(entries.map((e) => e.number)).toEqual([1, 2, 3]);
    expect(entries.map((e) => e.title)).toEqual(['First pair', 'Second pair', 'Third pair']);
  });

  it('takes paths from the Files line only', () => {
    // A path mentioned in prose is not a registered file, and must not end up in
    // the set the existence check walks.
    const entries = parsePairs(FIXTURE);
    expect(entries[0].files).toEqual(['a/one.ts', 'a/two.ts']);
    expect(entries[1].files).toHaveLength(3);
    expect(entries.flatMap((e) => e.files)).not.toContain('some/path/in/prose.ts');
  });

  it('carries the whole entry text through, so the agent reads the reasoning too', () => {
    expect(parsePairs(FIXTURE)[0].text).toContain('Why they might disagree.');
  });
});

describe('sliceForRun', () => {
  const entries = parsePairs(FIXTURE);

  it('gives consecutive runs different pairs', () => {
    // THE PIN for the phase's stated outcome: "two consecutive dispatches
    // examine DIFFERENT pairs". An ISO-week rotation fails this — two runs in
    // one week return the same slice — which is why the run counter drives it.
    for (let run = 0; run < 12; run += 1) {
      const a = sliceForRun(entries, run).map((e) => e.number);
      const b = sliceForRun(entries, run + 1).map((e) => e.number);
      expect(a).not.toEqual(b);
    }
  });

  it('visits every entry rather than starving any', () => {
    const seen = new Set();
    for (let run = 0; run < entries.length * 2; run += 1)
      for (const e of sliceForRun(entries, run)) seen.add(e.number);
    expect([...seen].sort()).toEqual(entries.map((e) => e.number));
  });

  it('returns a slice of the requested size, wrapping past the end', () => {
    const last = sliceForRun(entries, 1, 2);
    expect(last).toHaveLength(2);
    expect(sliceForRun(entries, 5, 2).map((e) => e.number)).toEqual([2, 3]);
  });

  it('never returns more entries than the register holds', () => {
    expect(sliceForRun(entries.slice(0, 1), 3, 2)).toHaveLength(1);
    expect(sliceForRun([], 3, 2)).toEqual([]);
  });
});

describe('the checked-in register', () => {
  it('parses into a usable rotation', () => {
    expect(register.length).toBeGreaterThanOrEqual(SLICE_SIZE * 3);
    expect(register.map((e) => e.number)).toEqual(register.map((_, i) => i + 1));
  });

  it('names at least two files in every entry — a "pair" of one is not a pair', () => {
    for (const entry of register) {
      expect(entry.files.length, `entry #${entry.number} "${entry.title}"`).toBeGreaterThanOrEqual(
        2,
      );
    }
  });

  it('points every path at a file that exists', () => {
    // THE PIN that keeps the register honest. An entry naming a file that has
    // been renamed away would come round every few weeks, find nothing, and
    // report a clean result — a sweep confidently checking a pair that is not
    // there is #911's failure in miniature. This goes red the moment a
    // registered path moves.
    const missing = register.flatMap((entry) =>
      entry.files
        .filter((file) => !existsSync(path.join(repoRoot, file)))
        .map((file) => `#${entry.number} "${entry.title}" → ${file}`),
    );
    expect(missing).toEqual([]);
  });
});
