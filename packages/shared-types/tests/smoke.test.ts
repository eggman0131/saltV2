import { describe, it, expect } from 'vitest';
import * as pkg from '../src/index.js';

describe('@salt/shared-types', () => {
  it('is importable', () => {
    expect(pkg).toBeDefined();
  });
});
