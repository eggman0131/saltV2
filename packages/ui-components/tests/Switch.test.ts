// spec: SPEC.md §6 v0.2.3
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import Switch from '../src/primitives/Switch/Switch.svelte';

afterEach(() => cleanup());

describe('Switch', () => {
  describe('renders with minimum required props', () => {
    it('renders a switch role', () => {
      render(Switch, { props: { label: 'Dark mode' } });
      expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    it('renders label text', () => {
      render(Switch, { props: { label: 'Dark mode' } });
      expect(screen.getByText('Dark mode')).toBeInTheDocument();
    });
  });

  describe('props contract', () => {
    it('reflects checked state via data-state', () => {
      render(Switch, { props: { label: 'x', checked: true } });
      expect(screen.getByRole('switch')).toHaveAttribute('data-state', 'checked');
    });

    it('reflects unchecked state via data-state', () => {
      render(Switch, { props: { label: 'x', checked: false } });
      expect(screen.getByRole('switch')).toHaveAttribute('data-state', 'unchecked');
    });

    it('applies size class to root — sm', () => {
      const { container } = render(Switch, { props: { label: 'x', size: 'sm' } });
      expect(container.querySelector('.h-4.w-7')).toBeInTheDocument();
    });

    it('applies size class to root — lg', () => {
      const { container } = render(Switch, { props: { label: 'x', size: 'lg' } });
      expect(container.querySelector('.h-6.w-11')).toBeInTheDocument();
    });

    it('thumb uses correct translate for sm checked', () => {
      const { container } = render(Switch, { props: { label: 'x', size: 'sm' } });
      const thumb = container.querySelector('[data-switch-thumb]');
      expect(thumb).toHaveClass('data-[state=checked]:translate-x-3');
    });

    it('thumb uses correct translate for md checked', () => {
      const { container } = render(Switch, { props: { label: 'x', size: 'md' } });
      const thumb = container.querySelector('[data-switch-thumb]');
      expect(thumb).toHaveClass('data-[state=checked]:translate-x-4');
    });

    it('thumb uses correct translate for lg checked', () => {
      const { container } = render(Switch, { props: { label: 'x', size: 'lg' } });
      const thumb = container.querySelector('[data-switch-thumb]');
      expect(thumb).toHaveClass('data-[state=checked]:translate-x-5');
    });

    it('renders description text', () => {
      render(Switch, { props: { label: 'x', description: 'Hint text' } });
      expect(screen.getByText('Hint text')).toBeInTheDocument();
    });

    it('renders error with role="alert"', () => {
      render(Switch, { props: { label: 'x', error: 'Required' } });
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('is disabled when disabled prop set', () => {
      render(Switch, { props: { label: 'x', disabled: true } });
      expect(screen.getByRole('switch')).toBeDisabled();
    });
  });

  describe('events contract', () => {
    it('calls onCheckedChange when clicked', async () => {
      const onCheckedChange = vi.fn();
      render(Switch, { props: { label: 'x', onCheckedChange } });
      await userEvent.click(screen.getByRole('switch'));
      expect(onCheckedChange).toHaveBeenCalledOnce();
      expect(onCheckedChange).toHaveBeenCalledWith(true);
    });

    it('toggles from checked to unchecked', async () => {
      const onCheckedChange = vi.fn();
      render(Switch, { props: { label: 'x', checked: true, onCheckedChange } });
      await userEvent.click(screen.getByRole('switch'));
      expect(onCheckedChange).toHaveBeenCalledWith(false);
    });

    it('does not call onCheckedChange when disabled', async () => {
      const onCheckedChange = vi.fn();
      render(Switch, { props: { label: 'x', disabled: true, onCheckedChange } });
      await userEvent.click(screen.getByRole('switch'));
      expect(onCheckedChange).not.toHaveBeenCalled();
    });
  });

  describe('keyboard interaction', () => {
    it('toggles on Space key', async () => {
      const onCheckedChange = vi.fn();
      render(Switch, { props: { label: 'x', onCheckedChange } });
      screen.getByRole('switch').focus();
      await userEvent.keyboard(' ');
      expect(onCheckedChange).toHaveBeenCalledWith(true);
    });

    it('toggles on Enter key', async () => {
      const onCheckedChange = vi.fn();
      render(Switch, { props: { label: 'x', onCheckedChange } });
      screen.getByRole('switch').focus();
      await userEvent.keyboard('{Enter}');
      expect(onCheckedChange).toHaveBeenCalledWith(true);
    });
  });

  describe('accessibility', () => {
    it('has no axe violations when unchecked', async () => {
      const { container } = render(Switch, { props: { label: 'Dark mode' } });
      expect(await axe(container)).toHaveNoViolations();
    });

    it('has no axe violations when checked', async () => {
      const { container } = render(Switch, {
        props: { label: 'Dark mode', checked: true },
      });
      expect(await axe(container)).toHaveNoViolations();
    });

    it('error id is prepended to aria-describedby', () => {
      render(Switch, {
        props: { label: 'x', error: 'Err', description: 'Desc' },
      });
      const switchEl = screen.getByRole('switch');
      const ids = (switchEl.getAttribute('aria-describedby') ?? '').split(' ');
      const errorEl = screen.getByRole('alert');
      const descEl = screen.getByText('Desc');
      expect(ids[0]).toBe(errorEl.id);
      expect(ids[1]).toBe(descEl.id);
    });
  });

  describe('controlled vs uncontrolled', () => {
    it('uses defaultChecked when uncontrolled', () => {
      render(Switch, { props: { label: 'x', defaultChecked: true } });
      expect(screen.getByRole('switch')).toHaveAttribute('data-state', 'checked');
    });

    it('ignores defaultChecked when checked is provided', () => {
      render(Switch, { props: { label: 'x', checked: false, defaultChecked: true } });
      expect(screen.getByRole('switch')).toHaveAttribute('data-state', 'unchecked');
    });

    it('fires onCheckedChange and updates on interaction', async () => {
      const onCheckedChange = vi.fn();
      render(Switch, { props: { label: 'x', onCheckedChange } });
      await userEvent.click(screen.getByRole('switch'));
      expect(onCheckedChange).toHaveBeenCalledWith(true);
    });
  });
});
