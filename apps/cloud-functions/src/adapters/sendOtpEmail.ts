import { Resend } from 'resend';

// Bounded, non-throwing Resend wrapper for the OTP email (issue #546). Mirrors
// the withAiTimeout shape: returns a Result, never throws across the boundary
// (Rule 10). The caller reports an unexpected failure via observability/server.

export type SendEmailResult = { ok: true } | { ok: false; error: unknown };

// From address. Defaults to Resend's shared test sender (works without domain
// verification, so dev/staging can send immediately); production should set
// OTP_EMAIL_FROM to a verified sender on the project's own domain.
const OTP_FROM = process.env['OTP_EMAIL_FROM'] ?? 'Salt <onboarding@resend.dev>';

function otpText(code: string): string {
  return [
    `Your Salt sign-in code is ${code}.`,
    '',
    'Enter it in the app to finish signing in. It expires in 10 minutes.',
    "If you didn't request this, you can ignore this email.",
  ].join('\n');
}

function otpHtml(code: string): string {
  return `<div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; font-size: 16px; color: #1a1a1a;">
  <p>Your Salt sign-in code is:</p>
  <p style="font-size: 32px; font-weight: 700; letter-spacing: 6px; margin: 16px 0;">${code}</p>
  <p style="color: #666;">Enter it in the app to finish signing in. It expires in 10 minutes.</p>
  <p style="color: #666;">If you didn't request this, you can ignore this email.</p>
</div>`;
}

export async function sendOtpEmail(
  apiKey: string,
  to: string,
  code: string,
): Promise<SendEmailResult> {
  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: OTP_FROM,
      to,
      subject: `${code} is your Salt sign-in code`,
      text: otpText(code),
      html: otpHtml(code),
    });
    // Resend returns errors in-band (does not throw) — treat as a send failure.
    if (error) return { ok: false, error };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err };
  }
}
