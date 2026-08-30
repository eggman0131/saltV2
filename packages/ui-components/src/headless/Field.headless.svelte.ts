// spec: ui-spec-v02.md §8.2, §8.3, §8.4, §8.5 v0.2.18
/**
 * The field state every labelled input primitive needs: a stable id, the two
 * derived ids for its error and description, and the `aria-describedby` those
 * compose into.
 *
 * One module, four primitives. TextField, Textarea, Checkbox and Switch each
 * carried a private copy of this until #929 — identical in full, differing only
 * in the `useId` prefix and the two exported names — so an `aria-describedby`
 * fix landed in one and missed three. `ui-spec-v02.md` §3.1 sanctions the shared
 * headless module; the older "(Textarea reuses TextField.headless)" note was the
 * same practice recorded for one pair.
 *
 * **`prefix` is a parameter, not a constant, and its value is observable.**
 * Every generated id reaches the DOM as `id`/`for`/`aria-describedby`, so the
 * four callers must keep the prefixes they generate today: `checkbox`, `switch`,
 * `textfield` — and Textarea passes `textfield` too, because that is what it has
 * always produced through `createTextFieldState`.
 */
import { useId } from '../lib/useId';

export type FieldState = {
  readonly id: string;
  readonly descId: string;
  readonly errorId: string;
  readonly hasError: boolean;
  readonly hasDescription: boolean;
  readonly describedBy: string | undefined;
};

export function createFieldState(opts: {
  /** `useId` prefix. Observable in the DOM — see the module note above. */
  prefix: string;
  id: () => string | undefined;
  error: () => string | undefined;
  description: () => string | undefined;
}): FieldState {
  const generatedId = useId(opts.prefix);
  return {
    get id() {
      return opts.id() ?? generatedId;
    },
    get descId() {
      return `${this.id}-desc`;
    },
    get errorId() {
      return `${this.id}-error`;
    },
    get hasError() {
      return !!opts.error();
    },
    get hasDescription() {
      return !!opts.description();
    },
    get describedBy() {
      // Error before description: a screen reader should reach the problem
      // before the hint. Pinned by all four primitives' suites.
      const ids: string[] = [];
      if (this.hasError) ids.push(this.errorId);
      if (this.hasDescription) ids.push(this.descId);
      return ids.length ? ids.join(' ') : undefined;
    },
  };
}
