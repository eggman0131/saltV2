// spec: canon-icons.md §Rendering v1.0
// Non-interactive primitive — 'events contract' and 'keyboard interaction' blocks omitted.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { axe } from 'vitest-axe';
import CanonIcon from '../src/primitives/CanonIcon/CanonIcon.svelte';

afterEach(() => cleanup());

const URL = 'https://storage.googleapis.com/bucket/canon-icons/abc.webp';

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

  describe('accessibility', () => {
    it('has no axe violations with an icon', async () => {
      const { container } = render(CanonIcon, { props: { thumbnail: URL, name: 'Milk' } });
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
