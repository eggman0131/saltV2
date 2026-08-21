// spec: ui-spec-v09.md §8.26 v0.9
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import DisclosureFixture from './fixtures/DisclosureFixture.svelte';

afterEach(() => cleanup());

function trigger(): HTMLElement {
  return screen.getByTestId('trigger');
}

function chevron(): SVGElement {
  const svg = trigger().querySelector('svg');
  if (!svg) throw new Error('no chevron rendered');
  return svg;
}

describe('DisclosureTrigger', () => {
  it('is a type="button" carrying aria-expanded, both states', () => {
    render(DisclosureFixture, { props: { expanded: false } });
    expect(trigger()).toHaveAttribute('type', 'button');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    cleanup();
    render(DisclosureFixture, { props: { expanded: true } });
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
  });

  // §8.26.4 — aria-expanded alone is the disclosure contract; an id would have
  // to be minted and threaded for no announced benefit.
  it('sets no aria-controls', () => {
    render(DisclosureFixture, { props: { expanded: true } });
    expect(trigger()).not.toHaveAttribute('aria-controls');
  });

  it('forwards onclick', async () => {
    const onclick = vi.fn();
    render(DisclosureFixture, { props: { expanded: false, onclick } });
    await userEvent.click(trigger());
    expect(onclick).toHaveBeenCalledTimes(1);
  });

  // §8.26.3 — the trigger ships no layout of its own; the caller's class is all
  // there is. The shopping row needs `flex-1 min-w-0 text-left` and nothing else.
  it('carries only the caller class', () => {
    render(DisclosureFixture, { props: { expanded: false, class: 'min-w-0 flex-1 text-left' } });
    expect(trigger().className).toBe('min-w-0 flex-1 text-left');
  });
});

describe('DisclosureChevron', () => {
  it('points down when open and right when closed', () => {
    render(DisclosureFixture, { props: { expanded: true } });
    const open = chevron().innerHTML;
    cleanup();
    render(DisclosureFixture, { props: { expanded: false } });
    expect(chevron().innerHTML).not.toBe(open);
  });

  it('takes the size it is given', () => {
    render(DisclosureFixture, { props: { expanded: false, chevronSize: 12 } });
    expect(chevron().getAttribute('width')).toBe('12');
  });

  it('defaults to the section-header size', () => {
    render(DisclosureFixture, { props: { expanded: false } });
    expect(chevron().getAttribute('width')).toBe('14');
  });
});
