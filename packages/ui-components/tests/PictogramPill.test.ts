// spec: ui-spec-v12.md §8.30 v0.12
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import PictogramPill from '../src/primitives/PictogramPill/PictogramPill.svelte';

afterEach(() => cleanup());

const PAN = 'https://example.com/kit/large-frying-pan.webp';

function pill(): HTMLElement {
  return screen.getByTestId('pill');
}

describe('PictogramPill', () => {
  describe('semantics — read, never pressed (§8.30.6)', () => {
    it('renders a span, not a button, and announces no pressed state', () => {
      render(PictogramPill, {
        props: { label: 'large frying pan', thumbnail: PAN, 'data-testid': 'pill' },
      });
      expect(pill().tagName).toBe('SPAN');
      expect(screen.queryByRole('button')).toBeNull();
      expect(pill()).not.toHaveAttribute('aria-pressed');
    });

    it('takes no tab stop', async () => {
      render(PictogramPill, {
        props: { label: 'colander', thumbnail: PAN, 'data-testid': 'pill' },
      });
      await userEvent.tab();
      // Nothing in the pill is focusable, so the tab lands on the body — the
      // point of §8.23.8's rule carried into §8.30.6: a thing that cannot be
      // pressed must not cost a keyboard user a stop.
      expect(document.activeElement).toBe(document.body);
    });

    it('prints the label as the pill text', () => {
      render(PictogramPill, {
        props: { label: 'potato masher', thumbnail: PAN, 'data-testid': 'pill' },
      });
      expect(pill().textContent?.trim()).toBe('potato masher');
    });

    it('is inline-level, not block — every other static pill in the package is', () => {
      // salt.css:730-736 (`.salt-chip--fact` and its siblings) is inline-flex;
      // `flex` here would stretch the pill to fill any non-flex parent, which
      // is exactly what the Storybook Playground/NoPicture canvas is (#1050).
      render(PictogramPill, {
        props: { label: 'large frying pan', thumbnail: PAN, 'data-testid': 'pill' },
      });
      const classes = pill().className.split(/\s+/);
      expect(classes).toContain('inline-flex');
      expect(classes).not.toContain('flex');
    });

    it('silences the decorative tile so the label is not announced twice', () => {
      // The tile sits beside a visible label span that already carries the
      // name; an unsilenced `<img alt>` would double-announce the object to a
      // screen reader. axe has no rule for this — a green axe run is not
      // evidence either way (§8.30.8).
      render(PictogramPill, {
        props: { label: 'large frying pan', thumbnail: PAN, 'data-testid': 'pill' },
      });
      const tile = screen.getByTestId('canon-icon');
      expect(tile.closest('[aria-hidden="true"]')).not.toBeNull();
      expect(screen.getByTestId('canon-icon-img')).toHaveAttribute('alt', '');
    });
  });

  describe('the picture', () => {
    it('draws the tile at 40px — the in-list pictogram size (ui-spec-v04 §14.6.1)', () => {
      render(PictogramPill, { props: { label: 'large frying pan', thumbnail: PAN } });
      const tile = screen.getByTestId('canon-icon');
      expect(tile.getAttribute('style')).toContain('width: 40px');
      expect(tile.getAttribute('style')).toContain('height: 40px');
    });

    it('passes the cache-bust nonce through to the image', () => {
      render(PictogramPill, {
        props: { label: 'large frying pan', thumbnail: PAN, version: '2026-02-02' },
      });
      expect(screen.getByTestId('canon-icon-img')).toHaveAttribute('src', `${PAN}?v=2026-02-02`);
    });

    it('collapses the left padding so the tile sits flush in the round end', () => {
      render(PictogramPill, {
        props: { label: 'large frying pan', thumbnail: PAN, 'data-testid': 'pill' },
      });
      expect(pill().className).toContain('pl-1');
      expect(pill().className).not.toContain('pl-4');
    });
  });

  describe('the miss path — words, no tile, never a placeholder (§8.30.5)', () => {
    // The four ways there is no picture: not drawn yet, hidden by the user, an
    // empty string, and a vocabulary that has not loaded. All four read the
    // same, because a blank grey square inside a pill reads as a broken picture
    // where words alone read as an object nobody has drawn yet.
    const misses = [
      ['null — no icon generated yet', null],
      ['the "hidden" sentinel — the user opted out', 'hidden'],
      ['an empty string', ''],
      ['omitted — the vocabulary has not loaded', undefined],
    ] as const;

    it.each(misses)('renders no tile at all for %s', (_name, thumbnail) => {
      render(PictogramPill, {
        props: { label: 'tagine', thumbnail, 'data-testid': 'pill' },
      });
      expect(screen.queryByTestId('canon-icon')).toBeNull();
      expect(screen.queryByTestId('canon-icon-img')).toBeNull();
      expect(pill().textContent?.trim()).toBe('tagine');
    });

    it('keeps the full left inset when there is no tile', () => {
      render(PictogramPill, { props: { label: 'tagine', 'data-testid': 'pill' } });
      expect(pill().className).toContain('pl-4');
      expect(pill().className).not.toContain('pl-1');
    });
  });

  it('passes attributes and a class through to the pill', () => {
    render(PictogramPill, {
      props: {
        label: 'mandoline',
        thumbnail: PAN,
        'data-testid': 'pill',
        title: 'mandoline',
        class: 'shrink-0',
      },
    });
    expect(pill()).toHaveAttribute('title', 'mandoline');
    expect(pill().className).toContain('shrink-0');
  });

  it('has no axe violations, with a picture and without', async () => {
    const withPicture = render(PictogramPill, {
      props: { label: 'large frying pan', thumbnail: PAN },
    });
    expect(await axe(withPicture.container)).toHaveNoViolations();
    cleanup();
    const without = render(PictogramPill, { props: { label: 'tagine', thumbnail: null } });
    expect(await axe(without.container)).toHaveNoViolations();
  });
});
