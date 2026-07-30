// Emits dist/package.json — the package manifest that ships to Cloud Functions.
//
// The esbuild bundle (dist/index.js) inlines everything EXCEPT the
// --external packages (firebase-admin, firebase-functions, sharp). So the
// deployed artifact's only real runtime dependencies are those. sharp is a
// native module (prebuilt binaries) and MUST stay external so `npm install`
// against this manifest fetches the platform-correct binary on the Functions
// runtime. Crucially this manifest must contain NO `workspace:*` deps: Cloud
// Build runs plain `npm install` against it and cannot resolve pnpm's workspace
// protocol (EUNSUPPORTEDPROTOCOL).
//
// firebase.json points functions.source at dist/, so THIS file (not the source
// package.json with its workspace deps) is what gets uploaded.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = JSON.parse(readFileSync(resolve(pkgRoot, 'package.json'), 'utf8'));

const pick = (name) => {
  const v = src.dependencies?.[name];
  if (!v) throw new Error(`expected ${name} in cloud-functions dependencies`);
  return v;
};

const deployPkg = {
  name: 'salt-cloud-functions',
  type: 'module',
  // Relative to dist/, which is the deployed source root.
  main: 'index.js',
  // Drives the deployed Node runtime (nodejs22) — must be present.
  engines: src.engines,
  dependencies: {
    'firebase-admin': pick('firebase-admin'),
    'firebase-functions': pick('firebase-functions'),
    sharp: pick('sharp'),
  },
  // TEMPORARY upstream workaround (2026-07-30). @firebase/database-compat 2.1.5
  // requires '@firebase/app' at load time in dist/index.standalone.js while
  // declaring it only as an OPTIONAL peer — which npm never installs. So a fresh
  // install of firebase-admin (any 13.x/14.x: it depends on
  // @firebase/database-compat ^2.0.0) yields a tree that throws
  // "Cannot find module '@firebase/app'" the moment firebase-functions pulls in
  // firebase-admin/database. Salt never touches RTDB — the chain is
  // firebase-functions → lib/common/providers/database.js → firebase-admin/database.
  //
  // This manifest is the ONLY install in the repo without a lockfile behind it
  // (Cloud Build and globalSetup.ts both run plain `npm install` against it),
  // which is why it broke while pnpm-lock.yaml — already resolved at 2.1.4 —
  // kept the workspace working. The pin restores that same version, so the
  // deployed tree matches what the workspace builds and tests against.
  //
  // Symptoms if this is ever removed prematurely: the Functions emulator fails
  // to analyze the codebase (no triggers → the e2e container healthcheck never
  // passes), e2e sign-in dies as a misleading "Network error" (the
  // beforeMemberCreated blocking function is killed by the missing module), and
  // deployed functions crash on cold start. Drop the pin once upstream ships a
  // release that installs what it requires.
  overrides: {
    '@firebase/database-compat': '2.1.4',
  },
};

writeFileSync(resolve(pkgRoot, 'dist/package.json'), JSON.stringify(deployPkg, null, 2) + '\n');
console.log('wrote dist/package.json (deploy artifact: firebase-admin, firebase-functions, sharp)');
