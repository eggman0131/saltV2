// spec: canon-icons.md §Rendering v1.0

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
   * The item this tile stands for is matched to a canon. Only changes the BARE
   * tile (no renderable thumbnail): a matched-but-iconless tile tints sage
   * (`--salt-secondary-container`) with the item's initial in
   * `--salt-accent-foreground`, instead of the unmatched grey (`bg-icon-tile`) —
   * the "found its home" resting state while the real icon generates. A tile that
   * already renders an `<img>` is unaffected (its backdrop stays `bg-icon-tile`).
   * The grey→sage change carries a `transition-colors` cross-fade, suppressed
   * under reduced motion. Default `false` → today's grey bare tile, so every
   * existing consumer that omits it is unchanged.
   */
  matched?: boolean;
  /**
   * Play the one-shot shimmer sweep across the tile — the "match just landed"
   * flourish (lively shopping list). A single translucent band crosses once, then
   * settles; it is an overlay, so it works over the bare, sage, or icon tile. The
   * caller is responsible for holding this `true` only for the reveal window and
   * only when motion is allowed; `motion-reduce:hidden` guards it regardless.
   * Default `false`.
   */
  shimmer?: boolean;
  class?: string;
};
