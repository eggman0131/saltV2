// Layer 1 — deployed callables over plain HTTPS (issue #722).
//
// Speaks the Firebase callable wire protocol directly rather than through the
// client SDK, so the probe stays a bare node script: POST `{ data }`, get back
// `{ result }` on 200 or `{ error: { status, message } }` otherwise.

import type { ProbeIdentity } from './auth.js';
import type { ProbeEnv } from './env.js';

/**
 * Structural stand-in for a zod schema. `zod` is not a direct dependency of
 * this package (the functions get `z` re-exported from genkit), and every
 * `@salt/domain/schemas` export satisfies this shape — so the harness validates
 * against the real schemas without pulling in a dependency of its own.
 */
export interface WireSchema<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: { message: string } };
}

/** Every callable is deployed here (`setGlobalOptions` in src/index.ts). */
const REGION = 'europe-west2';

export interface CallableResponse {
  readonly httpStatus: number;
  /** Callable error status (`UNAUTHENTICATED`, `INVALID_ARGUMENT`, …). */
  readonly errorStatus: string | null;
  readonly errorMessage: string | null;
  readonly result: unknown;
}

export interface CallOptions {
  /**
   * Omit the App Check header. Only for the negative assertion that an
   * unattested call is refused — every real journey sends attestation.
   */
  readonly withoutAppCheck?: boolean;
  /** Omit the auth header, to assert an unauthenticated call is refused. */
  readonly withoutAuth?: boolean;
}

export function callableUrl(env: ProbeEnv, name: string): string {
  return `https://${REGION}-${env.projectId}.cloudfunctions.net/${name}`;
}

export async function callCallable(
  env: ProbeEnv,
  identity: ProbeIdentity,
  name: string,
  data: unknown,
  options: CallOptions = {},
): Promise<CallableResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.withoutAuth !== true) headers['Authorization'] = `Bearer ${identity.idToken}`;
  if (options.withoutAppCheck !== true) headers['X-Firebase-AppCheck'] = identity.appCheckToken;

  const response = await fetch(callableUrl(env, name), {
    method: 'POST',
    headers,
    body: JSON.stringify({ data }),
  });

  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    // A non-JSON body is itself the signal (e.g. a Cloud Run 403 HTML page when
    // the callable has no `run.invoker` binding) — keep it as the message.
    return {
      httpStatus: response.status,
      errorStatus: response.ok ? null : 'NON_JSON_RESPONSE',
      errorMessage: text.slice(0, 300),
      result: null,
    };
  }

  const error = (body as { error?: { status?: unknown; message?: unknown } }).error;
  return {
    httpStatus: response.status,
    errorStatus: typeof error?.status === 'string' ? error.status : null,
    errorMessage: typeof error?.message === 'string' ? error.message : null,
    result: (body as { result?: unknown }).result ?? null,
  };
}

/**
 * Call and validate against the *same* `@salt/domain/schemas` shape the function
 * returns, so a wire-schema change surfaces here as a typecheck or parse
 * failure rather than as silent drift.
 */
export async function callAndParse<T>(
  env: ProbeEnv,
  identity: ProbeIdentity,
  name: string,
  data: unknown,
  schema: WireSchema<T>,
): Promise<T> {
  const response = await callCallable(env, identity, name, data);

  if (response.errorStatus !== null || response.httpStatus !== 200) {
    throw new Error(
      `${name} failed: HTTP ${response.httpStatus} ${response.errorStatus ?? ''} ${response.errorMessage ?? ''}`.trim(),
    );
  }

  const parsed = schema.safeParse(response.result);
  if (!parsed.success) {
    throw new Error(`${name} returned a payload the wire schema rejects: ${parsed.error.message}`);
  }
  return parsed.data;
}
