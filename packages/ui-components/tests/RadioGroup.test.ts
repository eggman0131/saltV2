// lean RadioGroup test suite
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';

import RadioGroupFixture from './fixtures/RadioGroupFixture.svelte';

afterEach(() => cleanup());

let apple: HTMLElement, banana: HTMLElement, orange: HTMLElement;

function setup(props = {}) {
  render(RadioGroupFixture, { props });
  [apple, banana, orange] = screen.getAllByRole('radio') as [HTMLElement, HTMLElement, HTMLElement];
}

describe('RadioGroup (lean suite)', () => {
  // ------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------
  describe('rendering', () => {
    it('renders group and items', () => {
      setup();
      expect(screen.getByRole('radiogroup')).toBeInTheDocument();
      expect(screen.getAllByRole('radio')).toHaveLength(3);
    });

    it('renders label', () => {
      setup({ label: 'Favourite fruit' });
      expect(screen.getByText('Favourite fruit')).toBeInTheDocument();
    });

    it('applies disabled/required props', () => {
      setup({ disabled: true, required: true });
      const group = screen.getByRole('radiogroup');
      expect(group).toHaveAttribute('aria-disabled', 'true');
      expect(group).toHaveAttribute('aria-required', 'true');
    });
  });

  // ------------------------------------------------------------
  // Behaviour
  // ------------------------------------------------------------
  describe('behaviour', () => {
    it('selects on click', async () => {
      const onValueChange = vi.fn();
      setup({ onValueChange });
      await fireEvent.click(banana);
      expect(onValueChange).toHaveBeenCalledWith('banana');
    });

    it('does not select disabled item', async () => {
      const onValueChange = vi.fn();
      setup({ onValueChange });
      await fireEvent.click(orange);
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('root disabled blocks selection', async () => {
      const onValueChange = vi.fn();
      setup({ disabled: true, onValueChange });
      await fireEvent.click(apple);
      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------
  // Keyboard navigation (minimal)
  // ------------------------------------------------------------
  describe('keyboard', () => {
    beforeEach(() => setup());

    it('ArrowDown moves to next enabled item (skips disabled)', async () => {
      apple.focus();
      await userEvent.keyboard('{ArrowDown}');
      expect(document.activeElement).toBe(banana);

      // banana → ArrowDown → orange (disabled) → wrap to apple
      banana.focus();
      await userEvent.keyboard('{ArrowDown}');
      expect(document.activeElement).toBe(apple);
    });
  });

  // ------------------------------------------------------------
  // Accessibility (minimal)
  // ------------------------------------------------------------
  describe('accessibility', () => {
    it('has no axe violations', async () => {
      const { container } = render(RadioGroupFixture);
      expect(await axe(container)).toHaveNoViolations();
    });

    it('is labelled by legend', () => {
      setup({ label: 'Pick fruit' });
      const group = screen.getByRole('radiogroup');
      const labelId = group.getAttribute('aria-labelledby');
      expect(document.getElementById(labelId!)).toHaveTextContent('Pick fruit');
    });
  });

  // ------------------------------------------------------------
  // Controlled vs uncontrolled
  // ------------------------------------------------------------
  describe('controlled', () => {
    it('uses defaultValue when uncontrolled', () => {
      setup({ defaultValue: 'banana' });
      expect(banana).toHaveAttribute('aria-checked', 'true');
      expect(apple).toHaveAttribute('aria-checked', 'false');
    });

    it('value overrides defaultValue', () => {
      setup({ value: 'apple', defaultValue: 'banana' });
      expect(apple).toHaveAttribute('aria-checked', 'true');
      expect(banana).toHaveAttribute('aria-checked', 'false');
    });
  });
});
