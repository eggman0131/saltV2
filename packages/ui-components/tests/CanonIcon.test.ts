// spec: canon-icons.md §Rendering v1.0
// Non-interactive primitive — 'events contract' and 'keyboard interaction' blocks omitted.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { axe } from 'vitest-axe';
import CanonIcon from '../src/primitives/CanonIcon/CanonIcon.svelte';

afterEach(() => cleanup());

const URL = 'https://storage.googleapis.com/bucket/canon-icons/abc.webp';
// A realistic Firebase Storage download URL already carries a query string
// (`?alt=media&token=…`), so the cache-bust must join with `&`, not `?`.
const URL_WITH_QUERY =
  'https://firebasestorage.googleapis.com/v0/b/bucket/o/canon-icons%2Fabc.webp?alt=media&token=xyz';

describe('CanonIcon', () => {
  describe('tri-state rendering', () => {
    it('renders an <img> for a real URL', () => {
      const { getByTestId } = render(CanonIcon, { props: { thumbnail: URL, name: 'Milk' } });
      const img = getByTestId('canon-icon-img') as HTMLImageElement;
      expect(img).toBeInTheDocument();
      expect(img.getAttribute('src')).toBe(URL);
      expect(img.getAttribute('alt')).toBe('Milk');
    });

    it('renders the bare tile (no img) when thumbnail is null', () => {
      const { getByTestId, queryByTestId } = render(CanonIcon, { props: { thumbnail: null } });
      expect(getByTestId('canon-icon')).toBeInTheDocument();
      expect(queryByTestId('canon-icon-img')).toBeNull();
    });

    it('renders the bare tile (no img) when thumbnail is "hidden"', () => {
      const { queryByTestId } = render(CanonIcon, { props: { thumbnail: 'hidden' } });
      expect(queryByTestId('canon-icon-img')).toBeNull();
    });

    it('renders the bare tile (no img) for an empty string', () => {
      const { queryByTestId } = render(CanonIcon, { props: { thumbnail: '' } });
      expect(queryByTestId('canon-icon-img')).toBeNull();
    });
  });

  describe('cache-bust (version prop)', () => {
    it('leaves the src raw when no version is passed (back-compat)', () => {
      const { getByTestId } = render(CanonIcon, { props: { thumbnail: URL, name: 'Milk' } });
      expect(getByTestId('canon-icon-img').getAttribute('src')).toBe(URL);
    });

    it('leaves the src raw for an empty version (no bare ?v=)', () => {
      // A canon item with an empty `updatedAt` and no `iconRequestedAt` resolves
      // to an empty version; a bare `?v=` carries no cache-key info, so skip it.
      const { getByTestId } = render(CanonIcon, {
        props: { thumbnail: URL, name: 'Milk', version: '' },
      });
      expect(getByTestId('canon-icon-img').getAttribute('src')).toBe(URL);
    });

    it('appends ?v=<version> when the base URL has no query', () => {
      const { getByTestId } = render(CanonIcon, {
        props: { thumbnail: URL, name: 'Milk', version: 123 },
      });
      expect(getByTestId('canon-icon-img').getAttribute('src')).toBe(`${URL}?v=123`);
    });

    it('appends &v=<version> when the base URL already has a query', () => {
      const { getByTestId } = render(CanonIcon, {
        props: { thumbnail: URL_WITH_QUERY, name: 'Milk', version: 456 },
      });
      expect(getByTestId('canon-icon-img').getAttribute('src')).toBe(`${URL_WITH_QUERY}&v=456`);
    });

    it('accepts a string version', () => {
      const { getByTestId } = render(CanonIcon, {
        props: { thumbnail: URL, name: 'Milk', version: '2026-07-11T00:00:00.000Z' },
      });
      expect(getByTestId('canon-icon-img').getAttribute('src')).toBe(
        `${URL}?v=2026-07-11T00:00:00.000Z`,
      );
    });

    it('changes the busted src when version changes even though the base URL does not', () => {
      const { getByTestId, rerender } = render(CanonIcon, {
        props: { thumbnail: URL, name: 'Milk', version: 1 },
      });
      const first = getByTestId('canon-icon-img').getAttribute('src');
      expect(first).toBe(`${URL}?v=1`);
      // Same base URL string, new regeneration nonce → new src.
      return rerender({ thumbnail: URL, name: 'Milk', version: 2 }).then(() => {
        const second = getByTestId('canon-icon-img').getAttribute('src');
        expect(second).toBe(`${URL}?v=2`);
        expect(second).not.toBe(first);
      });
    });

    it('does not render an <img> (nor crash) when thumbnail is null even with a version', () => {
      const { queryByTestId } = render(CanonIcon, { props: { thumbnail: null, version: 123 } });
      expect(queryByTestId('canon-icon-img')).toBeNull();
    });

    it('does not render an <img> (nor crash) when thumbnail is "hidden" even with a version', () => {
      const { queryByTestId } = render(CanonIcon, { props: { thumbnail: 'hidden', version: 123 } });
      expect(queryByTestId('canon-icon-img')).toBeNull();
    });
  });

  describe('props contract', () => {
    it('applies the icon-tile background class', () => {
      const { getByTestId } = render(CanonIcon, { props: { thumbnail: null } });
      expect(getByTestId('canon-icon')).toHaveClass('bg-icon-tile');
    });

    it('dims the tile when dimmed', () => {
      const { getByTestId } = render(CanonIcon, { props: { thumbnail: URL, dimmed: true } });
      expect(getByTestId('canon-icon')).toHaveClass('opacity-40');
    });

    it('is not dimmed by default', () => {
      const { getByTestId } = render(CanonIcon, { props: { thumbnail: URL } });
      expect(getByTestId('canon-icon')).not.toHaveClass('opacity-40');
    });

    it('lazy-loads the image', () => {
      const { getByTestId } = render(CanonIcon, { props: { thumbnail: URL } });
      expect(getByTestId('canon-icon-img').getAttribute('loading')).toBe('lazy');
    });

    it('applies the size to the tile', () => {
      const { getByTestId } = render(CanonIcon, { props: { thumbnail: null, size: 48 } });
      expect(getByTestId('canon-icon').getAttribute('style')).toContain('width: 48px');
    });

    it('merges the class prop', () => {
      const { getByTestId } = render(CanonIcon, { props: { thumbnail: null, class: 'custom-x' } });
      expect(getByTestId('canon-icon')).toHaveClass('custom-x');
    });
  });

  describe('matched (sage bare tile, Phase 3)', () => {
    it('tints a bare matched tile sage instead of grey', () => {
      const { getByTestId } = render(CanonIcon, {
        props: { thumbnail: null, name: 'Milk', matched: true },
      });
      const tile = getByTestId('canon-icon');
      expect(tile).toHaveClass('bg-secondary-container');
      expect(tile).not.toHaveClass('bg-icon-tile');
    });

    it('shows the name initial (uppercased) on the sage bare tile', () => {
      const { getByTestId } = render(CanonIcon, {
        props: { thumbnail: null, name: 'milk', matched: true },
      });
      expect(getByTestId('canon-icon-initial').textContent).toBe('M');
    });

    it('marks the initial aria-hidden (decorative — the row carries the label)', () => {
      const { getByTestId } = render(CanonIcon, {
        props: { thumbnail: null, name: 'Milk', matched: true },
      });
      expect(getByTestId('canon-icon-initial').getAttribute('aria-hidden')).toBe('true');
    });

    it('renders no initial when matched but the name is empty', () => {
      const { getByTestId, queryByTestId } = render(CanonIcon, {
        props: { thumbnail: null, name: '', matched: true },
      });
      // Still sage — just an empty tile, no letter.
      expect(getByTestId('canon-icon')).toHaveClass('bg-secondary-container');
      expect(queryByTestId('canon-icon-initial')).toBeNull();
    });

    it('leaves a matched tile WITH an icon on the neutral backdrop (no sage, no letter)', () => {
      const { getByTestId, queryByTestId } = render(CanonIcon, {
        props: { thumbnail: URL, name: 'Milk', matched: true },
      });
      const tile = getByTestId('canon-icon');
      expect(tile).toHaveClass('bg-icon-tile');
      expect(tile).not.toHaveClass('bg-secondary-container');
      expect(queryByTestId('canon-icon-img')).toBeInTheDocument();
      expect(queryByTestId('canon-icon-initial')).toBeNull();
    });

    it('keeps the grey bare tile when not matched (default — unchanged for every other consumer)', () => {
      const { getByTestId, queryByTestId } = render(CanonIcon, { props: { thumbnail: null } });
      expect(getByTestId('canon-icon')).toHaveClass('bg-icon-tile');
      expect(queryByTestId('canon-icon-initial')).toBeNull();
    });
  });

  describe('shimmer (one-shot reveal sweep, Phase 3)', () => {
    it('renders the shimmer overlay when shimmer is true', () => {
      const { getByTestId } = render(CanonIcon, {
        props: { thumbnail: null, name: 'Milk', matched: true, shimmer: true },
      });
      const overlay = getByTestId('canon-icon-shimmer');
      expect(overlay).toBeInTheDocument();
      expect(overlay).toHaveClass('salt-icon-shimmer');
      // Hidden under reduced motion, and decorative.
      expect(overlay).toHaveClass('motion-reduce:hidden');
      expect(overlay.getAttribute('aria-hidden')).toBe('true');
    });

    it('renders no shimmer overlay by default', () => {
      const { queryByTestId } = render(CanonIcon, { props: { thumbnail: null, matched: true } });
      expect(queryByTestId('canon-icon-shimmer')).toBeNull();
    });

    it('can shimmer over a rendered icon too (overlay is independent of tile state)', () => {
      const { getByTestId } = render(CanonIcon, {
        props: { thumbnail: URL, name: 'Milk', shimmer: true },
      });
      expect(getByTestId('canon-icon-img')).toBeInTheDocument();
      expect(getByTestId('canon-icon-shimmer')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has no axe violations with an icon', async () => {
      const { container } = render(CanonIcon, { props: { thumbnail: URL, name: 'Milk' } });
      expect(await axe(container)).toHaveNoViolations();
    });

    it('has no axe violations for a matched, shimmering bare tile', async () => {
      const { container } = render(CanonIcon, {
        props: { thumbnail: null, name: 'Milk', matched: true, shimmer: true },
      });
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
