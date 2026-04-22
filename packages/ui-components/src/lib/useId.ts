// spec: SPEC.md §3.5 v0.2.3
let counter = 0;

export function useId(prefix = 'salt'): string {
  // Module-scope counter — deterministic within a single client-side render tree.
  // Not SSR-safe; see §2.6 before introducing SSR.
  return `${prefix}-${++counter}`;
}
