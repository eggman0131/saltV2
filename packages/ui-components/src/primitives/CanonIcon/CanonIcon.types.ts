// spec: ui-spec-v04.md §14 v0.4

export type CanonIconProps = {
  /**
   * The canon item's `thumbnail` field, tri-state: a real icon URL, `null`
   * (no icon yet), or the `"hidden"` sentinel (user opted out). Only a real
   * URL renders an image; the other two show the bare tile.
   */
  thumbnail: string | null;
  /** Item name, used for the image alt text. */
  name?: string;
  /** Tile (and icon) edge length in px. Default 30. */
  size?: number;
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
