import { describe, it, expect } from 'vitest';
import { iconRegenerationFields } from '../../src/canon/commands/iconRegenerationFields.js';

/**
 * The icon-regeneration field set (issue #1054, Phase 3) — what both the admin
 * screens and the canon/product-form callables write when someone asks for an
 * icon again.
 *
 * The load-bearing property is `iconHint`'s ABSENCE rather than its being
 * `undefined`: the client turns absence into a delete by omitting the key from a
 * whole-document write, and the server turns it into an explicit
 * `FieldValue.delete()`. A key present and set to `undefined` would be rejected
 * by the Admin SDK, so it is asserted with `Object.keys`, which
 * `toHaveProperty` and `toEqual` would both let through.
 */
describe('iconRegenerationFields', () => {
  it('clears the thumbnail and stamps the caller-supplied nonce', () => {
    expect(iconRegenerationFields(1_700_000_000_000)).toEqual({
      thumbnail: null,
      iconRequestedAt: 1_700_000_000_000,
    });
  });

  it('reads no clock — the nonce is whatever the caller passed', () => {
    // Rule 1: no `Date.now()` inside the domain. Passing a fixed number twice
    // must produce the same document both times.
    expect(iconRegenerationFields(42).iconRequestedAt).toBe(42);
    expect(iconRegenerationFields(42)).toEqual(iconRegenerationFields(42));
  });

  it('carries a hint, trimmed', () => {
    expect(iconRegenerationFields(1, '  show it as a tin  ')).toEqual({
      thumbnail: null,
      iconRequestedAt: 1,
      iconHint: 'show it as a tin',
    });
  });

  // Every way of saying "no steer". Each row names itself (UT-D1/D2).
  it.each([
    ['no argument', undefined],
    ['null', null],
    ['empty', ''],
    ['whitespace only', '   '],
    ['a tab and a newline', '\t\n'],
  ])('omits the iconHint KEY for %s', (_name, hint) => {
    const fields = iconRegenerationFields(1, hint);
    expect(Object.keys(fields)).not.toContain('iconHint');
    // Not merely absent from `Object.keys` by accident of ordering — the value
    // read is `undefined` BECAUSE there is no key, which is what each caller's
    // presence check keys off.
    expect('iconHint' in fields).toBe(false);
  });

  it('never emits a key set to undefined for any input', () => {
    // The property the Admin SDK's rejection makes load-bearing, stated once
    // over the whole input space this function accepts.
    for (const hint of [undefined, null, '', ' ', 'a steer', '  a steer  ']) {
      const fields = iconRegenerationFields(1, hint);
      for (const [key, value] of Object.entries(fields)) {
        expect(value, `${key} for hint ${JSON.stringify(hint)}`).not.toBeUndefined();
      }
    }
  });
});
