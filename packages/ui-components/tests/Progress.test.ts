// spec: SPEC.md §6 v0.2.3
// Note: "events contract" and "keyboard interaction" blocks are omitted — Progress is
// non-interactive (consumer-driven value) and has no keyboard surface or event callbacks.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { axe } from 'vitest-axe';
import Progress from '../src/primitives/Progress/Progress.svelte';

afterEach(() => cleanup());

describe('Progress', () => {
  describe('renders with minimum required props', () => {
    it('renders a progressbar', () => {
      render(Progress);
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });
  });

  describe('props contract', () => {
    it('sets aria-valuenow when value is provided', () => {
      render(Progress, { props: { value: 50 } });
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    });

    it('omits aria-valuenow when value is undefined (indeterminate)', () => {
      render(Progress);
      expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    });

    it('clamps value below 0 to 0', () => {
      render(Progress, { props: { value: -10 } });
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    });

    it('clamps value above max to max', () => {
      render(Progress, { props: { value: 150, max: 100 } });
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    });

    it('sets aria-valuemax from max prop', () => {
      render(Progress, { props: { max: 200 } });
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '200');
    });

    it('sets aria-label when ariaLabel is provided', () => {
      render(Progress, { props: { ariaLabel: 'Upload progress', value: 40 } });
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', 'Upload progress');
    });

    it('sets aria-live="polite" by default', () => {
      render(Progress, { props: { value: 50 } });
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-live', 'polite');
    });

    it('omits aria-live when announce="off"', () => {
      render(Progress, { props: { value: 50, announce: 'off' } });
      expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-live');
    });

    it('merges class prop', () => {
      render(Progress, { props: { class: 'custom-class' } });
      expect(screen.getByRole('progressbar')).toHaveClass('custom-class');
    });

    it('applies determinate transform style when value is set', () => {
      render(Progress, { props: { value: 75 } });
      const indicator = screen.getByRole('progressbar').firstElementChild as HTMLElement;
      expect(indicator.style.transform).toBe('translateX(-25%)');
    });

    it('does not apply inline style in indeterminate mode', () => {
      render(Progress);
      const indicator = screen.getByRole('progressbar').firstElementChild as HTMLElement;
      expect(indicator.style.transform).toBe('');
    });
  });

  describe('controlled vs uncontrolled', () => {
    it('starts indeterminate when no value or defaultValue given', () => {
      render(Progress);
      expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    });

    it('uses defaultValue when uncontrolled', () => {
      render(Progress, { props: { defaultValue: 60 } });
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60');
    });

    it('uses value when controlled, ignoring defaultValue', () => {
      render(Progress, { props: { value: 30, defaultValue: 60 } });
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30');
    });
  });

  describe('accessibility', () => {
    it('has no axe violations in indeterminate mode', async () => {
      const { container } = render(Progress, { props: { ariaLabel: 'Loading' } });
      expect(await axe(container)).toHaveNoViolations();
    });

    it('has no axe violations in determinate mode', async () => {
      const { container } = render(Progress, {
        props: { value: 50, ariaLabel: 'Upload progress' },
      });
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
