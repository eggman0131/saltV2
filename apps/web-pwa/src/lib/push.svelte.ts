import { savePushSubscription, deletePushSubscription } from '@salt/firebase-sync';
import { pushSubscriptionId } from '@salt/domain';
import type { PushSubscriptionDoc } from '@salt/domain/schemas';

// Cook-timer push subscription lifecycle (issue #544). Uses the native browser
// PushManager (no library) + VAPID. The subscription doc lives in Firestore
// (Rule 3: no browser storage) — the per-device id is derived from the push
// endpoint (which the browser owns), so no storage carve-out is needed. This is
// the app-layer composition; the actual Firestore write goes through
// firebase-sync (which never imports observability — Rule 4).

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '';

function detectSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

// VAPID application server key: base64url string → Uint8Array (what
// pushManager.subscribe expects).
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalised);
  // Back with an explicit ArrayBuffer (not ArrayBufferLike) so it satisfies the
  // BufferSource type the PushManager applicationServerKey expects.
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Stable per-device id from the subscription endpoint (SHA-256, truncated). The
// endpoint is unique per browser + push service, so this is a deterministic
// device key without persisting anything locally.
async function deviceHashFromEndpoint(endpoint: string): Promise<string> {
  const data = new TextEncoder().encode(endpoint);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

class PushStore {
  // Browser can do web push at all.
  readonly supported = detectSupported();
  // A VAPID public key is configured for this environment.
  readonly configured = VAPID_PUBLIC_KEY.length > 0;
  // This device currently has an active subscription + granted permission.
  enabled = $state(false);
  busy = $state(false);
  error = $state<string | null>(null);
  permissionDenied = $state(false);

  constructor() {
    void this.refresh();
  }

  // Reconcile `enabled` with the actual browser state (permission + live
  // subscription). Safe to call any time; degrades silently.
  async refresh(): Promise<void> {
    if (!this.supported) return;
    try {
      this.permissionDenied = Notification.permission === 'denied';
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      this.enabled = !!sub && Notification.permission === 'granted';
    } catch {
      /* leave defaults — treated as not enabled */
    }
  }

  // Enable on THIS device. MUST be called from a user gesture (iOS requires the
  // permission prompt to be gesture-initiated). Returns whether it succeeded.
  async enable(uid: string): Promise<boolean> {
    if (!this.supported || !this.configured || this.busy) return false;
    this.busy = true;
    this.error = null;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        this.permissionDenied = permission === 'denied';
        this.error = 'Notifications need permission — allow them to get timer alerts.';
        return false;
      }
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        }));

      const json = sub.toJSON();
      const keys = (json.keys ?? {}) as { p256dh?: string; auth?: string };
      if (!keys.p256dh || !keys.auth) {
        this.error = 'Could not read the subscription keys.';
        return false;
      }
      const deviceHash = await deviceHashFromEndpoint(sub.endpoint);
      const now = new Date().toISOString();
      const doc: PushSubscriptionDoc = {
        id: pushSubscriptionId(uid, deviceHash),
        schemaVersion: 1,
        ownerUid: uid,
        endpoint: sub.endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
        expirationTime: json.expirationTime ?? null,
        createdAt: now,
        updatedAt: now,
      };
      const result = await savePushSubscription(doc);
      if (result.kind !== 'ok') {
        this.error = 'Could not save your subscription. Please try again.';
        return false;
      }
      this.enabled = true;
      return true;
    } catch {
      this.error = 'Could not enable notifications. Please try again.';
      return false;
    } finally {
      this.busy = false;
    }
  }

  // Disable on THIS device: unsubscribe the browser + remove the Firestore doc.
  async disable(uid: string): Promise<void> {
    if (!this.supported || this.busy) return;
    this.busy = true;
    this.error = null;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const deviceHash = await deviceHashFromEndpoint(sub.endpoint);
        await sub.unsubscribe();
        await deletePushSubscription(pushSubscriptionId(uid, deviceHash));
      }
      this.enabled = false;
    } catch {
      this.error = 'Could not turn notifications off. Please try again.';
    } finally {
      this.busy = false;
    }
  }
}

export const push = new PushStore();
