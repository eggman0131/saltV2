import { describe, it, expect } from 'vitest';
import * as sharedTypes from '@salt/shared-types';
import { makeId, makeTimestamp } from '../src/index.js';

describe('@salt/testing-utils', () => {
  it('can import from allowed layer @salt/shared-types', () => {
    expect(sharedTypes).toBeDefined();
  });

  it('makeId returns a non-empty string', () => {
    const id = makeId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('makeTimestamp returns a Date', () => {
    expect(makeTimestamp()).toBeInstanceOf(Date);
  });
});
