import { describe, expect, it } from 'vitest';

import {
  DEFAULT_THRESHOLDS,
  findRenamedClones,
  shingles,
  similarity,
  svelteScript,
  tokenize,
} from '../lib/tokenShingles.mjs';

describe('tokenize', () => {
  it('is blind to naming — the property the whole layer rests on', () => {
    const a = `export function onKitchenTimerWrite(event) { const timer = event.data; return save(timer); }`;
    const b = `export function onCookTimerWrite(change) { const record = change.data; return persist(record); }`;
    expect(tokenize(a)).toEqual(tokenize(b));
  });

  it('is blind to string and number contents', () => {
    expect(tokenize(`const a = "kitchenTools"; const b = 42;`)).toEqual(
      tokenize(`const a = "productForms"; const b = 9001;`),
    );
  });

  it('drops comments, so reworded prose cannot hide a clone', () => {
    // This is the #912 cook-page case in miniature: identical logic, comments
    // rewritten, which is what defeated a text-level comparison.
    const a = `// Derive the icon map for the canon entries.\nconst m = build(x);`;
    const b = `/* Build up a map of icons, keyed by canon id. */\nconst m = build(x);`;
    expect(tokenize(a)).toEqual(tokenize(b));
  });

  it('keeps keywords, so different constructs stay different', () => {
    // Blindness has to stop somewhere. If `const` and `let` collapsed too, the
    // layer would report structurally different code as identical.
    expect(tokenize(`const x = 1;`)).not.toEqual(tokenize(`let x = 1;`));
    expect(tokenize(`if (a) b();`)).not.toEqual(tokenize(`while (a) b();`));
  });

  it('does not treat an unterminated construct as a reason to throw', () => {
    // A lexer over a half-written file must degrade, not explode — a thrown
    // error in the sweep would skip the file silently.
    expect(() => tokenize('const a = "unterminated')).not.toThrow();
    expect(() => tokenize('/* unterminated')).not.toThrow();
  });
});

describe('svelteScript', () => {
  it('takes every script block and leaves the template behind', () => {
    const sfc = `<script lang="ts">const a = 1;</script>\n<div>markup</div>\n<script>const b = 2;</script>`;
    const out = svelteScript(sfc);
    expect(out).toContain('const a = 1;');
    expect(out).toContain('const b = 2;');
    expect(out).not.toContain('markup');
  });
});

describe('similarity', () => {
  it('separates "same file" from "contained in"', () => {
    const small = new Set(['a', 'b']);
    const large = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    const score = similarity(small, large);
    // Wholly contained, but a quarter the size: coverage sees it, jaccard does
    // not. A sweep gated on jaccard alone would miss every partial clone.
    expect(score.coverage).toBe(1);
    expect(score.jaccard).toBeLessThan(0.3);
  });

  it('scores empty input as zero rather than dividing by it', () => {
    expect(similarity(new Set(), new Set(['a']))).toEqual({ jaccard: 0, coverage: 0, shared: 0 });
  });
});

// A renamed clone the size of the smallest real one this layer was built to
// catch. `generateEquipmentIcon` ↔ `generateKitchenToolIcon` score 1.00 with 89
// shingles each; this fixture is deliberately built to land near that size.
const STATEMENT_SHAPES = [
  (v, i) => `const ${v}${i} = await load${v}(${i});`,
  (v, i) => `if (!${v}${i}) { throw new Error("missing ${v}"); }`,
  (v, i) => `for (const item of ${v}${i}.rows) { collect${v}(item, ${i}); }`,
  (v, i) => `const ${v}Map${i} = new Map(${v}${i}.map((r) => [r.id, r]));`,
  (v, i) => `try { await write${v}(${v}Map${i}); } catch (err) { report(err, ${i}); }`,
  (v, i) => `while (${v}${i}.pending) { ${v}${i} = await step${v}(${v}${i}); }`,
  (v, i) => `switch (${v}${i}.kind) { case "a": return ${i}; default: break; }`,
  (v, i) => `const ${v}Total${i} = ${v}${i}.reduce((sum, r) => sum + r.amount, ${i});`,
];

// Structurally varied on purpose. A body of n identical statements collapses to
// a handful of DISTINCT shingles however long it is, so a repetitive fixture
// would not exercise the size floor at all.
const cloneOfAbout = (n, names) => {
  const body = Array.from({ length: n }, (_, i) =>
    STATEMENT_SHAPES[i % STATEMENT_SHAPES.length](names, i),
  ).join('\n');
  return tokenize(`export async function run${names}() {\n${body}\n}`);
};

describe('findRenamedClones size floor', () => {
  it('still reports a ~90-shingle whole-file clone at the shipped defaults', () => {
    // THE CALIBRATION PIN. `minShingles: 250` shortens the report beautifully
    // and silently drops both clones the layer exists to find. Raise
    // DEFAULT_THRESHOLDS.minShingles past ~89 and this test goes red — which is
    // the only thing standing between a tidy report and #911's mistake.
    const a = { path: 'src/generateEquipmentIcon.ts', tokens: cloneOfAbout(8, 'Equipment') };
    const b = { path: 'src/generateKitchenToolIcon.ts', tokens: cloneOfAbout(8, 'KitchenTool') };

    expect(shingles(a.tokens).size).toBeGreaterThanOrEqual(85);
    expect(shingles(a.tokens).size).toBeLessThanOrEqual(160);

    const pairs = findRenamedClones([a, b]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].jaccard).toBe(1);
  });

  it('goes quiet when the floor is raised above the clone — the regression being guarded', () => {
    const a = { path: 'a.ts', tokens: cloneOfAbout(8, 'Equipment') };
    const b = { path: 'b.ts', tokens: cloneOfAbout(8, 'KitchenTool') };
    expect(findRenamedClones([a, b], { minShingles: 250 })).toHaveLength(0);
  });

  it('discards re-export stubs, which match each other perfectly and mean nothing', () => {
    const stub = (name) => ({ path: `${name}/index.ts`, tokens: tokenize(`export * from './${name}';`) });
    expect(findRenamedClones([stub('canon'), stub('recipe')])).toHaveLength(0);
  });
});

describe('findRenamedClones', () => {
  it('qualifies a pair on either axis, not both', () => {
    const big = cloneOfAbout(40, 'Thing');
    const small = big.slice(0, 200);
    const pairs = findRenamedClones([
      { path: 'big.ts', tokens: big },
      { path: 'small.ts', tokens: small },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].coverage).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.minCoverage);
  });

  it('reports nothing for unrelated files', () => {
    const a = { path: 'a.ts', tokens: cloneOfAbout(8, 'Equipment') };
    const b = {
      path: 'b.ts',
      tokens: tokenize(
        `export class Ledger { private rows = []; add(r) { this.rows.push(r); } total() { return this.rows.reduce((s, r) => s + r.amount, 0); } }`.repeat(
          8,
        ),
      ),
    };
    expect(findRenamedClones([a, b])).toHaveLength(0);
  });

  it('is deterministic regardless of input order', () => {
    const a = { path: 'a.ts', tokens: cloneOfAbout(8, 'Equipment') };
    const b = { path: 'b.ts', tokens: cloneOfAbout(8, 'KitchenTool') };
    expect(findRenamedClones([a, b])).toEqual(findRenamedClones([b, a]));
  });
});
