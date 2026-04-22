// spec: SPEC.md §8.12 v0.2.3
// Type-level test: verifies Icon `name` prop is keyof typeof import('lucide-svelte').
import { expectTypeOf } from 'vitest';
import type { IconProps } from '../src/primitives/Icon/Icon.types';

// Valid icon names are assignable to IconProps['name']
expectTypeOf<'Circle'>().toMatchTypeOf<IconProps['name']>();
expectTypeOf<'Check'>().toMatchTypeOf<IconProps['name']>();

// @ts-expect-error — arbitrary string is not a valid icon name
const _bad: IconProps = { name: 'NotAnIcon' };
