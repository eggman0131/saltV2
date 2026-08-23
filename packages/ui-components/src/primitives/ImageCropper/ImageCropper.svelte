<!-- spec: ui-spec-v11.md §1 v0.11 -->
<script lang="ts">
  import Cropper from 'svelte-easy-crop';
  import type { CropArea, Point } from 'svelte-easy-crop';
  import { cn } from '../../lib/cn';
  import type { ImageCropperProps } from './ImageCropper.types';

  // The recipe hero is ALWAYS 3:2 — hence the default. The other two modes are
  // each a sanctioned, spec'd escape: `aspect='1:1'` is the Tier-1 pictogram frame
  // (ui-spec-v11 §1), and `aspect='free'` locks the frame to the source's OWN ratio
  // (ui-spec-v06 §1) for a source a hero frame would crop the content out of. All
  // three are LOCKED frames; they differ only in which ratio they lock to.
  const HERO_ASPECT = 3 / 2;
  const SQUARE_ASPECT = 1;

  let { src, aspect = '3:2', maxEdge = 1600, class: className }: ImageCropperProps = $props();

  // svelte-easy-crop drives these; crop/zoom are bindable so pan (drag) and zoom
  // (wheel/pinch/slider) stay in sync with the overlay.
  let crop = $state<Point>({ x: 0, y: 0 });
  let zoom = $state(1);
  // Source-image pixel rect of the current selection, updated on every crop change.
  let croppedAreaPixels = $state<CropArea | null>(null);
  // Free mode only: the source image's own ratio, measured once per `src`.
  let measuredAspect = $state<number | null>(null);

  // The single ratio the frame, the stage and the output canvas all follow.
  // `null` only in free mode, while the source is unmeasured (ui-spec-v06 §1.4).
  // '1:1' resolves to a constant like '3:2' does — it measures nothing and can
  // never be unknown, so it has no placeholder stage (ui-spec-v11 §1.4).
  const activeAspect = $derived(
    aspect === 'free' ? measuredAspect : aspect === '1:1' ? SQUARE_ASPECT : HERO_ASPECT,
  );

  function onCropComplete(e: { percent: CropArea; pixels: CropArea }): void {
    croppedAreaPixels = e.pixels;
  }

  // Reset pan/zoom whenever a new image is loaded so a re-pick starts centred.
  $effect(() => {
    // Referencing `src` makes this re-run on change.
    src;
    crop = { x: 0, y: 0 };
    zoom = 1;
    croppedAreaPixels = null;
  });

  // Free mode: measure the source's own ratio (ui-spec-v06 §1.4). The locked mode
  // needs no decode of its own. A result arriving after `src` changed again is
  // discarded, so the frame never takes a stale image's shape; an unloadable src
  // leaves the aspect unknown (placeholder stage) rather than throwing or
  // silently falling back to 3:2.
  $effect(() => {
    if (aspect !== 'free') return;
    const url = src;
    measuredAspect = null;
    let cancelled = false;
    loadImage(url).then(
      (img) => {
        if (cancelled) return;
        measuredAspect =
          img.naturalWidth > 0 && img.naturalHeight > 0
            ? img.naturalWidth / img.naturalHeight
            : null;
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  });

  function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Strip the `data:<mime>;base64,` prefix — the callable decodes a bare
        // base64 payload.
        resolve(result.slice(result.indexOf(',') + 1));
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Exposed on the component instance (Svelte 5): the consumer calls this via
  // `bind:this` on Save. Draws the selected source region onto an offscreen canvas
  // at the active aspect (capped at `maxEdge` on the long side) and returns bare
  // base64 WebP. All Canvas/Blob work lives here in ui-components — never in
  // @salt/domain.
  export async function getCroppedBase64(): Promise<string | null> {
    const area = croppedAreaPixels;
    const ratio = activeAspect;
    if (!area || area.width <= 0 || area.height <= 0) return null;
    if (ratio === null || ratio <= 0) return null;

    const img = await loadImage(src);
    // The selection already matches the active ratio (the frame is locked to it);
    // force the output to that exact ratio so sub-pixel rounding can't drift the
    // stored shape. `maxEdge` caps the genuinely longest edge — which is the
    // height once the frame is portrait (ui-spec-v06 §1.5).
    let outWidth: number;
    let outHeight: number;
    if (ratio >= 1) {
      outWidth = Math.min(Math.round(area.width), maxEdge);
      outHeight = Math.round(outWidth / ratio);
    } else {
      outHeight = Math.min(Math.round(area.height), maxEdge);
      outWidth = Math.round(outHeight * ratio);
    }

    const canvas = document.createElement('canvas');
    canvas.width = outWidth;
    canvas.height = outHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, outWidth, outHeight);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/webp', 0.92),
    );
    if (!blob) return null;
    return blobToBase64(blob);
  }
</script>

<div class={cn('flex flex-col gap-3', className)}>
  <!-- Positioned stage: svelte-easy-crop's container is absolutely filled, so it
       needs a relative ancestor with an intrinsic height. That height comes from
       the active ratio (inline, because it is a runtime number Tailwind cannot
       generate a class for — sanctioned in ui-spec-v06 §1.2). While a free-mode
       source is unmeasured the stage is a neutral placeholder and the cropper is
       NOT mounted: a frame that flashed 3:2 and snapped to portrait would read as
       a bug, and could be dragged in before it settled. -->
  <div
    class={cn(
      'relative w-full overflow-hidden rounded-md bg-muted',
      activeAspect === null && 'min-h-40',
    )}
    style={activeAspect === null ? undefined : `aspect-ratio: ${activeAspect}`}
    data-testid="image-cropper-stage"
  >
    {#if activeAspect !== null}
      <Cropper
        image={src}
        bind:crop
        bind:zoom
        aspect={activeAspect}
        oncropcomplete={onCropComplete}
      />
    {/if}
  </div>
  <!-- Zoom control (pan is drag/scroll/pinch on the stage). -->
  <label class="flex items-center gap-2 text-xs text-muted-foreground">
    <span class="shrink-0">Zoom</span>
    <input
      type="range"
      min="1"
      max="3"
      step="0.01"
      bind:value={zoom}
      aria-label="Zoom"
      class="w-full accent-primary"
      data-testid="image-cropper-zoom"
    />
  </label>
</div>
