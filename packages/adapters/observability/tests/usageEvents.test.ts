import { describe, it, expect, vi, beforeEach } from 'vitest';

// Feature-usage events (issue #684): a typed, closed taxonomy over
// posthog.capture. What matters at this layer is the never-throw / inert-before-
// init contract (Rule 10) and that the wire shape is exactly name + props —
// identity and environment ride via identify()/super properties, so no call
// site may need to attach either.

const { clientCapture } = vi.hoisted(() => ({ clientCapture: vi.fn() }));

vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    register: vi.fn(),
    capture: clientCapture,
    identify: vi.fn(),
    reset: vi.fn(),
  },
}));

import { initObservability } from '../src/init.js';
import { trackUsageEvent } from '../src/usageEvents.js';

describe('trackUsageEvent', () => {
  beforeEach(() => {
    clientCapture.mockClear();
    clientCapture.mockImplementation(() => undefined);
    initObservability('test-key', { environment: 'production' });
  });

  it('captures the event name and properties verbatim', () => {
    trackUsageEvent('recipe.created', {
      recipe_id: 'r1',
      recipe_kind: 'recipe',
      recipe_method: 'photo',
    });
    expect(clientCapture).toHaveBeenCalledWith('recipe.created', {
      recipe_id: 'r1',
      recipe_kind: 'recipe',
      recipe_method: 'photo',
    });
  });

  it('attaches no identity or environment at the call site (super properties own those)', () => {
    trackUsageEvent('chat.message_sent', {});
    const [, props] = clientCapture.mock.calls.at(-1)!;
    expect(props).toEqual({});
  });

  it('never throws when the SDK capture fails', () => {
    clientCapture.mockImplementation(() => {
      throw new Error('sdk exploded');
    });
    expect(() => trackUsageEvent('cook.started', { recipe_id: 'r1' })).not.toThrow();
  });
});
