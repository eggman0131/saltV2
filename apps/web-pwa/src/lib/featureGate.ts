import { derived, readable, type Readable } from 'svelte/store';
import {
  areObservabilityFeatureFlagsSettled,
  isObservabilityFeatureEnabled,
  onObservabilityFeatureFlags,
  BREAD_FLAG_KEY,
} from '@salt/observability';

// The one place in the app that knows how to ask "is this feature on for me?"
// (issue #831).
//
// WHAT THIS IS FOR: shipping something half-built to main without shipping it to
// the household. A feature under construction stays in the trunk — no long-lived
// branch, no merge held open for weeks — and everyone except the people testing
// it simply never sees it exists.
//
// IT IS COSMETIC, NOT A PERMISSION BOUNDARY. The flag is evaluated in the browser
// and the data is family-shared either way; `firestore.rules` is untouched and a
// determined person with devtools can turn any of this back on. That is fine —
// what is being withheld is an unfinished screen, not somebody else's data. Do not
// build anything on this that would matter if it were bypassed.
//
// AND NOTHING MAY HINT THAT A FEATURE IS WITHHELD. There is no "coming soon", no
// greyed-out entry, no denial copy. A gated feature is simply absent — which is
// the one place this deliberately parts company with `AdminGuard`, whose denial
// message is right for an operator area you know exists and wrong for a feature
// you are not supposed to know about yet.

/**
 * The closed vocabulary of gated features. Gating the next unfinished thing means
 * adding a key here and a flag in PostHog — a union rather than a free string so
 * a typo is a compile error instead of a feature that silently stays hidden
 * forever (a misspelled flag reads as "off" and looks exactly like a working gate).
 */
export type FeatureKey = 'bread' | 'recipePhases';

// Feature key → PostHog flag key. Separate from the union so the flag can be
// renamed in PostHog without touching every call site, and so the app's word for
// a feature never has to match an analytics naming convention.
//
// The KEYS are this app's words. The VALUES are PostHog's, and come from
// `@salt/observability` (issue #1054) because the server half of the same gate
// asks about the same flag from an app this one cannot import.
//
// `recipePhases` is the exception that proves the rule, and its literal is
// deliberately local (issue #1122). `BREAD_FLAG_KEY` lives in @salt/observability
// because the bread gate has a SERVER half — `onBatchWritten` asks about the same
// flag from an app web-pwa cannot import — and a shared key is what stops the two
// spellings drifting. The phase timeline is browser-only: nothing in
// cloud-functions consults it, so a shared constant would be an export with no
// second reader. Give it one, and it moves.
const FLAG_KEY: Record<FeatureKey, string> = {
  bread: BREAD_FLAG_KEY,
  recipePhases: 'recipe-phases',
};

export interface FeatureGate {
  /** Whether the feature is on for THIS person right now. */
  enabled: boolean;
  /**
   * Whether the answer has arrived. False only while PostHog's flag payload is in
   * flight. A route guard must wait for this before redirecting, otherwise it
   * bounces the flagged user off their own page on first paint.
   */
  settled: boolean;
}

/**
 * A one-shot read, for the places that are already reactive for another reason
 * (a `$derived` in a page that re-runs anyway). Prefer `featureGate` where the
 * arrival of the flags is the only thing that would change the answer.
 *
 * Returns `true` when this build has no PostHog key at all — see
 * `isObservabilityFeatureEnabled`: without live PostHog nothing can be gated, so
 * unit tests and the e2e build see the whole app. A key that was supplied and then
 * failed to come up is the opposite case and fails closed.
 */
export function isFeatureEnabled(feature: FeatureKey): boolean {
  return isObservabilityFeatureEnabled(FLAG_KEY[feature]);
}

// Bumps whenever PostHog delivers a flag payload. Nothing reads the number — it
// exists purely to give the derived stores below something to invalidate on,
// since the flag values themselves live inside the SDK rather than in a store we
// could subscribe to. The subscription is torn down with the last subscriber.
const flagRevision = readable(0, (set) => {
  let n = 0;
  return onObservabilityFeatureFlags(() => set((n += 1)));
});

// One store per key, memoised, so every consumer of the same feature shares a
// single flag subscription rather than opening one apiece.
const gates = new Map<FeatureKey, Readable<FeatureGate>>();

/** The live gate for a feature: re-evaluates each time PostHog delivers flags. */
export function featureGate(feature: FeatureKey): Readable<FeatureGate> {
  const existing = gates.get(feature);
  if (existing) return existing;
  const store = derived(flagRevision, () => ({
    enabled: isFeatureEnabled(feature),
    settled: areObservabilityFeatureFlagsSettled(),
  }));
  gates.set(feature, store);
  return store;
}

/** Bread — formulas, batches and everything epic #778 is still building. */
export const breadGate = featureGate('bread');

/**
 * Recipe phases — the named phase strip and the planning timeline (issue #1122).
 *
 * Off, everything about recipe timing is exactly as it was: the Prep / Cook /
 * Total chips, the list's sort and chip, the edit page's three number inputs. On,
 * the phases replace them. It comes off in phase 4, together with the three
 * numbers it replaces.
 */
export const recipePhasesGate = featureGate('recipePhases');
