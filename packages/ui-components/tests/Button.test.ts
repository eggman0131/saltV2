// spec: SPEC.md §6 v0.2.3
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { createRawSnippet } from 'svelte';
import Button from '../src/primitives/Button/Button.svelte';

afterEach(() => cleanup());

function snippet(text: string) {
  return createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));
}

describe('Button', () => {
  describe('renders with minimum required props', () => {
    it('renders a button with children', () => {
      render(Button, { props: { children: snippet('Click me') } });
      expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
    });
  });

  describe('props contract', () => {
    it('applies variant classes', () => {
      render(Button, { props: { variant: 'destructive', children: snippet('Delete') } });
      expect(screen.getByRole('button')).toHaveClass('bg-destructive');
    });
    it('merges class prop last', () => {
      render(Button, { props: { class: 'custom-class', children: snippet('x') } });
      expect(screen.getByRole('button')).toHaveClass('custom-class');
    });
    it('sets data-disabled when disabled', () => {
      render(Button, { props: { disabled: true, children: snippet('x') } });
      expect(screen.getByRole('button', { hidden: true })).toHaveAttribute('data-disabled', '');
    });
    it('sets data-loading when loading', () => {
      render(Button, { props: { loading: true, children: snippet('x') } });
      expect(screen.getByRole('button')).toHaveAttribute('data-loading', '');
    });
    it('renders Spinner when loading', () => {
      render(Button, { props: { loading: true, children: snippet('x') } });
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
    it('hides trailing when loading', () => {
      render(Button, {
        props: {
          loading: true,
          children: snippet('x'),
          trailing: snippet('trailing-text'),
        },
      });
      expect(screen.queryByText('trailing-text')).not.toBeInTheDocument();
    });
  });

  describe('events contract', () => {
    it('calls onclick when interactive', async () => {
      const onclick = vi.fn();
      render(Button, { props: { onclick, children: snippet('x') } });
      await userEvent.click(screen.getByRole('button'));
      expect(onclick).toHaveBeenCalledOnce();
    });
    it('suppresses click when loading', async () => {
      const onclick = vi.fn();
      render(Button, { props: { onclick, loading: true, children: snippet('x') } });
      await userEvent.click(screen.getByRole('button'));
      expect(onclick).not.toHaveBeenCalled();
    });
    it('suppresses click when disabled', async () => {
      const onclick = vi.fn();
      render(Button, { props: { onclick, disabled: true, children: snippet('x') } });
      await userEvent.click(screen.getByRole('button', { hidden: true }));
      expect(onclick).not.toHaveBeenCalled();
    });
  });

  describe('keyboard interaction', () => {
    it('activates on Enter', async () => {
      const onclick = vi.fn();
      render(Button, { props: { onclick, children: snippet('x') } });
      screen.getByRole('button').focus();
      await userEvent.keyboard('{Enter}');
      expect(onclick).toHaveBeenCalled();
    });
    it('activates on Space', async () => {
      const onclick = vi.fn();
      render(Button, { props: { onclick, children: snippet('x') } });
      screen.getByRole('button').focus();
      await userEvent.keyboard(' ');
      expect(onclick).toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('has no axe violations', async () => {
      const { container } = render(Button, { props: { children: snippet('x') } });
      expect(await axe(container)).toHaveNoViolations();
    });
    it('requires ariaLabel for icon-only', () => {
      render(Button, { props: { size: 'icon', ariaLabel: 'Settings' } });
      expect(screen.getByRole('button')).toHaveAccessibleName('Settings');
    });
    it('sets aria-busy when loading', () => {
      render(Button, { props: { loading: true, children: snippet('x') } });
      expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
    });
    it('sets aria-disabled when loading', () => {
      render(Button, { props: { loading: true, children: snippet('x') } });
      expect(screen.getByRole('button')).toHaveAttribute('aria-disabled', 'true');
    });
  });
});
