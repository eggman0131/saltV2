import { describe, it, expect, vi, afterEach } from 'vitest';

// The install store reads navigator/matchMedia at construction, so each test
// re-imports it fresh (vi.resetModules) after stubbing the environment it needs.

const originalUA = window.navigator.userAgent;
const originalMaxTouch = window.navigator.maxTouchPoints;

function setNavigator(userAgent: string, maxTouchPoints = 0): void {
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(window.navigator, 'maxTouchPoints', {
    value: maxTouchPoints,
    configurable: true,
  });
}

async function freshInstall() {
  vi.resetModules();
  return (await import('../src/lib/install.svelte.js')).install;
}

afterEach(() => {
  setNavigator(originalUA, originalMaxTouch ?? 0);
  vi.restoreAllMocks();
});

describe('install detection util (#545)', () => {
  it('reports not-standalone / not-iOS-Safari in a plain desktop context', async () => {
    setNavigator('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36');
    const install = await freshInstall();
    expect(install.isStandalone).toBe(false);
    expect(install.isIosSafari).toBe(false);
    expect(install.canPromptInstall).toBe(false);
  });

  it('detects iOS Safari (iPhone) that is not installed', async () => {
    setNavigator(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    );
    const install = await freshInstall();
    expect(install.isIosSafari).toBe(true);
    expect(install.isStandalone).toBe(false);
  });

  it('does NOT treat Chrome on iOS (CriOS) as iOS Safari', async () => {
    setNavigator(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0 Mobile/15E148 Safari/604.1',
    );
    const install = await freshInstall();
    expect(install.isIosSafari).toBe(false);
  });

  it('treats a touch-capable iPadOS (desktop-masquerading Safari) as iOS Safari', async () => {
    setNavigator(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      5,
    );
    const install = await freshInstall();
    expect(install.isIosSafari).toBe(true);
  });

  it('captures beforeinstallprompt and fires the native prompt on demand', async () => {
    setNavigator(
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
    );
    const install = await freshInstall();
    expect(install.canPromptInstall).toBe(false);

    const prompt = vi.fn().mockResolvedValue(undefined);
    const evt = new Event('beforeinstallprompt') as Event & Record<string, unknown>;
    evt['prompt'] = prompt;
    evt['userChoice'] = Promise.resolve({ outcome: 'accepted', platform: 'web' });
    window.dispatchEvent(evt);

    expect(install.canPromptInstall).toBe(true);

    const outcome = await install.promptInstall();
    expect(prompt).toHaveBeenCalledOnce();
    expect(outcome).toBe('accepted');
    expect(install.isStandalone).toBe(true);
    expect(install.canPromptInstall).toBe(false);

    // A beforeinstallprompt event is single-use — a second call is a no-op.
    expect(await install.promptInstall()).toBeNull();
  });

  it('flips to standalone on the appinstalled event', async () => {
    setNavigator(
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
    );
    const install = await freshInstall();
    expect(install.isStandalone).toBe(false);
    window.dispatchEvent(new Event('appinstalled'));
    expect(install.isStandalone).toBe(true);
  });
});
