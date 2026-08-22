import { normaliseName } from '../../canon/index.js';

// The two rules both kitchen-tool commands share: what a tool's id is, and what
// its matcher list is allowed to contain. Kept here rather than duplicated across
// create and update, because a slug minted one way and an edit that normalises
// matchers another way is exactly how the vocabulary starts disagreeing with
// itself.

/**
 * Kebab-case of the label — `Mixing bowl` → `mixing-bowl`, `Chef's knife` →
 * `chefs-knife`, `Sauté pan` → `saute-pan`.
 *
 * Deterministic rather than a uuid because the id IS the Storage key
 * (`kit-icons/{id}.webp`), which is what lets the weekly orphan sweep join a
 * drawing to a document. It is also the exact rule the Phase-1 seed table was
 * written by, so a tool added by hand from the admin page and the same tool
 * seeded offline land on one id rather than two.
 *
 * An apostrophe DISAPPEARS rather than becoming a separator: `chefs-knife`, never
 * `chef-s-knife`. Every other run of non-alphanumerics collapses to one dash.
 */
export function kitchenToolSlug(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .replace(/['’]/g, '') // straight and curly apostrophes vanish
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Tidy a matcher list: trim, drop blanks, drop anything that says the same thing
 * as another entry, and drop anything that merely repeats the tool's own label.
 *
 * "Says the same thing" is measured with `normaliseName`, the fold the resolver
 * itself applies — so two matchers that survive here are two the resolver can
 * actually tell apart, and a repeat of the label is dead weight because
 * `resolveKitchenTool` already competes the label on equal terms with the
 * matchers. The FIRST spelling of a duplicate wins, so an edit never silently
 * reworks a phrase somebody chose.
 */
export function normaliseMatchers(matchers: readonly string[], label: string): string[] {
  const seen = new Set<string>([normaliseName(label)]);
  const kept: string[] = [];
  for (const raw of matchers) {
    const phrase = raw.trim().replace(/\s+/g, ' ');
    if (!phrase) continue;
    const key = normaliseName(phrase);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(phrase);
  }
  return kept;
}
