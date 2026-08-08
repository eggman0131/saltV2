import { get } from 'svelte/store';
import { push } from 'svelte-spa-router';
import type { CookSessionDoc } from '@salt/domain/schemas';
import { cookSession } from './cookSessionService.js';
import { addToast } from './toastStore.js';
import { playChime } from './chime.js';

// App-level cook-timer alerts (issue #544 follow-up). The chime used to live in
// CookModePage, which left a hole: a timer finishing while the chef was on the
// shopping list alerted NOWHERE. push-sw.js suppresses the OS notification
// whenever any window client is visible, and the cook page — the only thing that
// could chime — was unmounted. This watcher is the single in-app alert owner, so
// it runs for as long as the app is open, wherever the chef has navigated to.
//
// It reads the EXISTING cookSession store rather than opening a subscription of
// its own, because two things make that enough:
//   - the store is module-level, and CookModePage's teardown only drops the
//     Firestore listener, so the last snapshot survives navigation;
//   - `endsAt` is ABSOLUTE, so firing a timer needs a clock, not fresh data.
//
// Two cases that deliberately belong to the push instead:
//   - a cook STARTED on another device while we are elsewhere in the app —
//     nothing ever subscribed us to it, so there is no snapshot to tick;
//   - a timer cancelled on another device after we left the cook page still
//     alerts here (the dispatch handler re-reads the live session and no-ops; an
//     in-memory snapshot cannot). A spurious toast, never a missed timer.

const TICK_MS = 1_000;

// A lag longer than one tick means the page was FROZEN across the end-time (iOS
// suspends a backgrounded PWA and stops timers; browsers throttle hidden tabs).
// A frozen page has no visible window client, so push-sw.js did NOT suppress and
// the chef already got the OS notification — alerting on return would be a second
// alert for a timer they have already been told about.
const GRACE_MS = 2_000;

// Long enough to notice from across the kitchen, and it carries an action.
const TOAST_MS = 12_000;

function timerKey(sessionId: string, timerId: string, endsAt: string): string {
  return `${sessionId}::${timerId}@${endsAt}`;
}

function cookPath(session: CookSessionDoc): string {
  return `/recipes/${session.recipeId}/cook`;
}

// True when the chef is already looking at the cook page for THIS session, where
// the chip flips to "Finished" on its own — the chime carries the alert and a
// toast would only cover the chip's Dismiss button. Hash-routed app, so the live
// route is the hash; read directly rather than through the router so this stays a
// plain module with no component or store coupling.
function isViewingCook(session: CookSessionDoc): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.hash === `#${cookPath(session)}`;
}

export function initCookTimerAlerts(): () => void {
  // Both sets are keyed by session + timer id + end-time, so adjusting a timer
  // (which changes `endsAt`) is a new timer to be alerted for, and a re-armed
  // timer on a later cook is never mistaken for one already handled.
  const observedRunning = new Set<string>();
  const alerted = new Set<string>();

  function check(): void {
    const session = get(cookSession);
    if (!session) return;
    const now = Date.now();
    for (const timer of session.activeTimers) {
      const key = timerKey(session.id, timer.id, timer.endsAt);
      const endsAtMs = new Date(timer.endsAt).getTime();
      if (endsAtMs > now) {
        observedRunning.add(key);
        continue;
      }
      // Never seen running — it finished before this watcher was here (a fresh
      // load, or the cook picked up on another device), so it was never ours to
      // announce. Already alerted — nothing more to do.
      if (!observedRunning.has(key) || alerted.has(key)) continue;
      // Marked resolved whether or not it alerts, so a fire discovered late stays
      // silent rather than surfacing on some later tick.
      alerted.add(key);
      if (now - endsAtMs > GRACE_MS) continue;
      playChime();
      if (!isViewingCook(session)) {
        addToast('Timer finished', 'default', {
          action: { label: 'Back to the cook', onClick: () => push(cookPath(session)) },
          duration: TOAST_MS,
        });
      }
    }
  }

  // Observe anything already running before the first tick, so a timer started
  // moments before this ran is still eligible to alert.
  check();
  if (typeof setInterval !== 'function') return () => {}; // SSR guard
  const handle = setInterval(check, TICK_MS);
  return () => clearInterval(handle);
}
