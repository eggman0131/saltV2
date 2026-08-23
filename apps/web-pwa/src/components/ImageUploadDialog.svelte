<script lang="ts">
  import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    ImageCropper,
    Text,
    type ImageCropperHandle,
  } from '@salt/ui-components';
  import type { IconUploadFamily } from '@salt/domain/schemas';
  import { uploadIcon } from '../lib/iconUploadService.js';
  import { addToast } from '../lib/toastStore.js';

  // Use your own picture instead (issue #892).
  //
  // Shared by the four pictogram surfaces, because the flow is identical on all
  // of them: pick a file, crop it square, save. It lives in components/ rather
  // than @salt/ui-components because it knows about families and services — an
  // app composite, not a primitive (Rule 7). Recipe heroes are NOT wired to it:
  // they already have their own upload, at 3:2 through a different server
  // pipeline.
  //
  // THE CROP IS SQUARE, and that is load-bearing rather than tidy. The server
  // frames every upload by its LONGER side (`normalizeIconFraming`, `contentMax:
  // 108`), and on an opaque photograph the measured subject is the whole crop —
  // so only a square lands 108×108 and sits at the same apparent size as the
  // drawn pictograms beside it. ui-spec-v11 §1.1 carries the arithmetic.

  type Props = {
    open: boolean;
    family: IconUploadFamily;
    id: string;
    /** What the picture is of — so a dialog opened from a list says which row. */
    subject: string;
    /** Called after a successful upload, for a toast or a refresh at the call site. */
    onUploaded?: () => void;
    'data-testid'?: string;
  };

  let {
    open = $bindable(),
    family,
    id,
    subject,
    onUploaded,
    'data-testid': testid = 'image-upload-dialog',
  }: Props = $props();

  let cropper = $state<ImageCropperHandle | undefined>(undefined);
  let src = $state<string | null>(null);
  let busy = $state(false);

  // A pictogram is stored at 128px square, so the cropper's 1600px default is a
  // needless payload and a needless server-side decode. 512 leaves room for the
  // framing step to downscale cleanly and nothing more (ui-spec-v11 §1.5).
  const MAX_EDGE = 512;

  function clearSrc(): void {
    if (src) URL.revokeObjectURL(src);
    src = null;
  }

  function handleFileChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset the input so re-picking the SAME file still fires a change event.
    input.value = '';
    if (!file || busy) return;
    clearSrc();
    src = URL.createObjectURL(file);
  }

  function handleOpenChange(next: boolean): void {
    open = next;
    // Never hold an object URL — or last week's photo — across a close.
    if (!next) clearSrc();
  }

  async function handleSave(): Promise<void> {
    if (!cropper || busy) return;
    busy = true;
    // `null` means the crop is not ready yet, which is a wait rather than an
    // error (ui-spec-v06 §1.5) — the photo stays on screen to try again with.
    const base64 = await cropper.getCroppedBase64();
    if (!base64) {
      busy = false;
      addToast('That photo isn’t ready yet — give it a moment.', 'destructive');
      return;
    }
    const result = await uploadIcon(family, id, base64, 'image/webp');
    busy = false;
    if (result.kind !== 'ok') {
      addToast(
        result.error.kind === 'ValidationError' && result.error.message
          ? result.error.message
          : "Couldn't save that picture. Try again.",
        'destructive',
      );
      return;
    }
    clearSrc();
    open = false;
    addToast('Picture updated.', 'success');
    onUploaded?.();
  }
</script>

<Dialog {open} onOpenChange={handleOpenChange}>
  <DialogContent>
    <div class="flex flex-col gap-4" data-testid={testid}>
      <DialogHeader>
        <DialogTitle>Use your own picture</DialogTitle>
        <DialogDescription>
          Choose a photo for {subject} and crop it square. It replaces the drawn icon until you press
          Regenerate.
        </DialogDescription>
      </DialogHeader>

      {#if src}
        <ImageCropper bind:this={cropper} {src} aspect="1:1" maxEdge={MAX_EDGE} />
      {:else}
        <Text size="sm" muted>Pick an image to get started.</Text>
      {/if}

      <label class="flex items-center gap-2 text-sm">
        <span class="sr-only">Choose an image</span>
        <input
          type="file"
          accept="image/*"
          onchange={handleFileChange}
          disabled={busy}
          data-testid="{testid}-file"
          class="text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:text-foreground"
        />
      </label>

      <DialogFooter>
        <Button variant="outline" onclick={() => handleOpenChange(false)} disabled={busy}>
          Cancel
        </Button>
        <Button
          data-testid="{testid}-save"
          onclick={handleSave}
          loading={busy}
          disabled={busy || !src}
        >
          Save picture
        </Button>
      </DialogFooter>
    </div>
  </DialogContent>
</Dialog>
