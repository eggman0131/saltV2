import type { Page } from '@playwright/test';
import { aislesPage } from './locators';

export type ReorderDirection = 'up' | 'down';

// svelte-dnd-action's keyboard handler is bound to each draggable item (the <li>),
// so we focus the <li>, press Space to enter drag mode, arrow to move, Space to drop.
// Pointer-based drag is intentionally avoided: svelte-dnd-action's pointer events
// don't survive Playwright's `dragTo` reliably under headless chromium.
// See https://github.com/isaacHagoel/svelte-dnd-action#keyboard-support
export async function keyboardReorder(
  page: Page,
  aisleId: string,
  direction: ReorderDirection,
  count = 1,
): Promise<void> {
  const li = aislesPage(page).rowItem(aisleId);
  await li.focus();
  await li.press(' ');
  const arrow = direction === 'up' ? 'ArrowUp' : 'ArrowDown';
  for (let i = 0; i < count; i += 1) {
    await li.press(arrow);
  }
  await li.press(' ');
}
