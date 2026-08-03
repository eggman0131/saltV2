// spec: ui-spec-v02.md §2.5 v0.2.10
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
