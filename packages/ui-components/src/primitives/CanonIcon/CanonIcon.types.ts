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
  class?: string;
};
