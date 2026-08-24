// spec: ui-spec-v02.md §8.12 v0.2.10
// Type-level test: verifies Icon `name` prop is keyof the curated icon registry.
//
// Wrapped in describe/it as of issue #922. Until then this file matched no glob
// in `vitest.config.ts` and had never run once — which mattered more here than
// for the sibling Text test: the narrowed `IconName` union IS the whole
// maintenance mechanism for the registry (ui-spec-v02 §8.12, issue #813), and
// nothing was checking that it still narrows.
import { describe, it, expectTypeOf } from 'vitest';
import type { IconProps } from '../src/primitives/Icon/Icon.types';

describe('IconProps', () => {
  it('accepts registered icon names', () => {
    expectTypeOf<'Circle'>().toExtend<IconProps['name']>();
    expectTypeOf<'Check'>().toExtend<IconProps['name']>();
  });

  it('rejects a name that is not an icon at all', () => {
    // @ts-expect-error — arbitrary string is not a valid icon name
    const _bad: IconProps = { name: 'NotAnIcon' };
  });

  it('rejects a real Lucide icon that is not in the registry', () => {
    // This is what makes an unregistered name a build failure rather than a blank
    // space where an icon should be.
    // @ts-expect-error — `Heart` exists in @lucide/svelte but is not registered
    const _unregistered: IconProps = { name: 'Heart' };
  });
});
