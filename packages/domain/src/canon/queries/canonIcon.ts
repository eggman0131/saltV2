// Canon-item icon (Tier-1 pictogram) helpers — issue #148.
//
// `CanonItem.thumbnail` (`string | null`) is tri-state:
//   - `null`            → no valid icon yet (never generated, or last attempt
//                          failed). The creation trigger will (re)attempt.
//   - `CANON_ICON_HIDDEN` → user opted out; the trigger skips it forever.
//   - any other string  → a real icon URL; render it.
//
// The `"hidden"` sentinel is deliberately a plain string value rather than a
// schema widening (reversible pre-launch). `isCanonIconRenderable` is the
// read-boundary guard the UI uses to decide between rendering the icon and
// showing the bare placeholder tile.

/** Sentinel `thumbnail` value meaning "user hid this icon; never regenerate". */
export const CANON_ICON_HIDDEN = 'hidden';

/**
 * True only when `thumbnail` is a real icon URL — i.e. not `null`, not the
 * `CANON_ICON_HIDDEN` sentinel, and not empty. This is the client read-boundary
 * guard for the tri-state `thumbnail` field.
 */
export function isCanonIconRenderable(thumbnail: string | null): boolean {
  return thumbnail !== null && thumbnail !== CANON_ICON_HIDDEN && thumbnail.length > 0;
}
