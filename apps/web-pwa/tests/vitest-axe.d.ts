// `vitest-axe@0.1.0` ships its matcher typings as an augmentation of the legacy
// global `Vi` namespace, which Vitest 4 no longer reads — so `toHaveNoViolations`
// is invisible to the compiler even though `tests/setup.ts` registers the matcher
// at runtime via `expect.extend`. Re-declare it against Vitest 4's own `Matchers`
// interface. Delete this file if vitest-axe ever ships Vitest 4 typings.
import type { AxeMatchers } from 'vitest-axe/matchers';

declare module 'vitest' {
  interface Matchers<T = unknown> extends AxeMatchers {}
}
