import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const STOP_SCRIPT = path.join(REPO_ROOT, 'scripts/stop-test-emulators.mjs');

export default async function globalTeardown(): Promise<void> {
  const shouldTeardown = process.env.CI || process.env.E2E_TEARDOWN === '1';
  if (!shouldTeardown) {
    console.log(
      'globalTeardown: leaving test emulators running for faster subsequent runs (set E2E_TEARDOWN=1 or CI=1 to stop them).',
    );
    return;
  }
  execFileSync('node', [STOP_SCRIPT], { stdio: 'inherit' });
}
