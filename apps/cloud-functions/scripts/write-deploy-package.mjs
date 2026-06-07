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
};

writeFileSync(resolve(pkgRoot, 'dist/package.json'), JSON.stringify(deployPkg, null, 2) + '\n');
console.log('wrote dist/package.json (deploy artifact: firebase-admin, firebase-functions, sharp)');
