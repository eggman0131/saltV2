// spec: ui-spec-v12.md §8.30 v0.12
import type { HTMLAttributes } from 'svelte/elements';

/**
 * A drawn object, named (§8.30). One size, no variants, and no `onclick`: the
 * pill is read, never pressed (§8.30.6), so it renders a `<span>` and the
 * passthrough is `HTMLAttributes<HTMLElement>` rather than a button's.
 */
export type PictogramPillProps = {
  /**
   * The object's words — required. A pill with no name is a picture, and a
   * picture on its own is not the content: the words are what a reader gets,
   * and what survives the pictogram kill-switch (§8.30.5).
   */
  label: string;
  /**
   * An ALREADY-RESOLVED pictogram URL, or one of the no-picture states.
   * `CanonIcon`'s tri-state (`null`, the `"hidden"` sentinel, a real URL) plus
   * the caller's own "nothing resolved" — `undefined` — because a vocabulary
   * that has not loaded yet is the normal first paint, not a fault.
   *
   * The component never resolves a label into a picture (§8.30.7): the lookup
   * reads a Firestore-backed vocabulary and belongs to the consuming app.
   */
  thumbnail?: string | null | undefined;
  /**
   * Per-regeneration cache-bust nonce, handed straight to `CanonIcon`
   * (ui-spec-v04 §14.4). `undefined` is in the union rather than implied by `?`
   * so a caller may pass a lookup result that widens to `undefined` under
   * `exactOptionalPropertyTypes`.
   */
  version?: string | number | undefined;
  class?: string;
} & Omit<HTMLAttributes<HTMLElement>, 'class' | 'onclick'> & { onclick?: never };
