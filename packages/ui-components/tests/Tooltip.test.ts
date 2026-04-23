// spec: SPEC.md §6 v0.2.3
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import Tooltip from '../src/primitives/Tooltip/Tooltip.svelte';
import TooltipContent from '../src/primitives/Tooltip/TooltipContent.svelte';
import TooltipProvider from '../src/primitives/Tooltip/TooltipProvider.svelte';

afterEach(() => cleanup());

describe('Tooltip', () => {
  describe('renders with minimum required props', () => {
    it('renders TooltipProvider without error', () => {
      const { container } = render(TooltipProvider, { target: document.body, props: {} });
      expect(container).toBeTruthy();
    });

    it('renders Tooltip root without error', () => {
      const { container } = render(Tooltip, { target: document.body, props: {} });
      expect(container).toBeTruthy();
    });
  });

  describe('props contract', () => {
    it('starts closed by default', () => {
      render(Tooltip, { target: document.body, props: {} });
      // Tooltip content is not visible without hover/focus
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('accepts delayDuration prop without error', () => {
      expect(() =>
        render(Tooltip, { target: document.body, props: { delayDuration: 500 } }),
      ).not.toThrow();
    });

    it('accepts disableHoverableContent prop without error', () => {
      expect(() =>
        render(Tooltip, { target: document.body, props: { disableHoverableContent: true } }),
      ).not.toThrow();
    });
  });

  describe('events contract', () => {
    it('does not call onOpenChange before any interaction', () => {
      const onOpenChange = vi.fn();
      render(Tooltip, { target: document.body, props: { onOpenChange } });
      expect(onOpenChange).not.toHaveBeenCalled();
    });
  });

  describe('keyboard interaction', () => {
    it('Escape key does not throw on closed tooltip', async () => {
      render(Tooltip, { target: document.body, props: {} });
      await expect(userEvent.keyboard('{Escape}')).resolves.not.toThrow();
    });
  });

  describe('accessibility', () => {
    it('has no axe violations when tooltip is closed', async () => {
      const { container } = render(Tooltip, { target: document.body, props: {} });
      expect(await axe(container)).toHaveNoViolations();
    });

    it('TooltipProvider has no axe violations', async () => {
      const { container } = render(TooltipProvider, { target: document.body, props: {} });
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  describe('controlled vs uncontrolled', () => {
    it('uses defaultOpen=false by default', () => {
      render(Tooltip, { target: document.body, props: {} });
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });

  describe('composition', () => {
    it('throws when TooltipContent is rendered without a Tooltip root', () => {
      expect(() => render(TooltipContent, { target: document.body, props: {} })).toThrow(
        'Tooltip context not found',
      );
    });
  });
});
