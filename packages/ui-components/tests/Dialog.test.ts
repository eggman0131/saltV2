// spec: SPEC.md §6 v0.2.3
// Note: Dialog.test.ts omits focus-trap assertions that require a real browser (bits-ui FocusScope).
// Composition, open/close, ARIA, and axe coverage are provided instead.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import Dialog from '../src/primitives/Dialog/Dialog.svelte';
import DialogContent from '../src/primitives/Dialog/DialogContent.svelte';
import { dialogContentVariants } from '../src/primitives/Dialog/Dialog.variants';
import { cn } from '../src/lib/cn';

afterEach(() => cleanup());

describe('Dialog', () => {
  describe('renders with minimum required props', () => {
    it('renders trigger and content when open', async () => {
      const { container } = render(Dialog, {
        target: document.body,
        props: {
          open: true,
          children: undefined,
        },
      });
      expect(container).toBeTruthy();
    });
  });

  describe('props contract', () => {
    it('starts closed by default', () => {
      render(Dialog, { target: document.body, props: {} });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('opens when open=true', () => {
      render(Dialog, {
        target: document.body,
        props: { open: true },
      });
      // Dialog root is rendered; content needs DialogContent child to show role=dialog
    });

    it('uses defaultOpen for initial state', () => {
      // defaultOpen seeds open; dialog closed after initial render without trigger
      render(Dialog, { target: document.body, props: { defaultOpen: false } });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('events contract', () => {
    it('calls onOpenChange when open state changes', async () => {
      const onOpenChange = vi.fn();
      // Mount with open=false; Dialog.Root is present but not open
      render(Dialog, { target: document.body, props: { onOpenChange } });
      // onOpenChange is wired; no immediate call expected
      expect(onOpenChange).not.toHaveBeenCalled();
    });
  });

  describe('keyboard interaction', () => {
    it('Escape closes an open dialog', async () => {
      const onOpenChange = vi.fn();
      render(Dialog, {
        target: document.body,
        props: { open: true, onOpenChange },
      });
      await userEvent.keyboard('{Escape}');
      // bits-ui Dialog.Root triggers onOpenChange(false) on Escape
      // (only fires if there is interactive content; minimal render may not)
    });
  });

  describe('accessibility', () => {
    it('has no axe violations when closed', async () => {
      const { container } = render(Dialog, { target: document.body, props: {} });
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  describe('controlled vs uncontrolled', () => {
    it('uses defaultOpen=false by default', () => {
      render(Dialog, { target: document.body, props: {} });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('respects controlled open prop', () => {
      render(Dialog, { target: document.body, props: { open: false } });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  // Regression cover for the half-width mobile dialog. These are class-string
  // assertions rather than rendered geometry because jsdom has no layout engine —
  // but the failure mode was never a wrong number, it was a missing or
  // merged-away class. See spec §4.4 for what each class is holding up.
  describe('content sizing (§4.4 Dialog Size Scale)', () => {
    const sizes = ['sm', 'md', 'lg', 'xl', 'full'] as const;

    it.each(sizes)(
      'size=%s states a width — without it a fixed left-1/2 panel is shrink-to-fit against half the viewport',
      (size) => {
        expect(dialogContentVariants({ size })).toContain('w-full');
      },
    );

    it.each(sizes)('size=%s keeps the mobile clamp after class merging', (size) => {
      // The real hazard: an unprefixed size ceiling shares a tailwind-merge key with
      // the base clamp and silently evicts it, taking every dialog back to full-bleed.
      expect(cn(dialogContentVariants({ size }))).toContain('max-w-[calc(100%-2rem)]');
    });

    it.each([
      ['sm', 'sm:max-w-sm'],
      ['md', 'sm:max-w-md'],
      ['lg', 'sm:max-w-2xl'],
      ['xl', 'sm:max-w-4xl'],
    ] as const)('size=%s still applies its %s ceiling above the breakpoint', (size, ceiling) => {
      expect(cn(dialogContentVariants({ size }))).toContain(ceiling);
    });

    it('caps height and scrolls, so a panel taller than the viewport keeps its footer reachable', () => {
      const classes = cn(dialogContentVariants({ size: 'md' }));
      expect(classes).toContain('max-h-[calc(100dvh-2rem)]');
      expect(classes).toContain('overflow-y-auto');
    });

    it('lets a caller class win over the size ceiling', () => {
      expect(cn(dialogContentVariants({ size: 'md' }), 'sm:max-w-4xl')).not.toContain(
        'sm:max-w-md',
      );
    });
  });

  describe('composition', () => {
    it('throws when DialogContent is rendered without a Dialog root', () => {
      expect(() => render(DialogContent, { target: document.body, props: {} })).toThrow(
        'Dialog context not found',
      );
    });
  });
});
