import { z } from 'zod';

// Email one-time-code (OTP) sign-in (issue #546). A standalone-iOS-safe
// alternative to magic link that completes entirely in-app. Both schemas are
// validated at the callable boundary → HttpsError('invalid-argument') on bad
// input (per the Zod conventions in CLAUDE.md).

export const EmailOtpRequestSchema = z.object({
  email: z.string().email(),
});
export type EmailOtpRequest = z.infer<typeof EmailOtpRequestSchema>;

export const EmailOtpVerifySchema = z.object({
  email: z.string().email(),
  // Exactly six digits — the shape the server mints. Validated here so a
  // malformed code never reaches the hash comparison.
  code: z.string().regex(/^\d{6}$/),
});
export type EmailOtpVerify = z.infer<typeof EmailOtpVerifySchema>;
