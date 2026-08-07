// spec: ui-spec-v07.md §1.7 v0.7
// Covers the fill mode only. The rest of DetailPage (header, actions, metadata
// aside) is spec'd in SPEC.md §9.3 and exercised through the app's page tests.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import DetailPage from '../src/templates/DetailPage/DetailPage.svelte';

afterEach(() => cleanup());

function snippet(text: string) {
  return createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));
}

/** The wrapper DetailPage puts around `children` — the element that must grow under fill. */
function contentWrapper(container: HTMLElement): Element | null {
  return container.querySelector('section > div.min-w-0');
}

describe('DetailPage fill mode (ui-spec-v07 §1)', () => {
  describe('default — every existing page is untouched', () => {
    it('takes no height, so <main> scrolls the page as before', () => {
      const { container } = render(DetailPage, {
        props: { title: 'Weeknight pasta', children: snippet('body') },
      });
      const section = container.querySelector('section')!;
      expect(section).not.toHaveClass('h-full');
      expect(section).not.toHaveClass('min-h-0');
      expect(contentWrapper(container)).not.toHaveClass('flex-1');
    });
  });

  describe('fill', () => {
    it('fills the shell content area and hands the leftover height to children', () => {
      const { container } = render(DetailPage, {
        props: { title: 'Weeknight pasta', fill: true, children: snippet('panes') },
      });
      // h-full resolves against <main>'s definite height; min-h-0 is what lets the
      // column actually shrink instead of being floored at its content height.
      expect(container.querySelector('section')).toHaveClass('h-full', 'min-h-0');
      expect(contentWrapper(container)).toHaveClass('flex', 'flex-1', 'flex-col');
    });

    it('gives the content wrapper min-h-0, without which flex-1 does nothing', () => {
      // A column flex item's min-height is `auto`, so it is floored at its content
      // height: drop this class and the wrapper carries every fill class and still
      // overflows the section. Cost the recipe page a whole debugging pass (#737).
      const { container } = render(DetailPage, {
        props: { title: 'Weeknight pasta', fill: true, children: snippet('panes') },
      });
      expect(contentWrapper(container)).toHaveClass('min-h-0');
    });

    it("still merges the caller's own class", () => {
      const { container } = render(DetailPage, {
        props: {
          title: 'Weeknight pasta',
          fill: true,
          class: 'p-4',
          children: snippet('panes'),
        },
      });
      const section = container.querySelector('section')!;
      expect(section).toHaveClass('p-4');
      expect(section).toHaveClass('h-full');
    });
  });
});
