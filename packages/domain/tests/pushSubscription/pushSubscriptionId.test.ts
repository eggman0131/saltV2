import { describe, it, expect } from 'vitest';
import { pushSubscriptionId } from '@salt/domain';

// The pin (issue #1145): the id must stay byte-identical to what the enable and
// disable sites in web-pwa compose by hand.
describe('pushSubscriptionId', () => {
  it('joins uid and deviceHash with an underscore', () => {
    expect(pushSubscriptionId('uid-1', 'dev-1')).toBe('uid-1_dev-1');
  });
});
