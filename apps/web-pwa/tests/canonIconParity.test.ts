import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { CanonIcon } from '@salt/ui-components';
import { CANON_ICON_HIDDEN, appendCacheBuster, isCanonIconRenderable } from '@salt/domain';

/**
 * `CanonIcon`'s two inlined copies still agree with `@salt/domain` (issue #933).
 *
 * WHY THE COPIES EXIST, AND WHY THEY STAY. `packages/ui-components` may depend on
 * external packages only — CLAUDE.md's layer map, `eslint.config.js`'s
 * `{ from: 'ui-components', allow: [] }`, and a `package.json` carrying no
 * `@salt/*` dependency at all, three independent statements of the same rule. So
 * `CanonIcon` cannot import `isCanonIconRenderable` or `appendCacheBuster`, and
 * re-implements both. That duplication is FORCED and is not what this issue
 * removes; amending the layer map would be its own issue with its own go-ahead.
 *
 * WHAT THIS FILE CHANGES. Until now the two copies were held in agreement by a
 * comment asking the next author to keep them in sync. That is the mechanism
 * issue #913 exists to remove, and the one that has already failed twice
 * elsewhere in this codebase. `apps/web-pwa` is the only package that may legally
 * import BOTH `@salt/domain` and `@salt/ui-components`, so the agreement can be
 * checked here even though it cannot be enforced by the type system.
 *
 * Editing either side alone turns this red. That is the whole point: it is a
 * DRIFT DETECTOR, not a de-duplication.
 */

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

// One table, both assertions. Every row is a `thumbnail` the component can be
// handed — the three arms of the tri-state, plus the shapes where the
// cache-buster join is not obvious.
const THUMBNAILS: { name: string; thumbnail: string | null }[] = [
  { name: 'a real icon URL', thumbnail: 'https://storage.test/icon.png' },
  {
    name: 'an icon URL that already carries a query',
    thumbnail: 'https://storage.test/icon.png?alt=media&token=abc',
  },
  { name: 'no icon yet (null)', thumbnail: null },
  { name: 'the hidden sentinel', thumbnail: CANON_ICON_HIDDEN },
  { name: 'an empty string', thumbnail: '' },
];

const VERSIONS: { name: string; version: string | number | undefined }[] = [
  { name: 'a numeric version', version: 1234 },
  { name: 'version zero — a real version, not an absent one', version: 0 },
  { name: 'a string version', version: '2026-08-30T10:00:00.000Z' },
  { name: 'no version', version: undefined },
  { name: 'an empty version', version: '' },
];

function iconImg(container: HTMLElement): HTMLImageElement | null {
  return container.querySelector('[data-testid="canon-icon-img"]');
}

describe('CanonIcon renders exactly where isCanonIconRenderable says it should', () => {
  it.each(THUMBNAILS)('$name', ({ thumbnail }) => {
    const { container } = render(CanonIcon, { props: { thumbnail, name: 'Flour' } });

    // The domain's answer is the expectation — not a literal restated here, so a
    // change to the tri-state rule moves both together or fails loudly.
    expect(iconImg(container) !== null).toBe(isCanonIconRenderable(thumbnail));
  });

  it('covers all three arms of the tri-state, so this cannot go vacuously green', () => {
    // UT-E2: if the table ever stopped containing a renderable row AND a
    // non-renderable one, every assertion above would still pass while checking
    // nothing.
    const answers = THUMBNAILS.map((t) => isCanonIconRenderable(t.thumbnail));
    expect(answers).toContain(true);
    expect(answers).toContain(false);
    expect(THUMBNAILS.map((t) => t.thumbnail)).toContain(CANON_ICON_HIDDEN);
  });
});

describe('CanonIcon busts its src exactly as appendCacheBuster would', () => {
  const renderableThumbnails = THUMBNAILS.filter((t) => isCanonIconRenderable(t.thumbnail));

  const cases = renderableThumbnails.flatMap((t) =>
    VERSIONS.map((v) => ({
      name: `${t.name}, ${v.name}`,
      thumbnail: t.thumbnail,
      version: v.version,
    })),
  );

  it.each(cases)('$name', ({ thumbnail, version }) => {
    const { container } = render(CanonIcon, {
      props: { thumbnail, name: 'Flour', ...(version === undefined ? {} : { version }) },
    });

    const img = iconImg(container);
    expect(img).not.toBeNull();
    // `thumbnail` is non-null on every row here — the filter above guarantees it.
    expect(img!.getAttribute('src')).toBe(appendCacheBuster(thumbnail!, version));
  });

  it('exercises both join shapes and the zero-version edge', () => {
    // UT-E2 again: names the three cases whose absence would make the table
    // agree for uninteresting reasons.
    expect(cases.some((c) => c.thumbnail!.includes('?'))).toBe(true);
    expect(cases.some((c) => !c.thumbnail!.includes('?'))).toBe(true);
    expect(cases.some((c) => c.version === 0)).toBe(true);
  });
});
