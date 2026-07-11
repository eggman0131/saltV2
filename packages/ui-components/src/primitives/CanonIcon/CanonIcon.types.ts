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
  class?: string;
};
