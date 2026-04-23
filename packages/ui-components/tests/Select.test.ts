// spec: SPEC.md §7 v0.3
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { tick } from 'svelte';
import { axe } from 'vitest-axe';

import SelectFixture from './fixtures/SelectFixture.svelte';
import SelectContent from '../src/primitives/Select/SelectContent.svelte';

afterEach(() => cleanup());

function setup(props: Record<string, unknown> = {}) {
  return render(SelectFixture, { props });
}

function getTrigger() {
  return screen.getByRole('button');
}

function getListbox() {
  return screen.getByRole('listbox');
}

async function openSelect(props: Record<string, unknown> = {}) {
  const result = setup(props);
  await userEvent.click(getTrigger());
  return result;
}

describe('Select', () => {
  // ------------------------------------------------------------------
  // 1. Rendering
  // ------------------------------------------------------------------
  describe('rendering', () => {
    it('renders the trigger button', () => {
      setup();
      expect(getTrigger()).toBeInTheDocument();
    });

    it('does not render the listbox when closed', () => {
      setup();
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('renders the listbox when open', async () => {
      await openSelect();
      expect(getListbox()).toBeInTheDocument();
    });

    it('renders all options when open', async () => {
      await openSelect();
      expect(screen.getAllByRole('option')).toHaveLength(3);
    });

    it('renders placeholder when no value is selected', () => {
      setup({ placeholder: 'Pick a fruit…' });
      expect(getTrigger()).toHaveTextContent('Pick a fruit…');
    });

    it('renders separator', async () => {
      await openSelect();
      expect(screen.getByRole('separator')).toBeInTheDocument();
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

    it('disabled trigger cannot be clicked', async () => {
      const onOpenChange = vi.fn();
      setup({ disabled: true, onOpenChange });
      await userEvent.click(getTrigger());
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it('renders hidden input when name is provided', () => {
      setup({ name: 'fruit' });
      const input = document.querySelector('input[type="hidden"][name="fruit"]');
      expect(input).toBeInTheDocument();
    });

    it('hidden input value reflects selection', async () => {
      setup({ name: 'fruit', defaultValue: 'apple' });
      const input = document.querySelector<HTMLInputElement>('input[name="fruit"]');
      expect(input?.value).toBe('apple');
    });
  });

  // ------------------------------------------------------------------
  // 3. Events contract
  // ------------------------------------------------------------------
  describe('events contract', () => {
    it('calls onOpenChange(true) when opened', async () => {
      const onOpenChange = vi.fn();
      setup({ onOpenChange });
      await userEvent.click(getTrigger());
      expect(onOpenChange).toHaveBeenCalledWith(true);
    });

    it('calls onOpenChange(false) when closed via Escape', async () => {
      const onOpenChange = vi.fn();
      await openSelect({ onOpenChange });
      await userEvent.keyboard('{Escape}');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('calls onValueChange when an option is selected', async () => {
      const onValueChange = vi.fn();
      await openSelect({ onValueChange });
      await userEvent.click(screen.getByRole('option', { name: 'Apple' }));
      expect(onValueChange).toHaveBeenCalledWith('apple');
    });

    it('does not call onValueChange when a disabled option is clicked', async () => {
      const onValueChange = vi.fn();
      await openSelect({ onValueChange });
      await userEvent.click(screen.getByRole('option', { name: 'Orange' }));
      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // 4. Keyboard interaction
  // ------------------------------------------------------------------
  describe('keyboard', () => {
    it('Enter on trigger opens the select', async () => {
      setup();
      getTrigger().focus();
      await userEvent.keyboard('{Enter}');
      expect(getListbox()).toBeInTheDocument();
    });

    it('Space on trigger opens the select', async () => {
      setup();
      getTrigger().focus();
      await userEvent.keyboard(' ');
      expect(getListbox()).toBeInTheDocument();
    });

    it('ArrowDown on trigger opens the select', async () => {
      setup();
      getTrigger().focus();
      await userEvent.keyboard('{ArrowDown}');
      expect(getListbox()).toBeInTheDocument();
    });

    it('ArrowDown moves the active option forward', async () => {
      await openSelect();
      await waitFor(() => expect(getListbox()).toHaveFocus());
      const listbox = getListbox();
      const before = listbox.getAttribute('aria-activedescendant');
      await userEvent.keyboard('{ArrowDown}');
      const after = listbox.getAttribute('aria-activedescendant');
      // active should have moved
      expect(after).toBeTruthy();
      expect(after).not.toBe(before);
    });

    it('ArrowUp moves the active option backward', async () => {
      await openSelect({ defaultValue: 'banana' });
      await waitFor(() => expect(getListbox()).toHaveFocus());
      const listbox = getListbox();
      await userEvent.keyboard('{ArrowUp}');
      const activeId = listbox.getAttribute('aria-activedescendant');
      expect(document.getElementById(activeId!)).toHaveTextContent('Apple');
    });

    it('Home moves to the first enabled option', async () => {
      await openSelect();
      await waitFor(() => expect(getListbox()).toHaveFocus());
      await userEvent.keyboard('{Home}');
      const activeId = getListbox().getAttribute('aria-activedescendant');
      expect(document.getElementById(activeId!)).toHaveTextContent('Apple');
    });

    it('End moves to the last enabled option (skips disabled)', async () => {
      await openSelect();
      await waitFor(() => expect(getListbox()).toHaveFocus());
      await userEvent.keyboard('{End}');
      const activeId = getListbox().getAttribute('aria-activedescendant');
      // Orange is disabled; last enabled = Banana
      expect(document.getElementById(activeId!)).toHaveTextContent('Banana');
    });

    it('Enter selects the active option and closes', async () => {
      const onValueChange = vi.fn();
      await openSelect({ onValueChange });
      await waitFor(() => expect(getListbox()).toHaveFocus());
      await userEvent.keyboard('{ArrowDown}');
      await userEvent.keyboard('{Enter}');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(onValueChange).toHaveBeenCalled();
    });

    it('Escape closes without selecting', async () => {
      const onValueChange = vi.fn();
      await openSelect({ onValueChange });
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // 5. Typeahead
  // ------------------------------------------------------------------
  describe('typeahead', () => {
    it('typing a character activates the matching option', async () => {
      await openSelect();
      await waitFor(() => expect(getListbox()).toHaveFocus());
      await userEvent.keyboard('b');
      const activeId = getListbox().getAttribute('aria-activedescendant');
      expect(document.getElementById(activeId!)).toHaveTextContent('Banana');
    });

    it('is case-insensitive', async () => {
      await openSelect();
      await waitFor(() => expect(getListbox()).toHaveFocus());
      await userEvent.keyboard('B');
      const activeId = getListbox().getAttribute('aria-activedescendant');
      expect(document.getElementById(activeId!)).toHaveTextContent('Banana');
    });

    it('buffer resets after ~1 s and next char starts a fresh search', async () => {
      // Use defaultOpen to avoid click timing issues with fake timers
      setup({ defaultOpen: true });
      const listbox = screen.getByRole('listbox');
      listbox.focus();

      vi.useFakeTimers();
      try {
        // fireEvent is synchronous; await tick() to flush Svelte's reactive DOM updates
        fireEvent.keyDown(listbox, { key: 'b' });
        await tick();
        // Advance past the 1 s reset (flushes the typeahead clearTimeout)
        vi.advanceTimersByTime(1100);
        fireEvent.keyDown(listbox, { key: 'a' });
        await tick();
        const activeId = listbox.getAttribute('aria-activedescendant');
        expect(document.getElementById(activeId!)).toHaveTextContent('Apple');
      } finally {
        vi.useRealTimers();
      }
    });

    it('skips disabled items during typeahead', async () => {
      await openSelect();
      await waitFor(() => expect(getListbox()).toHaveFocus());
      await userEvent.keyboard('o'); // 'Orange' is disabled — should not activate
      const activeId = getListbox().getAttribute('aria-activedescendant');
      if (activeId) {
        expect(document.getElementById(activeId)).not.toHaveAttribute('aria-disabled', 'true');
      }
    });
  });

  // ------------------------------------------------------------------
  // 6. Focus management
  // ------------------------------------------------------------------
  describe('focus management', () => {
    it('listbox receives focus when the select opens', async () => {
      await openSelect();
      await waitFor(() => expect(getListbox()).toHaveFocus());
    });

    it('trigger regains focus after Escape', async () => {
      setup();
      const trigger = getTrigger();
      await userEvent.click(trigger);
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(trigger).toHaveFocus());
    });

    it('trigger regains focus after selecting an option', async () => {
      setup();
      const trigger = getTrigger();
      await userEvent.click(trigger);
      await userEvent.click(screen.getByRole('option', { name: 'Apple' }));
      await waitFor(() => expect(trigger).toHaveFocus());
    });
  });

  // ------------------------------------------------------------------
  // 7. Accessibility
  // ------------------------------------------------------------------
  describe('accessibility', () => {
    it('has no axe violations when closed', async () => {
      const { container } = render(SelectFixture);
      expect(await axe(container)).toHaveNoViolations();
    });

    it('trigger has aria-haspopup="listbox"', () => {
      setup();
      expect(getTrigger()).toHaveAttribute('aria-haspopup', 'listbox');
    });

    it('trigger aria-expanded is false when closed', () => {
      setup();
      expect(getTrigger()).toHaveAttribute('aria-expanded', 'false');
    });

    it('trigger aria-expanded is true when open', async () => {
      await openSelect();
      expect(getTrigger()).toHaveAttribute('aria-expanded', 'true');
    });

    it('trigger aria-controls references the listbox id when open', async () => {
      await openSelect();
      const listbox = getListbox();
      expect(getTrigger()).toHaveAttribute('aria-controls', listbox.id);
    });

    it('selected option has aria-selected="true"', async () => {
      await openSelect({ defaultValue: 'apple' });
      expect(screen.getByRole('option', { name: 'Apple' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    it('unselected options have aria-selected="false"', async () => {
      await openSelect({ defaultValue: 'apple' });
      expect(screen.getByRole('option', { name: 'Banana' })).toHaveAttribute(
        'aria-selected',
        'false',
      );
    });

    it('listbox has aria-activedescendant pointing to the active option', async () => {
      await openSelect();
      await waitFor(() => expect(getListbox()).toHaveFocus());
      await userEvent.keyboard('{ArrowDown}');
      const activeId = getListbox().getAttribute('aria-activedescendant');
      expect(activeId).toBeTruthy();
      expect(document.getElementById(activeId!)).toHaveAttribute('role', 'option');
    });

    it('throws when SelectContent is used without a Select root', () => {
      expect(() => render(SelectContent, { props: {} })).toThrow('Select context not found');
    });
  });
});
