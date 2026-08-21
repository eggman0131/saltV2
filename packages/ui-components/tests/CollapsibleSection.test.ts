// spec: ui-spec-v09.md §8.25, §8.26 v0.9
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import CollapsibleSectionFixture from './fixtures/CollapsibleSectionFixture.svelte';

afterEach(() => cleanup());

const base = { title: 'Produce', expanded: true, onToggle: () => {} };

describe('CollapsibleSection', () => {
  it('names the section on a button carrying aria-expanded', () => {
    render(CollapsibleSectionFixture, { props: { ...base, triggerTestId: 'trigger' } });
    const trigger = screen.getByTestId('trigger');
    expect(trigger).toHaveAttribute('type', 'button');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveTextContent('Produce');
  });

  it('reports collapsed through aria-expanded', () => {
    render(CollapsibleSectionFixture, {
      props: { ...base, expanded: false, triggerTestId: 'trigger' },
    });
    expect(screen.getByTestId('trigger')).toHaveAttribute('aria-expanded', 'false');
  });

  // §8.25.3 — a collapsed section must not hold anything focusable. Hiding the
  // body with CSS would leave it in the tab order.
  it('does not render the body while collapsed', () => {
    render(CollapsibleSectionFixture, { props: { ...base, expanded: false } });
    expect(screen.queryByTestId('body-button')).toBeNull();
  });

  it('renders the body while expanded', () => {
    render(CollapsibleSectionFixture, { props: { ...base, expanded: true } });
    expect(screen.getByTestId('body-button')).toBeInTheDocument();
  });

  // §8.25.4 — the section never flips itself; the page owns the state.
  it('calls onToggle and does not change state on its own', async () => {
    const onToggle = vi.fn();
    render(CollapsibleSectionFixture, {
      props: { ...base, expanded: false, onToggle, triggerTestId: 'trigger' },
    });
    await userEvent.click(screen.getByTestId('trigger'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('trigger')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('body-button')).toBeNull();
  });

  describe('collapsedCount', () => {
    it('shows only while collapsed', () => {
      render(CollapsibleSectionFixture, {
        props: { ...base, expanded: false, collapsedCount: 4, triggerTestId: 'trigger' },
      });
      expect(screen.getByTestId('trigger')).toHaveTextContent('(4)');
    });

    it('is absent while expanded', () => {
      render(CollapsibleSectionFixture, {
        props: { ...base, expanded: true, collapsedCount: 4, triggerTestId: 'trigger' },
      });
      expect(screen.getByTestId('trigger')).not.toHaveTextContent('(4)');
    });

    it('is omitted entirely when not given', () => {
      render(CollapsibleSectionFixture, {
        props: { ...base, expanded: false, triggerTestId: 'trigger' },
      });
      expect(screen.getByTestId('trigger').textContent?.trim()).toBe('Produce');
    });
  });

  it('renders the action beside the trigger, outside it', () => {
    render(CollapsibleSectionFixture, {
      props: { ...base, withAction: true, triggerTestId: 'trigger' },
    });
    const action = screen.getByTestId('action');
    expect(action).toBeInTheDocument();
    // Outside, or activating "Clear" would also toggle the section.
    expect(screen.getByTestId('trigger').contains(action)).toBe(false);
  });

  // §8.25.5 — `...rest` goes to the <section>, the testid to the button.
  it('puts rest attributes on the section and triggerTestId on the button', () => {
    render(CollapsibleSectionFixture, {
      props: { ...base, triggerTestId: 'trigger', 'data-testid': 'section' } as never,
    });
    const section = screen.getByTestId('section');
    expect(section.tagName).toBe('SECTION');
    expect(section.contains(screen.getByTestId('trigger'))).toBe(true);
  });

  it('has no axe violations, open or closed', async () => {
    const open = render(CollapsibleSectionFixture, { props: { ...base, expanded: true } });
    expect(await axe(open.container)).toHaveNoViolations();
    cleanup();
    const shut = render(CollapsibleSectionFixture, {
      props: { ...base, expanded: false, collapsedCount: 4 },
    });
    expect(await axe(shut.container)).toHaveNoViolations();
  });
});
