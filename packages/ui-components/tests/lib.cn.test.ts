// spec: SPEC.md §3.5 v0.2.3
import { describe, it, expect } from 'vitest';
import { cn } from '../src/lib/cn';

describe('cn', () => {
  it('returns a string', () => {
    expect(typeof cn('foo')).toBe('string');
  });

  it('merges conflicting tailwind utilities (last wins)', () => {
    expect(cn('px-2', 'px-3')).toBe('px-3');
  });

  it('merges conflicting tailwind utilities with multiple args', () => {
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('combines non-conflicting classes', () => {
    expect(cn('flex', 'items-center')).toBe('flex items-center');
  });

  it('handles conditional classes via clsx', () => {
    expect(cn('base', false && 'skipped', 'added')).toBe('base added');
  });

  it('handles array inputs', () => {
    expect(cn(['flex', 'gap-2'])).toBe('flex gap-2');
  });

  it('handles undefined and null gracefully', () => {
    expect(cn(undefined, null, 'px-4')).toBe('px-4');
  });

  it('returns empty string for no inputs', () => {
    expect(cn()).toBe('');
  });
});
