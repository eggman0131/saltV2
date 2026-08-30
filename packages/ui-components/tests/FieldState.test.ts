// spec: ui-spec-v02.md §8.2, §8.3, §8.4, §8.5 v0.2.18
//
// Pins the two properties of the shared field-state module that reach the DOM,
// for all four primitives that now use it (#929 Phase 4):
//
//   1. **The `useId` prefix each primitive generates.** `createFieldState` takes
//      the prefix as a parameter, so a wrong argument at one of the four call
//      sites silently renames every `id`, `for` and `aria-describedby` that
//      primitive renders. Textarea's `textfield` in particular looks like a
//      copy-paste slip and is not: Textarea has produced `textfield-N` ids since
//      it began sharing `TextField.headless`, and changing it would be a visible
//      DOM change (#929 contract clause 3).
//   2. **Error id before description id**, which is the order a screen reader
//      should meet them in.
//
// Why a new file rather than assertions added to the four existing suites: each
// of them already checks (2), but **self-referentially** — `ids[0]` against the
// error element's own `id` — which is satisfied by any prefix at all. Swapping
// Checkbox's prefix to `check` and Textarea's to `textarea` left
// `Checkbox.test.ts`, `Textarea.test.ts` and every other gate green. Nothing in
// the repository was checking (1). This file is what makes clause 3 mechanical.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Checkbox from '../src/primitives/Checkbox/Checkbox.svelte';
import Switch from '../src/primitives/Switch/Switch.svelte';
import TextField from '../src/primitives/TextField/TextField.svelte';
import Textarea from '../src/primitives/Textarea/Textarea.svelte';

afterEach(() => cleanup());

/** The prefix each primitive must keep generating, and how to reach its control. */
const FIELDS = [
  { name: 'Checkbox', component: Checkbox, prefix: 'checkbox', role: 'checkbox' },
  { name: 'Switch', component: Switch, prefix: 'switch', role: 'switch' },
  { name: 'TextField', component: TextField, prefix: 'textfield', role: null },
  // Not a typo — see the module note above.
  { name: 'Textarea', component: Textarea, prefix: 'textfield', role: null },
] as const;

describe('shared field state', () => {
  it.each(FIELDS)('$name generates $prefix-N ids, in error-then-description order', (f) => {
    render(f.component, {
      target: document.body,
      props: { label: 'x', error: 'Err', description: 'Desc' },
    });
    const control = f.role ? screen.getByRole(f.role) : screen.getByLabelText('x');
    const ids = (control.getAttribute('aria-describedby') ?? '').split(' ');

    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(new RegExp(`^${f.prefix}-\\d+-error$`));
    expect(ids[1]).toMatch(new RegExp(`^${f.prefix}-\\d+-desc$`));
    // Both ids belong to the same field, and both resolve to a real element.
    expect(ids[0]?.replace(/-error$/, '')).toBe(ids[1]?.replace(/-desc$/, ''));
    expect(document.getElementById(ids[0] as string)).toHaveTextContent('Err');
    expect(document.getElementById(ids[1] as string)).toHaveTextContent('Desc');
  });

  it.each(FIELDS)('$name omits aria-describedby when it has neither', (f) => {
    render(f.component, { target: document.body, props: { label: 'x' } });
    const control = f.role ? screen.getByRole(f.role) : screen.getByLabelText('x');
    expect(control).not.toHaveAttribute('aria-describedby');
  });
});
