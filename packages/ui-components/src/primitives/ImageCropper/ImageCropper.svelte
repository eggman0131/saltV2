<!-- spec: SPEC.md §8.7 v0.3 -->
<script lang="ts">
  import Cropper from 'svelte-easy-crop';
  import type { CropArea, Point } from 'svelte-easy-crop';
  import { cn } from '../../lib/cn';
  import type { ImageCropperProps } from './ImageCropper.types';

  // The recipe hero is ALWAYS 3:2 — locked, not a prop.
  const ASPECT = 3 / 2;

  let { src, maxEdge = 1600, class: className }: ImageCropperProps = $props();

  // svelte-easy-crop drives these; crop/zoom are bindable so pan (drag) and zoom
  // (wheel/pinch/slider) stay in sync with the overlay.
  let crop = $state<Point>({ x: 0, y: 0 });
  let zoom = $state(1);
  // Source-image pixel rect of the current selection, updated on every crop change.
  let croppedAreaPixels = $state<CropArea | null>(null);

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
  // `bind:this` on Save. Draws the selected source region onto an offscreen 3:2
  // canvas (capped at `maxEdge` on the long side) and returns bare base64 WebP.
  // All Canvas/Blob work lives here in ui-components — never in @salt/domain.
  export async function getCroppedBase64(): Promise<string | null> {
    const area = croppedAreaPixels;
    if (!area || area.width <= 0 || area.height <= 0) return null;

    const img = await loadImage(src);
    // The selection is already 3:2 (aspect-locked); force the output to an exact
    // 3:2 canvas so any sub-pixel rounding can't drift the stored ratio.
    const outWidth = Math.min(Math.round(area.width), maxEdge);
    const outHeight = Math.round(outWidth / ASPECT);

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
  <!-- Positioned, fixed-3:2 stage: svelte-easy-crop's container is absolutely
       filled, so it needs a relative ancestor with an intrinsic height. -->
  <div class="relative aspect-[3/2] w-full overflow-hidden rounded-md bg-muted">
    <Cropper image={src} bind:crop bind:zoom aspect={ASPECT} oncropcomplete={onCropComplete} />
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
