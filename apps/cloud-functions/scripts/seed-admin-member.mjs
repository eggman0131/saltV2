// One-off operator script: seed the first admin member (issue #155).
//
// WHY THIS EXISTS — the bootstrap chicken-and-egg: the beforeMemberCreated
// blocking function rejects any sign-in whose email is not already in the
// `members` collection, and the admin UI that manages `members` is itself
// admin-only. So the very first admin must be written directly with the Admin
// SDK (which bypasses both the blocking function and the security rules) BEFORE
// the blocking function is enabled on a project.
//
// USAGE
//   Against a real project (uses Application Default Credentials):
//     GOOGLE_CLOUD_PROJECT=<projectId> \
//       node apps/cloud-functions/scripts/seed-admin-member.mjs [email] [name]
//   Against the Firestore emulator:
//     FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GOOGLE_CLOUD_PROJECT=demo-salt \
//       node apps/cloud-functions/scripts/seed-admin-member.mjs
//
// Defaults to daniel@pendery.org / "Daniel" (the launch admin). Idempotent:
// re-running overwrites the same members/{email} doc.

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const email = (process.argv[2] ?? 'daniel@pendery.org').trim().toLowerCase();
const name = process.argv[3] ?? 'Daniel';
const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT;

if (!projectId) {
  console.error('Set GOOGLE_CLOUD_PROJECT to the target Firebase project id.');
  process.exit(1);
}

// Against the emulator, FIRESTORE_EMULATOR_HOST short-circuits credentials.
// Against a real project, ADC (gcloud auth application-default login, or a
// service account on CI) provides them.
const useEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
initializeApp(useEmulator ? { projectId } : { projectId, credential: applicationDefault() });

const member = {
  id: email,
  schemaVersion: 1,
  name,
  email,
  admin: true,
  sortOrder: 0,
  icon: null,
  updatedAt: new Date().toISOString(),
};

await getFirestore().collection('members').doc(email).set(member);
console.log(
  `Seeded admin member ${email} (${name}) in project ${projectId}` +
    (useEmulator ? ' [emulator]' : ''),
);
process.exit(0);
