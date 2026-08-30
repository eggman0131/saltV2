// spec: ui-spec-v02.md §8.6 v0.2.18; ui-spec-v03.md §5.2 v0.3.5
//
// The characterisation net for the twelve Dialog and Sheet part components.
//
// Why it exists: until this file, `smoke.test.ts` asserted only that the twelve
// are `toBeDefined()`, and `Dialog.test.ts` / `Sheet.test.ts` render only the
// root and the content — so no gate in the repository rendered any part, and a
// fix landing in `DialogTitle` but not `SheetTitle` was caught by nothing.
//
// What it pins, and why in that shape (#929 Phase 2):
//
//   1. The **literal** tag and class string of each part, per root. A pairwise
//      "Dialog equals Sheet" assertion on its own is self-consistent: it stays
//      green when both copies change together, and after Phase 3 — when the two
//      names resolve to one file — it becomes a tautology. The literal is what
//      keeps this file honest once the fork is gone.
//   2. That the four **shared** parts (Close, Title, Description, Header) render
//      identical markup under both names. That is the whole claim Phase 3 makes.
//   3. That the two **forked** parts differ, and exactly how: `DialogFooter`
//      stacks and reverses on narrow screens where `SheetFooter` does not, and
//      `SheetTrigger` forwards `class` (ui-spec-v03 §5.3.1 — `BottomNav`'s
//      overflow tab needs the handle) where `DialogTrigger` drops it. These two
//      pairs must NOT be consolidated, and this is what says so.
//   4. That `class` merges last through `cn()`, by passing a token that collides
//      with the base and asserting the base token is gone.
//
// It is written against the **unforked** code and Phase 3 does not touch it
// (#941 Track B): a net edited by the change it guards proves only that the
// change is self-consistent.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import type { Component } from 'svelte';
import Fixture from './fixtures/ModalPartFixture.svelte';
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  SheetClose,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '../src/index';

afterEach(() => cleanup());

/** Mount one part inside its root and hand back the element it rendered. */
function mountPart(
  root: 'dialog' | 'sheet',
  part: unknown,
  opts: { class?: string; inContent?: boolean } = {},
): HTMLElement {
  render(Fixture, {
    target: document.body,
    props: {
      root,
      part: part as Component<never>,
      class: opts.class,
      inContent: opts.inContent ?? true,
    },
  });
  const child = screen.getByTestId('part-child');
  expect(child.parentElement).not.toBeNull();
  return child.parentElement as HTMLElement;
}

type SharedCase = {
  name: string;
  dialog: unknown;
  sheet: unknown;
  tag: string;
  /** The full merged class string both names must render, character for character. */
  classes: string;
  /** A token that collides with one in `classes`, to prove `cn()` merges last. */
  override: { pass: string; loses: string };
};

/**
 * The four parts whose two names must render the same thing. Phase 3 deletes the
 * Sheet file and republishes the Dialog one under both names; these rows are the
 * assertion that nothing observable changed when it did.
 */
const SHARED: SharedCase[] = [
  {
    name: 'Close',
    dialog: DialogClose,
    sheet: SheetClose,
    tag: 'BUTTON',
    classes:
      'salt-focus-ring inline-flex items-center justify-center rounded h-9 w-9 p-0 bg-transparent hover:bg-muted hover:text-foreground transition-colors motion-reduce:transition-none',
    override: { pass: 'rounded-full', loses: 'rounded' },
  },
  {
    name: 'Title',
    dialog: DialogTitle,
    sheet: SheetTitle,
    tag: 'DIV',
    classes: 'text-lg font-semibold text-foreground',
    override: { pass: 'text-sm', loses: 'text-lg' },
  },
  {
    name: 'Description',
    dialog: DialogDescription,
    sheet: SheetDescription,
    tag: 'DIV',
    classes: 'text-sm text-muted-foreground',
    override: { pass: 'text-lg', loses: 'text-sm' },
  },
  {
    name: 'Header',
    dialog: DialogHeader,
    sheet: SheetHeader,
    tag: 'DIV',
    classes: 'flex flex-col gap-1.5',
    override: { pass: 'gap-8', loses: 'gap-1.5' },
  },
];

describe('modal parts shared between Dialog and Sheet', () => {
  it.each(SHARED)('$name renders the same tag and class string under both names', (c) => {
    const asDialog = mountPart('dialog', c.dialog);
    expect(asDialog.tagName).toBe(c.tag);
    expect(asDialog.getAttribute('class')).toBe(c.classes);
    cleanup();

    const asSheet = mountPart('sheet', c.sheet);
    expect(asSheet.tagName).toBe(c.tag);
    expect(asSheet.getAttribute('class')).toBe(c.classes);
  });

  it.each(SHARED)('$name renders its children under both names', (c) => {
    expect(mountPart('dialog', c.dialog).textContent).toBe('child');
    cleanup();
    expect(mountPart('sheet', c.sheet).textContent).toBe('child');
  });

  it.each(SHARED)('$name merges the class prop last via cn(), under both names', (c) => {
    for (const [root, part] of [
      ['dialog', c.dialog],
      ['sheet', c.sheet],
    ] as const) {
      const el = mountPart(root, part, { class: c.override.pass });
      const tokens = (el.getAttribute('class') ?? '').split(' ');
      expect(tokens).toContain(c.override.pass);
      expect(tokens).not.toContain(c.override.loses);
      cleanup();
    }
  });
});

/**
 * The two parts that are NOT the same component, and the exact difference in
 * each. `SheetFooter` and `SheetTrigger` stay Sheet's own files — these rows are
 * why, and they go red if anyone consolidates them.
 */
describe('modal parts that deliberately differ between Dialog and Sheet', () => {
  it('Footer: Dialog reverses and stacks on narrow screens, Sheet does not', () => {
    const dialogFooter = mountPart('dialog', DialogFooter);
    expect(dialogFooter.tagName).toBe('DIV');
    expect(dialogFooter.getAttribute('class')).toBe(
      'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
    );
    cleanup();

    const sheetFooter = mountPart('sheet', SheetFooter);
    expect(sheetFooter.tagName).toBe('DIV');
    expect(sheetFooter.getAttribute('class')).toBe('flex justify-end gap-2');
  });

  it('Trigger: SheetTrigger forwards class, DialogTrigger drops it', () => {
    // ui-spec-v03 §5.3.1: the Sheet trigger is the element the layout constrains,
    // so a caller sizing BottomNav's overflow tab has no other handle.
    const dialogTrigger = mountPart('dialog', DialogTrigger, {
      class: 'flex-1',
      inContent: false,
    });
    expect(dialogTrigger.tagName).toBe('BUTTON');
    expect(dialogTrigger.getAttribute('class')).toBeNull();
    cleanup();

    const sheetTrigger = mountPart('sheet', SheetTrigger, { class: 'flex-1', inContent: false });
    expect(sheetTrigger.tagName).toBe('BUTTON');
    expect(sheetTrigger.getAttribute('class')).toBe('flex-1');
  });

  it('Trigger: both render their children', () => {
    expect(mountPart('dialog', DialogTrigger, { inContent: false }).textContent).toBe('child');
    cleanup();
    expect(mountPart('sheet', SheetTrigger, { inContent: false }).textContent).toBe('child');
  });
});
