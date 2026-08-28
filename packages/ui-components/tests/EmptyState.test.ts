// spec: ui-spec-v13.md §8.31.5 v0.13
// Non-interactive primitive — 'events contract' and 'keyboard interaction' blocks omitted per v0.2 §6.1.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/svelte';
import { axe } from 'vitest-axe';
import { createRawSnippet } from 'svelte';
import EmptyState from '../src/primitives/EmptyState/EmptyState.svelte';

afterEach(() => cleanup());

function snippet(text: string) {
  return createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));
}

describe('EmptyState (ui-spec-v13 §8.31)', () => {
  describe('renders with minimum required props', () => {
    it('renders the title as an h3', () => {
      render(EmptyState, { props: { title: 'Nothing here yet' } });
      expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Nothing here yet');
    });
  });

  describe('empty is not an error (§8.31.2)', () => {
    it('is a polite status region, never an alert', () => {
      // The whole reason EmptyState and ErrorState are two components rather
      // than one with a `tone`: nothing failed, so nothing interrupts.
      const { container } = render(EmptyState, { props: { title: 'Nothing here yet' } });
      expect(container.querySelector('[role="status"]')).toBeInTheDocument();
      expect(container.querySelector('[role="alert"]')).not.toBeInTheDocument();
    });
  });

  describe('props contract', () => {
    it('omits description, icon and actions entirely when not given', () => {
      const { container } = render(EmptyState, { props: { title: 'Nothing here yet' } });
      expect(container.querySelector('p')).not.toBeInTheDocument();
      // One heading and nothing else: no empty wrappers left behind for the
      // optional parts.
      expect(container.querySelector('[role="status"]')?.children).toHaveLength(1);
    });

    it('renders the description', () => {
      render(EmptyState, { props: { title: 'Nothing here yet', description: 'Add the first.' } });
      expect(screen.getByText('Add the first.')).toBeInTheDocument();
    });

    it('renders the icon above the title and the actions below', () => {
      const { container } = render(EmptyState, {
        props: { title: 'Nothing here yet', icon: snippet('icon'), actions: snippet('action') },
      });
      const panel = container.querySelector('[role="status"]')!;
      expect(panel).toHaveTextContent('icon');
      expect(panel).toHaveTextContent('action');
      const order = [...panel.children].map((el) => el.textContent);
      expect(order[0]).toBe('icon');
      expect(order.at(-1)).toBe('action');
    });

    it('merges the class prop', () => {
      const { container } = render(EmptyState, {
        props: { title: 'Nothing here yet', class: 'extra-class' },
      });
      expect(container.firstElementChild).toHaveClass('extra-class');
    });
  });

  describe('accessibility', () => {
    it('has no axe violations with only a title', async () => {
      const { container } = render(EmptyState, { props: { title: 'Nothing here yet' } });
      expect(await axe(container)).toHaveNoViolations();
    });

    it('has no axe violations with every optional part', async () => {
      const { container } = render(EmptyState, {
        props: {
          title: 'Nothing here yet',
          description: 'Add the first.',
          icon: snippet('icon'),
          actions: snippet('action'),
        },
      });
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
