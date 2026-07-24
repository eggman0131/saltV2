// PWA install/standalone detection (issue #545). Pure client-side feature
// detection — no persisted state (Rule 3: no localStorage/sessionStorage). The
// explainer that consumes this self-resolves once the app is standalone, so
// there is nothing to persist. Reused by #544's iOS notification-permission
// flow, which needs the same "installed?"/"is this iOS Safari?" answers.

// `beforeinstallprompt` is not yet in lib.dom; this is the minimal shape we use.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

// Already running as an installed app? `display-mode: standalone` covers
// Android/desktop and installed iOS; `navigator.standalone` is the iOS-only
// legacy signal. Either one true ⇒ installed. This check is reliable (unlike
// the UA sniff below), so it leads.
function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const displayMode = window.matchMedia?.('(display-mode: standalone)')?.matches ?? false;
    const iosStandalone =
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    return displayMode || iosStandalone;
  } catch {
    return false;
  }
}

// Best-effort "is this iOS Safari?" — inherently fuzzy (Apple gives us no clean
// API). Worst case the explainer shows to a non-iOS user, who can dismiss it.
function detectIosSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator;
  const ua = nav.userAgent;
  // iPhone/iPod report iOS in the UA. iPadOS 13+ masquerades as desktop Safari,
  // so also treat a touch-capable "Macintosh" as iOS.
  const isIosDevice =
    /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && nav.maxTouchPoints > 1);
  if (!isIosDevice) return false;
  // Every iOS browser is WebKit, but only Safari offers Share → Add to Home
  // Screen. Exclude the known in-app / third-party engines (Chrome=CriOS,
  // Firefox=FxiOS, Edge=EdgiOS, Opera=OPiOS, Google app=GSA). Genuine in-app
  // webviews usually omit "Safari" from the UA and are filtered by the guard.
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua);
  return isSafari;
}

class InstallStore {
  // Reactive so a mid-session transition to standalone (or a successful install)
  // hides the explainer without a reload.
  isStandalone = $state(detectStandalone());
  // Static per session — the UA doesn't change under us.
  readonly isIosSafari = detectIosSafari();
  // True when the browser handed us a native install prompt to defer
  // (Android / desktop Chromium). iOS never fires this.
  canPromptInstall = $state(false);

  // A `beforeinstallprompt` event can only be used once; hold it until the user
  // clicks Install, then consume it.
  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  constructor() {
    if (typeof window === 'undefined') return;

    // Chromium fires this INSTEAD of auto-showing an install prompt. Capturing
    // it (and preventing the default mini-infobar) lets us offer an explicit
    // "Install Salt" button wired to a user gesture.
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e as BeforeInstallPromptEvent;
      this.canPromptInstall = true;
    });

    // Fired once the app is installed — drop the affordance for good.
    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.canPromptInstall = false;
      this.isStandalone = true;
    });

    // display-mode can flip to standalone without a reload; keep it live so the
    // explainer self-hides the moment the app is installed and relaunched.
    try {
      const mq = window.matchMedia('(display-mode: standalone)');
      mq.addEventListener?.('change', (e) => {
        if (e.matches) this.isStandalone = true;
      });
    } catch {
      /* matchMedia unavailable — the constructor-time value stands */
    }
  }

  // Trigger the native install dialog (Android / desktop Chromium). Must be
  // called from a user gesture. Returns the outcome, or null when there was no
  // deferred prompt to show (iOS, already installed, or already consumed).
  async promptInstall(): Promise<'accepted' | 'dismissed' | null> {
    const evt = this.deferredPrompt;
    if (!evt) return null;
    this.deferredPrompt = null;
    this.canPromptInstall = false;
    try {
      await evt.prompt();
      const { outcome } = await evt.userChoice;
      if (outcome === 'accepted') this.isStandalone = true;
      return outcome;
    } catch {
      return null;
    }
  }
}

export const install = new InstallStore();
