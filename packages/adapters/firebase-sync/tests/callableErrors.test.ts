import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DomainError } from '@salt/shared-types';
import { classifyCallableError } from '../src/callableErrors.js';

// The shared callable error mapper (issue #916), and the structural guard that
// keeps it shared.
//
// The defect: every callable wrapper ended its catch with a
// `NetworkError/transient` catch-all. A Cloud Function 500 arrives at the browser
// SDK as `functions/internal` and fell into it — so the user was told to check
// their connection when the SERVER was broken, and the failure was never reported,
// because NetworkError is a SUPPRESSED category in the §7.6 reporting policy.
// `auth.ts:toOtpError` was fixed for the sign-in path and nothing else was told.

// The suppressed set from docs/salt-architecture.md §7.6, restated here rather
// than imported: the authoritative copy is `isReportableCategory` in
// @salt/observability, and firebase-sync must not import a sibling adapter
// (CLAUDE.md rule #4). Keep the two in agreement by hand — they are both short,
// both commented, and the policy is a stable contract rather than a moving list.
const SUPPRESSED_CATEGORIES: ReadonlySet<DomainError['kind']> = new Set<DomainError['kind']>([
  'NetworkError',
  'ValidationError',
  'NotFound',
  'ConflictError',
]);

function isReportable(error: DomainError): boolean {
  return !SUPPRESSED_CATEGORIES.has(error.kind);
}

function callableError(code: string): Error & { code: string } {
  const err = new Error(`Firebase: ${code}`) as Error & { code: string };
  err.code = code;
  return err;
}

beforeEach(() => {
  // Node ≥ 21 exposes navigator globally with onLine = false, which would send
  // every case down the offline branch. Stub online for all but the offline tests.
  vi.stubGlobal('navigator', { onLine: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('classifyCallableError — the guard', () => {
  it('does NOT map a Cloud Function 500 to a suppressed reporting category', () => {
    const error = classifyCallableError(callableError('functions/internal'));

    expect(error).toEqual({ kind: 'StorageError', reason: 'unavailable' });
    expect(isReportable(error)).toBe(true);
  });

  it('does not map any unrecognised code to a suppressed category either', () => {
    for (const code of ['functions/unknown', 'functions/unimplemented', 'functions/data-loss']) {
      expect(isReportable(classifyCallableError(callableError(code)))).toBe(true);
    }
    // …nor a rejection carrying no code at all.
    expect(isReportable(classifyCallableError(new Error('boom')))).toBe(true);
  });

  it('still maps a genuine offline failure to a SUPPRESSED NetworkError', () => {
    vi.stubGlobal('navigator', { onLine: false });
    const error = classifyCallableError(callableError('functions/internal'));

    expect(error).toEqual({ kind: 'NetworkError', reason: 'offline' });
    expect(isReportable(error)).toBe(false);
  });

  it('prefers the offline signal over EVERY code — the ordering is the whole fix', () => {
    vi.stubGlobal('navigator', { onLine: false });
    for (const code of ['internal', 'permission-denied', 'unauthenticated', 'resource-exhausted']) {
      expect(classifyCallableError(callableError(`functions/${code}`))).toEqual({
        kind: 'NetworkError',
        reason: 'offline',
      });
    }
  });
});

describe('classifyCallableError — the mapping', () => {
  it.each([
    ['functions/permission-denied', { kind: 'AuthError', reason: 'forbidden' }],
    ['functions/unauthenticated', { kind: 'AuthError', reason: 'unauthenticated' }],
    ['functions/unavailable', { kind: 'NetworkError', reason: 'transient' }],
    ['functions/deadline-exceeded', { kind: 'NetworkError', reason: 'transient' }],
    ['functions/cancelled', { kind: 'NetworkError', reason: 'transient' }],
    ['functions/aborted', { kind: 'NetworkError', reason: 'transient' }],
    ['functions/resource-exhausted', { kind: 'StorageError', reason: 'quota-exceeded' }],
    ['functions/data-loss', { kind: 'StorageError', reason: 'corruption' }],
    ['functions/internal', { kind: 'StorageError', reason: 'unavailable' }],
  ])('maps %s', (code, expected) => {
    expect(classifyCallableError(callableError(code))).toEqual(expected);
  });

  it('tolerates a bare, unprefixed code', () => {
    expect(classifyCallableError(callableError('unauthenticated'))).toEqual({
      kind: 'AuthError',
      reason: 'unauthenticated',
    });
  });

  it('never throws, whatever it is handed (Rule 10)', () => {
    for (const thrown of [null, undefined, 'a string', 42, {}, { code: 7 }]) {
      expect(() => classifyCallableError(thrown)).not.toThrow();
    }
  });
});

describe('classifyCallableError — per-call-site overrides', () => {
  it('lets a call site claim a code that means something particular to it', () => {
    expect(
      classifyCallableError(callableError('functions/failed-precondition'), {
        'failed-precondition': { kind: 'AuthError', reason: 'expired' },
      }),
    ).toEqual({ kind: 'AuthError', reason: 'expired' });
  });

  it('does NOT let an override outrank the offline check', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(
      classifyCallableError(callableError('functions/failed-precondition'), {
        'failed-precondition': { kind: 'AuthError', reason: 'expired' },
      }),
    ).toEqual({ kind: 'NetworkError', reason: 'offline' });
  });

  it('falls through to the shared mapping for codes it does not claim', () => {
    expect(
      classifyCallableError(callableError('functions/internal'), {
        'failed-precondition': { kind: 'AuthError', reason: 'expired' },
      }),
    ).toEqual({ kind: 'StorageError', reason: 'unavailable' });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// The structural guard.
//
// A behavioural test proves ONE mapper is right today. #913's rule is that a
// cause is not closed until something prevents its recurrence, and the cause here
// was twenty-odd copies of the same mapping — which is why fixing one never
// reached the others. This reads the source of every file that talks to the
// callable SDK and fails if a new one hand-rolls its own mapping.
// ──────────────────────────────────────────────────────────────────────────

const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url));

function sourceFiles(): { name: string; text: string }[] {
  return readdirSync(SRC_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ name, text: readFileSync(join(SRC_DIR, name), 'utf8') }));
}

const callableSources = sourceFiles().filter(({ text }) =>
  text.includes("from 'firebase/functions'"),
);

describe('structural — the mapping is written once', () => {
  it('finds the callable modules it is meant to be guarding', () => {
    // A rename or a moved directory must fail loudly rather than quietly guard
    // nothing at all.
    expect(callableSources.length).toBeGreaterThanOrEqual(15);
  });

  // Comments talk ABOUT the old catch-all all over this package; only code counts.
  function codeOnly(text: string): string {
    return text
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
      .join('\n');
  }

  it.each(callableSources.map(({ name }) => name))(
    '%s does not hand-roll a NetworkError catch-all',
    (name) => {
      const code = codeOnly(callableSources.find((f) => f.name === name)!.text);

      // The ONE NetworkError a callable module may construct for itself is the
      // offline answer, which has to be given before any error code is read (the
      // two import classifiers do this, because they map onto their own failure
      // vocabulary and cannot delegate wholesale). Anything else — and above all
      // the `reason: 'transient'` catch-all this issue exists to remove — belongs
      // to classifyCallableError.
      const constructed = [...code.matchAll(/kind:\s*'NetworkError',\s*reason:\s*'([\w-]+)'/g)].map(
        (m) => m[1],
      );
      expect(constructed.filter((reason) => reason !== 'offline')).toEqual([]);

      // …and there is no other way it names the category, so an oddly-formatted
      // or partial literal cannot slip past the pattern above.
      const mentions = code.match(/'NetworkError'/g) ?? [];
      expect(mentions.length).toBe(constructed.length);
    },
  );

  it.each(callableSources.filter(({ text }) => text.includes('catch (')).map(({ name }) => name))(
    '%s maps its callable failures through the shared classifyCallableError',
    (name) => {
      const { text } = callableSources.find((f) => f.name === name)!;
      expect(text).toContain('classifyCallableError');
    },
  );
});
