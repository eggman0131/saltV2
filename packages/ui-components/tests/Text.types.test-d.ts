// spec: ui-spec-v02.md §8.11 v0.2.3
// Type-level test: verifies Text `as` prop is constrained to 'p' | 'span' | 'div'.
//
// Wrapped in describe/it as of issue #922. Until then this file matched no glob
// in `vitest.config.ts` and had never run once; now that it does, the assertions
// are named units so the run reports them rather than reporting a file with no
// tests in it.
import { describe, it, expectTypeOf } from 'vitest';
import type { TextProps } from '../src/primitives/Text/Text.types';

describe('TextProps', () => {
  it('constrains `as` to the three sanctioned elements', () => {
    expectTypeOf<TextProps['as']>().toEqualTypeOf<'p' | 'span' | 'div' | undefined>();
  });

  it('rejects any other element', () => {
    // @ts-expect-error — arbitrary string is not a valid `as` value
    const _bad: TextProps = { as: 'article' };
  });
});
