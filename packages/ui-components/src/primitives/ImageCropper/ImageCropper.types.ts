// spec: ui-spec-v06.md §1 v0.6

/** Which ratio the crop frame is locked to (ui-spec-v06 §1.3). */
export type ImageCropperAspect = '3:2' | 'free';

// A pan/zoom cropper locked to one of two named frames. The consumer supplies an
// image source (object URL / data URL) and, on Save, calls the exposed
// `getCroppedBase64()` method (via `bind:this`) to obtain the cropped image as a
// bare base64 string (no data-URL prefix) ready to hand to the upload callable.
// Aspect is a CLOSED two-valued mode, never a number: '3:2' is the recipe hero
// frame (the default, so the hero call site passes nothing) and 'free' locks the
// frame to the source image's own ratio for sources a hero frame would crop the
// content out of — a photographed cookbook page. A numeric aspect would let a
// call site silently violate the hero contract; adding a third mode is a spec
// amendment (ui-spec-v06 §1.3), not a call-site decision.
export type ImageCropperProps = {
  /** Object URL or data URL of the image to crop. */
  src: string;
  /** Which ratio the crop frame is locked to. Defaults to the 3:2 hero frame. */
  aspect?: ImageCropperAspect;
  /** Longest-edge cap (px) of the produced crop. Defaults to 1600; the server
   * re-encodes to its own bound, so this only limits the base64 payload size. */
  maxEdge?: number;
  class?: string;
};

/** Imperative handle exposed by the ImageCropper component instance. */
export type ImageCropperHandle = {
  /**
   * Renders the current pan/zoom selection to an offscreen canvas at the active
   * aspect and returns the cropped image as a bare base64 string (no `data:`
   * prefix), or `null` when no crop is ready yet (image still loading, or a
   * free-mode source whose ratio could not be measured). WebP-encoded.
   */
  getCroppedBase64: () => Promise<string | null>;
};
