import { addToast } from './toastStore.js';

/**
 * Deferred bulk delete + Undo snackbar — the contextual-action-mode delete
 * pattern, shared by every list page (shopping, equipment, canon, …).
 *
 * Selected ids are hidden immediately, but the real delete (`commit`) only runs
 * once the Undo toast lapses. Pressing Undo cancels the commit, so nothing is
 * ever deleted and no restore/tombstone path is required — true to
 * Firestore-as-master (no soft-delete). On both the lapse-commit and the failure
 * case the ids are unhidden: success removes them from the source list anyway,
 * and a failed commit should reveal them again.
 *
 * Lives in `web-pwa` (not `@salt/ui-components`) because it depends on the
 * app-level toast store; `ListPage` itself stays toast-free.
 */
export function createDeferredDelete() {
  let pending = $state(new Set<string>());

  // Undo window for the snackbar. Deliberately longer than the Toast default
  // (5s): this is a destructive bulk action, so the user gets a comfortable
  // window to react — which also keeps the undo path off a wall-clock race in
  // slower environments (e.g. CI).
  const UNDO_WINDOW_MS = 10_000;

  function unhide(ids: readonly string[]): void {
    const next = new Set(pending);
    for (const id of ids) next.delete(id);
    pending = next;
  }

  return {
    /** Reactive set of ids currently hidden pending commit. */
    get pendingIds(): ReadonlySet<string> {
      return pending;
    },
    isPending(id: string): boolean {
      return pending.has(id);
    },
    /** Drop the currently-hidden items from a list for rendering. */
    visible<T extends { id: string }>(items: readonly T[]): T[] {
      return items.filter((i) => !pending.has(i.id));
    },
    /**
     * Hide `ids` and schedule `commit` behind an Undo toast. `commit` runs only
     * if the user lets the toast lapse, and is responsible for surfacing its own
     * failure toast. `noun`/`nounPlural` shape the message ("3 items deleted").
     */
    request(
      ids: readonly string[],
      commit: (ids: readonly string[]) => Promise<void> | void,
      opts: { noun?: string; nounPlural?: string; durationMs?: number } = {},
    ): void {
      if (ids.length === 0) return;
      const list = [...ids];
      pending = new Set([...pending, ...list]);

      const noun = opts.noun ?? 'item';
      const nounPlural = opts.nounPlural ?? `${noun}s`;
      const label = list.length === 1 ? noun : nounPlural;

      let undone = false;
      addToast(`${list.length} ${label} deleted`, 'default', {
        duration: opts.durationMs ?? UNDO_WINDOW_MS,
        action: {
          label: 'Undo',
          onClick: () => {
            undone = true;
            unhide(list);
          },
        },
        onDismiss: () => {
          if (undone) return;
          void Promise.resolve(commit(list)).finally(() => unhide(list));
        },
      });
    },
  };
}

export type DeferredDelete = ReturnType<typeof createDeferredDelete>;
