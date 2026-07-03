// VIOLATION: @salt/domain is the pure layer — no browser APIs. Touching a
// browser global (window/document/localStorage/…) is platform code that belongs
// in an adapter. Expected: no-restricted-globals error.
// @ts-nocheck — the global reference is intentionally illegal for domain; the
// lint rule is what enforces purity.
export function readTheme(): string | null {
  return localStorage.getItem('theme');
}
