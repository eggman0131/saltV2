// Type-level test: the two deliberate narrowings `CanonItem` makes over
// `CanonItemSchema` (issue #932).
//
// `CanonItem` is schema-derived but NOT wholesale — it omits `traceContext` and
// re-requires `embedding`. Both narrowings are load-bearing, and before this
// file nothing enforced either: widen them and every runtime suite still passes
// (`expectTypeOf` is a no-op at runtime), `tsc --build` still passes (it is
// rooted at `src/` and never sees `tests/`), and `embedMatch`'s
// `item.embedding!` would quietly accept `undefined` into `cosineSimilarity`.
//
// Compiled by the `typecheck` block in packages/domain/vitest.config.ts.
import { describe, it, expectTypeOf } from 'vitest';
import type { CanonItem } from '@salt/domain';
import type { CanonItemDoc } from '@salt/domain/schemas';

describe('CanonItem narrows CanonItemSchema', () => {
  it('omits traceContext — transport only, never the pure domain', () => {
    expectTypeOf<'traceContext'>().not.toExtend<keyof CanonItem>();
  });

  it('leaves traceContext on the schema side — the narrowing is the entity’s alone', () => {
    expectTypeOf<'traceContext'>().toExtend<keyof CanonItemDoc>();
  });

  it('keeps embedding required and never undefined', () => {
    expectTypeOf<CanonItem['embedding']>().toEqualTypeOf<readonly number[] | null>();
  });

  it('keeps embedding optional on the schema — the #410 back-compat read fallback', () => {
    expectTypeOf<undefined>().toExtend<CanonItemDoc['embedding']>();
  });
});
