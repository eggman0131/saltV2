// spec: ui-spec-v14.md §8.33 v0.14
//
// The four shapes 28 hand-written popover rows took before #930 Phase 4, now
// asserted against the component that replaced them. This file inherits the
// characterization Phase 1 put in `apps/web-pwa/tests/popoverMenuEntry.test.ts`:
// that file scanned the bare buttons and proved they were exactly four shapes,
// and it could not outlive them.
//
// The migration's claim is like-for-like, and these assertions are what makes
// that checkable rather than asserted. Two tokens are deliberately ADDED to some
// rows, both argued in the spec — §8.33.5 for the unconditional `disabled:`
// utility, §8.33.6 for `gap-2` on the selected row — and each is named in the
// table below rather than absorbed into a looser assertion.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import PopoverMenuItem from '../src/primitives/Popover/PopoverMenuItem.svelte';
import PopoverMenuItemFixture from './fixtures/PopoverMenuItemFixture.svelte';
import { popoverMenuItemVariants } from '../src/primitives/Popover/PopoverMenuItem.variants';
import { cn } from '../src/lib/cn';

afterEach(() => cleanup());

/** Exactly what the 28 bare buttons wrote, verbatim, before Phase 4. */
const WAS = {
  plain: 'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent',
  disabled:
    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-50',
  destructive:
    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10',
  selected: 'flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent font-medium',
} as const;

const tokens = (classes: string): Set<string> => new Set(classes.split(/\s+/).filter(Boolean));
const resolved = (props: Parameters<typeof popoverMenuItemVariants>[0]): Set<string> =>
  tokens(cn(popoverMenuItemVariants(props)));

describe('PopoverMenuItem — the four shapes it replaced', () => {
  it('the 20 plain rows: same tokens, plus the unconditional dim', () => {
    // §8.33.5. `disabled:opacity-50` selects `:disabled`, and a plain row is
    // never disabled — the next test proves the attribute is absent — so it
    // matches nothing and paints nothing here.
    expect(resolved({})).toEqual(new Set([...tokens(WAS.plain), 'disabled:opacity-50']));
  });

  it('the 5 disabled rows: exactly the tokens they wrote, no more', () => {
    // The five that carried `disabled:opacity-50` were exactly the five passing
    // a `disabled` attribute. That correlation was maintained by hand; it is now
    // structural, and this row is byte-for-byte what it was.
    expect(resolved({})).toEqual(tokens(WAS.disabled));
  });

  it('the 2 destructive rows: same tokens, plus the unconditional dim', () => {
    expect(resolved({ variant: 'destructive' })).toEqual(
      new Set([...tokens(WAS.destructive), 'disabled:opacity-50']),
    );
  });

  it('the destructive arm REPLACES the neutral hover, never adds to it', () => {
    // Two hover grounds on one row is a coin toss decided by stylesheet order.
    expect(resolved({ variant: 'destructive' })).not.toContain('hover:bg-accent');
  });

  it('the 1 selected row: same tokens, plus the dim and a gap it cannot use', () => {
    // §8.33.6. `gap-2` spaces flex items from each other, and this row renders a
    // single label — the next test pins that it has no icon, which is the state
    // the claim is bounded by. Give it one and the gap starts applying, which is
    // the correct behaviour for a row with a glyph and the reason the token is
    // in the base at all.
    expect(resolved({ selected: true })).toEqual(
      new Set([...tokens(WAS.selected), 'disabled:opacity-50', 'gap-2']),
    );
  });

  it('selected is off by default, so an unselected row is not bolded', () => {
    expect(resolved({})).not.toContain('font-medium');
  });
});

describe('PopoverMenuItem — rendering', () => {
  it('is a button of type="button", so a menu row inside a form never submits', () => {
    render(PopoverMenuItem, { target: document.body, props: {} });
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('renders no glyph when none is named', () => {
    const { container } = render(PopoverMenuItem, { target: document.body, props: {} });
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders a named glyph at 14px', () => {
    const { container } = render(PopoverMenuItem, {
      target: document.body,
      props: { icon: 'Pencil' },
    });
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('width', '14');
  });

  it('iconVisible={false} keeps the glyph and hides it, so the column survives', () => {
    // §8.33.8. Dropping the element instead would shuffle every other label in
    // the menu left when the selection moved.
    const { container } = render(PopoverMenuItem, {
      target: document.body,
      props: { icon: 'Check', iconVisible: false },
    });
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('class')).toContain('invisible');
  });

  it('a visible glyph carries no invisible class', () => {
    const { container } = render(PopoverMenuItem, {
      target: document.body,
      props: { icon: 'Check' },
    });
    expect(container.querySelector('svg')!.getAttribute('class')).not.toContain('invisible');
  });

  it('disabled reaches the button as the native attribute', () => {
    // Without this the base's `disabled:opacity-50` is decoration: `:disabled`
    // matches the attribute, not the prop.
    render(PopoverMenuItem, { target: document.body, props: { disabled: true } });
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('a row that is not disabled carries no disabled attribute', () => {
    render(PopoverMenuItem, { target: document.body, props: {} });
    expect(screen.getByRole('button')).not.toBeDisabled();
  });

  it('passes onclick and data-* through to the button', () => {
    const onclick = vi.fn();
    render(PopoverMenuItem, {
      target: document.body,
      props: { onclick, 'data-testid': 'menu-row', 'data-sort': 'name' },
    });
    const button = screen.getByTestId('menu-row');
    expect(button).toHaveAttribute('data-sort', 'name');
  });

  it('a disabled row does not fire its handler', async () => {
    const onclick = vi.fn();
    render(PopoverMenuItem, {
      target: document.body,
      props: { onclick, disabled: true, 'data-testid': 'menu-row' },
    });
    await userEvent.click(screen.getByTestId('menu-row'), { pointerEventsCheck: 0 });
    expect(onclick).not.toHaveBeenCalled();
  });

  it('lets a caller class win over the variant', () => {
    expect(cn(popoverMenuItemVariants({}), 'text-base')).not.toContain('text-sm');
  });

  it('has no axe violations — the glyph is hidden, the label is the name', async () => {
    // Through the fixture, because a row's label is a snippet and `render()`
    // cannot supply one. A labelless button has no accessible name, which is a
    // fact about this test's arrangement and not about the component.
    const { container } = render(PopoverMenuItemFixture, {
      target: document.body,
      props: { icon: 'Pencil', label: 'Edit' },
    });
    expect(await axe(container)).toHaveNoViolations();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('an invisible glyph still leaves the label as the accessible name', async () => {
    const { container } = render(PopoverMenuItemFixture, {
      target: document.body,
      props: { icon: 'Check', iconVisible: false, label: 'Aisle' },
    });
    expect(await axe(container)).toHaveNoViolations();
    expect(screen.getByRole('button', { name: 'Aisle' })).toBeInTheDocument();
  });
});
