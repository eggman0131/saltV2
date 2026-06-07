import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock firebase-functions/identity ─────────────────────────────────────────
// beforeUserCreated(opts, handler) returns the handler so we can invoke it.
// HttpsError is a minimal stand-in that records its code.

class FakeHttpsError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

vi.mock('firebase-functions/identity', () => ({
  beforeUserCreated: (_opts: unknown, handler: unknown) => handler,
  HttpsError: FakeHttpsError,
}));

// ─── Mock firebase-functions logger ──────────────────────────────────────────

vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── Mock firebase-admin/firestore ───────────────────────────────────────────

const { mockGet, mockDoc, mockCollection } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockDoc = vi.fn(() => ({ get: mockGet }));
  const mockCollection = vi.fn(() => ({ doc: mockDoc }));
  return { mockGet, mockDoc, mockCollection };
});

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: mockCollection }),
}));

// Import after mocks.
const { beforeMemberCreated } = await import('../../src/auth/beforeMemberCreated.js');
const handler = beforeMemberCreated as unknown as (event: {
  data?: { email?: string };
}) => Promise<void>;

function lookupReturns(exists: boolean): void {
  mockGet.mockResolvedValue({ exists });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('beforeMemberCreated', () => {
  it('allows an email that is on the members allowlist', async () => {
    lookupReturns(true);
    await expect(handler({ data: { email: 'daniel@pendery.org' } })).resolves.toBeUndefined();
  });

  it('looks up the members collection by the normalised email', async () => {
    lookupReturns(true);
    await handler({ data: { email: '  Daniel@Pendery.ORG ' } });
    expect(mockCollection).toHaveBeenCalledWith('members');
    expect(mockDoc).toHaveBeenCalledWith('daniel@pendery.org');
  });

  it('rejects an email that is not on the allowlist', async () => {
    lookupReturns(false);
    await expect(handler({ data: { email: 'stranger@evil.com' } })).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('rejects an account with no email', async () => {
    await expect(handler({ data: {} })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockGet).not.toHaveBeenCalled();
  });
});
