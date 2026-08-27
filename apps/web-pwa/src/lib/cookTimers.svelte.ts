import { fromStore } from 'svelte/store';
import {
  withTimerStarted,
  withTimerDismissed,
  timerProgress,
  isCheckInTimerId,
} from '@salt/domain';
import type { CookActiveTimerDoc, StepDoc } from '@salt/domain/schemas';
import { cookSession, persistCookSession, getCookSessionSnapshot } from './cookSessionService.js';
import { primeChime } from './chime.js';
import { AD_HOC_TIMER_LABEL, AD_HOC_TIMER_MINUTES, shouldNotifyFor } from './timerDefaults.js';

/**
 * The step timers a cook screen runs on — the live projection, the 1s tick, start,
 * dismiss, progress, and the one sheet all four ways in share.
 *
 * Press-to-start countdowns backed entirely by the Firestore session document.
 * Starting a timer writes an `activeTimers` entry with an ABSOLUTE `endsAt` (start +
 * durationMinutes); every countdown is `endsAt - now`, so a reload or a device switch
 * reconstructs the correct remaining time with no extra client state — the
 * resumability mechanism. One live timer per step. `notify` arms the server-side push
 * path: onCookTimerWrite enqueues a Cloud Task per newly-armed timer and
 * onCookTimerDispatch sends the notification at `endsAt`.
 *
 * SHARED by both cook screens (issue #994), because they are the same timers on the
 * same `cookSessions/{recipeId}_{uid}` document: a timer started in plain cook mode is
 * live in the guided one and vice versa. Two copies of this could drift into two
 * meanings of "one live timer per step" on a single document.
 *
 * The audible alert is NOT here. It lives in the app-level watcher
 * (`lib/cookTimerAlerts.ts`), which keeps ticking once the chef navigates off the cook
 * page — where the page, and any chime it owned, would be unmounted. This module owns
 * the VISUAL half only: the `now` that flips a chip to "Finished". Do not add a chime
 * here; two owners means two honks.
 *
 * Runes in a factory, following `./deck.svelte.ts` and `./cookLifecycle.svelte.ts`:
 * the state and effects declared here belong to the component that calls it, so its
 * teardown is the component's. The session store is bridged with `fromStore` for the
 * same reason it is there — a `$store` auto-subscription is component syntax and does
 * not exist in a `.svelte.ts` module.
 */

/** What every entry point hands to the one write that starts a timer. */
interface CookTimerEntry {
  id: string;
  stepId: string | null;
  label: string | null;
  durationMinutes: number;
}

/**
 * What the sheet was opened ON: which entry the confirm writes to, and what to
 * prefill. Captured on the way in so the sheet itself stays ignorant of steps, ids
 * and sessions.
 */
interface TimerSheetTarget {
  id: string;
  stepId: string | null;
  label: string;
  durationMinutes: number;
  running: boolean;
}

export interface CookTimersOptions {
  /**
   * The LIVE recipe's steps, read fresh on every lookup. Only used to recover a
   * duration a timer entry does not carry itself — see `timerProgressFor`.
   */
  steps: () => readonly StepDoc[];
  /**
   * Raise the timer sheet. The open flag stays with the page because the markup
   * binds it (`bind:open`), and a binding needs a variable it can assign to — a
   * getter on this object is not one. Everything the sheet is opened WITH is here.
   */
  showSheet: () => void;
  /**
   * The plan's partway reminders for a timer about to start, anchored to the instant
   * it starts from. Guided cook passes its plan's; plain cook mode passes NOTHING,
   * which is what makes "check-ins are guided-only" structural rather than a
   * condition someone can later get wrong — a screen with no plan in hand has no way
   * to arm a reminder, because it never supplies the thing that arms one.
   */
  armCheckIns?: (timerId: string, stepId: string | null, startMs: number) => CookActiveTimerDoc[];
}

export function createCookTimers(options: CookTimersOptions) {
  const session = fromStore(cookSession);

  const activeTimers = $derived(session.current?.activeTimers ?? []);

  // Keyed by STEP, deliberately: this is the "is there a live timer on the step I am
  // cooking?" lookup, not an identity map (that is `t.id`). Entries with no step of
  // their own are skipped rather than filed under a null key.
  //
  // So are guided check-ins (issue #751). A check-in carries its step, because the
  // push copy names it, so this must ask for the step's OWN timer rather than the last
  // entry that mentions the step — otherwise the inline control would count down a
  // reminder and its Cancel would call one off instead of the timer. That holds on
  // BOTH screens: plain cook mode never arms a check-in, but it shares the session
  // document with the guided one, so a cook who switches modes mid-braise finds them.
  const timerByStep = $derived(
    new Map(
      activeTimers.flatMap((t) =>
        t.stepId === null || isCheckInTimerId(t.id) ? [] : [[t.stepId, t] as const],
      ),
    ),
  );

  // A single in-memory 1s interval drives `now`. It only runs while at least one timer
  // is live (the effect re-runs when `activeTimers` gains or loses entries) and is torn
  // down on cleanup — no per-timer intervals, and nothing ticks at rest.
  let now = $state(Date.now());
  $effect(() => {
    if (activeTimers.length === 0) return;
    if (typeof setInterval !== 'function') return; // SSR / no timers guard
    const handle = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(handle);
  });

  // What the bar shows. A guided check-in that has FIRED leaves on its own: it is a
  // nudge, not a checkpoint, so there is nothing to confirm and nothing to dismiss, and
  // a "Check the heat — Finished" chip sitting over the braise for the next two hours
  // would be exactly the acknowledgement issue #751 forbids. The entry stays in the
  // document (harmless — its key is already in the enqueue diff) and goes when the timer
  // it hangs off is dismissed. Derived off `now` rather than folded into the effect
  // above, which must keep watching `activeTimers.length` or it would tear its own
  // interval down every second.
  const barTimers = $derived(
    activeTimers.filter((t) => !isCheckInTimerId(t.id) || Date.parse(t.endsAt) > now),
  );

  // The step's own duration, for the two places a timer entry may not carry one: a
  // legacy entry written before the field existed.
  function stepDurationFor(stepId: string | null): number | undefined {
    if (stepId === null) return undefined;
    return options.steps().find((s) => s.id === stepId)?.timer?.durationMinutes;
  }

  // The one write that starts a timer — every entry point funnels through it, so a
  // timer the cook set by hand is indistinguishable from one the recipe described the
  // moment it is running.
  function startTimerEntry(entry: CookTimerEntry): void {
    const s = getCookSessionSnapshot();
    if (!s) return;
    // Unlock the audio context on this user gesture so the app-level watcher can play
    // the chime when the timer ends, even on iOS Safari (which blocks audio not tied to
    // a gesture). Starting a timer is the ONLY gesture guaranteed to precede a chime,
    // so this stays here even though the chime itself does not.
    primeChime();
    // The clock is read HERE, not in the domain producer, which never reads one — and
    // ONCE, for the main timer and its check-ins alike, so every reminder is anchored to
    // the same instant the wait started from. Replacing any existing entry with the same
    // id is the producer's job — which is also all "adjust a running timer" is: the same
    // id, a fresh `endsAt`, through the same producer. `notify` re-derives from the
    // duration actually being started, so a timer stretched over the floor gains its
    // push backstop and one shortened under it loses it.
    const startMs = Date.now();
    const endsAt = new Date(startMs + entry.durationMinutes * 60_000).toISOString();
    void persistCookSession(
      withTimerStarted(
        s,
        { ...entry, endsAt, notify: shouldNotifyFor(entry.durationMinutes) },
        // Always offered; the producer takes them only when this is a fresh start.
        // Re-timing a running timer keeps the check-ins already armed, because their
        // anchor is the original start — see withTimerStarted.
        options.armCheckIns?.(entry.id, entry.stepId, startMs),
      ),
    );
  }

  function startTimer(step: StepDoc): void {
    const timer = step.timer;
    if (!timer) return;
    // A step timer's identity IS its step id, so there is nothing to mint.
    startTimerEntry({
      id: step.id,
      stepId: step.id,
      label: timer.description ?? null,
      durationMinutes: timer.durationMinutes,
    });
  }

  function dismissTimer(timerId: string): void {
    const s = getCookSessionSnapshot();
    if (!s) return;
    void persistCookSession(withTimerDismissed(s, timerId));
  }

  // Turns the timer's total run into the elapsed fraction the progress fill draws. The
  // total is the duration the timer was STARTED for; only a legacy entry (written before
  // the field existed) falls back to looking its step up in the LIVE recipe. With
  // neither — a step edited away, or an ad-hoc timer from before the field —
  // `timerProgress` returns null and the chip renders with no fill rather than a bogus
  // one.
  function timerProgressFor(timer: CookActiveTimerDoc): number | null {
    const durationMinutes = timer.durationMinutes ?? stepDurationFor(timer.stepId);
    return timerProgress(timer, durationMinutes ? durationMinutes * 60_000 : null, now);
  }

  // ─── The timer sheet ────────────────────────────────────────────────────────────
  // One sheet, three ways in: the pencil beside a step's timer button, the header's
  // timer button, and a tap on a running chip. What differs between them is only what
  // the sheet is PREFILLED with and which id the confirm writes to.
  //
  // The default ad-hoc timer's name and length are shared with My Kitchen, which can
  // start the same kind of timer without a cook to hang it on (issue #842) — one
  // default to remember rather than two. See lib/timerDefaults.ts.
  let sheetTarget = $state<TimerSheetTarget | null>(null);
  const sheetPrefill = $derived({
    label: sheetTarget?.label ?? AD_HOC_TIMER_LABEL,
    durationMinutes: sheetTarget?.durationMinutes ?? AD_HOC_TIMER_MINUTES,
  });

  function openTimerSheet(target: TimerSheetTarget): void {
    sheetTarget = target;
    options.showSheet();
  }

  // A step timer, before it starts. Re-read from the LIVE step every time, which is what
  // makes "reset to the recipe's duration" a thing you already have: cancel, tap the
  // pencil again.
  function openStepTimerSheet(step: StepDoc): void {
    if (!step.timer) return;
    openTimerSheet({
      id: step.id,
      stepId: step.id,
      label: step.timer.description ?? '',
      durationMinutes: step.timer.durationMinutes,
      running: false,
    });
  }

  // A timer already counting down. Prefilled with what it was SET for, not what is left
  // on it — the number in the sheet is the length of the run you are about to re-start,
  // and confirming re-times it from now.
  function openRunningTimerSheet(timer: CookActiveTimerDoc): void {
    openTimerSheet({
      id: timer.id,
      stepId: timer.stepId,
      label: timer.label ?? '',
      // Neither field survives on a legacy entry written before they existed, so the
      // step's own duration stands in, and the ad-hoc default behind that.
      durationMinutes:
        timer.durationMinutes ?? stepDurationFor(timer.stepId) ?? AD_HOC_TIMER_MINUTES,
      running: true,
    });
  }

  // A timer for something the recipe never mentioned. Its id is minted here because it
  // has no step to borrow one from, and `stepId: null` is what keeps it out of every
  // step's inline slot while leaving it in the persistent bar.
  function openAdHocTimerSheet(): void {
    openTimerSheet({
      id: crypto.randomUUID(),
      stepId: null,
      label: AD_HOC_TIMER_LABEL,
      durationMinutes: AD_HOC_TIMER_MINUTES,
      running: false,
    });
  }

  function confirmTimerSheet(next: { label: string; durationMinutes: number }): void {
    const target = sheetTarget;
    if (!target) return;
    startTimerEntry({
      id: target.id,
      stepId: target.stepId,
      // An emptied name is no name — the chip falls back to the step's label, or to
      // "Timer", exactly as an unlabelled step timer always has.
      label: next.label === '' ? null : next.label,
      durationMinutes: next.durationMinutes,
    });
  }

  return {
    /** The live timer for each step that has one — check-ins excluded. */
    get timerByStep(): ReadonlyMap<string, CookActiveTimerDoc> {
      return timerByStep;
    },
    /** What the persistent bar shows: every live timer, plus check-ins not yet fired. */
    get barTimers(): CookActiveTimerDoc[] {
      return barTimers;
    },
    /** The 1s clock every countdown on the screen is drawn against. */
    get now(): number {
      return now;
    },
    /** What the sheet opens holding. */
    get sheetPrefill(): { label: string; durationMinutes: number } {
      return sheetPrefill;
    },
    /** The entry the sheet was opened on, or `null` before it has ever opened. */
    get sheetTarget(): TimerSheetTarget | null {
      return sheetTarget;
    },
    startTimer,
    dismissTimer,
    timerProgressFor,
    openStepTimerSheet,
    openRunningTimerSheet,
    openAdHocTimerSheet,
    confirmTimerSheet,
  };
}
