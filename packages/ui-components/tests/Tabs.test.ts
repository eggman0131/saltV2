// spec: ui-spec-v10.md §8.28, §8.29 v0.10
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import TabsFixture from './fixtures/TabsFixture.svelte';

afterEach(() => cleanup());

function tab(name: string): HTMLElement {
  return screen.getByTestId(`tab-${name}`);
}

describe('Tabs', () => {
  describe('roles and wiring', () => {
    it('renders a named tablist of tabs over labelled panels', () => {
      render(TabsFixture, {});
      const list = screen.getByRole('tablist');
      expect(list).toHaveAttribute('aria-label', 'Recipe');
      expect(screen.getAllByRole('tab')).toHaveLength(3);
      // Only the selected panel is in the tree; `hidden` takes the other two out.
      expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    });

    it('selects defaultValue on first render', () => {
      render(TabsFixture, {});
      expect(tab('ingredients')).toHaveAttribute('aria-selected', 'true');
      expect(tab('method')).toHaveAttribute('aria-selected', 'false');
      expect(screen.getByTestId('panel-method')).toHaveAttribute('hidden');
    });

    it('ties each trigger to its panel by aria-controls', () => {
      render(TabsFixture, {});
      const controls = tab('method').getAttribute('aria-controls');
      expect(controls).toBeTruthy();
      expect(screen.getByTestId('panel-method').id).toBe(controls);
    });
  });

  describe('switching panels', () => {
    it('shows the clicked tab’s panel and hides the one it left', async () => {
      render(TabsFixture, {});
      await userEvent.click(tab('method'));
      expect(screen.getByTestId('panel-method')).not.toHaveAttribute('hidden');
      expect(screen.getByTestId('panel-ingredients')).toHaveAttribute('hidden');
    });

    it('reports the new value to the host', async () => {
      const onValueChange = vi.fn();
      render(TabsFixture, { props: { onValueChange } });
      await userEvent.click(tab('method'));
      expect(onValueChange).toHaveBeenCalledWith('method');
    });
  });

  // §8.28.5: the drawer that scrolls to content inside a hidden panel has to be
  // able to bring that panel forward first.
  it('lets the host select a tab programmatically', async () => {
    const { rerender } = render(TabsFixture, { props: { value: 'ingredients' } });
    await rerender({ value: 'notes' });
    expect(tab('notes')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('panel-notes')).not.toHaveAttribute('hidden');
  });

  // §8.28.4: roving focus — one tab in the tab order, the arrows move between
  // them, and activation follows automatically.
  describe('keyboard', () => {
    it('keeps exactly one trigger in the tab order', () => {
      render(TabsFixture, {});
      expect(tab('ingredients')).toHaveAttribute('tabindex', '0');
      expect(tab('method')).toHaveAttribute('tabindex', '-1');
      expect(tab('notes')).toHaveAttribute('tabindex', '-1');
    });

    it('moves and selects with the arrow keys', async () => {
      render(TabsFixture, {});
      tab('ingredients').focus();
      await userEvent.keyboard('{ArrowRight}');
      expect(tab('method')).toHaveFocus();
      expect(tab('method')).toHaveAttribute('aria-selected', 'true');
      await userEvent.keyboard('{ArrowLeft}');
      expect(tab('ingredients')).toHaveFocus();
      expect(tab('ingredients')).toHaveAttribute('aria-selected', 'true');
    });

    it('jumps to the ends with Home and End', async () => {
      render(TabsFixture, {});
      tab('ingredients').focus();
      await userEvent.keyboard('{End}');
      expect(tab('notes')).toHaveFocus();
      await userEvent.keyboard('{Home}');
      expect(tab('ingredients')).toHaveFocus();
    });
  });

  describe('the count', () => {
    it('joins the tab’s accessible name', () => {
      render(TabsFixture, {});
      expect(tab('ingredients')).toHaveAccessibleName('Ingredients 19');
    });

    it('renders zero, and renders nothing when omitted', () => {
      render(TabsFixture, {});
      expect(tab('notes')).toHaveAccessibleName('Notes 0');
      cleanup();
      render(TabsFixture, { props: { counts: false } });
      expect(tab('notes')).toHaveAccessibleName('Notes');
      expect(tab('notes').querySelector('.salt-tabs__count')).toBeNull();
    });
  });

  it('passes data attributes through to every part', () => {
    render(TabsFixture, {});
    expect(screen.getByTestId('tabs')).toBeInTheDocument();
    expect(screen.getByTestId('list')).toBeInTheDocument();
    expect(screen.getByTestId('panel-ingredients')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(TabsFixture, {});
    expect(await axe(container)).toHaveNoViolations();
  });
});
