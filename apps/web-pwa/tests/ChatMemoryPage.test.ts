import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import type { KitchenMemoryDoc } from '@salt/domain/schemas';

// Issue #933 characterisation net. `ChatMemoryPage` renders its stamp DATE-ONLY
// (`{ month: 'short', day: 'numeric' }`), unlike `formatChatTimestamp` (used by
// the chat list), which also carries the time. `dateFormat.ts:70-74` asserts in
// prose that the difference is deliberate — this file is what makes that claim
// mechanical rather than trusted. It pins the date-only render; it does not take
// a position on whether the two SHOULD converge.

const { mockMemories, mockIsLoading } = await vi.hoisted(async () => {
  const { makeStore } = await import('./support/testStore.js');
  return {
    mockMemories: makeStore<readonly KitchenMemoryDoc[]>([]),
    mockIsLoading: makeStore<boolean>(false),
  };
});

vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/kitchenMemoryService.js', () => ({
  memories: mockMemories,
  isLoadingMemories: mockIsLoading,
  initKitchenMemorySync: vi.fn(() => () => {}),
  rememberNote: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  forgetNote: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
}));

import ChatMemoryPage from '../src/routes/chat/ChatMemoryPage.svelte';

function note(overrides: Partial<KitchenMemoryDoc> & { id: string }): KitchenMemoryDoc {
  return {
    schemaVersion: 1,
    text: 'We hate coriander',
    author: 'Daniel',
    createdAt: '2026-03-14T18:45:00.000Z',
    ...overrides,
  };
}

/**
 * What the page's own `formatDate` computes, without hard-coding a
 * locale-dependent string. `ChatMemoryPage` calls `formatInstant(…, undefined)`
 * — an explicit `undefined` for a defaulted parameter takes the default, which
 * `dateFormat.ts` fixes at `'en-GB'` (see its header comment), not the runtime's
 * own locale. That default, not `Intl`'s own fallback, is what this must match.
 */
function expectedDateOnly(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { month: 'short', day: 'numeric' }).format(new Date(iso));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMemories._set([]);
  mockIsLoading._set(false);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('ChatMemoryPage — the memory stamp is date-only (#933)', () => {
  it('shows the month and day, and no time at all', async () => {
    mockMemories._set([note({ id: 'm1', createdAt: '2026-03-14T18:45:00.000Z' })]);

    const { findByTestId } = render(ChatMemoryPage);

    const item = await findByTestId('memory-item');
    const stamp = item.textContent!;

    expect(stamp).toContain(expectedDateOnly('2026-03-14T18:45:00.000Z'));
    // No time: never a colon-separated clock reading, never an am/pm marker —
    // exactly what `formatChatTimestamp` would have added and this call omits.
    expect(stamp).not.toMatch(/\d{1,2}:\d{2}/);
    expect(stamp).not.toMatch(/\b(am|pm)\b/i);
  });

  it('renders a different day as a different date-only stamp, still with no time', async () => {
    mockMemories._set([note({ id: 'm2', createdAt: '2026-11-02T03:05:00.000Z' })]);

    const { findByTestId } = render(ChatMemoryPage);

    const item = await findByTestId('memory-item');
    const stamp = item.textContent!;

    expect(stamp).toContain(expectedDateOnly('2026-11-02T03:05:00.000Z'));
    expect(stamp).not.toMatch(/\d{1,2}:\d{2}/);
  });
});
