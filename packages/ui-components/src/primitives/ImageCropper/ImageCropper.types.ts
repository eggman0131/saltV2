// spec: SPEC.md §8.7 v0.3

// A pan/zoom cropper LOCKED to a 3:2 hero frame. The consumer supplies an image
// source (object URL / data URL) and, on Save, calls the exposed
// `getCroppedBase64()` method (via `bind:this`) to obtain the cropped 3:2 image as
// a bare base64 string (no data-URL prefix) ready to hand to the upload callable.
// Aspect is deliberately NOT a prop — the recipe hero is always 3:2.
export type ImageCropperProps = {
  /** Object URL or data URL of the image to crop. */
  src: string;
  /** Longest-edge cap (px) of the produced crop. Defaults to 1600; the server
   * re-encodes to its own bound, so this only limits the base64 payload size. */
  maxEdge?: number;
  class?: string;
};

/** Imperative handle exposed by the ImageCropper component instance. */
export type ImageCropperHandle = {
  /**
   * Renders the current pan/zoom selection to an offscreen 3:2 canvas and returns
   * the cropped image as a bare base64 string (no `data:` prefix), or `null` when
   * no crop is ready yet (image still loading). WebP-encoded.
   */
  getCroppedBase64: () => Promise<string | null>;
};
