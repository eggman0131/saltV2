<script lang="ts">
  import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Icon,
    ImageCropper,
    Spinner,
    type ImageCropperHandle,
  } from '@salt/ui-components';
  import type { EquipmentReferencePhoto } from '@salt/domain/schemas';
  import { addToast } from '../lib/toastStore.js';

  // Describe an appliance from a photograph of it (issue #947).
  //
  // CAPTURE AND CROP ONLY — this dialog knows nothing about the describe
  // callable. `EquipmentEditPage.svelte`'s `runBriefAction` is the one place a
  // description request is made and its busy/error handling lives, exactly as
  // Revise and Start over already work; this is that mechanism's third caller,
  // not a new one. `onDescribe` hands the cropped bytes up, and the page drives
  // `busy` back down while its callable is in flight.
  //
  // The photo is REQUEST-SCOPED and never persisted (Rule 3): it lives in this
  // component's state for the life of the dialog, goes to the callable as base64,
  // and is dropped the moment the dialog closes. Mirrors RecipeImportPhotoDialog
  // and ImageUploadDialog — object-URL lifecycle, input reset so re-picking the
  // same file still fires, `getCroppedBase64()` returning `null` meaning "not
  // ready yet" rather than an error (ui-spec-v06 §1.4/§1.5).

  type Props = {
    open: boolean;
    /** True while the page's describe call is in flight. */
    busy: boolean;
    /** Fired once with the cropped photo when Describe is pressed. */
    onDescribe: (photo: EquipmentReferencePhoto) => void;
  };

  let { open = $bindable(false), busy, onDescribe }: Props = $props();

  let src = $state<string | null>(null);
  let cropper = $state<ImageCropperHandle | undefined>(undefined);
  let cropBusy = $state(false);

  // Frame the appliance, not the pictogram: the server re-encodes anyway, so
  // this only bounds the base64 payload (ImageCropperProps.maxEdge doc).
  // 1024 is well clear of what a single item photo needs while staying far
  // inside EQUIPMENT_REFERENCE_PHOTO_MAX_BASE64_LENGTH.
  const MAX_EDGE = 1024;

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

  async function handleDescribe(): Promise<void> {
    if (!cropper || cropBusy || busy) return;
    cropBusy = true;
    const base64 = await cropper.getCroppedBase64();
    cropBusy = false;
    if (!base64) {
      addToast('That photo isn’t ready yet — give it a moment, or take another.', 'destructive');
      return;
    }
    onDescribe({ base64, contentType: 'image/webp' });
  }

  function handleOpenChange(next: boolean): void {
    open = next;
  }

  // Reset whenever the dialog closes, whoever closed it — Cancel/Escape here, or
  // the page flipping `open` back once its describe call has finished.
  $effect(() => {
    if (!open) clearSrc();
  });
</script>

<Dialog bind:open onOpenChange={handleOpenChange}>
  <DialogContent>
    <div class="flex flex-col gap-4" data-testid="equipment-photo-dialog">
      <DialogHeader>
        <DialogTitle>Use a photo</DialogTitle>
        <DialogDescription>
          Photograph the actual appliance — fill the frame and leave the worktop clutter out of it —
          and we'll rewrite the description from what the photo shows.
        </DialogDescription>
      </DialogHeader>

      {#if busy}
        <!-- The page's callable is in flight; the dialog just waits for it to
             flip `open` back to false. -->
        <div
          class="flex flex-col items-center gap-3 rounded-md border border-border bg-muted/40 px-4 py-8 text-center"
          data-testid="equipment-photo-describing"
        >
          <Spinner />
          <p class="text-sm font-medium text-foreground">Reading the photo…</p>
        </div>
      {:else if src}
        <!-- Free-aspect crop: the appliance's own proportions, not a fixed frame
             that could cut off the feature that identifies it. -->
        <ImageCropper bind:this={cropper} {src} aspect="free" maxEdge={MAX_EDGE} />
        <p class="text-xs text-muted-foreground">
          Drag to pan, pinch or use the slider to zoom, so the appliance fills the frame.
        </p>
      {:else}
        <label
          class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-input px-4 py-10 text-sm text-muted-foreground hover:bg-muted/50"
        >
          <Icon name="Camera" size={24} />
          <span>Take or choose a photo</span>
          <!-- `capture="environment"` asks the OS for the rear camera; a desktop
               browser ignores it and shows the file picker. -->
          <input
            type="file"
            accept="image/*"
            capture="environment"
            class="sr-only"
            onchange={handleFileChange}
            data-testid="equipment-photo-input"
          />
        </label>
      {/if}

      <DialogFooter>
        <Button
          variant="ghost"
          onclick={() => handleOpenChange(false)}
          disabled={busy}
          data-testid="equipment-photo-cancel"
        >
          Cancel
        </Button>
        <Button
          onclick={handleDescribe}
          loading={cropBusy || busy}
          disabled={!src || cropBusy || busy}
          data-testid="equipment-photo-describe-btn"
        >
          Describe
        </Button>
      </DialogFooter>
    </div>
  </DialogContent>
</Dialog>
