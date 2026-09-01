import { describe, it, expect } from 'vitest';
import { cookSessionId } from '@salt/domain';

// The pin (issue #1145): the id must stay byte-identical to what the two live
// call sites and the emulator rules test compose by hand.
describe('cookSessionId', () => {
  it('joins recipeId and uid with an underscore', () => {
    expect(cookSessionId('recipe-1', 'uid-1')).toBe('recipe-1_uid-1');
  });
});
