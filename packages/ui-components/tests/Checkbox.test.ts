// spec: SPEC.md §6 v0.2.3
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import Checkbox from '../src/primitives/Checkbox/Checkbox.svelte';

afterEach(() => cleanup());

describe('Checkbox', () => {
  describe('renders with minimum required props', () => {
    it('renders a checkbox role', () => {
      render(Checkbox, { props: { label: 'Accept terms' } });
      expect(screen.getByRole('checkbox')).toBeInTheDocument();
    });

    it('renders label text', () => {
      render(Checkbox, { props: { label: 'Accept terms' } });
      expect(screen.getByText('Accept terms')).toBeInTheDocument();
    });
  });

  describe('props contract', () => {
    it('applies size class — sm', () => {
      const { container } = render(Checkbox, { props: { label: 'x', size: 'sm' } });
      expect(container.querySelector('.h-3\\.5')).toBeInTheDocument();
    });

    it('applies size class — lg', () => {
      const { container } = render(Checkbox, { props: { label: 'x', size: 'lg' } });
      expect(container.querySelector('.h-5')).toBeInTheDocument();
    });

    it('reflects checked state via data-state', () => {
      render(Checkbox, { props: { label: 'x', checked: true } });
      expect(screen.getByRole('checkbox')).toHaveAttribute('data-state', 'checked');
    });

    it('reflects unchecked state via data-state', () => {
      render(Checkbox, { props: { label: 'x', checked: false } });
      expect(screen.getByRole('checkbox')).toHaveAttribute('data-state', 'unchecked');
    });

    it('reflects indeterminate state via data-state', () => {
      render(Checkbox, { props: { label: 'x', checked: 'indeterminate' } });
      expect(screen.getByRole('checkbox')).toHaveAttribute('data-state', 'indeterminate');
    });

    it('renders error with role="alert"', () => {
      render(Checkbox, { props: { label: 'x', error: 'Required' } });
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('renders description text', () => {
      render(Checkbox, { props: { label: 'x', description: 'Optional' } });
      expect(screen.getByText('Optional')).toBeInTheDocument();
    });

    it('is disabled when disabled prop set', () => {
      render(Checkbox, { props: { label: 'x', disabled: true } });
      expect(screen.getByRole('checkbox')).toBeDisabled();
    });
  });

  describe('events contract', () => {
    it('calls onCheckedChange when clicked', async () => {
      const onCheckedChange = vi.fn();
      render(Checkbox, { props: { label: 'x', onCheckedChange } });
      await userEvent.click(screen.getByRole('checkbox'));
      expect(onCheckedChange).toHaveBeenCalledOnce();
      expect(onCheckedChange).toHaveBeenCalledWith(true);
    });

    it('toggles from checked to unchecked', async () => {
      const onCheckedChange = vi.fn();
      render(Checkbox, { props: { label: 'x', checked: true, onCheckedChange } });
      await userEvent.click(screen.getByRole('checkbox'));
      expect(onCheckedChange).toHaveBeenCalledWith(false);
    });

    it('does not call onCheckedChange when disabled', async () => {
      const onCheckedChange = vi.fn();
      render(Checkbox, { props: { label: 'x', disabled: true, onCheckedChange } });
      await userEvent.click(screen.getByRole('checkbox'));
      expect(onCheckedChange).not.toHaveBeenCalled();
    });
  });

  describe('keyboard interaction', () => {
    it('toggles on Space key', async () => {
      const onCheckedChange = vi.fn();
      render(Checkbox, { props: { label: 'x', onCheckedChange } });
      screen.getByRole('checkbox').focus();
      await userEvent.keyboard(' ');
      expect(onCheckedChange).toHaveBeenCalledWith(true);
    });

    it('Space toggles between only checked/unchecked when indeterminate (never cycles back to indeterminate)', async () => {
      const onCheckedChange = vi.fn();
      render(Checkbox, { props: { label: 'x', checked: 'indeterminate', onCheckedChange } });
      screen.getByRole('checkbox').focus();
      await userEvent.keyboard(' ');
      const calledWith = onCheckedChange.mock.calls[0][0];
      expect(calledWith).toBe(true);
    });
  });

  describe('accessibility', () => {
    it('has no axe violations when unchecked', async () => {
      const { container } = render(Checkbox, { props: { label: 'Accept terms' } });
      expect(await axe(container)).toHaveNoViolations();
    });

    it('has no axe violations when checked', async () => {
      const { container } = render(Checkbox, {
        props: { label: 'Accept terms', checked: true },
      });
      expect(await axe(container)).toHaveNoViolations();
    });

    it('error id is prepended to aria-describedby', () => {
      render(Checkbox, {
        props: { label: 'x', error: 'Err', description: 'Desc' },
      });
      const checkbox = screen.getByRole('checkbox');
      const ids = (checkbox.getAttribute('aria-describedby') ?? '').split(' ');
      const errorEl = screen.getByRole('alert');
      const descEl = screen.getByText('Desc');
      expect(ids[0]).toBe(errorEl.id);
      expect(ids[1]).toBe(descEl.id);
    });
  });

  describe('controlled vs uncontrolled', () => {
    it('uses defaultChecked when uncontrolled', () => {
      render(Checkbox, { props: { label: 'x', defaultChecked: true } });
      expect(screen.getByRole('checkbox')).toHaveAttribute('data-state', 'checked');
    });

    it('ignores defaultChecked when checked is provided', () => {
      render(Checkbox, { props: { label: 'x', checked: false, defaultChecked: true } });
      expect(screen.getByRole('checkbox')).toHaveAttribute('data-state', 'unchecked');
    });

    it('fires onCheckedChange and updates on interaction', async () => {
      const onCheckedChange = vi.fn();
      render(Checkbox, { props: { label: 'x', onCheckedChange } });
      await userEvent.click(screen.getByRole('checkbox'));
      expect(onCheckedChange).toHaveBeenCalledWith(true);
    });
  });
});
