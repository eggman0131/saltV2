// spec: SPEC.md §8.12 v0.2.10
// Type-level test: verifies Icon `name` prop is keyof the curated icon registry.
import { expectTypeOf } from 'vitest';
import type { IconProps } from '../src/primitives/Icon/Icon.types';

// Registered icon names are assignable to IconProps['name']
expectTypeOf<'Circle'>().toMatchTypeOf<IconProps['name']>();
expectTypeOf<'Check'>().toMatchTypeOf<IconProps['name']>();

// @ts-expect-error — arbitrary string is not a valid icon name
const _bad: IconProps = { name: 'NotAnIcon' };

// @ts-expect-error — a real Lucide icon that is NOT in the registry is rejected;
// this is what makes an unregistered name a build failure rather than a blank.
const _unregistered: IconProps = { name: 'Heart' };
