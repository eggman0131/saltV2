import { Resend } from 'resend';

// Bounded, non-throwing Resend wrapper for the OTP email (issue #546). Mirrors
// the withAiTimeout shape: returns a Result, never throws across the boundary
// (Rule 10). The caller reports an unexpected failure via observability/server.

export type SendEmailResult = { ok: true } | { ok: false; error: unknown };

// Resend reports failures IN-BAND as a plain object, not a thrown Error. Passed
// straight to the reporting port it stringifies to "[object Object]" and the
// actual cause is lost (this is exactly what hid a week of dev send failures).
// Normalise to a real Error carrying Resend's own name/message/status.
function toSendError(error: unknown): Error {
  const { name, message, statusCode } = (error ?? {}) as {
    name?: string;
    message?: string;
    statusCode?: number;
  };
  const status = statusCode === undefined ? '' : ` [${statusCode}]`;
  return new Error(`Resend send failed${status}: ${name ?? 'unknown'}: ${message ?? 'no message'}`);
}

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

// `from` is supplied by the caller from Secret Manager, NOT process.env: deployed
// functions in this repo read runtime config only from Secret Manager, because the
// `dist` deploy source is wiped by every build so a `.env` there cannot survive.
// (Same constraint that moved VAPID_PUBLIC_KEY to a secret.) It must be an address
// on a Resend-verified domain — the shared `onboarding@resend.dev` test sender only
// delivers to the Resend account owner, so it is NOT a usable default.
export async function sendOtpEmail(
  apiKey: string,
  from: string,
  to: string,
  code: string,
): Promise<SendEmailResult> {
  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to,
      subject: `${code} is your Salt sign-in code`,
      text: otpText(code),
      html: otpHtml(code),
    });
    // Resend returns errors in-band (does not throw) — treat as a send failure.
    if (error) return { ok: false, error: toSendError(error) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err };
  }
}
