// Ensures dist/node_modules contains the HOST platform's sharp native binary.
//
// The build's main `npm install --prefix dist ... --os=linux` deliberately
// targets the Linux test-emulator container and the Cloud Functions runtime
// (see apps/cloud-functions/package.json "build"). That install bakes ONLY a
// Linux sharp binary into dist. But `pnpm dev:emulators` runs the Functions
// emulator NATIVELY on the dev host (e.g. macOS arm64), where a Linux-only
// binary fails to load — sharp throws on require, the Functions codebase fails
// to analyze, NO triggers register, and every callable 404s (which the browser
// surfaces, misleadingly, as a CORS error).
//
// This step adds the host's sharp binary ALONGSIDE the Linux one. It is a no-op
// on Linux (the main install already covered it) and harmless on deploy (GCP
// reinstalls against dist/package.json) and in the Linux container (the extra
// non-Linux binary is simply ignored by sharp's runtime loader).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = resolve(pkgRoot, 'dist');

const { platform, arch } = process;

// The main install already targets Linux; nothing to add when the host is Linux.
if (platform === 'linux') {
  console.log('add-native-sharp: host is linux, main install already covers it — skipping');
  process.exit(0);
}

const sharpVersion = JSON.parse(
  readFileSync(resolve(distRoot, 'node_modules/sharp/package.json'), 'utf8'),
).version;

const platformPkg = `@img/sharp-${platform}-${arch}@${sharpVersion}`;
const libvipsPkg = `@img/sharp-libvips-${platform}-${arch}`;

console.log(`add-native-sharp: adding ${platformPkg} for native emulator on ${platform}-${arch}`);

// --no-save: don't touch dist/package.json (the deploy manifest stays Linux-clean).
// Explicit package names + --no-save add binaries without pruning the Linux ones.
execFileSync(
  'npm',
  [
    'install',
    '--prefix',
    distRoot,
    '--no-save',
    '--no-audit',
    '--no-fund',
    '--loglevel=error',
    `--os=${platform}`,
    `--cpu=${arch}`,
    '--include=optional',
    platformPkg,
    libvipsPkg,
  ],
  { stdio: 'inherit' },
);

console.log('add-native-sharp: done');
