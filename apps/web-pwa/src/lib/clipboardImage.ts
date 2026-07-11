// Clipboard-image reads for the recipe hero upload dialog (issue #455, Phase 3).
//
// DOM/clipboard logic lives here in web-pwa — never in @salt/domain (domain is
// pure). Both entry points return an image `Blob` (or null) and NEVER throw: an
// unsupported, empty, or permission-denied clipboard degrades to null so the
// caller can show a hint without crashing the dialog.

/**
 * Whether the async Clipboard `read()` API (needed for the explicit Paste
 * button) is available. Some browsers (limited/older Firefox) expose
 * `navigator.clipboard` for writes but not `read()`. The ⌘/Ctrl-V `paste`
 * event path does NOT depend on this — it reads `ClipboardEvent.clipboardData`
 * — so gate only the button on it, not the keyboard listener.
 */
export function clipboardImageReadSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.clipboard?.read === 'function';
}

/**
 * Read the first image on the clipboard via the async Clipboard API (the Paste
 * button path). Returns the image `Blob`, or null when the API is unsupported,
 * the read is denied/fails, or the clipboard holds no image. Never throws.
 */
export async function readClipboardImage(): Promise<Blob | null> {
  if (!clipboardImageReadSupported()) return null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((t) => t.startsWith('image/'));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      if (blob) return blob;
    }
    return null;
  } catch {
    // Permission denied, no gesture, or unsupported — quiet fallback.
    return null;
  }
}

/**
 * Extract the first image from a `paste` event's `clipboardData` (the ⌘/Ctrl-V
 * path). Works even where `navigator.clipboard.read()` is missing. Returns the
 * image `Blob`/`File`, or null when the paste holds no image. Never throws.
 */
export function imageFromClipboardData(data: DataTransfer | null): Blob | null {
  if (!data) return null;
  for (const item of data.items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}
