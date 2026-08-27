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
 * The matcher is a plain function over a string, which is what lets the negative
 * case below run against inline source instead of a bad file written to disk.
 *
 * Only two right-hand sides are permitted: `toWireSpanKind(...)` for a kind
 * derived from a span, and the `SPAN_KIND_INTERNAL` constant for a leg whose kind
 * is known statically (`aiOtlpSpanProcessor` is one). Permitting any identifier
 * is what lets `span.kind` back in, which is the whole defect.
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

// Strip comments so the enum table in otlpWire.ts's own header — which spells out
// `INTERNAL = 0` and friends — never reads as code either way. `://` is spared so
// a PostHog host URL does not swallow the rest of its line.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

/**
 * The start of a block in which an `OtlpSpan` is CONSTRUCTED: either the literal
 * itself (`const out: OtlpSpan = {`) or the body of a function annotated as
 * returning one (`function toX(…): OtlpSpan {`, whose `return { … }` counts).
 *
 * Anchoring on the type annotation is what keeps the three `kind:` occurrences in
 * this package that are NOT an OtlpSpan kind out of the match set: the field
 * DECLARATION on `export interface OtlpSpan {` (no `:` before the name), the
 * `recipe_kind:` property in `usageEvents.ts`, and the `kind:` parameter of
 * `isReportableCategory`. A blunt `/kind:/` over the tree would hit all three.
 * A full AST parse would too, at a cost this does not need.
 */
const OTLP_SPAN_BLOCK = /:\s*OtlpSpan(?:\[\])?\s*(?:=\s*)?\{/g;
const KIND_PROPERTY = /\bkind\s*:\s*([^,\n}]*)/g;

/** The two legitimate right-hand sides. Anything else is the #1011 defect. */
const ALLOWED = [/^toWireSpanKind\s*\(/, /^SPAN_KIND_INTERNAL$/];

interface KindAssignment {
  /** Character offset of the `kind` token, used to de-duplicate nested blocks. */
  readonly offset: number;
  /** The right-hand side, trimmed — e.g. `toWireSpanKind(span.kind)`. */
  readonly value: string;
}

/** Index just past the `}` closing the block opened by the `{` at `open`. */
function endOfBlock(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return code.length;
}

/**
 * Every `kind:` property written inside an `OtlpSpan` construction, as a pure
 * function over source text. Nested blocks (a `const out: OtlpSpan = {` inside a
 * function already annotated `: OtlpSpan`) yield one entry, not two.
 */
function findOtlpSpanKinds(source: string): KindAssignment[] {
  const code = stripComments(source);
  const byOffset = new Map<number, KindAssignment>();
  for (const block of code.matchAll(OTLP_SPAN_BLOCK)) {
    const open = block.index + block[0].length - 1;
    const body = code.slice(open, endOfBlock(code, open));
    for (const property of body.matchAll(KIND_PROPERTY)) {
      byOffset.set(open + property.index, {
        offset: open + property.index,
        value: property[1].trim(),
      });
    }
  }
  return [...byOffset.values()].sort((a, b) => a.offset - b.offset);
}

const findings = walk(srcDir).flatMap((path) =>
  findOtlpSpanKinds(readFileSync(path, 'utf8')).map((kind) => ({
    path: relative(srcDir, path).split(sep).join('/'),
    value: kind.value,
  })),
);

describe('observability: every OtlpSpan kind goes through toWireSpanKind', () => {
  // UT-E2 — a guard that greens on an empty match set has stopped guarding, and
  // nothing else in CI would say so. Both of today's construction sites are on
  // DIFFERENT legs, so this also fails if the walk is narrowed to one directory.
  it('finds both of the OtlpSpan construction sites that exist today', () => {
    expect(walk(srcDir).length, 'the walk over src found nothing').toBeGreaterThan(10);
    expect(
      findings.map((f) => f.path).sort(),
      'the scan no longer sees both legs — it has narrowed, or the matcher stopped matching',
    ).toEqual(['server/aiOtlpSpanProcessor.ts', 'shared/otlpWire.ts']);
  });

  for (const [index, finding] of findings.entries()) {
    it(`${finding.path} #${index} sets kind via the mapper`, () => {
      expect(
        ALLOWED.some((allowed) => allowed.test(finding.value)),
        `${finding.path} builds an OtlpSpan with \`kind: ${finding.value}\`. The OTLP ` +
          `wire enum is offset by one from the @opentelemetry/api enum, so forwarding ` +
          `a raw API kind ships every span one kind too low (issue #1011) — a plausible ` +
          `but wrong service graph, not visibly corrupt data. Use toWireSpanKind(...), ` +
          `or SPAN_KIND_INTERNAL when the kind is known statically.`,
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
    expect(ALLOWED.some((allowed) => allowed.test(found[0].value))).toBe(false);
  });

  it('accepts both permitted right-hand sides', () => {
    const ok = `
      const a: OtlpSpan = { kind: toWireSpanKind(span.kind) };
      const b: OtlpSpan = { kind: SPAN_KIND_INTERNAL };
    `;
    const found = findOtlpSpanKinds(ok).map((k) => k.value);
    expect(found).toEqual(['toWireSpanKind(span.kind)', 'SPAN_KIND_INTERNAL']);
    expect(found.every((value) => ALLOWED.some((allowed) => allowed.test(value)))).toBe(true);
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
});
