// spec: ui-spec-v02.md §8.13 v0.2.19
// Type-level test: the three layout primitives still infer their variant unions
// from the shared maps in `src/lib/layoutVariants.ts`.
//
// Why this file exists (#929 Phase 4). `StackVariants`, `InlineVariants` and
// `GridVariants` are declared by their variants files and consumed by **nothing**
// — not by the components, not by the hand-written `*Props` types, not by
// `src/index.ts`. So "typecheck proves the unions still infer" was not true: with
// no consumer, an inference that silently widened to `string` would have compiled
// green and `Stack.test.ts` would not have noticed either, because it asserts
// rendered class strings and those are produced by the same maps.
//
// These assertions are that consumer. `toEqualTypeOf` is exact in both
// directions, so a widened key set fails here and nowhere else.
import { describe, it, expectTypeOf } from 'vitest';
import type { StackVariants } from '../src/primitives/Stack/Stack.variants';
import type { InlineVariants } from '../src/primitives/Inline/Inline.variants';
import type { GridVariants } from '../src/primitives/Grid/Grid.variants';
import type { StackProps } from '../src/primitives/Stack/Stack.types';
import type { InlineProps } from '../src/primitives/Inline/Inline.types';
import type { GridProps } from '../src/primitives/Grid/Grid.types';

type Gap = '0' | '1' | '2' | '3' | '4' | '6' | '8';
type Align = 'start' | 'center' | 'end' | 'stretch';
type Justify = 'start' | 'center' | 'end' | 'between';

describe('layout variant maps infer the documented unions', () => {
  it('Stack keeps gap, align and justify', () => {
    expectTypeOf<NonNullable<StackVariants['gap']>>().toEqualTypeOf<Gap>();
    expectTypeOf<NonNullable<StackVariants['align']>>().toEqualTypeOf<Align>();
    expectTypeOf<NonNullable<StackVariants['justify']>>().toEqualTypeOf<Justify>();
  });

  it('Inline keeps gap, align and justify', () => {
    expectTypeOf<NonNullable<InlineVariants['gap']>>().toEqualTypeOf<Gap>();
    expectTypeOf<NonNullable<InlineVariants['align']>>().toEqualTypeOf<Align>();
    expectTypeOf<NonNullable<InlineVariants['justify']>>().toEqualTypeOf<Justify>();
  });

  it('Grid keeps gap, and its own cols', () => {
    expectTypeOf<NonNullable<GridVariants['gap']>>().toEqualTypeOf<Gap>();
    expectTypeOf<NonNullable<GridVariants['cols']>>().toEqualTypeOf<1 | 2 | 3 | 4 | 6 | 12>();
  });
});

describe('the inferred unions still match the hand-written prop types', () => {
  // The `*Props` unions in the `.types.ts` files are written out by hand and are
  // what a consumer actually sees (§8.13's tables). If the maps and the props
  // ever disagree, a prop the spec documents stops producing a class.
  it('Stack', () => {
    expectTypeOf<NonNullable<StackProps['gap']>>().toEqualTypeOf<
      NonNullable<StackVariants['gap']>
    >();
    expectTypeOf<NonNullable<StackProps['align']>>().toEqualTypeOf<
      NonNullable<StackVariants['align']>
    >();
    expectTypeOf<NonNullable<StackProps['justify']>>().toEqualTypeOf<
      NonNullable<StackVariants['justify']>
    >();
  });

  it('Inline', () => {
    expectTypeOf<NonNullable<InlineProps['gap']>>().toEqualTypeOf<
      NonNullable<InlineVariants['gap']>
    >();
    expectTypeOf<NonNullable<InlineProps['align']>>().toEqualTypeOf<
      NonNullable<InlineVariants['align']>
    >();
    expectTypeOf<NonNullable<InlineProps['justify']>>().toEqualTypeOf<
      NonNullable<InlineVariants['justify']>
    >();
  });

  it('Grid', () => {
    expectTypeOf<NonNullable<GridProps['gap']>>().toEqualTypeOf<NonNullable<GridVariants['gap']>>();
    expectTypeOf<NonNullable<GridProps['cols']>>().toEqualTypeOf<
      NonNullable<GridVariants['cols']>
    >();
  });
});
