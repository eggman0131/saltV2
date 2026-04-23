// spec: SPEC.md §6 + §7 v0.3
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { axe } from 'vitest-axe';
import ToastFixture from './fixtures/ToastFixture.svelte';
import Toast from '../src/primitives/Toast/Toast.svelte';
import ToastClose from '../src/primitives/Toast/ToastClose.svelte';
import ToastAction from '../src/primitives/Toast/ToastAction.svelte';

afterEach(() => cleanup());

describe('Toast', () => {
  // -------------------------------------------------------------------------
  // renders with minimum required props
  // -------------------------------------------------------------------------
  describe('renders with minimum required props', () => {
    it('does not render content when closed (defaultOpen=false)', () => {
      render(ToastFixture, { target: document.body, props: { defaultOpen: false } });
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('renders toast with role="status" for default variant when open', () => {
      render(ToastFixture, { target: document.body, props: { open: true } });
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('renders with title text', () => {
      render(ToastFixture, {
        target: document.body,
        props: { open: true, title: 'Hello toast' },
      });
      expect(screen.getByText('Hello toast')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // props contract
  // -------------------------------------------------------------------------
  describe('props contract', () => {
    it('default variant uses role="status" and aria-live="polite"', () => {
      render(ToastFixture, { target: document.body, props: { open: true, variant: 'default' } });
      const toast = screen.getByRole('status');
      expect(toast).toHaveAttribute('aria-live', 'polite');
    });

    it('destructive variant uses role="alert" and aria-live="assertive"', () => {
      render(ToastFixture, {
        target: document.body,
        props: { open: true, variant: 'destructive' },
      });
      const toast = screen.getByRole('alert');
      expect(toast).toHaveAttribute('aria-live', 'assertive');
      expect(toast).toBeInTheDocument();
    });

    it('applies aria-atomic="true"', () => {
      render(ToastFixture, { target: document.body, props: { open: true } });
      expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'true');
    });

    it('merges class prop on toast root', () => {
      render(Toast, { target: document.body, props: { open: true, class: 'custom-toast' } });
      expect(screen.getByRole('status')).toHaveClass('custom-toast');
    });

    it('renders description when provided', () => {
      render(ToastFixture, {
        target: document.body,
        props: { open: true, description: 'Toast description' },
      });
      expect(screen.getByText('Toast description')).toBeInTheDocument();
    });

    it('renders action button when showAction=true', () => {
      render(ToastFixture, {
        target: document.body,
        props: { open: true, showAction: true },
      });
      expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    });

    it('renders close button when showClose=true', () => {
      render(ToastFixture, {
        target: document.body,
        props: { open: true, showClose: true },
      });
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // events contract
  // -------------------------------------------------------------------------
  describe('events contract', () => {
    it('does not call onOpenChange on initial render', () => {
      const onOpenChange = vi.fn();
      render(ToastFixture, {
        target: document.body,
        props: { open: true, onOpenChange },
      });
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it('calls onOpenChange(false) when close button is clicked', async () => {
      const onOpenChange = vi.fn();
      render(ToastFixture, {
        target: document.body,
        props: { open: true, showClose: true, onOpenChange },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  // -------------------------------------------------------------------------
  // keyboard interaction — APG §6.5
  // -------------------------------------------------------------------------
  describe('keyboard interaction', () => {
    it('toast does not steal focus when rendered', () => {
      const button = document.createElement('button');
      button.textContent = 'trigger';
      document.body.appendChild(button);
      button.focus();
      render(ToastFixture, { target: document.body, props: { open: true } });
      expect(document.activeElement).toBe(button);
      button.remove();
    });

    it('close button is focusable via keyboard', () => {
      render(ToastFixture, { target: document.body, props: { open: true, showClose: true } });
      const closeBtn = screen.getByRole('button', { name: 'Close' });
      closeBtn.focus();
      expect(document.activeElement).toBe(closeBtn);
    });

    it('action button is focusable', () => {
      render(ToastFixture, { target: document.body, props: { open: true, showAction: true } });
      const actionBtn = screen.getByRole('button', { name: 'Undo' });
      actionBtn.focus();
      expect(document.activeElement).toBe(actionBtn);
    });
  });

  // -------------------------------------------------------------------------
  // accessibility — APG §6.5 (Alert / Live Region)
  // -------------------------------------------------------------------------
  describe('accessibility', () => {
    it('default toast has no axe violations', async () => {
      const { container } = render(ToastFixture, {
        target: document.body,
        props: { open: true, title: 'Save successful' },
      });
      expect(await axe(container)).toHaveNoViolations();
    });

    it('destructive toast has no axe violations', async () => {
      const { container } = render(ToastFixture, {
        target: document.body,
        props: { open: true, variant: 'destructive', title: 'Error occurred' },
      });
      expect(await axe(container)).toHaveNoViolations();
    });

    it('ToastAction renders a focusable button element', () => {
      render(ToastAction, {
        target: document.body,
        props: { children: undefined },
      });
      const btn = document.querySelector('button');
      expect(btn).toBeInTheDocument();
      expect(btn?.getAttribute('type')).toBe('button');
    });
  });

  // -------------------------------------------------------------------------
  // composition (compound)
  // -------------------------------------------------------------------------
  describe('composition', () => {
    it('throws when ToastClose is rendered without a Toast root', () => {
      expect(() => render(ToastClose, { target: document.body, props: {} })).toThrow(
        'Toast context not found',
      );
    });
  });

  // -------------------------------------------------------------------------
  // controlled vs uncontrolled
  // -------------------------------------------------------------------------
  describe('controlled vs uncontrolled', () => {
    it('does not show when defaultOpen=false (uncontrolled default)', () => {
      render(ToastFixture, { target: document.body, props: {} });
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('shows when defaultOpen=true (uncontrolled)', () => {
      render(ToastFixture, { target: document.body, props: { defaultOpen: true } });
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('shows when controlled open=true', () => {
      render(ToastFixture, { target: document.body, props: { open: true } });
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('hides when controlled open=false', () => {
      render(ToastFixture, { target: document.body, props: { open: false } });
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('fires onOpenChange(false) on close', () => {
      const onOpenChange = vi.fn();
      render(ToastFixture, {
        target: document.body,
        props: { open: true, showClose: true, onOpenChange },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  // -------------------------------------------------------------------------
  // live region behavior (§7)
  // -------------------------------------------------------------------------
  describe('live region behavior', () => {
    it('default variant has role="status"', () => {
      render(ToastFixture, { target: document.body, props: { open: true, variant: 'default' } });
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('destructive variant has role="alert"', () => {
      render(ToastFixture, {
        target: document.body,
        props: { open: true, variant: 'destructive' },
      });
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('default variant aria-live is polite', () => {
      render(ToastFixture, { target: document.body, props: { open: true, variant: 'default' } });
      expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    });

    it('destructive variant aria-live is assertive', () => {
      render(ToastFixture, {
        target: document.body,
        props: { open: true, variant: 'destructive' },
      });
      expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
    });
  });

  // -------------------------------------------------------------------------
  // auto-dismiss + pause-on-hover (§7)
  // -------------------------------------------------------------------------
  describe('auto-dismiss + pause-on-hover', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('calls onOpenChange(false) after duration elapses', async () => {
      const onOpenChange = vi.fn();
      render(ToastFixture, {
        target: document.body,
        props: { open: true, duration: 3000, onOpenChange },
      });
      expect(onOpenChange).not.toHaveBeenCalled();
      vi.advanceTimersByTime(3000);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('pauses auto-dismiss on mouseenter and resumes on mouseleave', async () => {
      const onOpenChange = vi.fn();
      render(ToastFixture, {
        target: document.body,
        props: { open: true, duration: 2000, onOpenChange },
      });
      const toast = screen.getByRole('status');
      // Advance partway through duration
      vi.advanceTimersByTime(1000);
      // Hover — pause timer
      fireEvent.mouseEnter(toast);
      // Advance past original duration end (should NOT dismiss)
      vi.advanceTimersByTime(2000);
      expect(onOpenChange).not.toHaveBeenCalled();
      // Un-hover — resume timer with remaining ~1000ms
      fireEvent.mouseLeave(toast);
      vi.advanceTimersByTime(1100);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('does not auto-dismiss when duration=0', () => {
      const onOpenChange = vi.fn();
      render(ToastFixture, {
        target: document.body,
        props: { open: true, duration: 0, onOpenChange },
      });
      vi.advanceTimersByTime(30000);
      expect(onOpenChange).not.toHaveBeenCalled();
    });
  });
});
