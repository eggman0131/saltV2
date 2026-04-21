import { describe, it, expect } from 'vitest';
import * as pkg from '../src/index.js';

describe('@salt/ui-components', () => {
  it('is importable', () => {
    expect(pkg).toBeDefined();
  });
});
