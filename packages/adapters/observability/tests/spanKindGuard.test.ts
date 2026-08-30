/**
 * Source guard: every `kind:` written into an `OtlpSpan` goes through the mapper.
 *
 * `@opentelemetry/api`'s `SpanKind` and the OTLP wire's `Span.SpanKind` are two
 * different enumerations of the same six concepts and they do not agree on the
 * numbers — the wire reserves 0 for "unspecified", so its kinds start at 1 while
 * the API enum starts at 0. `shared/otlpWire.ts` carries the full table and the
 * `toWireSpanKind` switch that bridges them.
 *
 * ── Why a scan and not just the comment (issue #1030) ────────────────────────
 *
 * The off-by-one defect (#1011) was written INDEPENDENTLY on both distributed
 * legs — each forwarded the raw API enum onto the wire — and neither review nor
 * any value-level test caught it; #1007's tripwire did. Shipping every span one
 * kind too low does not look like corrupt data downstream, it looks like a
 * plausible but WRONG service graph, because tracing backends key topology maps
 * and parent/child rendering off span kind. That is precisely the failure mode a
 * human reviewer nods past.
 *
 * `tests/spanKindWire.test.ts` and `tests/otlpWireParity.test.ts` pin the mapper's
 * VALUES. They cannot pin its REACH: nothing there fails when a future emitter
 * writes a third `OtlpSpan` literal with `kind: span.kind`. A convention that
 * lives only in a comment is broken by the next person who does not read it, so
 * this file makes it mechanical — the house precedent being
 * `apps/cloud-functions/tests/aiTimeoutGuard.test.ts`, named by
 * `docs/unit-test-spec.md` UT-E1 as the shape to copy.
 *
 * ── Shape ────────────────────────────────────────────────────────────────────
 *
 * The scan surface is DERIVED by walking `src` (UT-E1) — every `.ts` under it,
 * recursively, so `shared/`, `server/` and the browser default subpath are all
 * inside it. A hand-listed set of directories would be the same defect one level
 * up: the original bug landed on two different legs.
 *
 * This reads bytes off disk and never imports the modules it checks — importing
 * them would let a mock make it vacuously green (the `aiTimeoutGuard` model).
 * The matcher is a pure function over a string, which is what lets every case
 * below run against inline source instead of a bad file written to disk.
 *
 * A guard is only worth its weight if its blind spots fail RED. Four ways it
 * previously failed GREEN, all fixed here and all pinned by fixtures below: a
 * lexer that could not tell a comment from a string (`blankNonCode`), an anchor
 * that recognised two of the eight ways an `OtlpSpan` gets built
 * (`findOtlpSpanKinds`), a bare `SPAN_KIND_INTERNAL` on a FORWARDING leg, and a
 * kind written by ASSIGNMENT after the literal had closed (both #1102).
 *
 * Only two right-hand sides are permitted: `toWireSpanKind(...)` for a kind
 * derived from a span, and the `SPAN_KIND_INTERNAL` constant for a leg whose kind
 * is known statically. Permitting any identifier is what lets `span.kind` back
 * in, which is the whole defect.
 *
 * ── The marker: #1029's condition, made mechanical (#1102) ───────────────────
 *
 * `SPAN_KIND_INTERNAL` is legitimate only where the leg AUTHORS its span. A leg
 * that FORWARDS one must map, and hardcoding the constant there ships every span
 * as INTERNAL — the #1011 symptom exactly, and green under the old allowlist,
 * which permitted the bare constant anywhere. That condition existed only in
 * prose, so the constant is now gated on the structural token `@authors-its-span`
 * (`MARKER`) at the site — on the `kind` line, or in the comment lines directly
 * above it. A token and never a sentence (UT-E3); the justification stays where
 * the decision is made, which is CLAUDE.md rule 3's idiom and leaves no central
 * list to keep (UT-E1). A forwarding leg must now COPY the marker, which is a
 * deliberate lie rather than an oversight.
 *
 * `blankNonCode` is length-preserving, so the marker is read from the RAW source
 * at the same offsets. Matching it against the blanked code would only ever find
 * spaces.
 *
 * ── Scope: assignments, not only literals (#1102) ────────────────────────────
 *
 * `out.kind = span.kind;` sits OUTSIDE the literal block, so a matcher that only
 * reads `kind:` properties never sees it — and post-literal mutation of `out` is
 * the established idiom two lines below BOTH guarded sites (`if (parent)
 * out.parentSpanId = parent;`), which is what the next emitter copies. So every
 * identifier BOUND as an `OtlpSpan` — the `out` of `const out: OtlpSpan`, or a
 * parameter annotated with the type — also has its `<name>.kind =` assignments
 * checked, anywhere in the file.
 *
 * Limit, stated rather than overclaimed: that reach runs through the binding's
 * TYPE ANNOTATION. A span mutated through a binding carrying none (`let out;`
 * then `out = { … } as OtlpSpan`) is outside it. `src/` holds no such shape, and
 * no `.kind =` assignment at all.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '../src');

/** Every `.ts` file under `src`, found by walking — never by a hand-kept list. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

/**
 * A `/` may open a regex literal only where a VALUE may start. One character of
 * left context decides it, which is all the disambiguation this needs: the cost
 * of getting it wrong is capped at one line (see `blankNonCode`).
 */
const REGEX_MAY_FOLLOW = /^[=(,:[!&|?+\-*%~^<>;{}]?$/;

/**
 * Blank everything that is not code — comment bodies, string and template
 * contents, regex bodies — in ONE left-to-right pass that tracks which construct
 * it is inside and consumes that construct to its OWN terminator.
 *
 * Sequential regex passes cannot do that, because they cannot see each other.
 * Stripping block comments first made the `/` + `*` inside the line comment on
 * `browserTracerImpl.ts:4` (it names `@opentelemetry/` + a wildcard) open a
 * phantom block that ran to the next block-comment terminator 289 lines below:
 * 13,140 chars collapsed to 531, `toBrowserOtlpSpan` — one of the two legs that
 * carried #1011 — vanished from the scanned text, and the guard reported GREEN.
 * A block-comment opener inside a string literal, and a `}` inside a string
 * literal truncating a brace match, are the same defect wearing other hats.
 *
 * Length-preserving: every removed character becomes a space and newlines are
 * kept, so offsets still address the original source. Strings and regexes are
 * also terminated by a newline — neither may span one — so even a misread `/`
 * can cost at most a single line.
 *
 * The old stripper spared a `://` so a PostHog host URL did not swallow its
 * line. That special case is gone and nothing regressed: the URL lives inside a
 * string literal, so a scanner that knows what a string is never reaches it as
 * code.
 */
function blankNonCode(source: string): string {
  const out = source.split('');
  const blank = (i: number): void => {
    if (out[i] !== '\n') out[i] = ' ';
  };
  // Frame stack: a `${` inside a template literal pushes a fresh code frame, and
  // the `}` that returns its depth to zero pops it. Without it a `}` inside an
  // interpolated string, or a nested template, terminates the wrong construct.
  const frames: Array<{ template: boolean; depth: number }> = [{ template: false, depth: 0 }];
  let prev = ''; // last significant CODE character
  let i = 0;
  const n = source.length;

  while (i < n) {
    const frame = frames[frames.length - 1]!;
    const c = source[i]!;

    if (frame.template) {
      if (c === '\\') {
        blank(i);
        blank(i + 1);
        i += 2;
      } else if (c === '`') {
        frames.pop();
        prev = '`';
        i += 1;
      } else if (c === '$' && source[i + 1] === '{') {
        frames.push({ template: false, depth: 0 });
        prev = '{';
        i += 2;
      } else {
        blank(i);
        i += 1;
      }
      continue;
    }

    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') blank(i++);
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      blank(i);
      blank(i + 1);
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) blank(i++);
      if (i < n) {
        blank(i);
        blank(i + 1);
        i += 2;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      i += 1; // the quotes stay; only the contents are blanked
      while (i < n && source[i] !== c && source[i] !== '\n') {
        if (source[i] === '\\') blank(i++);
        blank(i++);
      }
      i += 1;
      prev = c;
      continue;
    }
    if (c === '`') {
      frames.push({ template: true, depth: 0 });
      i += 1;
      continue;
    }
    if (c === '/' && REGEX_MAY_FOLLOW.test(prev)) {
      blank(i++); // the opening delimiter
      let inClass = false;
      while (i < n && source[i] !== '\n' && (inClass || source[i] !== '/')) {
        if (source[i] === '\\') blank(i++);
        else if (source[i] === '[') inClass = true;
        else if (source[i] === ']') inClass = false;
        blank(i++);
      }
      if (i < n && source[i] === '/') blank(i++);
      prev = ')'; // a regex is a value, so the next `/` is a division
      continue;
    }

    if (c === '{') frame.depth += 1;
    else if (c === '}') {
      if (frame.depth === 0 && frames.length > 1) {
        frames.pop(); // closes a `${…}` interpolation
        prev = '}';
        i += 1;
        continue;
      }
      frame.depth -= 1;
    }
    if (!/\s/.test(c)) prev = c;
    i += 1;
  }
  return out.join('');
}

/**
 * Where an `OtlpSpan` is CONSTRUCTED. The anchor is a mention of the TYPE, not
 * one hard-coded punctuation shape around it: `OtlpSpan` naming the thing being
 * built is the only signal every construction has in common.
 *
 * A mention puts a following object or array literal in scope when nothing but a
 * type tail separates them (`TYPE_TAIL`), which covers the annotation on a
 * `const`, a bare or unioned return annotation (`: OtlpSpan | null {` — which is
 * `remapGenkitSpan`'s own signature), a wrapped one (`Promise<OtlpSpan>`,
 * `Readonly<OtlpSpan>`), an array literal under `: OtlpSpan[] =`, a parameter
 * annotation whose function body may build one, and a literal nested anywhere
 * inside those. A mention AFTER the literal — `} as OtlpSpan`, `} satisfies
 * OtlpSpan` — puts the literal that precedes it in scope instead.
 *
 * (The previous anchor was `/:\s*OtlpSpan(?:\[\])?\s*(?:=\s*)?\{/`, and its
 * comment claimed the optional `=` covered "the body of a function returning
 * `OtlpSpan`". It covered a BARE `: OtlpSpan {` only. Every shape listed above
 * except the first two returned zero findings while carrying `kind: span.kind`,
 * including the one non-bare return annotation the package actually has.)
 *
 * Two mentions are deliberately NOT anchors. A declaration (`interface OtlpSpan`,
 * `type OtlpSpan`) is followed by the shape's own `kind: number` FIELD, which is
 * not an assignment; and a specifier list (`import { type OtlpSpan }`, `export
 * type { …, OtlpSpan };`) constructs nothing — both are excluded, the first by
 * its keyword and the second because a `}` or `;` reaches the matcher before any
 * literal does. That is also what keeps the `recipe_kind:` property in
 * `usageEvents.ts` and the `kind:` parameter of `isReportableCategory` out: no
 * `OtlpSpan` is named anywhere near them. A blunt `/kind:/` over the tree would
 * hit all three. A full AST parse would exclude them too, at a cost this does
 * not need.
 */
const OTLP_SPAN_MENTION = /\bOtlpSpan\b/g;
const DECLARES_THE_TYPE = /\b(?:interface|type|class)\s+$/;
const CASTS_TO_THE_TYPE = /\b(?:as|satisfies)\s+$/;
/** Type syntax that may sit between the mention and the literal it describes. */
const TYPE_TAIL = /^(?:\[\]|[^{}[\];])*/;
const KIND_PROPERTY = /\bkind\s*:\s*([^,\n}]*)/g;

/**
 * An identifier BOUND as an `OtlpSpan`: the `out` of `const out: OtlpSpan`, or a
 * parameter annotated with the type. Its `.kind =` assignments are in scope.
 * A declaration (`interface OtlpSpan`) and a specifier list (`type OtlpSpan }`)
 * carry no `:` immediately before the mention, so neither ever reaches this.
 */
const BINDS_THE_TYPE = /\b([A-Za-z_$][\w$]*)\s*:\s*$/;

/** `out.kind = …` — an assignment, and never a comparison (`==`, `===`). */
const kindAssignment = (name: string): RegExp =>
  new RegExp(`\\b${name}\\.kind\\s*=(?!=)\\s*([^;\\n]*)`, 'g');

/** A kind DERIVED from a span. Legitimate wherever it appears. */
const MAPPED = /^toWireSpanKind\s*\(/;
/** A kind ASSERTED outright. Legitimate only at a site carrying `MARKER`. */
const ASSERTED = /^SPAN_KIND_INTERNAL$/;
/** The structural token licensing `ASSERTED` — a token, not prose (UT-E3). */
const MARKER = /@authors-its-span\b/;

/** Whether a finding's right-hand side is legitimate WHERE IT IS WRITTEN. */
function isAllowed(finding: { readonly value: string; readonly justified: boolean }): boolean {
  if (MAPPED.test(finding.value)) return true;
  return ASSERTED.test(finding.value) && finding.justified;
}

interface KindAssignment {
  /** Character offset of the `kind` token, used to de-duplicate nested blocks. */
  readonly offset: number;
  /** The right-hand side, trimmed — e.g. `toWireSpanKind(span.kind)`. */
  readonly value: string;
  /** Whether `MARKER` sits at this site in the RAW source (see `isJustified`). */
  readonly justified: boolean;
}

const CLOSER: Record<string, string> = { '{': '}', '[': ']' };

/** Index of the delimiter closing the block opened at `open`. */
function endOfBlock(code: string, open: number): number {
  const opener = code[open]!;
  const closer = CLOSER[opener]!;
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === opener) depth += 1;
    else if (code[i] === closer) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return code.length;
}

/** Index of the delimiter opening the block closed at `close`, or -1. */
function startOfBlock(code: string, close: number): number {
  const closer = code[close]!;
  const opener = closer === '}' ? '{' : '[';
  let depth = 0;
  for (let i = close; i >= 0; i -= 1) {
    if (code[i] === closer) depth += 1;
    else if (code[i] === opener) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The literal(s) a single mention of `OtlpSpan` at `[start, end)` puts in scope. */
function blocksForMention(code: string, start: number, end: number): number[] {
  const before = code.slice(0, start);
  if (DECLARES_THE_TYPE.test(before)) return [];

  const cast = CASTS_TO_THE_TYPE.exec(before);
  if (cast) {
    let i = start - cast[0].length - 1;
    while (i >= 0 && /\s/.test(code[i]!)) i -= 1;
    if (code[i] === '}' || code[i] === ']') {
      const open = startOfBlock(code, i);
      return open === -1 ? [] : [open];
    }
    return [];
  }

  const tail = TYPE_TAIL.exec(code.slice(end))![0];
  const open = end + tail.length;
  return code[open] === '{' || code[open] === '[' ? [open] : [];
}

/**
 * Whether the kind at `offset` carries `MARKER` in the RAW source — on its own
 * line, or in the contiguous comment lines directly above it. The walk upward
 * stops at the first line that is not a comment, so a marker on an unrelated
 * construction elsewhere in the file licenses nothing here.
 */
function isJustified(raw: string, offset: number): boolean {
  const before = raw.slice(0, offset).split('\n');
  const restOfLine = raw.slice(offset).split('\n', 1)[0]!;
  if (MARKER.test((before[before.length - 1] ?? '') + restOfLine)) return true;
  for (let i = before.length - 2; i >= 0; i -= 1) {
    const line = before[i]!.trim();
    if (!line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*')) return false;
    if (MARKER.test(line)) return true;
  }
  return false;
}

/**
 * Every kind written onto an `OtlpSpan` — as a `kind:` property inside a
 * construction, AND as a `<binding>.kind =` assignment after it — as a pure
 * function over source text. Overlapping scopes (a `const out: OtlpSpan = {`
 * inside a function already annotated `: OtlpSpan`) yield one entry, not two.
 */
function findOtlpSpanKinds(source: string): KindAssignment[] {
  const code = blankNonCode(source);
  const byOffset = new Map<number, KindAssignment>();
  const record = (offset: number, value: string): void => {
    byOffset.set(offset, { offset, value: value.trim(), justified: isJustified(source, offset) });
  };

  const bindings = new Set<string>();
  for (const mention of code.matchAll(OTLP_SPAN_MENTION)) {
    const start = mention.index;
    const bound = BINDS_THE_TYPE.exec(code.slice(0, start));
    if (bound) bindings.add(bound[1]!);
    for (const open of blocksForMention(code, start, start + mention[0].length)) {
      const body = code.slice(open, endOfBlock(code, open));
      for (const property of body.matchAll(KIND_PROPERTY)) {
        record(open + property.index, property[1]!);
      }
    }
  }

  for (const name of bindings) {
    for (const assignment of code.matchAll(kindAssignment(name))) {
      record(assignment.index + assignment[0].indexOf('.kind') + 1, assignment[1]!);
    }
  }

  return [...byOffset.values()].sort((a, b) => a.offset - b.offset);
}

const sourceFiles = walk(srcDir);
const findings = sourceFiles.flatMap((path) =>
  findOtlpSpanKinds(readFileSync(path, 'utf8')).map((kind) => ({
    path: relative(srcDir, path).split(sep).join('/'),
    value: kind.value,
    justified: kind.justified,
  })),
);

describe('observability: every OtlpSpan kind goes through toWireSpanKind', () => {
  // UT-E2 — a guard that greens on an empty match set has stopped guarding, and
  // nothing else in CI would say so. A FLOOR and not a census: the exact set this
  // used to freeze made a CORRECT new emit site fail, with a message blaming a
  // narrowed walk, which trains the next reader to edit the expectation. Both of
  // today's sites are on DIFFERENT legs, so two distinct files is the property
  // worth defending — a walk narrowed to one directory drops below it.
  it('still reaches both distributed legs', () => {
    expect(
      sourceFiles.length,
      `the walk over src reached only ${sourceFiles.length} file(s) — it has been narrowed`,
    ).toBeGreaterThan(10);
    const legs = [...new Set(findings.map((f) => f.path))].sort();
    expect(
      legs.length,
      `the scan found ${findings.length} OtlpSpan kind(s) across ${legs.length} file(s) ` +
        `[${legs.join(', ') || 'none'}]. #1011 was written independently on TWO ` +
        `distributed legs, so fewer than two files means the walk has been narrowed or ` +
        `the matcher has stopped matching — NOT that a site was legitimately removed. ` +
        `A new correct emit site raises this count and keeps this test green, so a ` +
        `growing set is never a reason to edit it.`,
    ).toBeGreaterThanOrEqual(2);
  });

  for (const [index, finding] of findings.entries()) {
    it(`${finding.path} #${index} sets kind via the mapper`, () => {
      expect(
        isAllowed(finding),
        `${finding.path} writes \`kind = ${finding.value}\` onto an OtlpSpan. The OTLP ` +
          `wire enum is offset by one from the @opentelemetry/api enum, so forwarding ` +
          `a raw API kind ships every span one kind too low (issue #1011) — a plausible ` +
          `but wrong service graph, not visibly corrupt data. Use toWireSpanKind(...). ` +
          `SPAN_KIND_INTERNAL is for a leg that AUTHORS its span rather than forwarding ` +
          `one, and needs the @authors-its-span marker at the site to say so (#1102).`,
      ).toBe(true);
    });
  }

  it('rejects a third leg that forwards the raw API kind', () => {
    const violation = `
      export function toThirdLegOtlpSpan(span: ReadableSpanLike): OtlpSpan {
        const out: OtlpSpan = {
          traceId: span.spanContext().traceId,
          name: span.name,
          kind: span.kind,
        };
        return out;
      }
    `;
    const found = findOtlpSpanKinds(violation);
    expect(found.map((k) => k.value)).toEqual(['span.kind']);
    expect(isAllowed(found[0]!)).toBe(false);
  });

  it('accepts both permitted right-hand sides', () => {
    const ok = `
      const a: OtlpSpan = { kind: toWireSpanKind(span.kind) };
      // @authors-its-span
      const b: OtlpSpan = { kind: SPAN_KIND_INTERNAL };
    `;
    const found = findOtlpSpanKinds(ok);
    expect(found.map((k) => k.value)).toEqual(['toWireSpanKind(span.kind)', 'SPAN_KIND_INTERNAL']);
    expect(found.every(isAllowed)).toBe(true);
  });

  it('ignores the three `kind:` shapes in this package that are not span kinds', () => {
    const notSpanKinds = `
      export interface OtlpSpan { name: string; kind: number; }
      interface UsageEvent { recipe_kind: RecipeKind; }
      export function isReportableCategory(kind: DomainError['kind'] | undefined): boolean {
        return kind === 'StorageError';
      }
    `;
    expect(findOtlpSpanKinds(notSpanKinds)).toEqual([]);
  });

  it('ignores a mention that only imports or re-exports the type', () => {
    const specifiers = `
      import { buildOtlpBody, type OtlpSpan } from '../shared/otlpWire.js';
      export type { ReadableSpanLike, OtlpSpan };
      export const aiOtlpSpanProcessor = { onEnd(span) { const meta = { kind: span.kind }; } };
    `;
    expect(findOtlpSpanKinds(specifiers)).toEqual([]);
  });

  // ── The gate's blind spots, each of which used to fail GREEN (#1102) ────────

  describe('a bare SPAN_KIND_INTERNAL needs the authoring marker', () => {
    it('rejects a forwarding leg that hardcodes the constant', () => {
      // The #1011 symptom itself: this ships every forwarded span as INTERNAL.
      const forwarding = `
        export function toThirdLegOtlpSpan(span: ReadableSpanLike): OtlpSpan {
          const out: OtlpSpan = { name: span.name, kind: SPAN_KIND_INTERNAL };
          return out;
        }
      `;
      const found = findOtlpSpanKinds(forwarding);
      expect(found.map((k) => k.value)).toEqual(['SPAN_KIND_INTERNAL']);
      expect(found[0]!.justified).toBe(false);
      expect(isAllowed(found[0]!)).toBe(false);
    });

    it('accepts the same site once it says it authors its span', () => {
      const authored = `
        export function remapGenkitSpan(span: ReadableSpanLike): OtlpSpan | null {
          const out: OtlpSpan = {
            name: span.name,
            // @authors-its-span — synthesised, never forwarded (#1029).
            kind: SPAN_KIND_INTERNAL,
          };
          return out;
        }
      `;
      const found = findOtlpSpanKinds(authored);
      expect(found.map((k) => k.justified)).toEqual([true]);
      expect(found.every(isAllowed)).toBe(true);
    });

    it('accepts the marker on the kind line itself', () => {
      const inline = `const out: OtlpSpan = { kind: SPAN_KIND_INTERNAL }; // @authors-its-span`;
      expect(findOtlpSpanKinds(inline).every(isAllowed)).toBe(true);
    });

    it('does not let a marker elsewhere in the file license another site', () => {
      const mixed = `
        // @authors-its-span — this construction, and no other.
        const authored: OtlpSpan = { kind: SPAN_KIND_INTERNAL };

        export function forwarding(span: ReadableSpanLike): OtlpSpan {
          const out: OtlpSpan = { name: span.name, kind: SPAN_KIND_INTERNAL };
          return out;
        }
      `;
      expect(findOtlpSpanKinds(mixed).map((k) => k.justified)).toEqual([true, false]);
    });

    it('reads the marker from the raw source, not from the blanked code', () => {
      // blankNonCode empties comment bodies but preserves length, so the marker
      // is only ever visible in the original string (header, `blankNonCode`).
      const marked = `
        // @authors-its-span
        const out: OtlpSpan = { kind: SPAN_KIND_INTERNAL };
      `;
      expect(blankNonCode(marked)).not.toMatch(MARKER);
      expect(findOtlpSpanKinds(marked)[0]!.justified).toBe(true);
    });

    it('never licenses a forwarded raw API kind, marker or not', () => {
      const marked = `
        // @authors-its-span
        const out: OtlpSpan = { kind: span.kind };
      `;
      expect(findOtlpSpanKinds(marked).some(isAllowed)).toBe(false);
    });
  });

  // ── A kind written AFTER the literal closed (#1102) ──────────────────────────

  describe('the scan reaches assignments, not only literals', () => {
    it('catches a post-literal mutation of the constructed span', () => {
      // Shaped on the idiom two lines below both guarded sites in src:
      // `const out: OtlpSpan = { … }; if (parent) out.parentSpanId = parent;`.
      const mutating = `
        export function mutatingLeg(span: ReadableSpanLike): OtlpSpan {
          const out: OtlpSpan = {
            name: span.name,
            // @authors-its-span
            kind: SPAN_KIND_INTERNAL,
          };
          out.kind = span.kind;
          return out;
        }
      `;
      const found = findOtlpSpanKinds(mutating);
      expect(found.map((k) => k.value)).toEqual(['SPAN_KIND_INTERNAL', 'span.kind']);
      expect(found.map(isAllowed)).toEqual([true, false]);
    });

    it('catches a mutation through a parameter annotated with the type', () => {
      const viaParam = `
        function patchKind(out: OtlpSpan, span: ReadableSpanLike): void {
          out.kind = span.kind;
        }
      `;
      expect(findOtlpSpanKinds(viaParam).map((k) => k.value)).toEqual(['span.kind']);
    });

    it('accepts a mapped assignment', () => {
      const mapped = `
        const out: OtlpSpan = { kind: toWireSpanKind(span.kind) };
        out.kind = toWireSpanKind(span.kind);
      `;
      const found = findOtlpSpanKinds(mapped);
      expect(found).toHaveLength(2);
      expect(found.every(isAllowed)).toBe(true);
    });

    it('reads a comparison as a comparison, not an assignment', () => {
      const comparisons = `
        const out: OtlpSpan = { kind: toWireSpanKind(span.kind) };
        if (out.kind === span.kind) return;
        if (out.kind == span.kind) return;
      `;
      expect(findOtlpSpanKinds(comparisons).map((k) => k.value)).toEqual([
        'toWireSpanKind(span.kind)',
      ]);
    });

    it('leaves a `.kind =` on a binding that is not an OtlpSpan alone', () => {
      const unrelated = `
        const out: OtlpSpan = { kind: toWireSpanKind(span.kind) };
        const failure: DomainError = { kind: 'NetworkError' };
        failure.kind = 'StorageError';
      `;
      expect(findOtlpSpanKinds(unrelated).map((k) => k.value)).toEqual([
        'toWireSpanKind(span.kind)',
      ]);
    });
  });

  // ── The lexer's blind spots, each of which used to fail GREEN (review B1) ────

  describe('blankNonCode consumes each construct to its own terminator', () => {
    it('does not let a block-comment opener inside a line comment eat the file', () => {
      // `browserTracerImpl.ts:4` verbatim in shape: a line comment naming
      // `@opentelemetry/` + a wildcard, and a later trailing block comment.
      const source = [
        '// THE ONLY browser-side module that imports `@opentelemetry/*`, and it is reached',
        'export function toBrowserOtlpSpan(span: ReadableSpan): OtlpSpan {',
        '  return { name: span.name, kind: span.kind };',
        '}',
        'const later = 1; /* best-effort */',
      ].join('\n');
      expect(blankNonCode(source)).toContain('toBrowserOtlpSpan');
      expect(findOtlpSpanKinds(source).map((k) => k.value)).toEqual(['span.kind']);
    });

    it('does not let a block-comment opener inside a string eat the file', () => {
      const source = [
        "const token = '/*';",
        'const out: OtlpSpan = { kind: span.kind };',
        'const done = 1; /* best-effort */',
      ].join('\n');
      expect(findOtlpSpanKinds(source).map((k) => k.value)).toEqual(['span.kind']);
    });

    it('does not let a brace inside a string truncate the block', () => {
      const source = `
        const out: OtlpSpan = {
          name: span.name.replace('}', ''),
          kind: span.kind,
        };
      `;
      expect(findOtlpSpanKinds(source).map((k) => k.value)).toEqual(['span.kind']);
    });

    it('does not let a brace inside a template literal truncate the block', () => {
      const source = `
        const out: OtlpSpan = {
          name: \`genkit.\${type || '}'}\`,
          kind: span.kind,
        };
      `;
      expect(findOtlpSpanKinds(source).map((k) => k.value)).toEqual(['span.kind']);
    });

    it('does not let a brace inside a regex literal truncate the block', () => {
      // `aiOtlpSpanProcessor.ts:109` is brace-UNBALANCED as raw text.
      const source = `
        const FLOW_SEGMENT = /\\{([^,}]+),t:flow(?:,[^}]*)?\\}/g;
        const out: OtlpSpan = { kind: span.kind };
      `;
      expect(findOtlpSpanKinds(source).map((k) => k.value)).toEqual(['span.kind']);
    });

    it('treats a `//` inside a string as text, not as a comment', () => {
      // What the old `://` special case bought, now falling out of the lexer:
      // the rest of the LINE after a URL is still code.
      const source = `const h = 'https://eu.i.posthog.com'; const out: OtlpSpan = { kind: span.kind };`;
      expect(blankNonCode(source)).toContain('const out: OtlpSpan');
      expect(findOtlpSpanKinds(source).map((k) => k.value)).toEqual(['span.kind']);
    });

    // The assertion that would have caught B1 on the real tree: 96% of
    // `browserTracerImpl.ts` was being deleted before the matcher ever saw it.
    it('leaves every exported declaration in src standing', () => {
      const exported = /^\s*export (?:async )?(?:function|const|class|interface|type|enum) (\w+)/gm;
      for (const path of sourceFiles) {
        const raw = readFileSync(path, 'utf8');
        const code = blankNonCode(raw);
        for (const match of raw.matchAll(exported)) {
          expect(code, `${relative(srcDir, path)}: the lexer deleted ${match[1]}`).toContain(
            match[1]!,
          );
        }
      }
    });
  });

  // ── The anchor's blind spots, each of which used to fail GREEN (review B2) ───

  describe('the anchor covers every way an OtlpSpan gets constructed', () => {
    const shapes: ReadonlyArray<readonly [string, string]> = [
      ['bare return annotation', 'function f(span): OtlpSpan { return { kind: span.kind }; }'],
      [
        'unioned return annotation (remapGenkitSpan)',
        'function f(span): OtlpSpan | null { return { kind: span.kind }; }',
      ],
      [
        'Promise-wrapped return annotation',
        'async function f(span): Promise<OtlpSpan> { return { kind: span.kind }; }',
      ],
      ['Readonly-wrapped annotation', 'const out: Readonly<OtlpSpan> = { kind: span.kind };'],
      ['array literal', 'const batch: OtlpSpan[] = [{ kind: span.kind }];'],
      ['mapped array literal', 'const batch: OtlpSpan[] = spans.map((s) => ({ kind: s.kind }));'],
      ['as-cast after the literal', 'const out = { kind: span.kind } as OtlpSpan;'],
      ['satisfies after the literal', 'const out = { kind: span.kind } satisfies OtlpSpan;'],
      [
        'literal nested in the OTLP envelope (buildOtlpBody)',
        'function buildOtlpBody(span: OtlpSpan | OtlpSpan[], serviceName: string): unknown {\n' +
          '  return { resourceSpans: [{ scopeSpans: [{ spans: [{ kind: span.kind }] }] }] };\n' +
          '}',
      ],
    ];

    for (const [name, source] of shapes) {
      it(`catches a raw API kind in a ${name}`, () => {
        const found = findOtlpSpanKinds(source);
        expect(
          found.map((k) => k.value),
          source,
        ).toEqual([expect.stringMatching(/^s(?:pan)?\.kind$/)]);
        expect(found.some(isAllowed)).toBe(false);
      });
    }
  });
});
