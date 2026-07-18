// Screen Wake Lock wrapper (cooking mode, Phase 1). A thin, feature-detected
// wrapper around the Screen Wake Lock API (`navigator.wakeLock`) so the cook page
// can keep the screen awake while the user has their hands full. This is a DISPLAY
// API, not storage — no Rule 3 concern.
//
// Everything here degrades gracefully and NEVER throws: an unsupported browser, a
// rejected acquire (e.g. the tab isn't visible, or the OS denies it), or a release
// on an already-released sentinel all resolve quietly. The caller flips a UI toggle
// optimistically and this module makes it real where it can.
//
// The OS releases a wake lock automatically whenever the page is hidden (tab
// switch, screen off). `createWakeLock().enable()` re-acquires on `visibilitychange`
// when the document becomes visible again, so the lock survives a backgrounding.

// Minimal structural types — the DOM lib may not ship WakeLock typings in every TS
// config, and we only touch this narrow surface.
interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}
interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

function wakeLockApi(): WakeLockLike | null {
  if (typeof navigator === 'undefined') return null;
  const wl = (navigator as unknown as { wakeLock?: WakeLockLike }).wakeLock;
  return wl ?? null;
}

// Feature-detect guard: the UI toggle is rendered only where this is true.
export function isWakeLockSupported(): boolean {
  return wakeLockApi() !== null;
}

export interface WakeLockController {
  // Acquire the lock and keep it (re-acquiring across visibility changes). Safe to
  // call when already enabled or when unsupported.
  enable(): Promise<void>;
  // Release the lock and stop re-acquiring. Safe to call when already disabled.
  disable(): Promise<void>;
}

// Create an idempotent wake-lock controller. Not a singleton — the cook page owns
// one instance for its lifetime and disables it on teardown.
export function createWakeLock(): WakeLockController {
  let sentinel: WakeLockSentinelLike | null = null;
  // Desired state: true once the user enables, false once they disable. The
  // visibility handler re-acquires only while this is true.
  let wanted = false;
  let visibilityListener: (() => void) | null = null;

  async function acquire(): Promise<void> {
    const api = wakeLockApi();
    if (!api || sentinel !== null) return;
    try {
      const s = await api.request('screen');
      // The OS may have flipped `wanted` off (disable() raced) or hidden the page
      // while awaiting — drop the freshly-acquired lock in that case.
      if (!wanted) {
        void s.release().catch(() => {});
        return;
      }
      sentinel = s;
      // The sentinel auto-releases when the page is hidden; clear our handle so the
      // visibility handler re-acquires cleanly on return.
      s.addEventListener('release', () => {
        if (sentinel === s) sentinel = null;
      });
    } catch {
      // Denied / not visible / unsupported — degrade silently.
    }
  }

  async function enable(): Promise<void> {
    wanted = true;
    if (typeof document !== 'undefined' && visibilityListener === null) {
      visibilityListener = () => {
        if (wanted && document.visibilityState === 'visible') void acquire();
      };
      document.addEventListener('visibilitychange', visibilityListener);
    }
    await acquire();
  }

  async function disable(): Promise<void> {
    wanted = false;
    if (visibilityListener !== null && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', visibilityListener);
      visibilityListener = null;
    }
    const s = sentinel;
    sentinel = null;
    if (s && !s.released) {
      try {
        await s.release();
      } catch {
        // Already released or the tab is gone — nothing to do.
      }
    }
  }

  return { enable, disable };
}
