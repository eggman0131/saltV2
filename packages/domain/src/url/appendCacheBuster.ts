// Pure display-time cache-buster (issue #460). NO I/O, no Node/browser/Firebase
// APIs (CLAUDE.md Rule 1): a regenerated image (recipe hero, canon icon) reuses
// the same byte-identical Storage download URL, so the browser serves the stale
// bytes for up to ~1h. Appending a per-regeneration `?v=`/`&v=` nonce forces a
// re-fetch. This is the shared, testable home for the append logic used by the
// recipe pages; `CanonIcon.svelte` inlines an IDENTICAL copy because ui-components
// is external-only and cannot import `@salt/domain` (keep the two in sync).
//
// Behaviour: when `version` is null/undefined the url passes through unchanged
// (nothing to bust); otherwise `v=<version>` is appended in a `?`/`&`-aware way
// (`&` if the url already carries a query, `?` otherwise). Callers guard that the
// url is present/renderable, so an empty url is not expected — returning it
// unchanged is a harmless safety net.
export function appendCacheBuster(
  url: string,
  version: string | number | null | undefined,
): string {
  if (!url || version == null) return url;
  return `${url}${url.includes('?') ? '&' : '?'}v=${version}`;
}
