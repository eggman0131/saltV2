// spec: SPEC.md §6, §8.1 v0.2.7
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { createRawSnippet, tick } from 'svelte';
import Button from '../src/primitives/Button/Button.svelte';
import { PRESS_FLOOR_MS } from '../src/headless/Button.headless.svelte';

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
      expect(screen.getByRole('button')).toHaveClass('salt-button--destructive');
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

  // The press treatment is half CSS (`transform`, which jsdom neither computes
  // nor animates) and half JS: the minimum hold that keeps a too-quick click
  // visible. Only the JS half is observable here, and it is observable exactly
  // where the CSS reads it — the `data-pressed` attribute.
  describe('press feedback', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function renderButton(props: Record<string, unknown> = {}) {
      render(Button, { props: { children: snippet('x'), ...props } });
      return screen.getByRole('button', { hidden: true });
    }

    it('holds the press for the floor when the tap is quicker than it', async () => {
      const btn = renderButton();

      await fireEvent.pointerDown(btn);
      expect(btn).toHaveAttribute('data-pressed', '');

      // Released almost immediately — the press must NOT vanish with it.
      await fireEvent.pointerUp(btn);
      expect(btn).toHaveAttribute('data-pressed', '');

      vi.advanceTimersByTime(PRESS_FLOOR_MS - 1);
      await tick();
      expect(btn).toHaveAttribute('data-pressed', '');

      vi.advanceTimersByTime(1);
      await tick();
      expect(btn).not.toHaveAttribute('data-pressed');
    });

    it('stays pressed for as long as the button is held, then lets go at once', async () => {
      const btn = renderButton();

      await fireEvent.pointerDown(btn);
      vi.advanceTimersByTime(PRESS_FLOOR_MS * 5);
      await tick();
      expect(btn).toHaveAttribute('data-pressed', '');

      // Floor already served: the release is immediate, not floor-delayed again.
      await fireEvent.pointerUp(btn);
      expect(btn).not.toHaveAttribute('data-pressed');
    });

    it('releases a press that ends off the button', async () => {
      const btn = renderButton();

      await fireEvent.pointerDown(btn);
      await fireEvent.pointerLeave(btn);
      vi.advanceTimersByTime(PRESS_FLOOR_MS);
      await tick();
      expect(btn).not.toHaveAttribute('data-pressed');
    });

    it('releases a cancelled press (scroll takes over the gesture)', async () => {
      const btn = renderButton();

      await fireEvent.pointerDown(btn);
      await fireEvent.pointerCancel(btn);
      vi.advanceTimersByTime(PRESS_FLOOR_MS);
      await tick();
      expect(btn).not.toHaveAttribute('data-pressed');
    });

    it('does not press while loading', async () => {
      const btn = renderButton({ loading: true });

      await fireEvent.pointerDown(btn);
      expect(btn).not.toHaveAttribute('data-pressed');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('does not press while disabled', async () => {
      const btn = renderButton({ disabled: true });

      await fireEvent.pointerDown(btn);
      expect(btn).not.toHaveAttribute('data-pressed');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('presses on keyboard activation and honours the same floor', async () => {
      const btn = renderButton();
      btn.focus();

      await fireEvent.keyDown(btn, { key: 'Enter' });
      expect(btn).toHaveAttribute('data-pressed', '');

      await fireEvent.keyUp(btn, { key: 'Enter' });
      expect(btn).toHaveAttribute('data-pressed', '');

      vi.advanceTimersByTime(PRESS_FLOOR_MS);
      await tick();
      expect(btn).not.toHaveAttribute('data-pressed');
    });

    it('does not let key auto-repeat extend the press', async () => {
      const btn = renderButton();
      btn.focus();

      await fireEvent.keyDown(btn, { key: ' ' });
      vi.advanceTimersByTime(PRESS_FLOOR_MS - 20);
      // A held Space repeats keydown; the floor must not restart with it.
      await fireEvent.keyDown(btn, { key: ' ', repeat: true });
      await fireEvent.keyUp(btn, { key: ' ' });

      vi.advanceTimersByTime(20);
      await tick();
      expect(btn).not.toHaveAttribute('data-pressed');
    });

    it('ignores a secondary mouse button', async () => {
      const btn = renderButton();

      await fireEvent.pointerDown(btn, { button: 2 });
      expect(btn).not.toHaveAttribute('data-pressed');
    });

    it('leaves click and a consumer-supplied pointer handler alone', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const onclick = vi.fn();
      const onpointerdown = vi.fn();
      render(Button, { props: { onclick, onpointerdown, children: snippet('x') } });

      await user.click(screen.getByRole('button'));

      expect(onclick).toHaveBeenCalledOnce();
      // The press wiring listens on pointerdown too — it must not swallow the
      // consumer's own handler.
      expect(onpointerdown).toHaveBeenCalledOnce();
    });

    it('leaves no timer behind when the button unmounts mid-press', async () => {
      const btn = renderButton();

      await fireEvent.pointerDown(btn);
      cleanup();

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('press feedback — reduced motion', () => {
    const realMatchMedia = window.matchMedia;

    beforeEach(() => {
      vi.useFakeTimers();
      window.matchMedia = ((query: string) => ({
        media: query,
        matches: query.includes('prefers-reduced-motion'),
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
    });

    afterEach(() => {
      window.matchMedia = realMatchMedia;
      vi.useRealTimers();
    });

    it('still honours the floor — the shade is what it is holding on', async () => {
      render(Button, { props: { children: snippet('x') } });
      const btn = screen.getByRole('button');

      await fireEvent.pointerDown(btn);
      // The "no movement" half is entirely the CSS's job (salt.css gates only
      // the transform on `prefers-reduced-motion: no-preference`). The pressed
      // SHADE lives outside that gate, so under the preference `data-pressed`
      // still renders something — and therefore still needs the floor, or a tap
      // shorter than a frame would flash colour too briefly to register.
      expect(btn).toHaveAttribute('data-pressed', '');

      await fireEvent.pointerUp(btn);
      expect(btn).toHaveAttribute('data-pressed', '');

      vi.advanceTimersByTime(PRESS_FLOOR_MS - 1);
      await tick();
      expect(btn).toHaveAttribute('data-pressed', '');

      vi.advanceTimersByTime(1);
      await tick();
      expect(btn).not.toHaveAttribute('data-pressed');
    });

    it('leaves no timer behind on unmount', async () => {
      render(Button, { props: { children: snippet('x') } });

      await fireEvent.pointerDown(screen.getByRole('button'));
      cleanup();

      expect(vi.getTimerCount()).toBe(0);
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
