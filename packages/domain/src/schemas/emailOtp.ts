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

// The in-flight code-entry step, persisted by web-pwa so it survives the app
// being torn down (#585 follow-up). An installed iOS PWA is routinely killed
// while the user is away in their email client fetching the code, so the step
// has to be restorable from storage rather than held in memory. It comes back
// through a JSON.parse boundary, hence a schema.
export const PendingEmailOtpSchema = z.object({
  email: z.string().email(),
  // Epoch ms the code was requested, so a restored step can be dropped once the
  // server-side code TTL has elapsed and the code would be rejected anyway.
  sentAt: z.number(),
});
export type PendingEmailOtp = z.infer<typeof PendingEmailOtpSchema>;
