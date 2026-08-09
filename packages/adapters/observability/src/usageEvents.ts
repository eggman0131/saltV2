import type { RecipeKind } from '@salt/domain';
import { trackObservabilityEvent } from './init.js';

// Feature-usage events (issue #684). The point is ranking the app's surfaces by
// actual use, per person, in production — so the taxonomy is a SMALL, closed,
// typed set, not a free capture channel: a new event means a new entry here,
// which keeps names/props consistent for the dashboard that consumes them.
//
// Identity and environment ride for free: posthog.identify(uid) has already run
// by the time any of these fire, and `deployment.environment` is a super
// property — so no call site passes either.
//
// IDS ONLY, NEVER CONTENT (the scrubbing rule): recipe/list ids are fine,
// user-typed text (item rawText, chat messages, recipe titles) must never
// appear in these properties.
export interface UsageEventMap {
  'recipe.created': {
    recipe_id: string;
    recipe_kind: RecipeKind;
    // How the recipe came to exist — the manual editor, the URL importer, the
    // cookbook-photo importer (#676), or chat's "Save as recipe".
    recipe_method: 'manual' | 'url' | 'photo' | 'chat';
  };
  'cook.started': { recipe_id: string };
  // Completed = the explicit "Finish cooking" action, not merely reaching the
  // last step; restarts and abandons do not fire this.
  'cook.completed': { recipe_id: string };
  'plan.edited': { plan_scope: 'week' | 'template' };
  // User-typed adds only — bulk recipe→list extraction is a different gesture
  // (already visible via canon.match's cf path) and deliberately not counted.
  'shopping.item_added': { list_id: string };
  // One event per tick-off gesture; a bulk multi-select completion is one event
  // carrying item_count rather than a burst of events.
  'shopping.item_completed': { list_id: string; item_count: number };
  // One event per ITEM actually ticked off — the purchase signal (issue #725).
  // Deliberately the opposite granularity to item_completed above, because the
  // question is ranking WHAT gets bought, not how often someone shops. Ranking
  // on the tick-off rather than the add drops two false positives an add-side
  // event cannot: items added then deleted, and items carried to the shop and
  // dropped as not required.
  //
  // Names come from the canon vocabulary (the same class of value canon.match
  // already publishes as canon_result), never from the item's user-typed
  // rawText. An item the matcher never resolved still fires, with both fields
  // null, so the denominator stays honest and matcher coverage stays visible.
  'shopping.item_purchased': {
    canon_id: string | null;
    canon_name: string | null;
    item_source: 'manual' | 'recipe';
  };
  // `variation` (issue #763) is a chat that starts from an existing dish without
  // being attached to it — a distinct journey from `blank`, which it would
  // otherwise be counted as, and the only way to tell how often a new recipe is
  // born from an old one.
  'chat.started': { chat_context: 'blank' | 'recipe' | 'variation' };
  'chat.message_sent': Record<string, never>;
}

export type UsageEventName = keyof UsageEventMap;

// Thin typed gate over posthog.capture: inert before init, never throws
// (Rule 10 via trackObservabilityEvent's safePosthog).
export function trackUsageEvent<K extends UsageEventName>(event: K, props: UsageEventMap[K]): void {
  trackObservabilityEvent(event, props);
}
