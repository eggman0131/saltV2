import { describe, it, expect } from 'vitest';
import { isFullViewportRoute } from '../src/routes/fullViewport.js';

// Issue #641. This predicate is what makes App.svelte pass `chrome={false}` to
// AppShell, so a false negative puts focusable, screen-reader-visible navigation
// behind cook mode's overlay — and a false positive strips the nav off an ordinary
// page. Both failure modes are silent, hence the boundary cases below.

describe('isFullViewportRoute', () => {
  it('matches cook mode', () => {
    expect(isFullViewportRoute('/recipes/abc123/cook')).toBe(true);
    // Firestore ids are opaque; nothing here may assume a shape.
    expect(isFullViewportRoute('/recipes/A-b_9.zZ/cook')).toBe(true);
  });

  it('does not match the recipe routes either side of it', () => {
    expect(isFullViewportRoute('/recipes/abc123')).toBe(false);
    expect(isFullViewportRoute('/recipes/abc123/edit')).toBe(false);
    expect(isFullViewportRoute('/recipes')).toBe(false);
  });

  it('anchors both ends — no prefix or suffix sneaks through', () => {
    expect(isFullViewportRoute('/recipes/abc123/cook/steps')).toBe(false);
    expect(isFullViewportRoute('/admin/recipes/abc123/cook')).toBe(false);
    // A nested id segment is a different route, not a cook page.
    expect(isFullViewportRoute('/recipes/a/b/cook')).toBe(false);
  });

  it('leaves every ordinary route with its chrome', () => {
    for (const path of ['/', '/mine', '/shopping/list-1', '/mealplan', '/settings', '/admin']) {
      expect(isFullViewportRoute(path)).toBe(false);
    }
  });
});
