// Firestore access as the *probe user* (issue #722).
//
// The Admin SDK bypasses security rules, so it can only ever be used for setup,
// teardown and settle-polling. Everything a probe means to assert about read or
// write permission goes through the REST API carrying the probe's ID token,
// which is the same path a browser takes — so rules are genuinely exercised,
// coverage the e2e suite barely gets.

import type { ProbeIdentity } from './auth.js';
import type { ProbeEnv } from './env.js';

const BASE = 'https://firestore.googleapis.com/v1';

/** Firestore's typed-value wire encoding. */
type FirestoreValue = Record<string, unknown>;

export interface RestResult {
  readonly httpStatus: number;
  /** `PERMISSION_DENIED`, `NOT_FOUND`, … or null when the call succeeded. */
  readonly errorStatus: string | null;
  readonly data: Record<string, unknown> | null;
}

function documentUrl(env: ProbeEnv, path: string): string {
  return `${BASE}/projects/${env.projectId}/databases/(default)/documents/${path}`;
}

export function encodeValue(value: unknown): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeValue) } };
  }
  if (typeof value === 'object') {
    return { mapValue: { fields: encodeFields(value as Record<string, unknown>) } };
  }
  throw new Error(`cannot encode value of type ${typeof value} for Firestore`);
}

export function encodeFields(doc: Record<string, unknown>): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (value === undefined) continue;
    fields[key] = encodeValue(value);
  }
  return fields;
}

export function decodeValue(value: FirestoreValue): unknown {
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value['stringValue'];
  if ('booleanValue' in value) return value['booleanValue'];
  if ('integerValue' in value) return Number(value['integerValue']);
  if ('doubleValue' in value) return value['doubleValue'];
  if ('timestampValue' in value) return value['timestampValue'];
  if ('arrayValue' in value) {
    const values = (value['arrayValue'] as { values?: FirestoreValue[] }).values ?? [];
    return values.map(decodeValue);
  }
  if ('mapValue' in value) {
    const fields = (value['mapValue'] as { fields?: Record<string, FirestoreValue> }).fields ?? {};
    return decodeFields(fields);
  }
  // referenceValue, geoPointValue, bytesValue — unused by Salt's schemas.
  return null;
}

export function decodeFields(fields: Record<string, FirestoreValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) out[key] = decodeValue(value);
  return out;
}

async function request(
  env: ProbeEnv,
  identity: ProbeIdentity,
  method: 'GET' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<RestResult> {
  const headers: Record<string, string> = { Authorization: `Bearer ${identity.idToken}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(documentUrl(env, path), {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const status = (payload as { error?: { status?: unknown } })?.error?.status;
    return {
      httpStatus: response.status,
      errorStatus: typeof status === 'string' ? status : 'UNKNOWN',
      data: null,
    };
  }

  const fields = (payload as { fields?: Record<string, FirestoreValue> }).fields ?? {};
  return { httpStatus: response.status, errorStatus: null, data: decodeFields(fields) };
}

/** Read a document as the probe user — rules apply. */
export function readAsUser(
  env: ProbeEnv,
  identity: ProbeIdentity,
  path: string,
): Promise<RestResult> {
  return request(env, identity, 'GET', path);
}

/** Write a document as the probe user — rules apply. Full-document set (LWW). */
export function writeAsUser(
  env: ProbeEnv,
  identity: ProbeIdentity,
  path: string,
  doc: Record<string, unknown>,
): Promise<RestResult> {
  return request(env, identity, 'PATCH', path, { fields: encodeFields(doc) });
}

/** Delete a document as the probe user — rules apply. */
export function deleteAsUser(
  env: ProbeEnv,
  identity: ProbeIdentity,
  path: string,
): Promise<RestResult> {
  return request(env, identity, 'DELETE', path);
}
