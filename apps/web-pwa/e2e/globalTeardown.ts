import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const STOP_SCRIPT = path.join(REPO_ROOT, 'scripts/stop-emulators.mjs');
const WATCHDOG_PID_FILE = path.join(os.tmpdir(), 'salt-emulator-watchdog.pid');

function killWatchdog(): void {
  if (!fs.existsSync(WATCHDOG_PID_FILE)) return;
  try {
    const pid = Number(fs.readFileSync(WATCHDOG_PID_FILE, 'utf8').trim());
    if (pid) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
  } catch {
    // unreadable PID file
  }
  try {
    fs.unlinkSync(WATCHDOG_PID_FILE);
  } catch {
    // already gone
  }
}

export default async function globalTeardown(): Promise<void> {
  execFileSync('node', [STOP_SCRIPT], { stdio: 'inherit' });
  killWatchdog();
}
