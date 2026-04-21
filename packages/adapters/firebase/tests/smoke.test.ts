import { describe, it, expect } from 'vitest';
import * as domain from '@salt/domain';
import * as sharedTypes from '@salt/shared-types';
import * as pkg from '../src/index.js';

describe('@salt/firebase-adapter', () => {
  it('is importable', () => {
    expect(pkg).toBeDefined();
  });

  it('can import from allowed layers', () => {
    expect(domain).toBeDefined();
    expect(sharedTypes).toBeDefined();
  });
});
