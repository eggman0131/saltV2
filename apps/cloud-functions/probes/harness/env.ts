// Probe target resolution (issue #722).
//
// Every id a probe needs is *derived*, never hardcoded: project id, web API key
// and web app id all come from the same `apps/web-pwa/.env.<target>` file the
// PWA itself is built with, so a probe cannot drift from the app it is meant to
// be exercising. Hardcoded expected values are precisely what rotted
// docs/runbooks/product-forms-staging-validation.md.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The environments a probe may target. Production is deliberately absent. */
export const PROBE_TARGETS = ['dev', 'staging'] as const;
export type ProbeTarget = (typeof PROBE_TARGETS)[number];

/** `.env` file backing each target, relative to the repo root. */
const ENV_FILE: Record<ProbeTarget, string> = {
  dev: 'apps/web-pwa/.env.dev',
  staging: 'apps/web-pwa/.env.staging',
};

export interface ProbeEnv {
  readonly target: ProbeTarget;
  readonly projectId: string;
  /** Public browser key — referrer-restricted, see `referer` below. */
  readonly apiKey: string;
  /** Web app id, the audience for a minted App Check token. */
  readonly appId: string;
  /** Bucket the image triggers write into — probes clean up after them. */
  readonly storageBucket: string;
  /**
   * Service account whose IAM `signBlob` mints both the custom token and the
   * App Check token. Overridable, but the Firebase-generated name is uniform
   * across projects.
   */
  readonly serviceAccount: string;
  /**
   * The browser key is restricted to the app's own origins, so a headless
   * request sends no `Referer` and is refused. We send the app's default
   * Hosting origin — the same one a real browser would. This is not a
   * security bypass: the key is public by design (it ships in the bundle) and
   * referrer restrictions only deter casual reuse.
   */
  readonly referer: string;
}

/** Minimal `KEY=value` reader — enough for the flat, unquoted Vite env files. */
function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function required(vars: Record<string, string>, key: string, path: string): string {
  const value = vars[key];
  if (value === undefined || value === '') {
    throw new Error(`${path} is missing ${key} — cannot target this environment.`);
  }
  return value;
}

export function isProbeTarget(value: string): value is ProbeTarget {
  return (PROBE_TARGETS as readonly string[]).includes(value);
}

export function resolveEnv(target: ProbeTarget): ProbeEnv {
  const path = resolve(REPO_ROOT, ENV_FILE[target]);
  const vars = readEnvFile(path);

  const projectId = required(vars, 'VITE_FIREBASE_PROJECT_ID', path);

  return {
    target,
    projectId,
    apiKey: required(vars, 'VITE_FIREBASE_API_KEY', path),
    appId: required(vars, 'VITE_FIREBASE_APP_ID', path),
    storageBucket: required(vars, 'VITE_FIREBASE_STORAGE_BUCKET', path),
    serviceAccount:
      process.env['SALT_PROBE_SERVICE_ACCOUNT'] ??
      `firebase-adminsdk-fbsvc@${projectId}.iam.gserviceaccount.com`,
    referer: `https://${projectId}.web.app/`,
  };
}
