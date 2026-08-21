// spec: ui-spec-v09.md §8.27 v0.9.1
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import ValueChipFixture from './fixtures/ValueChipFixture.svelte';
import { valueChipVariants } from '../src/primitives/Chip/Chip.variants';

afterEach(() => cleanup());

describe('the value chip surface', () => {
  it('is one class, so it can be worn by anything that owns its own interaction', () => {
    expect(valueChipVariants()).toBe('salt-value-chip');
  });

  // §8.27.3: the surface only changes how a control looks. Everything the
  // control already announced about itself has to survive it.
  it('leaves the select trigger the listbox button it was', () => {
    render(ValueChipFixture);
    const trigger = screen.getByTestId('value-chip-select');
    expect(trigger.className).toContain('salt-value-chip');
    expect(trigger.className).toContain('salt-trigger');
    expect(trigger).toHaveAttribute('type', 'button');
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('leaves the combobox input a combobox', () => {
    render(ValueChipFixture);
    const input = screen.getByTestId('value-chip-combobox');
    expect(input.className).toContain('salt-value-chip');
    expect(input.className).toContain('salt-input');
    expect(input).toHaveAttribute('role', 'combobox');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
  });

  // §8.27.6: of the three pill treatments in v0.9, only Chip variant="filter"
  // is ever pressed. A listbox trigger, a combobox and a text input have no
  // pressed state, and claiming one would announce a toggle that cannot toggle.
  it('never carries aria-pressed, on any of the three', () => {
    render(ValueChipFixture);
    expect(screen.getByTestId('value-chip-select')).not.toHaveAttribute('aria-pressed');
    expect(screen.getByTestId('value-chip-combobox')).not.toHaveAttribute('aria-pressed');
    expect(screen.getByTestId('value-chip-input')).not.toHaveAttribute('aria-pressed');
  });

  it('still opens its picker — the surface takes no interaction away', async () => {
    render(ValueChipFixture);
    await userEvent.click(screen.getByTestId('value-chip-select'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  // §8.27.5: `class` lands on the outer stack (label + frame + description +
  // error), so pilling the field through it would round the wrong element.
  // `frameClass` is what reaches the box that paints the border.
  it('reaches a TextField’s frame, not its outer stack and not its input', () => {
    render(ValueChipFixture);
    const input = screen.getByTestId('value-chip-input');
    const frame = input.parentElement!;
    expect(frame.className).toContain('salt-value-chip');
    expect(frame.className).toContain('salt-input');
    expect(input.className).not.toContain('salt-value-chip');
    expect(frame.parentElement!.className).not.toContain('salt-value-chip');
    expect(frame.parentElement!.className).toContain('w-20');
  });

  // A value chip shows no label, so its accessible name can only come from the
  // caller. A nameless one is a spec violation (§8.27.6) — this is the check
  // that would catch a consumer that dropped the aria-label.
  it('is named by the caller, and has no axe violations', async () => {
    const { container } = render(ValueChipFixture);
    expect(screen.getByLabelText('Aisle')).toBeInTheDocument();
    expect(screen.getByLabelText('How this is shopped')).toBeInTheDocument();
    expect(screen.getByLabelText('Quantity threshold')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
