// spec: SPEC.md §3.5 v0.2.3
import { describe, it, expect } from 'vitest';
import { useId } from '../src/lib/useId';

describe('useId', () => {
  it('returns a string', () => {
    expect(typeof useId()).toBe('string');
  });

  it('uses the default prefix "salt"', () => {
    const id = useId();
    expect(id).toMatch(/^salt-\d+$/);
  });

  it('uses a custom prefix', () => {
    const id = useId('textfield');
    expect(id).toMatch(/^textfield-\d+$/);
  });

  it('returns distinct values on successive calls', () => {
    const a = useId();
    const b = useId();
    const c = useId();
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });

  it('counter increments monotonically', () => {
    const a = useId('x');
    const b = useId('x');
    const numA = parseInt(a.split('-')[1], 10);
    const numB = parseInt(b.split('-')[1], 10);
    expect(numB).toBe(numA + 1);
  });
});
