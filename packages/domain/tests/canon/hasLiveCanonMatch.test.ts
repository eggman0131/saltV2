import { describe, it, expect } from 'vitest';
import { hasLiveCanonMatch } from '@salt/domain';

describe('hasLiveCanonMatch', () => {
  it('returns true when matched and canonId is in the set', () => {
    expect(hasLiveCanonMatch({ matchState: 'matched', canonId: 'id1' }, new Set(['id1']))).toBe(
      true,
    );
  });

  it('returns false when matched but canonId is absent from the set', () => {
    expect(hasLiveCanonMatch({ matchState: 'matched', canonId: 'id1' }, new Set())).toBe(false);
  });

  it('returns false when matched but canonId is null', () => {
    expect(hasLiveCanonMatch({ matchState: 'matched', canonId: null }, new Set(['id1']))).toBe(
      false,
    );
  });

  it('returns false when pending regardless of canonId', () => {
    expect(hasLiveCanonMatch({ matchState: 'pending', canonId: null }, new Set())).toBe(false);
    expect(hasLiveCanonMatch({ matchState: 'pending', canonId: 'id1' }, new Set(['id1']))).toBe(
      false,
    );
  });

  it('returns false when failed', () => {
    expect(hasLiveCanonMatch({ matchState: 'failed', canonId: null }, new Set())).toBe(false);
  });

  it('returns true when needs_approval and canonId is in the set', () => {
    expect(
      hasLiveCanonMatch({ matchState: 'needs_approval', canonId: 'id1' }, new Set(['id1'])),
    ).toBe(true);
  });

  it('returns false when needs_approval but canonId is absent from the set', () => {
    expect(
      hasLiveCanonMatch({ matchState: 'needs_approval', canonId: 'id1' }, new Set(['other'])),
    ).toBe(false);
  });

  it('returns false when needs_approval but canonId is null', () => {
    expect(hasLiveCanonMatch({ matchState: 'needs_approval', canonId: null }, new Set())).toBe(
      false,
    );
  });
});
