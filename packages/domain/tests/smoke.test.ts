import { describe, it, expect } from 'vitest';
import * as sharedTypes from '@salt/shared-types';
import * as pkg from '../src/index.js';

describe('@salt/domain', () => {
  it('is importable', () => {
    expect(pkg).toBeDefined();
  });

  it('can import from allowed layer @salt/shared-types', () => {
    expect(sharedTypes).toBeDefined();
  });
});
