// spec: SPEC.md §8.11 v0.2.3
// Type-level test: verifies Text `as` prop is constrained to 'p' | 'span' | 'div'.
import { expectTypeOf } from 'vitest';
import type { TextProps } from '../src/primitives/Text/Text.types';

expectTypeOf<TextProps['as']>().toEqualTypeOf<'p' | 'span' | 'div' | undefined>();

// @ts-expect-error — arbitrary string is not a valid `as` value
const _bad: TextProps = { as: 'article' };
