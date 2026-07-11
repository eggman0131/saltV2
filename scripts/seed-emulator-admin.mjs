#!/usr/bin/env node
// Idempotently seed the launch admin member into the DEV Firestore emulator
// once it is ready, so `pnpm dev:emulators` always yields a sign-in-able app —
// including in a fresh git worktree.
//
// WHY THIS EXISTS — sign-in bootstraps off a `members/{email}` doc: the
// beforeMemberCreated blocking function rejects any email not already in the
// `members` collection. That doc only ever lived in the gitignored
// `.emulator-data/` import, so a fresh worktree (which does not carry
// `.emulator-data/`) started with an empty dataset and no way to sign in
// (the admin UI that manages `members` is itself admin-only — the same
// chicken-and-egg the one-off seed-admin-member.mjs was written for).
//
// `dev:emulators` launches this in the BACKGROUND, before `exec`-ing
// `firebase emulators:start` in the foreground. It waits for the Firestore
// emulator to accept connections, then defers to the existing one-off seed
// (single source of truth for the member shape) with the emulator env set.
//
// Best-effort — it must never break the dev session:
//   * If the emulator never comes up (start failed), it times out and exits 0.
//   * A seed failure is warned, not thrown.
//   * It is idempotent: the underlying seed is a full `set`, so running it on an
//     already-seeded stack (the normal main-repo case) is a no-op in effect.
// Writing `members` fires no Cloud Function trigger, so re-running every start
// is free.

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'; // firebase.json emulators.firestore.port
const READINESS_URL = `http://${FIRESTORE_EMULATOR_HOST}/`;
const SEED_SCRIPT = path.join(REPO_ROOT, 'apps/cloud-functions/scripts/seed-admin-member.mjs');
const TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;

// The dev emulator stack is pinned to the default project (singleProjectMode).
function defaultProjectId() {
  try {
    const rc = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.firebaserc'), 'utf8'));
    return rc?.projects?.default ?? 'demo-salt';
  } catch {
    return 'demo-salt';
  }
}

// The Firestore emulator root replies 200 once it is serving requests.
async function firestoreReady() {
  try {
    const res = await fetch(READINESS_URL, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForFirestore() {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await firestoreReady()) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

if (!(await waitForFirestore())) {
  console.warn(
    `seed-emulator-admin: Firestore emulator not ready after ${TIMEOUT_MS / 1000}s — skipping admin seed.`,
  );
  process.exit(0);
}

try {
  execFileSync('node', [SEED_SCRIPT], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      FIRESTORE_EMULATOR_HOST,
      GOOGLE_CLOUD_PROJECT: defaultProjectId(),
    },
  });
} catch (err) {
  console.warn(`seed-emulator-admin: admin seed failed (non-fatal): ${err?.message ?? err}`);
}

process.exit(0);
