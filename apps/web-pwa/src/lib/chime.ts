// The cook-timer chime (issue #544, Phase 4): Mr Toad's "Poop-poop!" — a jaunty
// double bulb-horn (The Wind in the Willows). Synthesized with the Web Audio API
// so there is no binary asset to ship, and so it can be unlocked on a user
// gesture (timer start) for iOS Safari, which blocks audio not tied to one.
//
// In-app only. The background system-notification path keeps the OS default
// sound. Every call degrades to a silent no-op where Web Audio is unavailable
// (SSR, jsdom, older browsers), so callers never need to guard.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    try {
      ctx = new AC();
    } catch {
      return null;
    }
  }
  return ctx;
}

// Prime the audio context from a user gesture (e.g. tapping "start timer") so a
// later playChime() is permitted on iOS Safari. Safe to call repeatedly.
export function primeChime(): void {
  const c = getCtx();
  if (c && c.state === 'suspended') void c.resume();
}

// One "parp": a short horn-ish tone — two slightly-detuned sawtooths through a
// gentle low-pass, enveloped so it swells and fades rather than clicking.
function parp(c: AudioContext, start: number, freq: number, duration: number): void {
  const gain = c.createGain();
  gain.connect(c.destination);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
  gain.gain.setValueAtTime(0.3, start + duration - 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 2000;
  filter.connect(gain);

  for (const detune of [-6, 6]) {
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    osc.detune.value = detune;
    osc.connect(filter);
    osc.start(start);
    osc.stop(start + duration);
  }
}

// "Poop-poop!" — two parps, the second a touch higher and longer, like a
// bulb-horn's two squeezes.
export function playChime(): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();
  const now = c.currentTime;
  parp(c, now, 330, 0.18); // poop
  parp(c, now + 0.22, 392, 0.22); // poop!
}
