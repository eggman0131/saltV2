// spec: ui-spec-v04.md §7 v0.4
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';

import ComboboxFixture from './fixtures/ComboboxFixture.svelte';
import ComboboxContent from '../src/primitives/Combobox/ComboboxContent.svelte';

afterEach(() => cleanup());

function setup(props: Record<string, unknown> = {}) {
  return render(ComboboxFixture, { props });
}

function getInput() {
  return screen.getByRole('combobox');
}

function getListbox() {
  return screen.getByRole('listbox');
}

async function openCombobox(props: Record<string, unknown> = {}) {
  const result = setup(props);
  await userEvent.click(getInput());
  return result;
}

describe('Combobox', () => {
  // ------------------------------------------------------------------
  // 1. Rendering
  // ------------------------------------------------------------------
  describe('rendering', () => {
    it('renders the input', () => {
      setup();
      expect(getInput()).toBeInTheDocument();
    });

    it('does not render the listbox when closed', () => {
      setup();
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('renders the listbox when open', async () => {
      await openCombobox();
      expect(getListbox()).toBeInTheDocument();
    });

    it('renders all options when open', async () => {
      await openCombobox();
      expect(screen.getAllByRole('option')).toHaveLength(3);
    });

    it('renders placeholder when no value is selected', () => {
      setup({ placeholder: 'Search fruits…' });
      expect(getInput()).toHaveAttribute('placeholder', 'Search fruits…');
    });

    it('renders separator', async () => {
      await openCombobox();
      expect(screen.getByRole('separator')).toBeInTheDocument();
    });

    it('renders the caret trigger button', () => {
      setup();
      // trigger is tabindex=-1, use querySelector
      expect(document.querySelector('button[tabindex="-1"]')).toBeInTheDocument();
    });
  });

  // ------------------------------------------------------------------
  // 2. Props contract
  // ------------------------------------------------------------------
  describe('props contract', () => {
    it('is closed by default', () => {
      setup();
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('defaultOpen=true renders listbox initially', () => {
      setup({ defaultOpen: true });
      expect(getListbox()).toBeInTheDocument();
    });

    it('defaultValue pre-fills input', () => {
      setup({ defaultValue: 'banana' });
      expect(getInput()).toHaveValue('Banana');
    });

    it('renders hidden input when name is provided', () => {
      setup({ name: 'fruit' });
      expect(document.querySelector('input[type="hidden"][name="fruit"]')).toBeInTheDocument();
    });

    it('hidden input value reflects selection', async () => {
      setup({ name: 'fruit', defaultValue: 'apple' });
      const input = document.querySelector<HTMLInputElement>('input[name="fruit"]');
      expect(input?.value).toBe('apple');
    });

    it('throws when allowCustom and restrict are both true', () => {
      expect(() => setup({ allowCustom: true, restrict: true })).toThrow('mutually exclusive');
    });
  });

  // ------------------------------------------------------------------
  // 3. Events contract
  // ------------------------------------------------------------------
  describe('events contract', () => {
    it('calls onOpenChange(true) when opened via click', async () => {
      const onOpenChange = vi.fn();
      setup({ onOpenChange });
      await userEvent.click(getInput());
      expect(onOpenChange).toHaveBeenCalledWith(true);
    });

    it('calls onOpenChange(false) when closed via Escape', async () => {
      const onOpenChange = vi.fn();
      await openCombobox({ onOpenChange });
      await userEvent.keyboard('{Escape}');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('calls onValueChange when an option is selected', async () => {
      const onValueChange = vi.fn();
      await openCombobox({ onValueChange });
      await userEvent.click(screen.getByRole('option', { name: 'Apple' }));
      expect(onValueChange).toHaveBeenCalledWith('apple');
    });

    it('updates input value after selection', async () => {
      await openCombobox();
      await userEvent.click(screen.getByRole('option', { name: 'Banana' }));
      expect(getInput()).toHaveValue('Banana');
    });

    it('closes popup after selection', async () => {
      await openCombobox();
      await userEvent.click(screen.getByRole('option', { name: 'Apple' }));
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  // ------------------------------------------------------------------
  // openOnClick={false}: dropdown only appears once the user types
  // ------------------------------------------------------------------
  describe('openOnClick=false', () => {
    it('does not open the popup when the input is clicked', async () => {
      setup({ openOnClick: false });
      await userEvent.click(getInput());
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('opens the popup once the user starts typing', async () => {
      setup({ openOnClick: false });
      await userEvent.click(getInput());
      await userEvent.type(getInput(), 'a');
      expect(getListbox()).toBeInTheDocument();
    });
  });

  // ------------------------------------------------------------------
  // 4. Keyboard interaction
  // ------------------------------------------------------------------
  describe('keyboard', () => {
    it('ArrowDown opens the popup and moves to first item', async () => {
      setup();
      getInput().focus();
      await userEvent.keyboard('{ArrowDown}');
      expect(getListbox()).toBeInTheDocument();
      await waitFor(() => {
        const activeId = getListbox().getAttribute('aria-activedescendant');
        expect(activeId).toBeTruthy();
      });
    });

    it('ArrowUp opens the popup and moves to last item', async () => {
      setup();
      getInput().focus();
      await userEvent.keyboard('{ArrowUp}');
      expect(getListbox()).toBeInTheDocument();
      await waitFor(() => {
        const activeId = getListbox().getAttribute('aria-activedescendant');
        const el = document.getElementById(activeId!);
        expect(el).toHaveTextContent('Cherry');
      });
    });

    it('ArrowDown moves active to next item', async () => {
      await openCombobox();
      await userEvent.keyboard('{ArrowDown}');
      const id1 = getListbox().getAttribute('aria-activedescendant');
      await userEvent.keyboard('{ArrowDown}');
      const id2 = getListbox().getAttribute('aria-activedescendant');
      expect(id2).not.toBe(id1);
    });

    it('ArrowUp moves active to previous item', async () => {
      await openCombobox({ defaultValue: 'cherry' });
      await userEvent.keyboard('{ArrowUp}');
      const activeId = getListbox().getAttribute('aria-activedescendant');
      // Moves from Cherry (index 2) toward Banana (index 1)
      expect(document.getElementById(activeId!)).toHaveTextContent('Banana');
    });

    it('Home moves to first item', async () => {
      await openCombobox();
      await userEvent.keyboard('{ArrowDown}');
      await userEvent.keyboard('{ArrowDown}');
      await userEvent.keyboard('{Home}');
      const activeId = getListbox().getAttribute('aria-activedescendant');
      expect(document.getElementById(activeId!)).toHaveTextContent('Apple');
    });

    it('End moves to last item', async () => {
      await openCombobox();
      await userEvent.keyboard('{End}');
      const activeId = getListbox().getAttribute('aria-activedescendant');
      expect(document.getElementById(activeId!)).toHaveTextContent('Cherry');
    });

    it('Enter selects active item and closes', async () => {
      const onValueChange = vi.fn();
      await openCombobox({ onValueChange });
      await userEvent.keyboard('{ArrowDown}');
      await userEvent.keyboard('{Enter}');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(onValueChange).toHaveBeenCalled();
    });

    it('Escape closes the popup', async () => {
      await openCombobox();
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('Escape restores input to current selected value', async () => {
      setup({ defaultValue: 'banana' });
      getInput().focus();
      await userEvent.clear(getInput());
      await userEvent.type(getInput(), 'xyz');
      await userEvent.keyboard('{Escape}');
      expect(getInput()).toHaveValue('Banana');
    });

    it('Escape clears input when no value is selected', async () => {
      await openCombobox();
      await userEvent.type(getInput(), 'xyz');
      await userEvent.keyboard('{Escape}');
      expect(getInput()).toHaveValue('');
    });
  });

  // ------------------------------------------------------------------
  // 5. Filtering
  // ------------------------------------------------------------------
  describe('filtering', () => {
    it('filters items as the user types', async () => {
      await openCombobox();
      await userEvent.type(getInput(), 'an');
      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveTextContent('Banana');
    });

    it('is case-insensitive', async () => {
      await openCombobox();
      await userEvent.type(getInput(), 'APPLE');
      expect(screen.getAllByRole('option')).toHaveLength(1);
      expect(screen.getByRole('option')).toHaveTextContent('Apple');
    });

    it('shows no options when input matches nothing', async () => {
      await openCombobox();
      await userEvent.type(getInput(), 'xyz');
      expect(screen.queryAllByRole('option')).toHaveLength(0);
    });

    it('shows ComboboxEmpty when no results', async () => {
      await openCombobox();
      await userEvent.type(getInput(), 'xyz');
      expect(screen.getByText('No results found.')).toBeInTheDocument();
    });

    it('shows all options when input is empty', async () => {
      await openCombobox();
      expect(screen.getAllByRole('option')).toHaveLength(3);
    });

    it('uses custom filterFn when provided', async () => {
      // Filter that only shows items whose value starts with input
      const filterFn = vi.fn((input: string, item: { value: string; label: string }) =>
        item.value.startsWith(input.toLowerCase()),
      );
      await openCombobox({ filterFn });
      await userEvent.type(getInput(), 'b');
      expect(filterFn).toHaveBeenCalled();
      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveTextContent('Banana');
    });

    it('resets active index when input changes', async () => {
      await openCombobox();
      await userEvent.keyboard('{ArrowDown}');
      const before = getListbox().getAttribute('aria-activedescendant');
      expect(before).toBeTruthy();
      await userEvent.type(getInput(), 'a');
      const after = getListbox().getAttribute('aria-activedescendant');
      expect(after).toBeNull();
    });
  });

  // ------------------------------------------------------------------
  // 6. Restrict mode
  // ------------------------------------------------------------------
  describe('restrict mode', () => {
    it('reverts input to selected value on blur with no match', async () => {
      setup({ restrict: true, defaultValue: 'apple' });
      const input = getInput();
      input.focus();
      await userEvent.clear(input);
      await userEvent.type(input, 'xyz');
      fireEvent.blur(input);
      await waitFor(() => {
        expect(input).toHaveValue('Apple');
      });
    });

    it('clears input on blur if no selection and no match', async () => {
      setup({ restrict: true });
      const input = getInput();
      input.focus();
      await userEvent.type(input, 'xyz');
      fireEvent.blur(input);
      await waitFor(() => {
        expect(input).toHaveValue('');
      });
    });
  });

  // ------------------------------------------------------------------
  // 7. allowCustom mode
  // ------------------------------------------------------------------
  describe('allowCustom mode', () => {
    it('shows ComboboxCreate when input does not match any label', async () => {
      await openCombobox({ allowCustom: true });
      await userEvent.type(getInput(), 'Mango');
      expect(screen.getByRole('option', { name: /Create "Mango"/ })).toBeInTheDocument();
    });

    it('does not show ComboboxCreate when input exactly matches a label', async () => {
      await openCombobox({ allowCustom: true });
      await userEvent.type(getInput(), 'Apple');
      expect(screen.queryByRole('option', { name: /Create/ })).not.toBeInTheDocument();
    });

    it('does not show ComboboxCreate when input is empty', async () => {
      await openCombobox({ allowCustom: true });
      expect(screen.queryByRole('option', { name: /Create/ })).not.toBeInTheDocument();
    });

    it('calls onCreate when ComboboxCreate is clicked', async () => {
      const onCreate = vi.fn();
      await openCombobox({ allowCustom: true, onCreate });
      await userEvent.type(getInput(), 'Mango');
      await userEvent.click(screen.getByRole('option', { name: /Create "Mango"/ }));
      expect(onCreate).toHaveBeenCalledWith('Mango');
    });

    it('calls onValueChange when custom value is created', async () => {
      const onValueChange = vi.fn();
      await openCombobox({ allowCustom: true, onValueChange });
      await userEvent.type(getInput(), 'Mango');
      await userEvent.click(screen.getByRole('option', { name: /Create "Mango"/ }));
      expect(onValueChange).toHaveBeenCalledWith('Mango');
    });

    it('closes popup after creating custom value', async () => {
      await openCombobox({ allowCustom: true });
      await userEvent.type(getInput(), 'Mango');
      await userEvent.click(screen.getByRole('option', { name: /Create "Mango"/ }));
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('Enter with no active item creates custom value when allowCustom', async () => {
      const onCreate = vi.fn();
      await openCombobox({ allowCustom: true, onCreate });
      await userEvent.type(getInput(), 'Mango');
      // Ensure no item is active (input just changed, activeIndex reset)
      await userEvent.keyboard('{Enter}');
      expect(onCreate).toHaveBeenCalledWith('Mango');
    });

    it('ComboboxCreate is navigable via arrow keys', async () => {
      await openCombobox({ allowCustom: true });
      await userEvent.type(getInput(), 'Mango');
      // filteredItems is empty, ComboboxCreate is at index 0
      await userEvent.keyboard('{ArrowDown}');
      const activeId = getListbox().getAttribute('aria-activedescendant');
      expect(document.getElementById(activeId!)).toHaveAttribute('role', 'option');
    });
  });

  // ------------------------------------------------------------------
  // 8. Trigger button
  // ------------------------------------------------------------------
  describe('trigger button', () => {
    it('toggles open state when clicked', async () => {
      const onOpenChange = vi.fn();
      setup({ onOpenChange });
      const trigger = document.querySelector('button[tabindex="-1"]')!;
      await userEvent.click(trigger);
      expect(onOpenChange).toHaveBeenCalledWith(true);
      await userEvent.click(trigger);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  // ------------------------------------------------------------------
  // 9. Controlled vs uncontrolled
  // ------------------------------------------------------------------
  describe('controlled vs uncontrolled', () => {
    it('uncontrolled: value updates internally on selection', async () => {
      await openCombobox();
      await userEvent.click(screen.getByRole('option', { name: 'Cherry' }));
      expect(getInput()).toHaveValue('Cherry');
    });

    it('uncontrolled: defaultValue sets initial input', () => {
      setup({ defaultValue: 'cherry' });
      expect(getInput()).toHaveValue('Cherry');
    });

    it('uncontrolled: defaultOpen=true shows listbox', () => {
      setup({ defaultOpen: true });
      expect(getListbox()).toBeInTheDocument();
    });
  });

  // ------------------------------------------------------------------
  // 10. Accessibility
  // ------------------------------------------------------------------
  describe('accessibility', () => {
    it('input has role="combobox"', () => {
      setup();
      expect(getInput()).toHaveAttribute('role', 'combobox');
    });

    it('input has aria-expanded="false" when closed', () => {
      setup();
      expect(getInput()).toHaveAttribute('aria-expanded', 'false');
    });

    it('input has aria-expanded="true" when open', async () => {
      await openCombobox();
      expect(getInput()).toHaveAttribute('aria-expanded', 'true');
    });

    it('input has aria-autocomplete="list"', () => {
      setup();
      expect(getInput()).toHaveAttribute('aria-autocomplete', 'list');
    });

    it('input has aria-controls referencing listbox when open', async () => {
      await openCombobox();
      const listbox = getListbox();
      expect(getInput()).toHaveAttribute('aria-controls', listbox.id);
    });

    it('input has no aria-controls when closed', () => {
      setup();
      expect(getInput()).not.toHaveAttribute('aria-controls');
    });

    it('listbox has role="listbox"', async () => {
      await openCombobox();
      expect(getListbox()).toHaveAttribute('role', 'listbox');
    });

    it('options have role="option"', async () => {
      await openCombobox();
      screen.getAllByRole('option').forEach((opt) => {
        expect(opt).toHaveAttribute('role', 'option');
      });
    });

    it('selected option has aria-selected="true"', async () => {
      await openCombobox({ defaultValue: 'apple' });
      expect(screen.getByRole('option', { name: 'Apple' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    it('unselected options have aria-selected="false"', async () => {
      await openCombobox({ defaultValue: 'apple' });
      expect(screen.getByRole('option', { name: 'Banana' })).toHaveAttribute(
        'aria-selected',
        'false',
      );
    });

    it('input aria-activedescendant points to active option', async () => {
      await openCombobox();
      await userEvent.keyboard('{ArrowDown}');
      const activeId = getInput().getAttribute('aria-activedescendant');
      expect(activeId).toBeTruthy();
      expect(document.getElementById(activeId!)).toHaveAttribute('role', 'option');
    });

    it('listbox aria-activedescendant matches input aria-activedescendant', async () => {
      await openCombobox();
      await userEvent.keyboard('{ArrowDown}');
      const inputActiveId = getInput().getAttribute('aria-activedescendant');
      const listboxActiveId = getListbox().getAttribute('aria-activedescendant');
      expect(inputActiveId).toBe(listboxActiveId);
    });

    it('ComboboxEmpty has aria-hidden="true"', async () => {
      await openCombobox();
      await userEvent.type(getInput(), 'xyz');
      const empty = screen.getByText('No results found.');
      expect(empty).toHaveAttribute('aria-hidden', 'true');
    });

    it('ComboboxCreate has aria-selected="false"', async () => {
      await openCombobox({ allowCustom: true });
      await userEvent.type(getInput(), 'Mango');
      const create = screen.getByRole('option', { name: /Create/ });
      expect(create).toHaveAttribute('aria-selected', 'false');
    });

    it('has no axe violations when closed', async () => {
      const { container } = render(ComboboxFixture);
      expect(await axe(container)).toHaveNoViolations();
    });

    it('throws when ComboboxContent is used without a Combobox root', () => {
      expect(() => render(ComboboxContent, { props: {} })).toThrow('Combobox context not found');
    });
  });
});
