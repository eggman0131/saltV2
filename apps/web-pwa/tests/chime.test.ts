import { describe, it, expect } from 'vitest';
import { primeChime, playChime } from '../src/lib/chime.js';

describe('chime (#544)', () => {
  it('degrades to a silent no-op when Web Audio is unavailable (jsdom)', () => {
    // jsdom ships no AudioContext — both entry points must no-op silently, never
    // throw, so cook mode can call them unconditionally.
    expect(() => primeChime()).not.toThrow();
    expect(() => playChime()).not.toThrow();
  });
});
