import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashEmail, hashCode } from '../../src/auth/otpStore.js';

// Collection-aware Firestore mock: `emailOtps` → the OTP doc, `members` → the
// allowlist doc. A single shared doc would cross the two reads.
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

const mockSendOtpEmail = vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: unknown });
vi.mock('../../src/adapters/sendOtpEmail.js', () => ({ sendOtpEmail: mockSendOtpEmail }));
const mockReportFlowError = vi.fn(async () => undefined);
vi.mock('../../src/observability/reportServerError.js', () => ({
  reportFlowError: mockReportFlowError,
}));

const { requestEmailOtp } = await import('../../src/callables/requestEmailOtp.js');

const NOW = 1_700_000_000_000;
const EMAIL = 'cook@example.com';

function snap(data: unknown) {
  return { exists: !!data, data: () => data };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  mockSendOtpEmail.mockResolvedValue({ ok: true });
  otpRef.get.mockResolvedValue(snap(null));
  memberRef.get.mockResolvedValue(snap({ email: EMAIL }));
});

describe('requestEmailOtp callable', () => {
  it('rejects an invalid email', async () => {
    await expect(
      (requestEmailOtp as Function)({ data: { email: 'not-an-email' } }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mockSendOtpEmail).not.toHaveBeenCalled();
  });

  it('is enumeration-safe: off-list email returns ok with no code sent', async () => {
    memberRef.get.mockResolvedValue(snap(null)); // not a member
    const result = await (requestEmailOtp as Function)({ data: { email: EMAIL } });
    expect(result).toEqual({ ok: true });
    expect(mockSendOtpEmail).not.toHaveBeenCalled();
    expect(otpRef.set).not.toHaveBeenCalled();
  });

  it('emails a 6-digit code to a member and stores its salted hash', async () => {
    const result = await (requestEmailOtp as Function)({ data: { email: EMAIL } });
    expect(result).toEqual({ ok: true });

    expect(mockSendOtpEmail).toHaveBeenCalledTimes(1);
    // (apiKey, from, to, code) — `from` rides as a secret, so it is 'test-secret'
    // under the defineSecret mock above.
    const [, from, toEmail, code] = mockSendOtpEmail.mock.calls[0]!;
    expect(from).toBe('test-secret');
    expect(toEmail).toBe(EMAIL);
    expect(code).toMatch(/^\d{6}$/);

    // The stored doc hashes the emailed code (bound to the email), attempts at 0.
    expect(otpRef.set).toHaveBeenCalledTimes(1);
    const stored = otpRef.set.mock.calls[0]![0] as Record<string, unknown>;
    expect(stored['codeHash']).toBe(hashCode(hashEmail(EMAIL), code as string));
    expect(stored['attempts']).toBe(0);
    expect(stored['expiresAt']).toBeGreaterThan(NOW);
    // Never the raw code or email in plaintext.
    expect(JSON.stringify(stored)).not.toContain(code as string);
    expect(JSON.stringify(stored)).not.toContain(EMAIL);
  });

  it('honours the resend cooldown (no resend within the window)', async () => {
    otpRef.get.mockResolvedValue(
      snap({ codeHash: 'x', lastSentAt: NOW - 5_000, expiresAt: NOW + 1000 }),
    );
    const result = await (requestEmailOtp as Function)({ data: { email: EMAIL } });
    expect(result).toEqual({ ok: true });
    expect(mockSendOtpEmail).not.toHaveBeenCalled();
    expect(otpRef.set).not.toHaveBeenCalled();
  });

  it('surfaces a send failure without storing a code, and reports it', async () => {
    mockSendOtpEmail.mockResolvedValue({ ok: false, error: new Error('resend down') });
    await expect((requestEmailOtp as Function)({ data: { email: EMAIL } })).rejects.toMatchObject({
      code: 'internal',
    });
    expect(otpRef.set).not.toHaveBeenCalled();
    expect(mockReportFlowError).toHaveBeenCalledTimes(1);
  });
});
