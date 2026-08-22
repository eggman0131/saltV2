// spec: ui-spec-v09.md §8.23, §8.24 v0.9.2
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import ChipFixture from './fixtures/ChipFixture.svelte';
import StaticChipFixture from './fixtures/StaticChipFixture.svelte';

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

  // §8.23.8: a chip that cannot be pressed must not be a button — not reachable
  // by Tab, not announced as a control, and never carrying aria-pressed.
  describe('the static chips', () => {
    it.each(['fact', 'tag'] as const)('renders %s as a span, not a button', (variant) => {
      render(StaticChipFixture, { props: { variant } });
      expect(chip().tagName).toBe('SPAN');
      expect(screen.queryByRole('button')).toBeNull();
      expect(chip()).not.toHaveAttribute('aria-pressed');
    });

    it('never takes the pressed fill', () => {
      render(StaticChipFixture, { props: { variant: 'fact' } });
      expect(chip().className).toContain('salt-chip--fact');
      expect(chip().className).not.toContain('salt-chip--on');
    });

    it('renders the leading icon a fact is given, and nothing when it is not', () => {
      render(StaticChipFixture, { props: { variant: 'fact', withIcon: true } });
      expect(chip().querySelector('svg')).not.toBeNull();
      cleanup();
      render(StaticChipFixture, { props: { variant: 'fact', withIcon: false } });
      expect(chip().querySelector('svg')).toBeNull();
    });

    it('gives a tag the quiet outline and no icon', () => {
      render(StaticChipFixture, { props: { variant: 'tag', label: 'weeknight' } });
      expect(chip().className).toContain('salt-chip--tag');
      expect(chip().querySelector('svg')).toBeNull();
      expect(chip()).toHaveTextContent('weeknight');
    });

    it('has no axe violations', async () => {
      const { container } = render(StaticChipFixture, {
        props: { variant: 'fact', withIcon: true },
      });
      expect(await axe(container)).toHaveNoViolations();
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
