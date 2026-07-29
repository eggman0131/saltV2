// spec: ui-spec-v05.md §1.6 v0.5
// Covers the fill mode only. The rest of ListPage (selection mode, bulk bar,
// pickers) is spec'd in ui-spec-v04 §9 and exercised through the app's page tests.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import ListPage from '../src/templates/ListPage/ListPage.svelte';

afterEach(() => cleanup());

function snippet(text: string) {
  return createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));
}

/** The wrapper ListPage puts around `children` — the element that must grow under fill. */
function contentWrapper(container: HTMLElement): Element | null {
  return container.querySelector('section > div.min-h-0');
}

describe('ListPage fill mode (ui-spec-v05 §1)', () => {
  describe('default — every existing page is untouched', () => {
    it('takes no height, so <main> scrolls the page as before', () => {
      const { container } = render(ListPage, {
        props: { title: 'Recipes', children: snippet('rows') },
      });
      const section = container.querySelector('section')!;
      expect(section).not.toHaveClass('h-full');
      expect(contentWrapper(container)).not.toHaveClass('flex-1');
    });
  });

  describe('fill', () => {
    it('fills the shell content area and hands the leftover height to children', () => {
      const { container } = render(ListPage, {
        props: { title: 'Meal plan', fill: true, children: snippet('deck') },
      });
      // h-full resolves against <main>'s definite height; min-h-0 is what lets the
      // column actually shrink instead of being floored at its content height.
      expect(container.querySelector('section')).toHaveClass('h-full', 'min-h-0');
      expect(contentWrapper(container)).toHaveClass('flex-1');
    });

    it("still merges the caller's own class", () => {
      const { container } = render(ListPage, {
        props: { title: 'Meal plan', fill: true, class: 'p-4', children: snippet('deck') },
      });
      const section = container.querySelector('section')!;
      expect(section).toHaveClass('p-4');
      expect(section).toHaveClass('h-full');
    });
  });
});
