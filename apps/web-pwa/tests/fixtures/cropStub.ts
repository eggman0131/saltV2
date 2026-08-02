// Controls what the StubImageCropper test double hands back (see the .svelte
// beside this file). Kept in its own module so the stub component and the test
// that drives it share one mutable cell without the test reaching into a
// component instance.
let queued: string | null = 'stub-cropped-base64';

export function setNextCrop(value: string | null): void {
  queued = value;
}

export function nextCrop(): string | null {
  return queued;
}
