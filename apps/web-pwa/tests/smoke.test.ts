import { describe, it, expect } from 'vitest';
import * as sharedTypes from '@salt/shared-types';
import * as domain from '@salt/domain';

describe('@salt/web-pwa', () => {
  it('can import from allowed layers', () => {
    expect(sharedTypes).toBeDefined();
    expect(domain).toBeDefined();
  });
});
