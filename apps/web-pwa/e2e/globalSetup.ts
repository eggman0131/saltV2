import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

export default async function globalSetup() {
  if (process.env.CI) return;
  const dir = path.dirname(fileURLToPath(import.meta.url));
  spawnSync('node', [path.resolve(dir, '../../../scripts/stop-emulators.mjs')], {
    stdio: 'inherit',
  });
}
