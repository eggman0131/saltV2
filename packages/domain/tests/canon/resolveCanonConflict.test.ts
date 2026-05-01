import { describe, it, expect } from 'vitest';
import { resolveCanonConflict } from '@salt/domain';
import type { CanonItem } from '@salt/domain';

function item(overrides: Partial<CanonItem> = {}): CanonItem {
  return {
    id: 'item-1',
    schemaVersion: 2,
    name: 'Tomato',
    synonyms: ['tom'],
    aisleId: 'produce',
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    updatedAt: '',
    revision: 0,
    deletedAt: null,
    ...overrides,
  };
}

const local = item({ id: 'item-1', name: 'Tomato', aisleId: 'dairy', synonyms: ['tom'] });
const remote = item({ id: 'item-1', name: 'Pomodoro', aisleId: 'produce', synonyms: ['pomodoro'] });

describe('resolveCanonConflict', () => {
  it('keep-local returns the local item unchanged', () => {
    const result = resolveCanonConflict('keep-local', local, remote);
    expect(result).toBe(local);
  });

  it('keep-remote returns the remote item unchanged', () => {
    const result = resolveCanonConflict('keep-remote', local, remote);
    expect(result).toBe(remote);
  });

  describe('merge', () => {
    it('applies merge field-precedence rules', () => {
      const result = resolveCanonConflict('merge', local, remote);
      expect(result.id).toBe(local.id);
      expect(result.name).toBe(remote.name);
      expect(result.aisleId).toBe(remote.aisleId);
      expect(result.synonyms).toContain('tom');
      expect(result.synonyms).toContain('pomodoro');
    });

    it('is not the same object reference as either input', () => {
      const result = resolveCanonConflict('merge', local, remote);
      expect(result).not.toBe(local);
      expect(result).not.toBe(remote);
    });
  });
});
