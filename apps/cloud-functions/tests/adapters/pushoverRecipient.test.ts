import { describe, it, expect, vi, beforeEach } from 'vitest';

// Coverage of the uid → member → Pushover devices resolution (issue #680). The
// three failure shapes are the point: 'unresolved' (blip), 'no-devices'
// (misconfiguration, reported by the caller) and 'suppressed' (non-prod policy)
// must stay distinct, because collapsing any two either spams reports on every
// network wobble or hides a member whose devices silently stopped matching.
// MemberSchema and memberFirstName are kept REAL.

vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let mockUser: { email?: string } | Error = { email: 'Daniel@Pendery.org' };
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    getUser: async () => {
      if (mockUser instanceof Error) throw mockUser;
      return mockUser;
    },
  }),
}));

let mockMemberSnap: { exists: boolean; data: () => unknown } = {
  exists: true,
  data: () => undefined,
};
const mockDocPaths: string[] = [];
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: () => ({
      doc: (id: string) => {
        mockDocPaths.push(id);
        return { get: async () => mockMemberSnap };
      },
    }),
  }),
}));

const mockResolveDevices = vi.fn();
vi.mock('../../src/adapters/sendPushover.js', () => ({
  resolvePushoverDevices: mockResolveDevices,
}));

const mockEnvironment = vi.fn(() => 'production');
vi.mock('../../src/observability/environment.js', () => ({
  resolveServerEnvironment: mockEnvironment,
}));

const { resolvePushoverTargets, __resetPushoverMemberCache } =
  await import('../../src/adapters/pushoverRecipient.js');

const CREDS = { token: 'app-token', user: 'user-key' };

function member(name: string) {
  return {
    id: 'daniel@pendery.org',
    schemaVersion: 1,
    name,
    email: 'daniel@pendery.org',
    admin: true,
    sortOrder: 0,
    icon: null,
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetPushoverMemberCache();
  mockDocPaths.length = 0;
  mockUser = { email: 'Daniel@Pendery.org' };
  mockMemberSnap = { exists: true, data: () => member('Daniel Pendery') };
  mockResolveDevices.mockResolvedValue(['daniel-phone']);
  mockEnvironment.mockReturnValue('production');
});

describe('resolvePushoverTargets', () => {
  it('resolves a uid to their devices via the normalised member email', async () => {
    const targets = await resolvePushoverTargets(CREDS, 'uid-1');

    expect(targets).toEqual({ kind: 'send', devices: ['daniel-phone'] });
    // The auth email is mixed-case; members are keyed by the normalised form.
    expect(mockDocPaths).toEqual(['daniel@pendery.org']);
    // The device prefix comes from the FIRST name only.
    expect(mockResolveDevices).toHaveBeenCalledWith(CREDS, 'Daniel');
  });

  it('returns no-devices when the account matched nothing', async () => {
    mockResolveDevices.mockResolvedValue([]);

    expect(await resolvePushoverTargets(CREDS, 'uid-1')).toEqual({
      kind: 'no-devices',
      firstName: 'Daniel',
    });
  });

  it('returns unresolved (not no-devices) when Pushover could not be reached', async () => {
    mockResolveDevices.mockResolvedValue(null);

    expect(await resolvePushoverTargets(CREDS, 'uid-1')).toMatchObject({ kind: 'unresolved' });
  });

  it('returns unresolved when the uid has no email', async () => {
    mockUser = {};

    expect(await resolvePushoverTargets(CREDS, 'uid-1')).toMatchObject({ kind: 'unresolved' });
    expect(mockResolveDevices).not.toHaveBeenCalled();
  });

  it('returns unresolved when there is no member doc', async () => {
    mockMemberSnap = { exists: false, data: () => undefined };

    expect(await resolvePushoverTargets(CREDS, 'uid-1')).toMatchObject({ kind: 'unresolved' });
  });

  it('returns unresolved when the member doc fails validation', async () => {
    mockMemberSnap = { exists: true, data: () => ({ id: 'x', schemaVersion: 99 }) };

    expect(await resolvePushoverTargets(CREDS, 'uid-1')).toMatchObject({ kind: 'unresolved' });
  });

  it('returns unresolved rather than throwing when the auth lookup blows up', async () => {
    mockUser = new Error('auth down');

    expect(await resolvePushoverTargets(CREDS, 'uid-1')).toMatchObject({ kind: 'unresolved' });
  });

  it('caches the member lookup across calls', async () => {
    await resolvePushoverTargets(CREDS, 'uid-1');
    await resolvePushoverTargets(CREDS, 'uid-1');

    expect(mockDocPaths).toHaveLength(1);
  });

  describe('non-production', () => {
    beforeEach(() => {
      mockEnvironment.mockReturnValue('staging');
    });

    it('suppresses everyone but the test-device owner', async () => {
      // Staging and dev share the SAME family Pushover account, so an unclamped
      // staging test would wake four other people.
      mockMemberSnap = { exists: true, data: () => member('Claire Pendery') };

      expect(await resolvePushoverTargets(CREDS, 'uid-2')).toEqual({ kind: 'suppressed' });
      expect(mockResolveDevices).not.toHaveBeenCalled();
    });

    it('still sends to the test-device owner', async () => {
      expect(await resolvePushoverTargets(CREDS, 'uid-1')).toEqual({
        kind: 'send',
        devices: ['daniel-phone'],
      });
    });
  });

  it('never sends from the emulator, even for the test-device owner', async () => {
    // e2e seeds a member called Daniel and fires cook timers on every CI run.
    vi.stubEnv('FUNCTIONS_EMULATOR', 'true');

    expect(await resolvePushoverTargets(CREDS, 'uid-1')).toEqual({ kind: 'suppressed' });
    expect(mockResolveDevices).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
  });
});
