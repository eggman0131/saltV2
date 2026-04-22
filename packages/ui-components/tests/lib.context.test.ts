// spec: SPEC.md §3.5 v0.2.3
import { describe, it, expect } from 'vitest';
import { createContext } from '../src/lib/context';

describe('createContext', () => {
  it('returns an object with set, get, and key', () => {
    const ctx = createContext<string>('Test');
    expect(typeof ctx.set).toBe('function');
    expect(typeof ctx.get).toBe('function');
    expect(typeof ctx.key).toBe('symbol');
  });

  it('key is a unique symbol per context name', () => {
    const a = createContext<string>('A');
    const b = createContext<string>('B');
    expect(a.key).not.toBe(b.key);
  });

  it('throws with the named message when get() is called outside a provider', () => {
    const ctx = createContext<string>('MyWidget');
    expect(() => ctx.get()).toThrow(
      'MyWidget context not found. Wrap in the matching root component.',
    );
  });

  it('error message includes the context name', () => {
    const ctx = createContext<string>('SomeComponent');
    expect(() => ctx.get()).toThrow('SomeComponent');
  });
});
