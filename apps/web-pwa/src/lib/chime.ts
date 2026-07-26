// The cook-timer chime (issue #544, Phase 4): Mr Toad's "Poop-poop!" — a jaunty
// double bulb-horn (The Wind in the Willows). Synthesized with the Web Audio API
// so there is no binary asset to ship, and so it can be unlocked on a user
// gesture (timer start) for iOS Safari, which blocks audio not tied to one.
//
// In-app only. The background system-notification path keeps the OS default
// sound. Every call degrades to a silent no-op where Web Audio is unavailable
// (SSR, jsdom, older browsers), so callers never need to guard.
//
// TUNED TO BE HEARD, not to be tasteful: a kitchen is noisy and the phone is
// usually on the far counter. Web Audio output is scaled by the DEVICE MEDIA
// VOLUME, and no web API can read or raise that, so the only headroom we own is
// between our own gain and full scale. This takes all of it:
//   - the envelope peaks near unity instead of the original 0.3 (~+9 dB), which
//     needs the per-oscillator trim below to stay clear of clipping;
//   - the lowpass opens 2 kHz → 5 kHz, keeping the harmonics in the band human
//     hearing is most sensitive to — a large PERCEIVED gain at the same peak,
//     and the cheapest loudness available to us;
//   - the pair repeats across ~2.6 s, because a single 0.4 s blip in the next
//     room is missed however loud it is.

let ctx: AudioContext | null = null;

// Envelope peak for one parp. The two detuned sawtooths are trimmed to 0.5 each
// before they sum (see `parp`), so the summed signal stays inside ±1 and this is
// the true output peak.
const PEAK = 0.9;

// How many times the two-parp figure repeats, and the gap between repeats.
const REPEATS = 3;
const REPEAT_GAP_S = 1.1;

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

// iOS Safari silences Web Audio while the hardware Ring/Silent switch is on, at
// ANY gain — so a chef whose phone lives on silent hears nothing however loud we
// synthesize, and no amount of tuning above can reach them. Declaring a
// `playback` audio session opts out of that. WebKit-only (Safari 16.4+) and
// still experimental, so it is feature-detected and any throw is swallowed;
// every other browser simply has no `navigator.audioSession`.
function claimPlaybackSession(): void {
  if (typeof navigator === 'undefined') return;
  try {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'playback';
  } catch {
    /* unsupported or disallowed — the chime still plays on the default session */
  }
}

// Prime the audio context from a user gesture (e.g. tapping "start timer") so a
// later playChime() is permitted on iOS Safari. Safe to call repeatedly.
export function primeChime(): void {
  claimPlaybackSession();
  const c = getCtx();
  if (c && c.state === 'suspended') void c.resume();
}

// One "parp": a short horn-ish tone — two slightly-detuned sawtooths through a
// low-pass, enveloped so it snaps on and off rather than clicking.
function parp(c: AudioContext, start: number, freq: number, duration: number): void {
  // Snap up over 20 ms, hold FLAT, release over the last 50 ms. The flat hold is
  // what makes a parp carry: average level sits at the peak instead of under a
  // swell, so it is loud for its whole length without ever exceeding PEAK.
  const env = c.createGain();
  env.connect(c.destination);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(PEAK, start + 0.02);
  env.gain.setValueAtTime(PEAK, start + duration - 0.05);
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 5000;
  filter.connect(env);

  for (const detune of [-6, 6]) {
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    osc.detune.value = detune;
    // The two sawtooths SUM into the filter, and a sawtooth is nominally ±1, so
    // each is halved first. Without this trim, constructive interference between
    // the detuned pair peaks near ±2 and an envelope anywhere near unity clips.
    const trim = c.createGain();
    trim.gain.value = 0.5;
    osc.connect(trim);
    trim.connect(filter);
    osc.start(start);
    osc.stop(start + duration);
  }
}

// "Poop-poop!" — two parps, the second a touch higher and longer, like a
// bulb-horn's two squeezes, repeated so the alert is still sounding when the chef
// looks up. The whole ~2.6 s is scheduled up front on the audio clock, so
// dismissing the timer mid-chime does not cut it short — at that length, letting
// it finish is better than the machinery to stop it.
export function playChime(): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();
  const now = c.currentTime;
  for (let i = 0; i < REPEATS; i++) {
    const at = now + i * REPEAT_GAP_S;
    parp(c, at, 330, 0.18); // poop
    parp(c, at + 0.22, 392, 0.22); // poop!
  }
}
