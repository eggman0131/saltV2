import { flushSync } from 'svelte';

/**
 * Run a rune factory outside a component.
 *
 * `$effect` is only legal inside an effect root, and a `.test.ts` file is not compiled
 * in runes mode — so a factory that declares effects (`createStepDeck`, and `createDeck`
 * underneath it) cannot simply be called from a test. This gives it a root, flushes the
 * effects it registered, and tears the root down afterwards.
 *
 * Deliberately synchronous end to end. Nothing here waits for a frame or a settle: the
 * test drives the state, calls `flushSync()`, and reads the answer — which is what keeps
 * a factory's coverage the same on a loaded CI runner as on a quiet laptop (issue #967).
 */
export function withEffectRoot<T>(create: () => T, body: (value: T) => void): void {
  let value: T;
  const destroy = $effect.root(() => {
    value = create();
  });
  try {
    flushSync();
    body(value!);
  } finally {
    destroy();
  }
}
