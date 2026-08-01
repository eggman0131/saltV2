<script lang="ts">
  // Test double for @salt/ui-components' ImageCropper.
  //
  // The real primitive cannot answer under jsdom: there is no canvas, and
  // svelte-easy-crop never reports a crop area in a zero-sized layout, so
  // `getCroppedBase64()` could only ever return null. Its own contract is
  // covered by ui-components' tests; what needs covering HERE is what the
  // capture dialog does with the two answers it can get back — bytes, or null
  // meaning "not ready yet" (ui-spec-v06 §1.4).
  import { nextCrop } from './cropStub.js';

  let { src, aspect }: { src: string; aspect?: string } = $props();

  export async function getCroppedBase64(): Promise<string | null> {
    return nextCrop();
  }
</script>

<div data-testid="stub-image-cropper" data-src={src} data-aspect={aspect}></div>
