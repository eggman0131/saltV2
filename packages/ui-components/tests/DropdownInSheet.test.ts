// spec: ui-spec-v02.md §2.5 v0.2.10
//
// Regression cover for #674 / #640. A `Select` or `Combobox` opened inside a
// `Sheet` used to portal its listbox to `<body>`. The modal dialog underneath
// puts `pointer-events: none` on `<body>`, so the listbox rendered *over* the
// sheet and every option was dead to clicks — and, sharing the root stacking
// context, it also needed a raw `z-50` to clear `z-dialog` at all.
//
// jsdom does no hit-testing, so `pointer-events: none` cannot be exercised by
// dispatching a click: the assertion that actually holds the fix is structural —
// the listbox lives INSIDE the sheet's content element (the live layer), and its
// wrapper carries the `z-popover` token rather than a raw value.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/svelte';

import DropdownInSheetFixture from './fixtures/DropdownInSheetFixture.svelte';

afterEach(() => cleanup());

function sheetPanel() {
  const el = document.querySelector<HTMLElement>('.sheet-under-test');
  if (!el) throw new Error('sheet content element not found');
  return el;
}

/** The portalled positioning wrapper the listbox sits in. */
function listboxWrapper() {
  const listbox = screen.getByRole('listbox');
  const wrapper = listbox.closest('div[style*="position: absolute"]');
  if (!(wrapper instanceof HTMLElement)) throw new Error('listbox wrapper not found');
  return wrapper;
}

describe('dropdown opened inside a Sheet (#674)', () => {
  describe('Select', () => {
    it('portals the listbox into the sheet panel, not the inert <body>', async () => {
      render(DropdownInSheetFixture, { props: { which: 'select' } });
      await fireEvent.click(screen.getByRole('button', { name: /pick a fruit/i }));

      await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());

      // The precondition for the bug: the modal really has made <body> inert.
      // Without it the rest of this assertion proves nothing.
      expect(document.body.style.pointerEvents).toBe('none');

      expect(sheetPanel().contains(screen.getByRole('listbox'))).toBe(true);
      expect(listboxWrapper().parentElement).toBe(sheetPanel());
    });

    it('puts the listbox on the z-popover rung, not a raw z-50', async () => {
      render(DropdownInSheetFixture, { props: { which: 'select' } });
      await fireEvent.click(screen.getByRole('button', { name: /pick a fruit/i }));
      await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());

      expect(listboxWrapper().className).toContain('z-popover');
      expect(listboxWrapper().className).not.toContain('z-50');
    });

    it('still selects when an option inside the sheet is clicked', async () => {
      const seen: string[] = [];
      render(DropdownInSheetFixture, {
        props: { which: 'select', onValueChange: (v: string) => seen.push(v) },
      });
      await fireEvent.click(screen.getByRole('button', { name: /pick a fruit/i }));
      await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());

      await fireEvent.click(screen.getByRole('option', { name: 'Banana' }));

      await waitFor(() => expect(seen).toEqual(['banana']));
    });

    it('honours an explicit portal target over the enclosing sheet', async () => {
      render(DropdownInSheetFixture, { props: { which: 'select', portal: 'body' } });
      await fireEvent.click(screen.getByRole('button', { name: /pick a fruit/i }));
      await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());

      expect(listboxWrapper().parentElement).toBe(document.body);
    });
  });

  describe('Combobox', () => {
    it('portals the popup into the sheet panel, not <body>', async () => {
      render(DropdownInSheetFixture, { props: { which: 'combobox' } });
      // fireEvent, not userEvent: userEvent focuses on pointerdown and the
      // combobox closes on input blur in a microtask, tearing the listbox down
      // before the click lands.
      await fireEvent.click(screen.getByRole('combobox'));

      await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());

      expect(sheetPanel().contains(screen.getByRole('listbox'))).toBe(true);
      expect(listboxWrapper().parentElement).toBe(sheetPanel());
      expect(listboxWrapper().className).toContain('z-popover');
      expect(listboxWrapper().className).not.toContain('z-50');
    });
  });
});

describe('dropdown outside any modal', () => {
  it('falls back to <body>', async () => {
    render(DropdownInSheetFixture, { props: { which: 'select', inSheet: false } });
    await fireEvent.click(screen.getByRole('button', { name: /pick a fruit/i }));
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());

    expect(document.querySelector('.sheet-under-test')).toBeNull();
    expect(listboxWrapper().parentElement).toBe(document.body);
  });
});
