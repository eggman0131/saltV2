import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const STOP_SCRIPT = path.join(REPO_ROOT, 'scripts/stop-test-emulators.mjs');

export default async function globalTeardown(): Promise<void> {
  execFileSync('node', [STOP_SCRIPT], { stdio: 'inherit' });
}
