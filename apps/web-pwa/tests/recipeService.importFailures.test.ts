import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import { URL_IMPORT_FAILURE_CODES, PHOTO_IMPORT_FAILURE_CODES } from '@salt/domain/schemas';
import type { RecipePagePhoto } from '@salt/domain/schemas';

// Issue #740 — what the two import paths SAY and what they REPORT.
//
// The defect this pins shut had two halves, and the second is the one a copy
// test would miss: a signed-out import was told to the user as a verdict on the
// recipe site, AND it carried no DomainError category, so the §7.6 reporting
// gate at ErrorReportingPort could never see it. Both halves are asserted here
// — the message, and the fact that an AuthError now reaches the port while an
// ordinary import verdict does not.

const report = vi.fn();

const { spans } = vi.hoisted(() => ({
  spans: [] as { attributes: Record<string, unknown>; errored: boolean }[],
}));

vi.mock('@salt/observability', () => ({
  startUserActionSpan: vi.fn(() => {
    const record = { attributes: {} as Record<string, unknown>, errored: false };
    spans.push(record);
    return {
      child: () => ({ end: () => {} }),
      end: () => {},
      setAttribute: (key: string, value: unknown) => {
        record.attributes[key] = value;
      },
      setError: () => {
        record.errored = true;
      },
      get traceparent() {
        return '';
      },
    };
  }),
  createObservabilityErrorReportingAdapter: vi.fn(() => ({ report })),
}));

vi.mock('@salt/firebase-sync', () => ({
  subscribeRecipes: vi.fn(() => vi.fn()),
  saveRecipe: vi.fn(),
  deleteRecipe: vi.fn(),
  callParseRecipeIngredients: vi.fn(),
  callCanonicaliseRecipeIngredients: vi.fn(),
  callExtractRecipeFromUrl: vi.fn(),
  callExtractRecipeFromPhoto: vi.fn(),
  callDescribeRecipeScene: vi.fn(),
  saveShoppingListItem: vi.fn(),
  isAuthTransitioning: vi.fn(() => false),
}));

vi.mock('../src/lib/canonService.js', () => ({ getCanonItemsSnapshot: vi.fn(() => []) }));

import * as firebaseSync from '@salt/firebase-sync';
import {
  importRecipeFromUrl,
  importRecipeFromPhoto,
  urlImportMessage,
  photoImportMessage,
  isSignedOutFailure,
  stashPendingImportUrl,
  takePendingImportUrl,
} from '../src/lib/recipeService.js';

const fs = firebaseSync as Mocked<typeof firebaseSync>;

const PAGES: RecipePagePhoto[] = [{ base64: 'AAAA', contentType: 'image/webp' }];
const SIGNED_OUT = { kind: 'AuthError', reason: 'unauthenticated' } as const;

beforeEach(() => {
  vi.clearAllMocks();
  spans.length = 0;
  takePendingImportUrl(); // drain any stash a previous test left behind
});

describe('import copy — what the user is told', () => {
  it('says you are signed out, and never blames the page, on a dead session', () => {
    const message = urlImportMessage(SIGNED_OUT);
    expect(message).toMatch(/signed out/i);
    // The exact regression: the old code answered this with fetch-failed's copy.
    expect(message).not.toMatch(/reach that page|paywalled|blocking/i);
  });

  it('says the same thing on the photo path, and never blames the photos', () => {
    const message = photoImportMessage(SIGNED_OUT);
    expect(message).toMatch(/signed out/i);
    expect(message).not.toMatch(/photos|recipe reader/i);
    // One spelling of "signed out" across both paths — the whole point of moving
    // auth onto DomainError rather than into two bespoke code sets.
    expect(message).toBe(urlImportMessage(SIGNED_OUT));
  });

  it('is honestly vague about an unknown failure rather than confidently wrong', () => {
    const message = urlImportMessage({ kind: 'NetworkError', reason: 'transient' });
    expect(message).toMatch(/something went wrong/i);
    expect(message).not.toMatch(/reach that page/i);
  });

  it('keeps the existing copy for every genuine URL-import verdict', () => {
    const messages = URL_IMPORT_FAILURE_CODES.map((code) =>
      urlImportMessage({ kind: 'ImportError', code }),
    );
    expect(new Set(messages).size).toBe(URL_IMPORT_FAILURE_CODES.length);
    // The one that was right all along, and had to stay right.
    expect(urlImportMessage({ kind: 'ImportError', code: 'fetch-failed' })).toMatch(
      /couldn't reach that page/i,
    );
  });

  it('keeps the existing copy for every genuine photo-import verdict', () => {
    const messages = PHOTO_IMPORT_FAILURE_CODES.map((code) =>
      photoImportMessage({ kind: 'ImportError', code }),
    );
    expect(new Set(messages).size).toBe(PHOTO_IMPORT_FAILURE_CODES.length);
  });

  it('recognises only auth as the signed-out case', () => {
    expect(isSignedOutFailure(SIGNED_OUT)).toBe(true);
    expect(isSignedOutFailure({ kind: 'AuthError', reason: 'forbidden' })).toBe(true);
    expect(isSignedOutFailure({ kind: 'ImportError', code: 'fetch-failed' })).toBe(false);
    expect(isSignedOutFailure({ kind: 'NetworkError', reason: 'transient' })).toBe(false);
  });
});

describe('import reporting — what reaches error tracking', () => {
  it('reports a signed-out URL import, with its category, to the port', async () => {
    fs.callExtractRecipeFromUrl.mockResolvedValue({ kind: 'err', error: SIGNED_OUT });

    await importRecipeFromUrl('https://example.com/r');

    expect(report).toHaveBeenCalledTimes(1);
    // Gated BY CATEGORY (§7.6), which is exactly what the old bespoke code could
    // not supply.
    expect(report.mock.calls[0]![1]).toBe('AuthError');
  });

  it('reports a signed-out PHOTO import too — the sibling defect', async () => {
    fs.callExtractRecipeFromPhoto.mockResolvedValue({ kind: 'err', error: SIGNED_OUT });

    await importRecipeFromPhoto(PAGES);

    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]![1]).toBe('AuthError');
  });

  it('does not report an ordinary import verdict — that is not an incident', async () => {
    fs.callExtractRecipeFromUrl.mockResolvedValue({
      kind: 'err',
      error: { kind: 'ImportError', code: 'not-a-recipe' },
    });

    await importRecipeFromUrl('https://example.com/r');

    expect(report).not.toHaveBeenCalled();
  });

  it('hands NetworkError to the port and lets the gate suppress it', async () => {
    fs.callExtractRecipeFromUrl.mockResolvedValue({
      kind: 'err',
      error: { kind: 'NetworkError', reason: 'transient' },
    });

    await importRecipeFromUrl('https://example.com/r');

    // The service does not second-guess the policy — it passes the category and
    // the port's gate drops it. Asserting the call, not a suppression here, is
    // what keeps the "gated by category, not by call-site shape" rule honest.
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]![1]).toBe('NetworkError');
  });

  it('labels the span with the category when there is no import code', async () => {
    fs.callExtractRecipeFromUrl.mockResolvedValue({ kind: 'err', error: SIGNED_OUT });

    await importRecipeFromUrl('https://example.com/r');

    expect(spans.at(-1)!.attributes['import.outcome']).toBe('AuthError');
    expect(spans.at(-1)!.errored).toBe(true);
  });

  it('still labels the span with the bespoke code when there is one', async () => {
    fs.callExtractRecipeFromUrl.mockResolvedValue({
      kind: 'err',
      error: { kind: 'ImportError', code: 'ai-failed' },
    });

    await importRecipeFromUrl('https://example.com/r');

    expect(spans.at(-1)!.attributes['import.outcome']).toBe('ai-failed');
  });
});

describe('the pasted URL survives the sign-in round trip', () => {
  it('hands the URL back exactly once', () => {
    stashPendingImportUrl('https://example.com/recipes/ragu');
    expect(takePendingImportUrl()).toBe('https://example.com/recipes/ragu');
    // Single-use: coming back to the list later must not resurrect a link the
    // user has moved on from.
    expect(takePendingImportUrl()).toBeNull();
  });

  it('trims, and treats a blank URL as nothing to rescue', () => {
    stashPendingImportUrl('  https://example.com/r  ');
    expect(takePendingImportUrl()).toBe('https://example.com/r');

    stashPendingImportUrl('   ');
    expect(takePendingImportUrl()).toBeNull();
  });
});
