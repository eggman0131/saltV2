// Autonomous probe authentication (issue #722).
//
// No service-account key file and no App Check debug token. Both credentials a
// probe needs are minted by the Admin SDK under ADC, signing through IAM on the
// project's Firebase Admin service account:
//
//   createCustomToken(uid)          -> exchanged for a real user ID token
//   getAppCheck().createToken(appId) -> a real App Check token
//
// A debug token would be a standing attestation bypass for anyone holding it;
// a minted token is revocable with an IAM change and shows up in App Check
// metrics as VALID, so probe traffic takes exactly the path a user's does.
//
// Both calls require `roles/iam.serviceAccountTokenCreator` on that service
// account — see docs/runbooks/cloud-smoke.md. Without it they fail with
// `iam.serviceAccounts.signBlob denied`.

import { applicationDefault, initializeApp, type App } from 'firebase-admin/app';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

import type { ProbeEnv } from './env.js';

/**
 * Stable, deliberately non-admin identity. Persistent rather than run-scoped so
 * probe traffic is attributable in Auth and CF logs, and so a failed run never
 * leaves a half-created user behind. It has no `members/{email}` doc, which is
 * what makes "denied on an admin-only write" a free assertion.
 *
 * `.invalid` is the reserved never-routable TLD (RFC 2606) — this address can
 * never receive mail.
 */
export const PROBE_UID = 'salt-probe';
export const PROBE_EMAIL = 'salt-probe@probe.invalid';

export interface ProbeIdentity {
  readonly uid: string;
  /** Real user ID token — sent as `Authorization: Bearer`, so rules apply. */
  readonly idToken: string;
  /** Real App Check token — sent as `X-Firebase-AppCheck`. */
  readonly appCheckToken: string;
}

export interface ProbeAdmin {
  readonly app: App;
  /** Rules-bypassing handle. Setup, teardown and settle-polling only. */
  readonly firestore: Firestore;
}

/**
 * `identitytoolkit` refuses user-ADC without a quota project. Setting it here
 * keeps the fix inside the harness rather than requiring every operator to
 * mutate their global `gcloud` ADC config.
 */
function ensureQuotaProject(projectId: string): void {
  process.env['GOOGLE_CLOUD_QUOTA_PROJECT'] ??= projectId;
}

export function initAdmin(env: ProbeEnv): ProbeAdmin {
  ensureQuotaProject(env.projectId);

  const app = initializeApp({
    projectId: env.projectId,
    credential: applicationDefault(),
    serviceAccountId: env.serviceAccount,
  });

  return { app, firestore: getFirestore(app) };
}

/**
 * Admin user creation does *not* fire the `beforeMemberCreated` blocking
 * function (that is `beforeUserCreated`, which only runs on client sign-up), so
 * the probe identity needs no `members` allowlist entry. Verified against
 * `s2-dev-eggman`.
 */
async function ensureProbeUser(admin: ProbeAdmin): Promise<void> {
  const auth = getAuth(admin.app);
  try {
    await auth.getUser(PROBE_UID);
  } catch {
    await auth.createUser({ uid: PROBE_UID, email: PROBE_EMAIL });
  }
}

async function exchangeForIdToken(env: ProbeEnv, customToken: string): Promise<string> {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${env.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: env.referer },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );

  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`custom-token exchange failed (${response.status}): ${JSON.stringify(body)}`);
  }

  const idToken = (body as { idToken?: unknown }).idToken;
  if (typeof idToken !== 'string') {
    throw new Error('custom-token exchange returned no idToken');
  }
  return idToken;
}

export async function signIn(env: ProbeEnv, admin: ProbeAdmin): Promise<ProbeIdentity> {
  await ensureProbeUser(admin);

  const customToken = await getAuth(admin.app).createCustomToken(PROBE_UID);
  const idToken = await exchangeForIdToken(env, customToken);

  // Callables do not set `consumeAppCheckToken`, so there is no replay
  // protection: one minted token is reusable for its whole TTL across a run.
  const { token: appCheckToken } = await getAppCheck(admin.app).createToken(env.appId);

  return { uid: PROBE_UID, idToken, appCheckToken };
}
