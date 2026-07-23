import { beforeEach, describe, expect, it, vi } from 'vitest';

// The deferred-delete pattern is "hide now, commit only if the Undo toast lapses".
// These tests pin that contract directly on `createDeferredDelete()` — mocking the
// toast store so we can drive the Undo / lapse callbacks by hand — plus the two
// Phase-2 additions: the optional message override (shopping's `"{name}" removed`)
// and the optional Undo-window duration, both of which must leave the existing
// three callers (canon / equipment / product forms) byte-identical.

vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));

import { createDeferredDelete } from '../src/lib/deferredDelete.svelte.js';
import { addToast } from '../src/lib/toastStore.js';

type CapturedOptions = {
  action?: { label: string; onClick: () => void };
  duration?: number;
  onDismiss?: () => void;
};

function lastToast(): { message: string; options: CapturedOptions | undefined } {
  const calls = vi.mocked(addToast).mock.calls;
  const [message, , options] = calls[calls.length - 1]!;
  return { message, options: options as CapturedOptions | undefined };
}

// Real timers: the commit is unhidden in a `.finally` microtask.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.mocked(addToast).mockClear();
});

describe('createDeferredDelete — default wording (unchanged for existing callers)', () => {
  it('keeps the "{n} {plural} deleted" wording when no message override is given', () => {
    const dd = createDeferredDelete();
    dd.request(['a', 'b', 'c'], () => {});
    expect(lastToast().message).toBe('3 items deleted');
  });

  it('uses the singular noun for a single id', () => {
    const dd = createDeferredDelete();
    dd.request(['a'], () => {}, { noun: 'form' });
    expect(lastToast().message).toBe('1 form deleted');
  });

  it('omits duration when none is given, so the toast keeps its 5000ms default', () => {
    const dd = createDeferredDelete();
    dd.request(['a'], () => {});
    expect(lastToast().options).not.toHaveProperty('duration');
  });

  it('does nothing for an empty id list', () => {
    const dd = createDeferredDelete();
    dd.request([], () => {});
    expect(vi.mocked(addToast)).not.toHaveBeenCalled();
  });
});

describe('createDeferredDelete — Phase 2 overrides', () => {
  it('replaces the computed wording with an explicit message override', () => {
    const dd = createDeferredDelete();
    dd.request(['a'], () => {}, { message: '"Tinned Tomatoes" removed' });
    expect(lastToast().message).toBe('"Tinned Tomatoes" removed');
  });

  it('threads an explicit Undo-window duration through to the toast', () => {
    const dd = createDeferredDelete();
    dd.request(['a'], () => {}, { message: '"Milk" removed', duration: 4200 });
    expect(lastToast().options?.duration).toBe(4200);
  });

  it('always renders an Undo action regardless of overrides', () => {
    const dd = createDeferredDelete();
    dd.request(['a'], () => {}, { message: '"Milk" removed', duration: 4200 });
    expect(lastToast().options?.action?.label).toBe('Undo');
  });
});

describe('createDeferredDelete — hide, commit, undo', () => {
  it('hides ids immediately but commits only once the toast lapses', async () => {
    const dd = createDeferredDelete();
    const commit = vi.fn();
    dd.request(['a', 'b'], commit, { message: '2 items removed', duration: 4200 });

    // Hidden right away.
    expect(dd.isPending('a')).toBe(true);
    expect(dd.isPending('b')).toBe(true);
    expect(dd.visible([{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toEqual([{ id: 'c' }]);

    // Not committed yet.
    expect(commit).not.toHaveBeenCalled();

    // Lapse → commit with the exact id list, then unhide.
    lastToast().options?.onDismiss?.();
    expect(commit).toHaveBeenCalledWith(['a', 'b']);
    await flush();
    expect(dd.isPending('a')).toBe(false);
    expect(dd.isPending('b')).toBe(false);
  });

  it('undo reveals the ids and prevents the commit even if a later dismiss fires', () => {
    const dd = createDeferredDelete();
    const commit = vi.fn();
    dd.request(['a'], commit, { message: '"Eggs" removed', duration: 4200 });

    const { options } = lastToast();
    options?.action?.onClick?.();
    expect(dd.isPending('a')).toBe(false); // revealed immediately

    // A stray dismiss after undo must never commit.
    options?.onDismiss?.();
    expect(commit).not.toHaveBeenCalled();
  });
});
