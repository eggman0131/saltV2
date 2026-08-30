// The "renamed clone" layer of the weekly duplication sweep: two files that are
// the same code with different names throughout.
//
// This exists because the layer it replaces does not work. Issue #912 specced
// `jscpd --mode weak` for this, on the understanding that weak mode normalises
// identifiers. Measured over this repo's first-party TS tree at 20 lines/120
// tokens, strict and weak produce byte-identical output — 2 clones, 0.17% — and
// neither reports `onKitchenTimerWrite` ↔ `onCookTimerWrite`, which are the same
// function with the nouns swapped. jscpd's clone detection is anchored on token
// VALUES, so a rename breaks the hash chain in both modes.
//
// What works instead is to destroy the values before hashing. Every identifier,
// string and number collapses to a single placeholder; keywords, punctuation and
// operators survive. What is left is the SHAPE of the code, which a rename does
// not touch. Two files that differ only in naming produce identical token
// streams and score 1.00.
//
// Shingles rather than whole-stream equality because the interesting case is
// partial: two files that share most of their structure but have diverged in
// one place are exactly what a drift sweep is looking for, and an equality test
// would score them 0 alongside two files with nothing in common.

// Keywords are kept verbatim — they carry the shape. Anything not in this set
// that lexes as a word is a name, and names are what we are deliberately blind
// to. TS/JS reserved words plus the contextual ones that change what a construct
// MEANS (`async`, `await`, `type`, `interface`, ...).
//
// The contextual ones cost something, in the direction of MISSING a clone rather
// than inventing one. A variable actually named `type` lexes as a keyword while
// its twin's `kind` lexes as a name, so that pair scores lower than it should
// and a rename touching such a word can drop below threshold. That is the
// accepted trade: a false negative in a rare case, against losing the ability to
// tell `type X = ...` from an assignment in every file. Widening this set makes
// the layer blinder; narrowing it makes it noisier.
const KEYWORDS = new Set(
  `await break case catch class const continue debugger default delete do else enum export
   extends false finally for function if implements import in instanceof interface let new
   null package private protected public return static super switch this throw true try
   typeof var void while with yield as asserts any boolean constructor declare from get infer
   is keyof module namespace never readonly require number object set string symbol type
   undefined unique unknown global satisfies abstract async of out override accessor`.split(
    /\s+/,
  ),
);

const ID_START = /[A-Za-z_$]/;
const ID_PART = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;

/**
 * Source text → a stream of shape tokens.
 *
 * Comments are dropped entirely: #912's whole motivating example is a pair of
 * cook pages whose logic was identical and whose comments had been reworded, so
 * comment text is actively misleading here.
 *
 * This is a lexer, not a parser. It has to be, because it runs over `.svelte`
 * script blocks and over TypeScript with decorators and generics, and anything
 * that needs a valid parse would fail on a syntax this repo has not adopted yet.
 * The failure mode of a lexer is a slightly wrong token count; the failure mode
 * of a parser is an exception and a silently skipped file.
 */
export function tokenize(source) {
  const tokens = [];
  const n = source.length;
  let i = 0;

  while (i < n) {
    const c = source[i];

    // Whitespace carries no shape.
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i += 1;
      continue;
    }

    // Comments — dropped, see above.
    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    // Strings and template literals → one placeholder. A template's `${...}`
    // interpolations are deliberately swallowed with the rest: a renamed clone
    // typically renames inside them too, and treating the whole literal as one
    // opaque token is what makes that invisible.
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i += 1;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      tokens.push('S');
      continue;
    }

    // Numbers → one placeholder. Suffixes, separators and hex all collapse.
    if (DIGIT.test(c)) {
      while (i < n && /[0-9a-fA-FxXoObBeE._n]/.test(source[i])) i += 1;
      tokens.push('N');
      continue;
    }

    // Words: keywords survive, names do not.
    if (ID_START.test(c)) {
      let word = '';
      while (i < n && ID_PART.test(source[i])) {
        word += source[i];
        i += 1;
      }
      tokens.push(KEYWORDS.has(word) ? word : 'I');
      continue;
    }

    // Everything else is punctuation or an operator, kept as-is. Multi-character
    // operators split into single characters, which is harmless: the split is
    // deterministic, so it is identical on both sides of any comparison.
    tokens.push(c);
    i += 1;
  }

  return tokens;
}

/** The `<script>` bodies of a Svelte component, concatenated. */
export function svelteScript(source) {
  const blocks = [];
  const open = /<script\b[^>]*>/gi;
  let m;
  while ((m = open.exec(source)) !== null) {
    const start = m.index + m[0].length;
    const end = source.indexOf('</script>', start);
    if (end === -1) break;
    blocks.push(source.slice(start, end));
    open.lastIndex = end;
  }
  return blocks.join('\n');
}

export const SHINGLE_SIZE = 9;

/**
 * The set of distinct k-token windows in a stream.
 *
 * k=9 is small enough that a shared 20-line region still produces dozens of
 * matching windows, and large enough that the windows common to ALL TypeScript
 * — `) { return I . I (` and the like — do not dominate the intersection.
 */
export function shingles(tokens, k = SHINGLE_SIZE) {
  const set = new Set();
  for (let i = 0; i + k <= tokens.length; i += 1) set.add(tokens.slice(i, i + k).join(' '));
  return set;
}

/**
 * How alike two shingle sets are, on two axes that disagree usefully.
 *
 * `jaccard` is symmetric and punishes size differences, so it answers "are these
 * the same file?". `coverage` divides by the SMALLER set, so it answers "is one
 * of these contained in the other?" — which is the shape of a small helper
 * copied wholesale into a large file, and would score near zero on jaccard
 * alone. A sweep that reported only jaccard would miss every partial clone.
 */
export function similarity(a, b) {
  if (a.size === 0 || b.size === 0) return { jaccard: 0, coverage: 0, shared: 0 };
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const s of small) if (large.has(s)) shared += 1;
  return {
    jaccard: shared / (a.size + b.size - shared),
    coverage: shared / small.size,
    shared,
  };
}

// Calibrated against this repo, keeping the pairs that justify the layer's
// existence visible. Measured over 873 first-party files:
//
//   minShingles |  40   60   80  150  250  400
//   pairs       | 120   65   45   26    5    0     (at jaccard>=0.8/coverage>=0.9)
//
// 250 gives a beautifully short report and is WRONG: the two whole-file clones
// this layer was built to catch — `onCookTimerWrite` ↔ `onKitchenTimerWrite` and
// `generateEquipmentIcon` ↔ `generateKitchenToolIcon`, both scoring 1.00 — have
// shingle sets of 144 and 89, so a floor of 250 silently drops the evidence
// while reporting success. That is the #911 failure exactly. 60 sits clearly
// below 89 with room for the files to shrink, and still discards the re-export
// stubs. `tests/tokenShingles.test.mjs` pins this: raise the floor past a
// ~90-shingle clone and it goes red.
//
// Tightening the SCORES rather than the size floor is the safe way to shorten
// the report: 0.9/0.95 gives 24 pairs and keeps both calibration pairs.
export const DEFAULT_THRESHOLDS = { minJaccard: 0.9, minCoverage: 0.95, minShingles: 60 };

/**
 * Every pair scoring at or above the thresholds, strongest first.
 *
 * A pair qualifies on EITHER axis, not both: jaccard catches "these are the same
 * file", coverage catches "this whole file is a region of that one", and a pair
 * that needs both to agree is only the first of those.
 *
 * `minShingles` drops files too short to say anything about. Without it a
 * 12-token barrel file matches every other barrel file at 1.00, and the report
 * is nothing but re-export stubs.
 */
export function findRenamedClones(files, options = {}) {
  const { minJaccard, minCoverage, minShingles } = { ...DEFAULT_THRESHOLDS, ...options };
  const entries = files
    .map(({ path, tokens }) => ({ path, set: shingles(tokens) }))
    .filter((f) => f.set.size >= minShingles)
    .sort((a, b) => (a.path < b.path ? -1 : 1));

  const pairs = [];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const score = similarity(entries[i].set, entries[j].set);
      if (score.jaccard >= minJaccard || score.coverage >= minCoverage) {
        pairs.push({ a: entries[i].path, b: entries[j].path, ...score });
      }
    }
  }
  return pairs.sort((x, y) => y.jaccard - x.jaccard || y.coverage - x.coverage);
}
