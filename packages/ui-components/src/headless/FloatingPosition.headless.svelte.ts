// spec: ui-spec-v02.md §2.5 v0.2.19
/**
 * Anchor a floating surface to an element, and keep it anchored.
 *
 * `SelectContent` and `ComboboxContent` held byte-identical copies of this
 * `autoUpdate` + `computePosition` block until #929 — thirty lines differing
 * only in which context getter supplied the anchor (`ctx.triggerEl` for Select,
 * `ctx.anchorEl` for Combobox). ui-spec-v02 §2.5 now requires the two to share
 * one implementation.
 *
 * **This module has no test, and must not be given one.** jsdom has no layout
 * engine, so every rect floating-ui reads is zero and `computePosition` cannot
 * produce a meaningful result: an assertion here would be checking the mock, not
 * the placement. The middleware array below was moved **verbatim** from the two
 * deleted blocks, and the review of that diff is the verification. If the
 * placement ever needs changing, it needs a real browser to change it in.
 *
 * It lives in its own module rather than beside the portal helper because
 * `PortalContainer` is about *where in the DOM tree* a surface is mounted, and
 * this is about *where on screen* it sits. They are separate concerns that
 * happen to be needed by the same two components.
 */
import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom';

export function useAnchoredPosition(opts: {
  el: () => HTMLElement | undefined;
  /** Select anchors to its trigger; Combobox to its field. */
  anchor: () => HTMLElement | undefined | null;
}): void {
  $effect(() => {
    const el = opts.el();
    const anchor = opts.anchor();
    if (!el || !anchor) return;

    return autoUpdate(anchor, el, () => {
      void computePosition(anchor, el, {
        placement: 'bottom-start',
        middleware: [
          offset(4),
          flip({ padding: 8 }),
          shift({ padding: 8 }),
          size({
            apply({ rects, elements, availableHeight }) {
              elements.floating.style.minWidth = `${rects.reference.width}px`;
              elements.floating.style.maxHeight = `${Math.max(120, availableHeight - 8)}px`;
              elements.floating.style.overflowY = 'auto';
            },
          }),
        ],
      }).then(({ x, y }) => {
        Object.assign(el.style, {
          position: 'absolute',
          left: '0',
          top: '0',
          transform: `translate(${Math.round(x)}px, ${Math.round(y)}px)`,
        });
      });
    });
  });
}
