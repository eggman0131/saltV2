// spec: ui-spec-v02.md §2.5 v0.2.19
import { createContext } from '../lib/context';

/**
 * The live layer that a floating surface opened *inside* a modal should portal
 * into.
 *
 * A modal `Dialog`/`Sheet` makes the rest of the page inert by putting
 * `pointer-events: none` on `<body>`. A dropdown portalled to `<body>` from
 * inside one therefore renders but is completely unclickable — and, sharing the
 * root stacking context, it also has to outrank `z-dialog` (50) just to be seen,
 * which is a rung the ladder in §4.1 does not have. Portalling into the modal's
 * own content element answers both: the listbox is inside the live layer, and
 * its rung becomes local to that stacking context so `z-popover` is correct.
 *
 * `DialogContent` and `SheetContent` publish their content element here;
 * `SelectContent` and `ComboboxContent` read it and fall back to `<body>` when
 * there is no modal above them. `el` is a getter because the element does not
 * exist until after mount.
 */
export type PortalContainerState = {
  readonly el: HTMLElement | null;
};

export const PORTAL_CONTAINER_CONTEXT = createContext<PortalContainerState>('PortalContainer');

/**
 * Where a floating surface's wrapper should be appended.
 *
 * `undefined` — the prop default — means "the enclosing modal, else `<body>`".
 * An explicit selector/element still wins (the host knows something we don't),
 * and `false` opts out of portalling entirely. Returns `null` for that case.
 */
export function resolvePortalTarget(
  portal: HTMLElement | string | false | undefined,
  container: HTMLElement | null,
): HTMLElement | null {
  if (portal === false) return null;
  if (portal === undefined) return container ?? document.body;
  if (typeof portal === 'string')
    return document.querySelector<HTMLElement>(portal) ?? document.body;
  return portal;
}

/**
 * Mount a floating surface's wrapper into its portal target, and take it out
 * again on teardown.
 *
 * `SelectContent` and `ComboboxContent` ran identical copies of this effect
 * until #929, differing only in the wording of the comment above it. That made
 * the #674/#640 fix two implementations of one rule — the failure mode the rule
 * exists to prevent. ui-spec-v02 §2.5 now requires the two to share it.
 *
 * Everything is a getter because all three inputs change after mount: the
 * wrapper element is `$state` bound by `bind:this`, and both the `portal` prop
 * and the enclosing modal's content element are read through context.
 */
export function usePortalMount(opts: {
  el: () => HTMLElement | undefined;
  portal: () => HTMLElement | string | false | undefined;
  container: () => HTMLElement | null;
}): void {
  $effect(() => {
    const el = opts.el();
    if (!el) return;

    const target = resolvePortalTarget(opts.portal(), opts.container());
    if (!target) return;

    target.appendChild(el);
    return () => el.remove();
  });
}
