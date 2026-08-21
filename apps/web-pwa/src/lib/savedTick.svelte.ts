/**
 * The quiet "Saved" acknowledgement for autosaving editors (issue #872).
 *
 * The record editors commit on change/blur, so there is no Save button to go
 * quiet — the confirmation has to come from somewhere. A toast is the wrong
 * instrument: toasts are for consequences (a delete you may undo, a split, a
 * regeneration), and one per keystroke-group would be noise. Instead every
 * successful field write flashes ONE shared indicator near the editor, which
 * clears itself.
 *
 * Deliberately shared per editor rather than per field: two fields saved in
 * quick succession should read as "saved", not race two ticks.
 */
export function createSavedTick(timeoutMs = 1500) {
  let visible = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    get visible(): boolean {
      return visible;
    },
    flash(): void {
      visible = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        visible = false;
      }, timeoutMs);
    },
  };
}

export type SavedTick = ReturnType<typeof createSavedTick>;
