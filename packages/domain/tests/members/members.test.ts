import { describe, it, expect } from 'vitest';
import {
  createMember,
  updateMember,
  normaliseMemberEmail,
  memberInitials,
  sortMembers,
  type Member,
} from '@salt/domain';

const NOW = '2026-06-07T12:00:00.000Z';

function makeMember(overrides: Partial<Member> & { id: string }): Member {
  return {
    schemaVersion: 1,
    name: 'Test Person',
    email: overrides.id,
    admin: false,
    sortOrder: 0,
    icon: null,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('normaliseMemberEmail', () => {
  it('lowercases and trims', () => {
    expect(normaliseMemberEmail('  Daniel@Pendery.ORG ')).toBe('daniel@pendery.org');
  });

  it('is idempotent', () => {
    const once = normaliseMemberEmail('A@B.com');
    expect(normaliseMemberEmail(once)).toBe(once);
  });
});

describe('memberInitials', () => {
  it('returns two initials for a first + last name', () => {
    expect(memberInitials('Daniel Pendery')).toBe('DP');
  });

  it('uses first and last word for three+ word names', () => {
    expect(memberInitials('Mary Jane Watson')).toBe('MW');
  });

  it('returns first two letters for a single word', () => {
    expect(memberInitials('Cher')).toBe('CH');
  });

  it('falls back to ? for empty input', () => {
    expect(memberInitials('   ')).toBe('?');
  });

  it('uppercases lowercase names', () => {
    expect(memberInitials('alice smith')).toBe('AS');
  });
});

describe('createMember', () => {
  it('uses the normalised email as both id and email', () => {
    const m = createMember({
      name: 'Daniel',
      email: '  Daniel@Pendery.ORG ',
      admin: true,
      sortOrder: 1,
      now: NOW,
    });
    expect(m.id).toBe('daniel@pendery.org');
    expect(m.email).toBe('daniel@pendery.org');
  });

  it('trims the name and defaults icon to null', () => {
    const m = createMember({
      name: '  Daniel  ',
      email: 'd@e.org',
      admin: false,
      sortOrder: 0,
      now: NOW,
    });
    expect(m.name).toBe('Daniel');
    expect(m.icon).toBeNull();
  });

  it('stamps schemaVersion 1 and updatedAt', () => {
    const m = createMember({ name: 'D', email: 'd@e.org', admin: false, sortOrder: 0, now: NOW });
    expect(m.schemaVersion).toBe(1);
    expect(m.updatedAt).toBe(NOW);
  });

  it('preserves the admin flag', () => {
    const m = createMember({ name: 'D', email: 'd@e.org', admin: true, sortOrder: 0, now: NOW });
    expect(m.admin).toBe(true);
  });
});

describe('updateMember', () => {
  const base = makeMember({ id: 'd@e.org', name: 'Old', admin: false, sortOrder: 0 });

  it('applies the patched fields and re-stamps updatedAt', () => {
    const next = updateMember(
      base,
      { name: 'New', admin: true, sortOrder: 3 },
      '2026-06-08T00:00:00.000Z',
    );
    expect(next.name).toBe('New');
    expect(next.admin).toBe(true);
    expect(next.sortOrder).toBe(3);
    expect(next.updatedAt).toBe('2026-06-08T00:00:00.000Z');
  });

  it('leaves unpatched fields unchanged', () => {
    const next = updateMember(base, { sortOrder: 9 }, NOW);
    expect(next.name).toBe('Old');
    expect(next.admin).toBe(false);
  });

  it('never changes the id or email (key is immutable)', () => {
    const next = updateMember(base, { name: 'New' }, NOW);
    expect(next.id).toBe('d@e.org');
    expect(next.email).toBe('d@e.org');
  });

  it('does not mutate the original', () => {
    updateMember(base, { name: 'Mutated' }, NOW);
    expect(base.name).toBe('Old');
  });

  it('trims a patched name', () => {
    const next = updateMember(base, { name: '  Spaced  ' }, NOW);
    expect(next.name).toBe('Spaced');
  });
});

describe('sortMembers', () => {
  it('orders by sortOrder ascending', () => {
    const members = [
      makeMember({ id: 'c@e.org', name: 'C', sortOrder: 2 }),
      makeMember({ id: 'a@e.org', name: 'A', sortOrder: 0 }),
      makeMember({ id: 'b@e.org', name: 'B', sortOrder: 1 }),
    ];
    expect(sortMembers(members).map((m) => m.name)).toEqual(['A', 'B', 'C']);
  });

  it('breaks ties by name', () => {
    const members = [
      makeMember({ id: 'z@e.org', name: 'Zara', sortOrder: 0 }),
      makeMember({ id: 'a@e.org', name: 'Alice', sortOrder: 0 }),
    ];
    expect(sortMembers(members).map((m) => m.name)).toEqual(['Alice', 'Zara']);
  });

  it('does not mutate the input array', () => {
    const members = [
      makeMember({ id: 'b@e.org', name: 'B', sortOrder: 1 }),
      makeMember({ id: 'a@e.org', name: 'A', sortOrder: 0 }),
    ];
    sortMembers(members);
    expect(members[0]!.name).toBe('B');
  });
});
