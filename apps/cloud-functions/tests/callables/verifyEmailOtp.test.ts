import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashEmail, hashCode } from '../../src/auth/otpStore.js';

const otpRef = {
  get: vi.fn(),
  set: vi.fn(async () => undefined),
  update: vi.fn(async () => undefined),
  delete: vi.fn(async () => undefined),
};
const memberRef = { get: vi.fn() };
const mockCollection = vi.fn((name: string) => ({
  doc: vi.fn(() => (name === 'emailOtps' ? otpRef : memberRef)),
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: mockCollection }),
}));

const mockGetUserByEmail = vi.fn();
const mockCreateUser = vi.fn();
const mockCreateCustomToken = vi.fn(async () => 'custom-token-xyz');
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    getUserByEmail: mockGetUserByEmail,
    createUser: mockCreateUser,
    createCustomToken: mockCreateCustomToken,
  }),
}));

class FakeHttpsError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
vi.mock('firebase-functions/https', () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: FakeHttpsError,
}));
vi.mock('firebase-functions/params', () => ({
  defineSecret: () => ({ value: () => 'test-secret' }),
}));
vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
const mockReportFlowError = vi.fn(async () => undefined);
vi.mock('../../src/observability/reportServerError.js', () => ({
  reportFlowError: mockReportFlowError,
}));

const { verifyEmailOtp } = await import('../../src/callables/verifyEmailOtp.js');

const NOW = 1_700_000_000_000;
const EMAIL = 'cook@example.com';
const CODE = '123456';
const EMAIL_HASH = hashEmail(EMAIL);

function snap(data: unknown) {
  return { exists: !!data, data: () => data };
}

// A valid, unexpired stored OTP doc for the correct code.
function validOtpDoc(over: Record<string, unknown> = {}) {
  return {
    emailHash: EMAIL_HASH,
    codeHash: hashCode(EMAIL_HASH, CODE),
    expiresAt: NOW + 60_000,
    attempts: 0,
    createdAt: NOW,
    lastSentAt: NOW,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  memberRef.get.mockResolvedValue(snap({ email: EMAIL }));
  mockGetUserByEmail.mockResolvedValue({ uid: 'user-1' });
});

describe('verifyEmailOtp callable', () => {
  it('rejects a malformed code', async () => {
    await expect(
      (verifyEmailOtp as Function)({ data: { email: EMAIL, code: '12' } }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects when no code is on file', async () => {
    otpRef.get.mockResolvedValue(snap(null));
    await expect(
      (verifyEmailOtp as Function)({ data: { email: EMAIL, code: CODE } }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(mockCreateCustomToken).not.toHaveBeenCalled();
  });

  it('rejects and consumes an expired code', async () => {
    otpRef.get.mockResolvedValue(snap(validOtpDoc({ expiresAt: NOW - 1 })));
    await expect(
      (verifyEmailOtp as Function)({ data: { email: EMAIL, code: CODE } }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(otpRef.delete).toHaveBeenCalledTimes(1);
  });

  it('rejects after too many attempts and consumes the code', async () => {
    otpRef.get.mockResolvedValue(snap(validOtpDoc({ attempts: 5 })));
    await expect(
      (verifyEmailOtp as Function)({ data: { email: EMAIL, code: CODE } }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(otpRef.delete).toHaveBeenCalledTimes(1);
  });

  it('burns an attempt on a wrong code but keeps the doc', async () => {
    otpRef.get.mockResolvedValue(snap(validOtpDoc()));
    await expect(
      (verifyEmailOtp as Function)({ data: { email: EMAIL, code: '000000' } }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(otpRef.update).toHaveBeenCalledWith({ attempts: 1 });
    expect(otpRef.delete).not.toHaveBeenCalled();
    expect(mockCreateCustomToken).not.toHaveBeenCalled();
  });

  it('denies a correct code from an off-allowlist email', async () => {
    otpRef.get.mockResolvedValue(snap(validOtpDoc()));
    memberRef.get.mockResolvedValue(snap(null)); // not a member
    await expect(
      (verifyEmailOtp as Function)({ data: { email: EMAIL, code: CODE } }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockCreateCustomToken).not.toHaveBeenCalled();
    expect(otpRef.delete).toHaveBeenCalledTimes(1);
  });

  it('mints a custom token for a correct code from an allowlisted member', async () => {
    otpRef.get.mockResolvedValue(snap(validOtpDoc()));
    const result = await (verifyEmailOtp as Function)({ data: { email: EMAIL, code: CODE } });
    expect(result).toEqual({ token: 'custom-token-xyz' });
    expect(mockCreateCustomToken).toHaveBeenCalledWith('user-1');
    expect(otpRef.delete).toHaveBeenCalledTimes(1); // one-time use
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('creates the auth user on first sign-in, then mints a token', async () => {
    otpRef.get.mockResolvedValue(snap(validOtpDoc()));
    mockGetUserByEmail.mockRejectedValue({ code: 'auth/user-not-found' });
    mockCreateUser.mockResolvedValue({ uid: 'new-user' });
    const result = await (verifyEmailOtp as Function)({ data: { email: EMAIL, code: CODE } });
    expect(mockCreateUser).toHaveBeenCalledWith({ email: EMAIL, emailVerified: true });
    expect(mockCreateCustomToken).toHaveBeenCalledWith('new-user');
    expect(result).toEqual({ token: 'custom-token-xyz' });
  });
});
