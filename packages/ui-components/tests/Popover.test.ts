// spec: SPEC.md §6 v0.2.3
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import Popover from '../src/primitives/Popover/Popover.svelte';
import PopoverContent from '../src/primitives/Popover/PopoverContent.svelte';

afterEach(() => cleanup());

describe('Popover', () => {
  describe('renders with minimum required props', () => {
    it('renders without error when closed', () => {
      const { container } = render(Popover, { target: document.body, props: {} });
      expect(container).toBeTruthy();
    });
  });

  describe('props contract', () => {
    it('starts closed by default', () => {
      render(Popover, { target: document.body, props: {} });
      // No popover content visible without a trigger interaction
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('accepts trapFocus prop without error', () => {
      expect(() =>
        render(Popover, { target: document.body, props: { trapFocus: true } }),
      ).not.toThrow();
    });

    it('accepts portal=false without error', () => {
      expect(() =>
        render(Popover, { target: document.body, props: { portal: false } }),
      ).not.toThrow();
    });
  });

  describe('events contract', () => {
    it('does not call onOpenChange before any interaction', () => {
      const onOpenChange = vi.fn();
      render(Popover, { target: document.body, props: { onOpenChange } });
      expect(onOpenChange).not.toHaveBeenCalled();
    });
  });

  describe('keyboard interaction', () => {
    it('Escape key does not throw on closed popover', async () => {
      render(Popover, { target: document.body, props: {} });
      await expect(userEvent.keyboard('{Escape}')).resolves.not.toThrow();
    });
  });

  describe('accessibility', () => {
    it('has no axe violations when closed', async () => {
      const { container } = render(Popover, { target: document.body, props: {} });
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  describe('controlled vs uncontrolled', () => {
    it('uses defaultOpen=false by default', () => {
      render(Popover, { target: document.body, props: {} });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('accepts open=false as controlled prop', () => {
      render(Popover, { target: document.body, props: { open: false } });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('composition', () => {
    it('throws when PopoverContent is rendered without a Popover root', () => {
      expect(() => render(PopoverContent, { target: document.body, props: {} })).toThrow(
        'Popover context not found',
      );
    });
  });
});
