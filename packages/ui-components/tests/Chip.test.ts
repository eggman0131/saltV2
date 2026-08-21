// spec: ui-spec-v09.md §8.23, §8.24 v0.9
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import ChipFixture from './fixtures/ChipFixture.svelte';

afterEach(() => cleanup());

function chip(): HTMLElement {
  return screen.getByTestId('chip');
}

describe('Chip', () => {
  describe('the toggle', () => {
    it('always renders aria-pressed, both states', () => {
      render(ChipFixture, { props: { pressed: false } });
      expect(chip()).toHaveAttribute('aria-pressed', 'false');
      cleanup();
      render(ChipFixture, { props: { pressed: true } });
      expect(chip()).toHaveAttribute('aria-pressed', 'true');
    });

    it('paints the fill only when pressed', () => {
      render(ChipFixture, { props: { pressed: true } });
      expect(chip().className).toContain('salt-chip--on');
      cleanup();
      render(ChipFixture, { props: { pressed: false } });
      expect(chip().className).not.toContain('salt-chip--on');
    });

    it('is a type="button", so a chip row inside a form submits nothing', () => {
      render(ChipFixture, {});
      expect(chip()).toHaveAttribute('type', 'button');
    });

    it('calls onclick', async () => {
      const onclick = vi.fn();
      render(ChipFixture, { props: { onclick } });
      await userEvent.click(chip());
      expect(onclick).toHaveBeenCalledTimes(1);
    });
  });

  describe('the expander', () => {
    // §8.23.6: it reveals more chips; it is never itself pressed, and announcing
    // "not pressed" for a control that cannot be pressed is worse than silence.
    it('carries no aria-pressed, even when handed pressed', () => {
      render(ChipFixture, { props: { variant: 'expander', pressed: true } });
      expect(chip()).not.toHaveAttribute('aria-pressed');
    });

    it('takes the dashed treatment and never the fill', () => {
      render(ChipFixture, { props: { variant: 'expander', pressed: true } });
      expect(chip().className).toContain('salt-chip--expander');
      expect(chip().className).not.toContain('salt-chip--filter');
    });
  });

  // The recipe list's filters are asserted through these; a primitive that ate
  // them would break e2e with no type error to warn anyone (§8.23.3).
  it('passes data attributes through to the button', () => {
    render(ChipFixture, { props: { 'data-tag': 'vegetarian' } as never });
    expect(chip()).toHaveAttribute('data-tag', 'vegetarian');
  });

  it('merges a consumer class last', () => {
    render(ChipFixture, { props: { class: 'mt-2' } });
    expect(chip().className).toContain('salt-chip');
    expect(chip().className).toContain('mt-2');
  });

  it('has no axe violations', async () => {
    const { container } = render(ChipFixture, { props: { ariaLabel: 'Tags', pressed: true } });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('ChipGroup', () => {
  // §8.24.4: an unnamed role="group" announces a boundary and then has nothing
  // to say about what is inside it.
  it('becomes a named group only when given a name', () => {
    render(ChipFixture, { props: { ariaLabel: 'Section' } });
    const group = screen.getByTestId('group');
    expect(group).toHaveAttribute('role', 'group');
    expect(group).toHaveAttribute('aria-label', 'Section');
  });

  it('stays a plain div when unnamed', () => {
    render(ChipFixture, {});
    const group = screen.getByTestId('group');
    expect(group).not.toHaveAttribute('role');
    expect(group).not.toHaveAttribute('aria-label');
    expect(group.className).toContain('salt-chip-group');
  });
});
