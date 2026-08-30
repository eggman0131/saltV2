// spec: ui-spec-v04.md §14 v0.4

/**
 * The four sizes a pictogram is drawn at, and there is no fifth (§14.6.1):
 *
 * - **32** — a nested or secondary row, and an inline glyph inside a step's
 *   wrapped row: a picture that reads *under* a 40px one.
 * - **40** — a primary list row, a chip, a pill. The size the asset's
 *   `contentMax: 108` framing is tuned for (`docs/canon-icons.md`).
 * - **64** — a sheet's or an edit page's subject header.
 * - **96** — a detail page.
 *
 * A union rather than a convention because the convention did not hold. §14.6.1
 * said "every in-list and in-chip consumer renders at 40px" from #610 until
 * #1051, and eight distinct values shipped at call sites underneath it — 26, 28,
 * 32, 36, 40, 44, 64, 96 — with a ninth, 30, sitting in this file as the
 * default. Nothing could go red, so nothing did. A fifth rung is an amendment to
 * §14.6.1 and an edit here, in that order.
 */
export type CanonIconSize = 32 | 40 | 64 | 96;

export type CanonIconProps = {
  /**
   * The canon item's `thumbnail` field, tri-state: a real icon URL, `null`
   * (no icon yet), or the `"hidden"` sentinel (user opted out). Only a real
   * URL renders an image; the other two show the bare tile.
   */
  thumbnail: string | null;
  /** Item name, used for the image alt text. */
  name?: string;
  /** Tile (and icon) edge length in px — one of four rungs. Default 32. */
  size?: CanonIconSize;
  /** Dim the icon — e.g. for checked shopping-list items. */
  dimmed?: boolean;
  /**
   * Per-regeneration cache-bust nonce, appended to the rendered `<img src>` as
   * `?v=`/`&v=`. A regenerated icon reuses the same (byte-identical) Storage
   * download URL, so the browser serves the stale image; bumping this forces a
   * re-fetch. Typically the canon item's `iconRequestedAt ?? updatedAt`. Omit
   * (or `null`/`undefined`) to render the raw URL unchanged. `undefined` is in
   * the union (not just implied by `?`) so callers may pass a lookup result
   * that widens to `undefined` under `exactOptionalPropertyTypes`.
   */
  version?: string | number | undefined;
  /**
   * The item this tile stands for is matched to a canon. At REST this only
   * changes the BARE tile (no renderable thumbnail): a matched-but-iconless tile
   * tints sage (`--salt-secondary-container`) with the item's initial in
   * `--salt-accent-foreground`, instead of the unmatched grey (`bg-icon-tile`) —
   * the "found its home" resting state while the real icon generates. A tile that
   * already renders an `<img>` keeps its `bg-icon-tile` backdrop at rest.
   *
   * DURING a reveal (`shimmer` also true) the sage lift applies to an icon tile
   * too, then fades back — otherwise the "found its home" moment is invisible for
   * the common case of matching an established canon that already has an icon.
   * The grey→sage change carries a `transition-colors` cross-fade, suppressed
   * under reduced motion. Default `false` → today's grey bare tile, so every
   * existing consumer that omits it is unchanged.
   */
  matched?: boolean;
  /**
   * Play the one-shot reveal on the tile — the "match just landed" flourish
   * (lively shopping list). Despite the name this is the whole reveal, not only
   * the sweep: a translucent band crosses once (an overlay, so it works over the
   * bare, sage or icon tile), AND — when `matched` is also true — the tile lifts
   * its backdrop to sage for the window, then fades back. The lift reads even on a
   * tile whose icon covers the square, because the pictograms leave margin and
   * transparency around the artwork. The caller is responsible for holding this
   * `true` only for the reveal window and only when motion is allowed;
   * `motion-reduce:` guards every part regardless. Default `false`.
   */
  shimmer?: boolean;
  class?: string;
};
