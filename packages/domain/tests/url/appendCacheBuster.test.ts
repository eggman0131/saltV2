import { describe, it, expect } from 'vitest';
import { appendCacheBuster } from '@salt/domain';

// Pure display-time cache-buster (issue #460). A regenerated image reuses the
// same byte-identical Storage download URL, so the browser serves stale bytes;
// appending a `?v=`/`&v=` nonce forces a re-fetch. These tests pin the `?`/`&`
// join, the null/undefined passthrough, and string+number versions so the recipe
// pages and the (inlined, must-stay-identical) CanonIcon copy can't drift.

describe('appendCacheBuster', () => {
  it('appends ?v= to a URL with no existing query', () => {
    expect(appendCacheBuster('http://img.test/a.jpg', 42)).toBe('http://img.test/a.jpg?v=42');
  });

  it('appends &v= to a URL that already carries a query', () => {
    expect(appendCacheBuster('http://img.test/a.jpg?token=abc', 42)).toBe(
      'http://img.test/a.jpg?token=abc&v=42',
    );
  });

  it('returns the URL unchanged when version is null or undefined', () => {
    expect(appendCacheBuster('http://img.test/a.jpg', null)).toBe('http://img.test/a.jpg');
    expect(appendCacheBuster('http://img.test/a.jpg', undefined)).toBe('http://img.test/a.jpg');
  });

  it('accepts string and number versions verbatim', () => {
    // Numeric nonce (e.g. imageRequestedAt epoch ms).
    expect(appendCacheBuster('http://img.test/a.jpg', 1720000000000)).toBe(
      'http://img.test/a.jpg?v=1720000000000',
    );
    // String nonce (e.g. updatedAt ISO fallback).
    expect(appendCacheBuster('http://img.test/a.jpg', '2026-07-11T00:00:00.000Z')).toBe(
      'http://img.test/a.jpg?v=2026-07-11T00:00:00.000Z',
    );
  });

  it('returns a falsy url unchanged as a safety net', () => {
    expect(appendCacheBuster('', 42)).toBe('');
  });
});
