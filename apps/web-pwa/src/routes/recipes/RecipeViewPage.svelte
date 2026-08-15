<script lang="ts">
  import {
    Button,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    DetailPage,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Divider,
    Icon,
    ImageCropper,
    Markdown,
    Popover,
    PopoverContent,
    PopoverTrigger,
    Spinner,
    TextArea,
    TextField,
    type ImageCropperHandle,
  } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import { trackUsageEvent } from '@salt/observability';
  import { goBack } from '../../lib/nav.js';
  import { breadGate } from '../../lib/featureGate.js';
  import { withMealParam } from '../../lib/mealReturn.js';
  import {
    recipes,
    isLoadingRecipes,
    removeRecipe,
    canonicaliseIngredients,
    matchIngredient,
    persistRecipe,
    stashImportedDraft,
    regenerateRecipeImage,
    reviseRecipeSceneBrief,
    startOverRecipeSceneBrief,
    setRecipeImageUpload,
  } from '../../lib/recipeService.js';
  import RecipeImportPhotoDialog from './RecipeImportPhotoDialog.svelte';
  import RecipeImportUrlDialog from './RecipeImportUrlDialog.svelte';
  import RecipeAddToListSheet from './RecipeAddToListSheet.svelte';
  import RecipeAddToPlannerSheet from './RecipeAddToPlannerSheet.svelte';
  import RecipeBakeBatchSheet from './RecipeBakeBatchSheet.svelte';
  import RecipeChangeSummary from './RecipeChangeSummary.svelte';
  import RecipeChatList from './RecipeChatList.svelte';
  import RecipeChatDrawer from './RecipeChatDrawer.svelte';
  import { chatsForRecipe } from './recipeChats.js';
  import {
    proposeRecipeAmendment,
    proposeRecipeRefresh,
    applyRecipeAmendment,
    type RecipeAmendment,
  } from '../../lib/recipeAmend.js';
  import { authorRecipeFromChat } from '../../lib/chatRecipeAuthor.js';
  import IngredientText from './IngredientText.svelte';
  import { canonItems } from '../../lib/canonService.js';
  import {
    appendCacheBuster,
    duplicateRecipe,
    flattenIngredients,
    hasComponents,
    hasLiveCanonMatch,
    isAuthorable,
    isCookable,
    isPlannable,
    looksScalable,
    resolveComponents,
    takesIngredients,
    type IngredientGroup,
    type Ingredient,
    type Recipe,
  } from '@salt/domain';
  import { KIND_COPY, kindOf } from './recipeKind.js';
  import type { ChatSessionDoc } from '@salt/domain/schemas';
  import type { DomainError, ReadResult } from '@salt/shared-types';
  import {
    guidedPlan,
    initGuidedPlanSync,
    discardGuidedPlan,
  } from '../../lib/guidedPlanService.js';
  import { formula, initFormulaSync } from '../../lib/formulaService.js';
  import { currentMember } from '../../lib/membersService.js';
  import { defaultListId } from '../../lib/shoppingListService.svelte.js';
  import { addToast } from '../../lib/toastStore.js';
  import { auth } from '../../lib/auth.svelte.js';
  import { createChatSession, sessions } from '../../lib/chatService.js';
  import ChatThread from '../chat/ChatThread.svelte';
  import { createChatThread } from '../chat/chatThreadState.svelte.js';
  import { equipment } from '../../lib/equipmentService.js';
  import {
    clipboardImageReadSupported,
    readClipboardImage,
    imageFromClipboardData,
  } from '../../lib/clipboardImage.js';

  // ─── "Optimise for my kitchen" canned prompt ─────────────────────────────────
  // A shortcut for a prompt you could type by hand, not a new capability: this
  // lands in the transcript as an ordinary USER turn, which is why it lives here
  // beside the sidebar and not in any flow prompt file. chefChat already has both
  // the household equipment manifest and the current recipe server-side, so the
  // text deliberately names no appliance — the manifest is injected for us, and
  // hardcoding kit here would go stale the moment the household buys something.
  //
  // The wording carries four loads: method-only (an ingredient rewrite would put
  // every ingredient back through canon matching for nothing), timings and
  // temperatures MOVING with the method (a pressure-cooker step that keeps the
  // two-hour simmer is worse than no change), proportionality (leaving a step
  // alone is a valid and common outcome), and a short account of what changed so
  // the chat turn reads on its own before you open the diff.
  const OPTIMISE_FOR_KITCHEN_PROMPT = `Go through this recipe's method and re-work it around the equipment I actually own.

Where a piece of my kit genuinely does a step better, rewrite that step to use it, and be specific: name the appliance, the mode, the accessory and the setting. Move the timings and temperatures with it — a step that changes equipment has to carry the times and temperatures that equipment actually needs, not the ones inherited from the original method. A step handed to different kit but left on the old timings is worse than no change at all.

Change the method only. Leave the ingredients, the quantities and the servings exactly as they are — this is about how it is cooked, not what goes into it.

Be proportionate. Only move a step where the result or the effort is genuinely better for it, counting set-up and washing-up as part of the cost. Leaving a step exactly as written is a good outcome, and if nothing in this recipe is better off on my kit, say so plainly rather than finding something to change.

Finish with a short note on what you changed and why, so I can read the gist here before I look at the recipe itself.`;

  interface Props {
    params: { id: string };
  }
  let { params }: Props = $props();

  const recipe = $derived($recipes.find((r) => r.id === params.id) ?? null);

  // Outbound link to the original recipe, only for url-sourced (imported) recipes
  // with a non-empty url. Manual/legacy recipes (source null) render nothing.
  const sourceUrl = $derived(
    recipe?.source?.type === 'url' && (recipe.source.url ?? '').trim() !== ''
      ? recipe.source.url!
      : null,
  );

  // "Makes: <name>" chip — resolve the produces canon link to its display name.
  // null when the recipe isn't linked or the canon item has since been deleted.
  const producesCanonName = $derived(
    recipe?.producesCanonId
      ? ($canonItems.find((c) => c.id === recipe.producesCanonId)?.name ?? null)
      : null,
  );

  // What this entry can do (issue #637). Everything that gates a section or an
  // action on this page reads one of these two — never the kind itself. Both are
  // false while the recipe is still loading, which is the conservative side: a
  // Cook button that appears and then vanishes is worse than one that arrives
  // with the content it belongs to.
  const showIngredients = $derived(recipe !== null && takesIngredients(kindOf(recipe)));
  const showCooking = $derived(recipe !== null && isCookable(kindOf(recipe)));
  // "Add to planner" offers this entry for a night, which is the same question
  // the planner's own picker asks — so it answers with the same predicate. A
  // cocktail is not dinner and a placeholder is attached, never chosen; neither
  // gets the button here, exactly as neither appears in the picker there.
  const showPlanning = $derived(recipe !== null && isPlannable(kindOf(recipe)));
  // TWO ⋮ items ask this one question, in two different groups: "Make a
  // variation" hands the dish to the librarian as the starting point for a new
  // one (issue #763), and "Refresh" hands it over to be re-transcribed (issue
  // #784). Neither is asking whether the action suits the kind — both are asking
  // whether the librarian can WRITE this kind at all, which is exactly
  // `isAuthorable`. Hence one predicate and no fifth capability: when
  // `isAuthorable` gains a kind (cocktails, #765) both items appear there with
  // no edit here.
  const canAuthor = $derived(recipe !== null && isAuthorable(kindOf(recipe)));

  // ─── The dishes this dinner is made of (issue #752) ─────────────────────────
  // Display only — attaching, reordering and removing all live in the editor,
  // because they are edits to the document and belong with every other one.
  //
  // Resolved against the same in-memory `recipes` store the rest of the page
  // reads, so an id whose recipe has been deleted elsewhere simply produces one
  // card fewer: `resolveComponents` skips what it cannot find rather than
  // rendering a row nobody can act on. ONE LEVEL ONLY — a component's own
  // components are not shown and are not read, which is what makes a cycle inert.
  const components = $derived(recipe === null ? [] : resolveComponents(recipe, $recipes));
  // The section appears for a MEAL, not for anything that could become one, and
  // the question is asked of the document rather than of the resolved list: a meal
  // all of whose components have been deleted still says it is a meal, and saying
  // so with an empty list is more honest than pretending the field is not there.
  const showComponents = $derived(recipe !== null && hasComponents(recipe));

  // ─── Adding another dish to this meal (issue #752, Phase 3) ─────────────────
  // All four ways of making a recipe, offered FROM the meal: import a link,
  // photograph a page, chat one up, or write it out. Each carries this meal's id
  // in the URL it navigates to (`?meal=<id>`, see lib/mealReturn.ts), and the
  // save at the far end attaches what it produced and comes back here.
  //
  // Gated on `showComponents` with the card, deliberately: this surface adds
  // ANOTHER dish to something that is already a meal. Turning an ordinary recipe
  // into one in the first place stays in the editor's "Made from" picker, where
  // Phase 1 put it.
  //
  // It lives on the VIEW page and not the editor for two reasons: leaving the
  // editor mid-flow would silently bin an unsaved draft of the meal, and "land
  // back on the meal" means this page — so the round trip starts and ends in the
  // same place.
  let componentMenuOpen = $state(false);
  let showComponentUrlImport = $state(false);
  let showComponentPhotoImport = $state(false);

  // Both imports are already PERSISTED by their callable (issue #616), flagged
  // unreviewed, so the hand-off is exactly the list page's: stash the draft so
  // the editor paints without waiting for the Firestore listener, then open that
  // recipe's editor — carrying the meal, which is the only difference.
  function openComponentEditor(imported: Recipe, method: 'url' | 'photo'): void {
    if (recipe === null) return;
    trackUsageEvent('recipe.created', {
      recipe_id: imported.id,
      recipe_kind: imported.kind,
      recipe_method: method,
    });
    stashImportedDraft(imported);
    showComponentUrlImport = false;
    showComponentPhotoImport = false;
    // If navigation itself fails, surface it rather than silently closing: the
    // recipe exists either way, so the user isn't stranded. Same as the list page.
    try {
      push(withMealParam(`/recipes/${imported.id}/edit`, recipe.id));
    } catch {
      addToast('Could not open the editor — please try again.', 'destructive');
    }
  }

  function startComponent(path: string): void {
    if (recipe === null) return;
    componentMenuOpen = false;
    push(withMealParam(path, recipe.id));
  }

  // ─── Does this recipe have a guided plan? (issue #751, Phase 2) ──────────────
  // Subscribed here so the action row can offer "Cook, guided" only where there is
  // something to be guided BY. There is no all-plans subscription anywhere in the
  // app — a plan is read one recipe at a time — so this is the only way to answer
  // the question, and it is answered on the page that asks it.
  //
  // The store is a module singleton the plan editor also drives, and every `init`
  // resets it to the not-loaded state first, so the two pages can never show each
  // other's plan. Its three states are load-bearing here for the same reason
  // `showCooking` is conservative: `undefined` means "not loaded", and rendering
  // the button on it would flash an action that then vanishes.
  $effect(() => {
    const id = params.id;
    if (!id) return;
    return initGuidedPlanSync(id);
  });
  const hasGuidedPlan = $derived($guidedPlan !== null && $guidedPlan !== undefined);
  // Used-but-flagged, never a gate (guidedPlan.ts): the plan is fully live either
  // way, and this only records that no human has read it. Absent means reviewed.
  const guidedPlanUnread = $derived($guidedPlan?.needs_approval === true);

  // ─── Does this recipe have a formula? (issue #812, phase 1 of epic #778) ─────
  //
  // PRESENCE, NOT KIND, and the distinction is the rule that keeps
  // `capabilities.ts` four columns wide: capabilities answer questions about the
  // KIND ("is this offered in the planner?"), presence answers questions about the
  // DOCUMENT ("does this have a formula?"). A loaf is an ordinary `recipe` — there
  // is no `bread` kind and there will not be one
  // (docs/formulas-schedules-batches.md) — so nothing here consults `kindOf`, and
  // nothing was added to the capability table for it.
  //
  // Subscribed here for the same reason the guided plan is: there is no all-formulas
  // subscription anywhere in the app, a formula is read one recipe at a time, and
  // this is the page that asks the question. The store's three states matter — with
  // `undefined` folded into "has one", both entries below would flash and vanish on
  // every recipe that has no formula, which is nearly all of them.
  //
  // GATED WHILE THE FEATURE IS BEING BUILT (issue #831). The gate sits on the
  // subscription rather than only on the two menu entries, so someone outside the
  // test group never reads `formulas/*` at all — the flag is cosmetic, but there
  // is no reason to spend a listener on an answer that can only be discarded.
  const breadEnabled = $derived($breadGate.enabled);
  $effect(() => {
    if (!breadEnabled) return;
    const id = params.id;
    if (!id) return;
    return initFormulaSync(id);
  });
  const hasFormula = $derived(breadEnabled && $formula !== null && $formula !== undefined);

  // ─── Could this recipe HAVE one? (issue #823) ────────────────────────────────
  //
  // Presence-and-shape again, one notch softer than `hasFormula`: not "does this
  // have a formula" but "does this look like something that could". The answer is
  // the domain's own basis guess asked as a yes/no — the same decision the formula
  // screen makes when it opens, so the offer can never lead somewhere the screen
  // then disagrees with. Still nothing about `kind` anywhere near it: a loaf is an
  // ordinary `recipe`, and there is no `bread` kind.
  //
  // An empty guess means "not offered" here, where the mapping screen reads it as
  // "you pick". That is the whole cost of the gate and it is bounded: a loaf whose
  // only flour line the keyword list has never heard of loses a menu item, not
  // access — `/recipes/:id/formula` is still typed-URL reachable.
  //
  // Canon LEADS and lands after first paint, so this is asked again as it arrives.
  // Every loaf in the library says "flour" in its own line too, so in practice the
  // item is there immediately; a recipe that reads as flour ONLY through its canon
  // name would see it appear a beat late, which is the accepted price of adding no
  // read here (the formula subscription above is the only one this costs).
  const canonNameById = $derived(new Map($canonItems.map((c) => [c.id, c.name])));
  const couldHaveFormula = $derived(
    recipe !== null &&
      looksScalable(
        flattenIngredients(recipe).map((ing) => ({
          ingredientId: ing.id,
          canonName: (ing.canonId ? canonNameById.get(ing.canonId) : null) ?? null,
          rawText: ing.rawText,
        })),
      ),
  );
  // Mutually exclusive with the pair above by construction: the moment a formula
  // is saved this goes false and "Bake a batch" / "Formula" take the slot.
  const showMakeScalable = $derived(breadEnabled && !hasFormula && couldHaveFormula);

  // ─── Which half of the Cook control is the primary one (issue #776) ─────────
  //
  // A per-person preference off this member's own doc, defaulting to `standard`
  // for everyone who has never set it — which is every member today, so nothing
  // changes for anyone until they choose.
  //
  // The control keeps its shape either way: the wide labelled half is your
  // default and the icon half is the other mode. That is what keeps the promise
  // that standard cook mode is always one tap away, whichever way this is set.
  const prefersGuided = $derived($currentMember?.cookMode === 'guided');
  // Guided leads only when there is a plan to be guided BY. On a recipe nobody has
  // written one for, the wide button is standard cook mode — a default should not
  // put a dead end where the obvious action was.
  const guidedIsPrimary = $derived(prefersGuided && hasGuidedPlan);
  // The second half appears when there is a plan (as before) AND, new here, when
  // guided is your default but this recipe has none: that is exactly the person
  // who wants to be offered the plan, and the screen it leads to now offers to
  // write one.
  const showGuidedHalf = $derived(hasGuidedPlan || prefersGuided);
  const primaryCookHref = $derived(
    guidedIsPrimary ? `/recipes/${params.id}/cook/guided` : `/recipes/${params.id}/cook`,
  );
  const secondaryCookHref = $derived(
    guidedIsPrimary ? `/recipes/${params.id}/cook` : `/recipes/${params.id}/cook/guided`,
  );

  function timeParts(): string[] {
    if (!recipe) return [];
    // Serves / Prep / Cook / Total are cooking facts. An outing has none of
    // them, and gating here covers both the chips and the card that wraps them.
    if (!isCookable(kindOf(recipe))) return [];
    const m = recipe.metadata;
    const parts: string[] = [];
    if (m.servings !== null) parts.push(`Serves ${m.servings}`);
    if (m.prepTimeMinutes !== null) parts.push(`Prep ${m.prepTimeMinutes} min`);
    if (m.cookTimeMinutes !== null) parts.push(`Cook ${m.cookTimeMinutes} min`);
    if (m.totalTimeMinutes !== null) parts.push(`Total ${m.totalTimeMinutes} min`);
    return parts;
  }

  // ─── Canon live-id set (for dangling-match derivation) ───────────────────────
  const liveCanonIds = $derived(new Set($canonItems.map((c) => c.id)));

  // ─── Canonicalise ────────────────────────────────────────────────────────────
  let canonalising = $state(false);

  const hasParsedPending = $derived(
    recipe !== null &&
      recipe.ingredients.some((g) =>
        g.items.some((ing) => ing.parsed !== null && !hasLiveCanonMatch(ing, liveCanonIds)),
      ),
  );

  async function handleCanonicalise(): Promise<void> {
    if (!recipe) return;
    canonalising = true;
    const result = await canonicaliseIngredients(recipe);
    canonalising = false;
    if (result.kind !== 'ok') {
      addToast('Canonicalisation failed.', 'destructive');
      return;
    }
    addToast('Ingredients matched.', 'success');
  }

  // ─── Per-row rematch ─────────────────────────────────────────────────────────
  // The unmatched indicator (✗) is the trigger: tapping it parses + canon-matches
  // that single ingredient and persists the recipe. Re-derives from the current
  // store copy and discards the result if the row changed mid-flight.
  let matchingIds = $state<Record<string, boolean>>({});

  async function handleRematch(group: IngredientGroup, ing: Ingredient): Promise<void> {
    if (!recipe || matchingIds[ing.id]) return;
    matchingIds = { ...matchingIds, [ing.id]: true };
    const result = await matchIngredient(ing);
    matchingIds = { ...matchingIds, [ing.id]: false };
    if (result.kind !== 'ok') {
      addToast('Failed to match ingredient.', 'destructive');
      return;
    }
    const current = $recipes.find((r) => r.id === recipe.id);
    if (!current) return;
    const updatedGroups = current.ingredients.map((g) =>
      g.id !== group.id
        ? g
        : {
            ...g,
            items: g.items.map((i) =>
              i.id === ing.id && i.rawText === ing.rawText ? result.value : i,
            ),
          },
    );
    const persisted = await persistRecipe({ ...current, ingredients: updatedGroups });
    if (persisted.kind !== 'ok') {
      addToast('Failed to save match.', 'destructive');
    }
  }

  // ─── Review state (issue #616) ────────────────────────────────────────────
  // A URL-imported recipe is persisted by the callable flagged `needs_approval`
  // — raw AI output nobody has read. It is fully live regardless (cookable,
  // plannable, searchable); the flag only marks it unread. An editor save clears
  // it, and so does this: for an import that came through clean, forcing an
  // edit-and-save just to mark it read is busywork.
  let markingReviewed = $state(false);

  async function handleMarkReviewed(): Promise<void> {
    if (!recipe || markingReviewed) return;
    const current = $recipes.find((r) => r.id === recipe.id);
    if (!current) return;
    markingReviewed = true;
    // Dropped, not set false — absent means reviewed (matches the schema and the
    // full-document setDoc persistRecipe performs).
    const { needs_approval: _wasUnreviewed, ...reviewed } = current;
    const persisted = await persistRecipe(reviewed);
    markingReviewed = false;
    if (persisted.kind !== 'ok') {
      addToast('Failed to mark as reviewed.', 'destructive');
    }
  }

  // ─── Add to shopping list ─────────────────────────────────────────────────
  // The review sheet (issue #185) owns servings + per-ingredient Add/Check
  // toggles + the commit; this page only guards that a default list exists.
  let addToListOpen = $state(false);

  // ─── Add to planner ───────────────────────────────────────────────────────
  // The picker sheet owns the calendar and the write; this page only opens it.
  let addToPlannerOpen = $state(false);

  // "Bake a batch" — the scale sheet (issue #812). Opened from the overflow menu;
  // see the placement note there.
  let bakeBatchOpen = $state(false);

  // Mobile-only overflow menu (⋮) that holds the secondary header actions
  // (Ask/amend, Edit, Delete) below the `sm` breakpoint; Cook + Add to list
  // stay visible at every width. Desktop keeps all five as inline buttons.
  let overflowMenuOpen = $state(false);

  function openAddToList(): void {
    if (!$defaultListId) {
      addToast('No shopping list found. Create one first.', 'destructive');
      return;
    }
    addToListOpen = true;
  }

  // ─── This recipe's chats ─────────────────────────────────────────────────────
  // Every conversation about this dish, newest first — a client-side filter over
  // the sessions store the app already holds (issue #696).
  const recipeChats = $derived(recipe ? chatsForRecipe($sessions, recipe.id) : []);

  // Which one is on screen. An EXPLICIT selection: every entry point sets it, and
  // it falls back to the newest so a recipe you have never chosen a chat on still
  // opens on the conversation you last had. Cleared implicitly when the selected
  // session is gone, because the lookup simply misses.
  let selectedSessionId = $state<string | null>(null);
  const activeSession = $derived(
    recipeChats.find((s) => s.id === selectedSessionId) ?? recipeChats[0] ?? null,
  );

  let amendBusy = $state(false);

  // Start a fresh line of enquiry about this dish. Seeds the title from the recipe
  // ("Cauliflower Steaks chat") until the chef retitles it, and selects it so
  // whichever surface is showing a chat switches to the new one.
  async function createRecipeChat(): Promise<ChatSessionDoc | null> {
    if (!recipe) return null;
    const uid = auth.user?.uid;
    if (!uid) return null;
    amendBusy = true;
    const result = await createChatSession(uid, recipe.id, recipe.title);
    amendBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to open chat.', 'destructive');
      return null;
    }
    selectedSessionId = result.value.id;
    return result.value;
  }

  // Is the chat docked in a column of its own? From the fold up it is, and there is
  // nothing for a drawer to do; below it, opening a chat raises the drawer over the
  // live recipe. `false` — the phone path — is the honest default whenever the answer
  // cannot be read: SSR, a jsdom without `matchMedia`, a query the engine rejects.
  // Same shape as `MealPlanWeekPage`'s split read, which is the house pattern.
  //
  // This must stay the SAME GATE as the `split:` variant the column is laid out with
  // (`app.css`), and in the same RANGE SYNTAX the browser actually sees: on an engine
  // too old for range queries the emitted CSS is inert, and a `min-width:` query here
  // would answer "yes, docked" for a page that is still one column — suppressing the
  // drawer with no pane to replace it, i.e. a recipe where tapping a chat does nothing.
  const DOCKED_QUERY = '(width >= 700px) and (height >= 480px)';
  let docked = $state(false);
  $effect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(DOCKED_QUERY);
    } catch {
      return;
    }
    docked = mql.matches;
    // A stubbed MediaQueryList (the unit suite ships one) can carry no listener API at
    // all, and resizing is the only thing the listener is for.
    if (typeof mql.addEventListener !== 'function') return;
    const onChange = (event: MediaQueryListEvent): void => {
      docked = event.matches;
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  });

  // The drawer's stop is in-memory only and so is whether it is open — Rule 3, and
  // nothing here is worth restoring across a reload anyway.
  let drawerOpen = $state(false);

  // Opening a chat from the recipe never leaves the recipe. Above the seam the chat is
  // already beside it, so selecting is the whole action; below it, the drawer rises.
  function openChat(session: ChatSessionDoc): void {
    selectedSessionId = session.id;
    if (!docked) {
      drawerOpen = true;
      scrollRecipeToBody();
    }
  }

  // The strip the drawer leaves visible should hold the ingredients, not the hero photo
  // — the whole point is reading the answer and the thing it is about in one glance. So
  // the page behind scrolls to its body on open, and only then: at every other moment
  // the recipe's scroll position is the user's.
  let bodyAnchorEl = $state<HTMLElement | undefined>(undefined);

  function scrollRecipeToBody(): void {
    bodyAnchorEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function handleNewChat(): Promise<void> {
    const created = await createRecipeChat();
    if (created) openChat(created);
  }

  // "Chat" in the header and in the ⋮ menu. CONTINUES the most recent conversation
  // about this dish rather than silently starting another — a new one is a
  // deliberate act, and the list's "New chat" is where you do it.
  async function handleAskAmend(): Promise<void> {
    if (!recipe) return;
    const newest = recipeChats[0];
    if (newest) {
      openChat(newest);
      return;
    }
    await handleNewChat();
  }

  // "Duplicate" in the ⋮ menu (issue #735). Nothing is written: the copy is
  // stashed as an unsaved draft and the editor picks it up, so backing out costs
  // no document and no hero-image generation. `duplicateRecipe` owns the whole
  // what-carries policy — do not reset fields here. The stash is the SAME
  // single-use seam URL and photo import already use; there is deliberately no
  // second draft-passing mechanism, no query param and no store.
  function handleDuplicate(): void {
    if (!recipe) return;
    stashImportedDraft(duplicateRecipe(recipe, crypto.randomUUID(), new Date().toISOString()));
    push('/recipes/new');
  }

  // "Make a variation" in the ⋮ menu (issue #763). Opens a NEW chat that holds
  // this recipe as its starting point and navigates AWAY to it, which is the
  // honest destination: the conversation is about a different dish, it is not
  // attached to this one, and so it deliberately does not appear in this page's
  // own chat list. Only the session document is written — no recipe and no image
  // generation until "Save as recipe".
  let variationBusy = $state(false);

  async function handleMakeVariation(): Promise<void> {
    if (!recipe || variationBusy) return;
    const uid = auth.user?.uid;
    if (!uid) return;
    variationBusy = true;
    const result = await createChatSession(uid, null, recipe.title, recipe.id);
    variationBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to start a variation.', 'destructive');
      return;
    }
    push(`/chat/${result.value.id}`);
  }

  // The transcript, the composer, the auto-scroll and the send path are all
  // ChatThread's — this page only holds the live turn state so "Optimise for my
  // kitchen" can start one on a session the component is not yet showing.
  const chat = createChatThread();

  // ─── Optimise for my kitchen ────────────────────────────────────────────────
  // Sends OPTIMISE_FOR_KITCHEN_PROMPT as an ordinary user turn, creating the
  // session first when the recipe has no chat yet. Nothing downstream is special:
  // the reply is a normal assistant turn, and "Review changes" runs authorRecipe
  // over the transcript exactly as it does for a hand-typed request.
  //
  // Hidden when the household owns no equipment — with an empty manifest the
  // server injects no kit section at all and the prompt asks the chef to reason
  // about nothing.
  const hasEquipment = $derived(($equipment?.items ?? []).length > 0);
  let optimiseBusy = $state(false);

  async function handleOptimiseForKitchen(): Promise<void> {
    if (!recipe || optimiseBusy || chat.isSending) return;
    const uid = auth.user?.uid;
    if (!uid) return;
    optimiseBusy = true;

    const session = activeSession ?? (await createRecipeChat());
    if (!session) {
      optimiseBusy = false;
      return;
    }
    // Put the transcript somewhere visible before the reply starts arriving in it.
    openChat(session);

    await chat.send(session, OPTIMISE_FOR_KITCHEN_PROMPT);
    optimiseBusy = false;
  }

  // Review-and-approve gate. "Update recipe" generates a PENDING proposal and
  // opens a diff summary; nothing is written until "Apply changes". What the
  // proposal contains and what the save writes live in `recipeAmend` and are
  // shared with the full `/chat/:id` page (issue #764) — this page holds only
  // its own busy/open state and its toasts. `sidebarIsProposing` guards the AI
  // call; `sidebarIsApplying` guards the save.
  let sidebarIsProposing = $state(false);
  let sidebarIsApplying = $state(false);
  let sidebarSummaryOpen = $state(false);
  let sidebarPending = $state<RecipeAmendment | null>(null);
  // Whether the pending proposal came from Refresh rather than from the chat
  // (issue #784). It decides ONE thing — whether applying also discards the
  // guided plan — and it is state rather than a second apply handler because
  // there is only one diff sheet and `onApply` binds to one function. Reset by
  // both entry points, so a discard-then-chat-amend cannot inherit it.
  let sidebarPendingIsRefresh = $state(false);

  async function handleSidebarReviewChanges(): Promise<void> {
    if (!activeSession || !recipe || sidebarIsProposing) return;
    sidebarIsProposing = true;
    const existingTags = [...new Set($recipes.flatMap((r) => r.metadata.tags))];
    const result = await proposeRecipeAmendment(recipe, activeSession.messages, existingTags);
    sidebarIsProposing = false;
    if (result.kind !== 'ok') {
      addToast('Failed to generate recipe update.', 'destructive');
      return;
    }
    sidebarPending = result.value;
    sidebarPendingIsRefresh = false;
    sidebarSummaryOpen = true;
  }

  async function handleSidebarApplyChanges(): Promise<void> {
    if (!sidebarPending || sidebarIsApplying) return;
    const wasRefresh = sidebarPendingIsRefresh;
    const refreshedId = sidebarPending.updated.id;
    sidebarIsApplying = true;
    const saveResult = await applyRecipeAmendment(sidebarPending);
    // A refresh re-mints every step id, so the guided plan's `stepId`
    // references no longer resolve (issue #784). Discard it here and the next
    // visit to guided mode writes a fresh one against the refreshed method;
    // leave it and guided mode is silently wrong. Only after the save succeeds —
    // throwing away the plan for a write that never landed would be a plain
    // loss. Best-effort: a failed delete leaves a stale plan, which is the
    // situation we were already in, so it must not turn a successful save into
    // an error the user has to interpret.
    if (saveResult.kind === 'ok' && wasRefresh) await discardGuidedPlan(refreshedId);
    sidebarIsApplying = false;
    if (saveResult.kind !== 'ok') {
      addToast('Failed to save recipe update.', 'destructive');
      return;
    }
    sidebarSummaryOpen = false;
    sidebarPending = null;
    sidebarPendingIsRefresh = false;
    addToast('Recipe updated!', 'success');
  }

  function handleSidebarDiscardChanges(): void {
    sidebarSummaryOpen = false;
    sidebarPending = null;
    sidebarPendingIsRefresh = false;
  }

  // ─── Refresh (issue #784) ───────────────────────────────────────────────────
  // Re-runs the librarian over THIS dish with today's house writing rules and
  // shows what it would change in the same review gate a chat amendment uses.
  // Nothing is written until Apply; Discard leaves the recipe exactly as it was.
  //
  // It is not Optimise, which sits beside it: Optimise reworks the METHOD around
  // the kit the household owns, and deliberately knows what that kit is. Refresh
  // deliberately does not — it re-applies the WRITING rules and leaves the
  // cooking alone. Two different questions, two menu items.
  //
  // No chat session is created and no transcript is written: this goes straight
  // from the menu item into the diff, because there is no conversation to have.
  let refreshBusy = $state(false);

  async function handleRefresh(): Promise<void> {
    if (!recipe || refreshBusy || sidebarIsProposing) return;
    refreshBusy = true;
    const existingTags = [...new Set($recipes.flatMap((r) => r.metadata.tags))];
    const result = await proposeRecipeRefresh(recipe, existingTags);
    refreshBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to refresh recipe.', 'destructive');
      return;
    }
    sidebarPending = result.value;
    sidebarPendingIsRefresh = true;
    sidebarSummaryOpen = true;
  }

  // "Save as new recipe" (issue #798) — the other thing a conversation beside a
  // dish can produce. You asked what would go with the lamb, the chef wrote out a
  // salad, and this keeps the salad as a recipe of its own.
  //
  // The dish on this page is NOT written to: what gets authored and saved lives in
  // `chatRecipeAuthor` and is shared with the full `/chat/:id` page, and it only
  // ever takes the create path. No `basedOnRecipeId` — an accompaniment is not
  // derived from what it accompanies, and variation mode would drag this recipe's
  // ingredients into it. No claim either: the conversation stays listed here.
  let sidebarIsSavingNew = $state(false);

  async function handleSaveAsNewRecipe(): Promise<void> {
    if (!activeSession || sidebarIsSavingNew) return;
    sidebarIsSavingNew = true;
    const existingTags = [...new Set($recipes.flatMap((r) => r.metadata.tags))];
    const result = await authorRecipeFromChat({
      messages: activeSession.messages,
      existingTags,
      basedOnRecipeId: null,
    });
    sidebarIsSavingNew = false;
    if (result.kind !== 'ok') {
      addToast(
        result.error.stage === 'author' ? 'Failed to generate recipe.' : 'Failed to save recipe.',
        'destructive',
      );
      return;
    }
    addToast('New recipe saved!', 'success');
    push(`/recipes/${result.value.id}`);
  }

  // ─── Delete ─────────────────────────────────────────────────────────────────
  let deleteOpen = $state(false);
  let deleteBusy = $state(false);

  async function handleDelete(): Promise<void> {
    if (!recipe) return;
    const title = recipe.title;
    deleteBusy = true;
    const result = await removeRecipe(recipe.id);
    deleteBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to delete recipe.', 'destructive');
      return;
    }
    deleteOpen = false;
    addToast(`Deleted ${title}`, 'success');
    push('/recipes');
  }

  // ─── Hero image (issue #148, Tier-2) ─────────────────────────────────────────
  // The photoreal hero is generated automatically by the onRecipeWritten trigger
  // on create; the manual escape hatch is Regenerate (with an optional steer),
  // surfaced as a subtle overlay control on the image. While a (re)generation is
  // in flight the new URL simply arrives via the recipe subscription — there is no
  // in-flight flag on the doc, so `imageBusy` only guards the button between click
  // and callable return. `imageHidden` is retired (inert, kept for back-compat) so
  // hero visibility is purely "does an image URL exist".
  const heroVisible = $derived(!!recipe?.image?.url);
  let imageBusy = $state(false);
  let regenOpen = $state(false);
  // The art direction for the next generation. Seeded on every open from the brief
  // saved beside the current image, so the dialog opens filled in with no load —
  // it is already on the recipe doc the page is subscribed to. Editing this text
  // *is* the steer, which is why the old one-line "Steer (optional)" hint input is
  // gone: it steered a brief the user could not see, and now they can just write it.
  let regenBrief = $state('');

  async function runRegenerate(brief?: string): Promise<void> {
    if (!recipe || imageBusy) return;
    imageBusy = true;
    const result = await regenerateRecipeImage(recipe.id, brief);
    imageBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to start image generation.', 'destructive');
      return;
    }
    addToast('Generating a new image — it will appear shortly.', 'success');
  }

  // Re-seed on every open (not once): the trigger re-saves imageBrief after each
  // successful generation, so the next open shows the brief that produced the image
  // now on screen — the user's own edited text, not the original. A recipe with no
  // brief yet seeds '' and the dialog reads as it always did: an empty optional box,
  // no error, no spinner — omitting it lets the trigger author one.
  function openRegenerate(): void {
    regenBrief = recipe?.imageBrief ?? '';
    regenHint = '';
    briefError = null;
    regenOpen = true;
  }

  async function handleRegenerateConfirm(): Promise<void> {
    const brief = regenBrief.trim();
    regenOpen = false;
    await runRegenerate(brief || undefined);
  }

  // ─── Brief revision + start over (issue #522, Phase 3) ───────────────────────
  // Both actions call the describeRecipeScene callable, which PERSISTS NOTHING —
  // the new brief lands back in the box, still editable, and only becomes the
  // recipe's art direction if the user then presses Regenerate. That is the point:
  // the brief is cheap and the image is not, so you iterate the words for a
  // fraction of a cent and buy exactly one render once they are right.
  //
  // The steer is deliberately NOT `imageHint` (retired, inert): it never touches
  // the wire as a persisted field, it is a one-shot instruction to the text model
  // that dies with the round trip. What persists is its RESULT, once, via the brief.
  let regenHint = $state('');
  let briefBusy = $state(false);
  let briefError = $state<string | null>(null);

  // Shared by both actions: run it, swap the brief in on success, and on failure
  // leave the box EXACTLY as it was. A revision that failed must not cost the user
  // the brief they already had — that text may be several edits deep, and a
  // transient callable error is no reason to throw it away.
  async function runBriefAction(
    action: () => Promise<ReadResult<string, DomainError>>,
  ): Promise<void> {
    if (!recipe || briefBusy) return;
    briefBusy = true;
    briefError = null;
    const result = await action();
    briefBusy = false;
    if (result.kind !== 'ok') {
      briefError = "Couldn't rewrite the brief — your text is unchanged. Try again.";
      return;
    }
    regenBrief = result.value;
  }

  async function handleReviseBrief(): Promise<void> {
    const hint = regenHint.trim();
    const brief = regenBrief.trim();
    // Revision needs both halves. With no brief to revise, the honest action is
    // "start over" — the button label already says so, so there is nothing to do.
    if (!hint || !brief) return;
    const target = recipe;
    if (!target) return;
    await runBriefAction(() => reviseRecipeSceneBrief(target, brief, hint));
    // The steer is spent: it has been folded into the brief, and leaving it in the
    // box invites a second Revise that applies "make it summery" to an already
    // summery brief.
    if (!briefError) regenHint = '';
  }

  async function handleStartOverBrief(): Promise<void> {
    const target = recipe;
    if (!target) return;
    regenHint = '';
    await runBriefAction(() => startOverRecipeSceneBrief(target));
  }

  // ─── Upload a local photo (issue #455, Phase 2) ──────────────────────────────
  // Pick a file → crop to 3:2 (pan/zoom) in the ImageCropper primitive → Save
  // sends the cropped bytes (base64) to the setRecipeImageUpload callable, which
  // re-encodes and writes `recipe-images/{id}.webp` then stamps
  // `image = { url, source: 'upload' }`. The new URL arrives via the subscription;
  // a bumped `imageRequestedAt` nonce cache-busts the identical Storage URL so the
  // photo appears immediately. Regenerate never clobbers an uploaded photo (the
  // trigger skips `source: 'upload'`).
  let uploadOpen = $state(false);
  let uploadBusy = $state(false);
  let uploadSrc = $state<string | null>(null);
  let cropper = $state<ImageCropperHandle | undefined>(undefined);

  function openUpload(): void {
    clearUploadSrc();
    uploadBusy = false;
    uploadOpen = true;
  }

  // Object-URL lifecycle: revoke the previous blob URL before replacing/clearing
  // so a re-pick or a close doesn't leak it.
  function clearUploadSrc(): void {
    if (uploadSrc) URL.revokeObjectURL(uploadSrc);
    uploadSrc = null;
  }

  function handleUploadFileChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset the input so re-picking the SAME file still fires a change event.
    input.value = '';
    if (!file) return;
    routeImageBlob(file);
  }

  // Shared sink for both file and clipboard sources: revoke any prior blob URL,
  // then feed the new image into the cropper exactly as the file path does.
  function routeImageBlob(blob: Blob): void {
    clearUploadSrc();
    uploadSrc = URL.createObjectURL(blob);
  }

  // ─── Paste from clipboard (issue #455, Phase 3) ──────────────────────────────
  // Two entry points into the SAME 3:2 crop → setRecipeImageUpload pipeline: an
  // explicit Paste button (async Clipboard `read()`) and ⌘/Ctrl-V while the
  // dialog is open (the `paste` event's clipboardData). The button is gated on
  // `clipboardImageReadSupported()` because some browsers expose no `read()`;
  // the keyboard listener needs no such gate — it uses clipboardData — so it
  // stays active regardless. Neither path throws: an unsupported/denied/empty
  // clipboard just shows a hint (see clipboardImage.ts).
  const canPasteFromClipboard = clipboardImageReadSupported();
  const pasteShortcutLabel =
    typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.userAgent)
      ? '⌘V'
      : 'Ctrl+V';

  async function handlePasteButton(): Promise<void> {
    if (uploadBusy) return;
    const blob = await readClipboardImage();
    if (!blob) {
      addToast('No image found on the clipboard.', 'default');
      return;
    }
    routeImageBlob(blob);
  }

  function handleDialogPaste(e: ClipboardEvent): void {
    if (uploadBusy) return;
    const blob = imageFromClipboardData(e.clipboardData);
    if (!blob) return;
    e.preventDefault();
    routeImageBlob(blob);
  }

  // Listen for ⌘/Ctrl-V only while the dialog is open. The dialog renders in a
  // portal, so bind at the document level and gate on `uploadOpen`.
  $effect(() => {
    if (!uploadOpen) return;
    const listener = (e: ClipboardEvent): void => handleDialogPaste(e);
    document.addEventListener('paste', listener);
    return () => document.removeEventListener('paste', listener);
  });

  function handleUploadOpenChange(open: boolean): void {
    uploadOpen = open;
    if (!open) {
      clearUploadSrc();
      uploadBusy = false;
    }
  }

  async function handleUploadSave(): Promise<void> {
    if (!recipe || !cropper || uploadBusy) return;
    uploadBusy = true;
    const base64 = await cropper.getCroppedBase64();
    if (!base64) {
      uploadBusy = false;
      addToast('Could not read that image — try another.', 'destructive');
      return;
    }
    const result = await setRecipeImageUpload(recipe.id, base64, 'image/webp');
    uploadBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to upload image.', 'destructive');
      return;
    }
    handleUploadOpenChange(false);
    addToast('Photo updated.', 'success');
  }
</script>

{#if recipe === null}
  <div class="p-4 sm:p-6">
    {#if $isLoadingRecipes}
      <p class="text-sm text-muted-foreground">Loading…</p>
    {:else}
      <p class="text-sm text-muted-foreground">Recipe not found.</p>
      <Button variant="outline" class="mt-4" onclick={() => push('/recipes')}
        >Back to recipes</Button
      >
    {/if}
  </div>
{:else}
  <!-- `fill` from the fold up (issue #737): the recipe and the chat are two panes that
       must scroll independently, which needs a real height chain rather than a guessed
       one. There is deliberately NO `calc(100dvh - …)` anywhere below — every height
       here comes from `DetailPage`'s fill (ui-spec-v07 §1) resolving against AppShell's
       <main>. `docked` is reused rather than adding a second gate: it reads the same
       media query as the `split:` variant, so the classes and the prop cannot disagree.
       Its `false` default on SSR/no-`matchMedia` means one frame as an ordinary
       scrolling page before it fills — the same honest default the drawer suppression
       already accepts. -->
  <DetailPage
    title={recipe.title}
    onBack={() => goBack('/recipes')}
    backLabel="Back"
    class="p-4 sm:p-6"
    fill={docked}
  >
    {#snippet actions()}
      <!-- Nine actions is far too many to shout at once, so they are ranked and
           the ranking is carried by BOTH weight and placement.

           Cook, Shop and Plan are what this page is for — the three things you
           came to do with a dish, and the three you want one tap away with your
           hands full — so they are the only `solid` (filled) buttons and the only
           ones that render inline. The row reads Cook · Shop · Plan · ⋮ at EVERY
           width (issue #735): the desktop row was already seven buttons and
           Duplicate would have made it eight, so the low-frequency actions get one
           consistent home instead of two divergent layouts to maintain. Labels are
           single words for the same reason: the row reads as a row rather than as
           a sentence.

           SINCE #751 the Cook slot can hold TWO cooks. A recipe with a guided plan
           can be cooked plainly or cooked guided, and that is not a second action —
           it is the SAME act, chosen at the same moment, with the plan as a lens.
           So it earns inline placement (unlike "Guided plan" in the menu below,
           which is desk work: writing and reading the plan, done before you cook).
           What it does NOT earn is a fourth labelled button: the row is already
           sized to the narrowest phone, and a fifth word would push it off the
           edge. It renders as a SEGMENTED PAIR sharing Cook's own button — one
           control, two ways to press it — which reads as "cook this, one way or the
           other" and costs 32px rather than 90. The row therefore still reads
           Cook · Shop · Plan · ⋮ at every width; only the Cook chip gained a right
           half, and only on recipes that have a plan.

           Three of the inline ones are capability-gated (issue #637) — things that
           don't apply simply aren't offered, so a takeaway shows Plan and the menu
           and nothing else. Guided rides on the same gate as Cook.

           WHICH HALF IS WHICH follows the cook's own preference (issue #776). The
           wide labelled half is their default and the icon half is the other mode,
           so standard cook mode is one tap away whichever way it is set — and the
           control's shape, its testids and its unreviewed dot are the same object
           either way. Only the destinations swap. -->
      {#if showCooking}
        <div
          class="flex items-center"
          data-testid="recipe-cook-actions"
          data-primary={guidedIsPrimary ? 'guided' : 'standard'}
        >
          <Button
            size="sm"
            class={showGuidedHalf ? 'rounded-r-none' : ''}
            onclick={() => push(primaryCookHref)}
            data-testid="recipe-cook-button"
          >
            {#snippet leading()}
              <Icon name={guidedIsPrimary ? 'ListChecks' : 'CookingPot'} size={16} />
            {/snippet}
            Cook
          </Button>
          {#if showGuidedHalf}
            <!-- The right half. Icon-only because it is the second press of a
                 control the left half has already named; its accessible name says
                 the whole thing, and the divider is what makes the two read as one
                 object rather than as two buttons that happen to touch.

                 Present with no plan too, but only for someone whose default is
                 guided — the person who most wants to be offered one. It leads to
                 the no-plan screen, which offers to write it. -->
            <Button
              size="sm"
              class="rounded-l-none border-l border-primary-foreground/30 px-2"
              onclick={() => push(secondaryCookHref)}
              ariaLabel={guidedIsPrimary
                ? 'Cook, standard'
                : guidedPlanUnread
                  ? 'Cook, guided — the plan is written by AI and not checked yet'
                  : 'Cook, guided'}
              title={guidedIsPrimary
                ? 'Cook, standard'
                : guidedPlanUnread
                  ? 'Cook, guided — written by AI, not checked yet'
                  : 'Cook, guided'}
              data-testid="recipe-cook-guided-button"
              data-unreviewed={guidedPlanUnread && !guidedIsPrimary}
            >
              {#snippet leading()}
                <!-- "Not checked yet" as an amber dot on the corner of the icon,
                     composed the way cook mode's keep-awake toggle composes its
                     Lock badge — there is no room for a word-bearing pill on a
                     32px segment, and overhanging one would push the row off a
                     narrow screen for a flag that is informational by design. The
                     amber is the app's review amber and the words are carried by
                     the accessible name and the tooltip; the full chip lives on
                     the plan editor, which is where you act on it. -->
                <span class="relative inline-flex">
                  <Icon name={guidedIsPrimary ? 'CookingPot' : 'ListChecks'} size={16} />
                  {#if guidedPlanUnread && !guidedIsPrimary}
                    <span
                      class="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-400 ring-1 ring-primary"
                      aria-hidden="true"
                      data-testid="recipe-cook-guided-unreviewed-dot"
                    ></span>
                  {/if}
                </span>
              {/snippet}
            </Button>
          {/if}
        </div>
      {/if}
      {#if showIngredients}
        <Button size="sm" onclick={openAddToList} data-testid="recipe-add-to-list-button">
          {#snippet leading()}<Icon name="ShoppingCart" size={16} />{/snippet}
          Shop
        </Button>
      {/if}
      {#if showPlanning}
        <Button
          size="sm"
          onclick={() => (addToPlannerOpen = true)}
          data-testid="recipe-add-to-planner-button"
        >
          {#snippet leading()}<Icon name="CalendarPlus" size={16} />{/snippet}
          Plan
        </Button>
      {/if}
      <!-- Overflow (⋮), at every width since #735. Cook, Shop and Plan are never in
           here — they stay inline, which is the whole point of ranking them, and
           neither is "Cook, guided", which is a way of pressing Cook.

           GROUPED, not flat (issue #784). The order below was already right, but as
           one undivided list it read as a pile: three genuinely different intents
           with nothing to tell them apart, and the list only gets longer. The
           dividers are the whole of that change — nothing renamed, nothing removed,
           nothing moved behind a second tap, relative order untouched.

             Chat · Optimise · Refresh ·     work on THIS dish, in place
             Guided plan · Cook plan ·
             Bake a batch · Formula
             ─────
             Make a variation · Duplicate    produce a SECOND recipe, leaving this
                                             one alone — the two honest answers to
                                             "I want this dish, but different"
             ─────
             Edit · Delete                   the document, not the food

           Duplicate, Edit and Delete are unconditional: every kind of entry can be
           copied, edited and deleted (deciding that from `kind` is exactly what the
           capability predicates exist to prevent), so the menu is never empty and
           the trigger never opens onto nothing, whatever the gates say above.

           That is also why only the FIRST divider is gated. Group one is empty on
           anything that is neither cookable nor authorable (a takeaway, a
           placeholder), and a divider with nothing above it is a rule across the
           top of a menu; groups two and three always render at least Duplicate and
           Edit, so the second divider is unconditional and can never lead or
           trail. The gate names EVERY condition that can put something in group one
           rather than leaning on the fact that everything authorable happens to be
           cookable today — the day cocktails become authorable (#765) that
           coincidence is what would quietly break. Since #812 that includes
           `hasFormula`, which is presence rather than a capability and so cannot be
           implied by either predicate: a cocktail with a 1:1:1 formula and nothing
           else in group one is exactly the case the third clause covers. #752
           adds `showComponents` on the same footing: also presence rather than a
           capability, so it gets its own clause rather than riding on the kinds
           that happen to be able to take components today. #823 adds
           `showMakeScalable` for the same reason once more — shape rather than
           kind, and the one clause that can be true when `hasFormula` is false. -->
      <Popover bind:open={overflowMenuOpen}>
        <PopoverTrigger>
          {#snippet children()}
            <button
              type="button"
              class="inline-flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="More actions"
              data-testid="recipe-actions-overflow"
            >
              <Icon name="EllipsisVertical" size={20} />
            </button>
          {/snippet}
        </PopoverTrigger>
        <PopoverContent align="end" class="min-w-44 p-1">
          {#if showCooking}
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
              onclick={() => {
                overflowMenuOpen = false;
                void handleAskAmend();
              }}
              disabled={amendBusy}
              data-testid="recipe-ask-amend-menu-item"
            >
              <Icon name="ChefHat" size={14} />
              Chat
            </button>
          {/if}
          {#if showCooking && hasEquipment}
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
              onclick={() => {
                overflowMenuOpen = false;
                void handleOptimiseForKitchen();
              }}
              disabled={optimiseBusy || chat.isSending}
              data-testid="recipe-optimise-kitchen-menu-item"
            >
              <Icon name="Blender" size={14} />
              Optimise
            </button>
          {/if}
          {#if canAuthor}
            <!-- Refresh (issue #784). Beside Optimise because both re-run a model
                 over THIS dish in place, and they are the two halves of a pair:
                 Optimise reworks the method around the household's kit, Refresh
                 re-applies the house WRITING rules and leaves the cooking alone.
                 Gated on `isAuthorable` rather than `isCookable` — the question
                 is whether the librarian can write this kind, which is why an
                 outing and a placeholder never offer it. -->
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
              onclick={() => {
                overflowMenuOpen = false;
                void handleRefresh();
              }}
              disabled={refreshBusy}
              data-testid="recipe-refresh-menu-item"
            >
              <Icon name="RefreshCw" size={14} />
              Refresh
            </button>
          {/if}
          {#if showCooking}
            <!-- The plan EDITOR (issue #751). In the overflow, not inline: writing
                 or reading the plan is preparation you do BEFORE you cook, at a
                 desk, and the inline actions are the hands-full ones. Distinct from
                 the "Cook, guided" half of the Cook button above, which is cooking.
                 Unconditional within the gate — this is also how you get a first
                 plan, so it cannot depend on one existing. Gated on the same
                 predicate as Cook: a plan explains a method, so an entry with no
                 method has nothing to explain. -->
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              onclick={() => {
                overflowMenuOpen = false;
                push(`/recipes/${recipe.id}/guided`);
              }}
              data-testid="recipe-guided-plan-menu-item"
            >
              <Icon name="ListChecks" size={14} />
              Guided plan
            </button>
          {/if}
          {#if showComponents}
            <!-- The cook plan (issue #752, phase 4). Beside "Guided plan" and for
                 exactly the same reason: it is what you open BEFORE you cook, to
                 decide when each dish goes on — the inline row is the hands-full
                 verbs. Gated on the DOCUMENT having components, like the "Made
                 from" card below: a dish with nothing hanging off it has no
                 running order to schedule, and there is no meal `kind` to ask. -->
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              onclick={() => {
                overflowMenuOpen = false;
                push(`/recipes/${recipe.id}/cook-plan`);
              }}
              data-testid="recipe-cook-plan-menu-item"
            >
              <Icon name="Clock" size={14} />
              Cook plan
            </button>
          {/if}
          {#if hasFormula}
            <!-- Bread scaling (issue #812, phase 1 of epic #778). BOTH entries sit
                 in group one, immediately after "Guided plan", and both are gated on
                 the FORMULA DOCUMENT EXISTING — never on `kind`.

                 WHY HERE, AND NOT INLINE. The inline row is Cook · Shop · Plan · ⋮
                 and those three slots are the primary verbs — what you came to do
                 with a dish, with your hands full. Neither of these is that.
                 "Guided plan" is the exact precedent: desk work you do BEFORE you
                 cook, at a bench, with the recipe open. Starting a run is the same
                 act one document further along — you are deciding what to weigh out
                 and when to mix, not cooking — and the formula screen is the once-a-
                 month version of it. Group one is right for both because both work
                 on THIS dish rather than producing a second recipe (group two) or
                 editing the document itself (group three).

                 WHY "Bake a batch" LEADS. It is the weekly action; the formula is
                 the monthly one, and it is the thing you open when the batch is
                 wrong. Frequency orders them, exactly as it does Chat before
                 Refresh above.

                 A recipe with NO formula offers neither — there is no batch to
                 start and nothing to open — and until #823 that left the screen
                 with no entry point at all for a recipe that had never had one.
                 What #812 actually objected to was an "add a formula" item on all
                 ~46 recipes, putting baker's percentages in front of every
                 weeknight curry to serve the three loaves; the item below answers
                 that by gating on the basis guess instead of offering it
                 unconditionally. The typed URL stays as the escape hatch for a loaf
                 the guess misses — it stopped being the ONLY way in, not a way
                 in. -->
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              onclick={() => {
                overflowMenuOpen = false;
                bakeBatchOpen = true;
              }}
              data-testid="recipe-bake-batch-menu-item"
            >
              <Icon name="Hourglass" size={14} />
              Bake a batch
            </button>
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              onclick={() => {
                overflowMenuOpen = false;
                push(`/recipes/${recipe.id}/formula`);
              }}
              data-testid="recipe-formula-menu-item"
            >
              <Icon name="Percent" size={14} />
              Formula
            </button>
          {/if}
          {#if showMakeScalable}
            <!-- The FIRST formula (issue #823). The mutually-exclusive twin of the
                 pair above, in the same slot and carrying the same icon: this is
                 the item you tap once in a recipe's life, and from the moment the
                 formula is saved those two take its place and this one is gone.
                 Nothing else on the page changes — it leads to the screen #806
                 already shipped, which has always handled the no-formula-yet case.

                 Gated on the domain's basis guess, never on `kind` — the
                 `couldHaveFormula` derivation above says why, and what an empty
                 guess costs. Group one for the same reason as the pair it replaces:
                 it works on THIS dish, and mapping a formula is desk work rather
                 than one of the hands-full verbs the inline row is for. "Guided
                 plan" is again the precedent, and this is the once-in-a-recipe's-
                 life version of it. -->
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              onclick={() => {
                overflowMenuOpen = false;
                push(`/recipes/${recipe.id}/formula`);
              }}
              data-testid="recipe-make-scalable-menu-item"
            >
              <Icon name="Percent" size={14} />
              Make it scalable
            </button>
          {/if}
          {#if showCooking || canAuthor || hasFormula || showMakeScalable || showComponents}
            <Divider class="my-1" />
          {/if}
          {#if canAuthor}
            <!-- Beside Duplicate because they answer the same impulse — "I want this
                 dish, but different" — and are the two honest answers to it: a literal
                 copy you hand-edit, or a conversation that works the changes out with
                 you. Above it, because talking it through is the one you reach for
                 more often now it exists. -->
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
              onclick={() => {
                overflowMenuOpen = false;
                void handleMakeVariation();
              }}
              disabled={variationBusy}
              data-testid="recipe-make-variation-menu-item"
            >
              <Icon name="Sparkles" size={14} />
              Make a variation
            </button>
          {/if}
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
            onclick={() => {
              overflowMenuOpen = false;
              handleDuplicate();
            }}
            data-testid="recipe-duplicate-menu-item"
          >
            <Icon name="Copy" size={14} />
            Duplicate
          </button>
          <Divider class="my-1" />
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
            onclick={() => {
              overflowMenuOpen = false;
              push(`/recipes/${recipe.id}/edit`);
            }}
            data-testid="recipe-edit-menu-item"
          >
            <Icon name="Pencil" size={14} />
            Edit
          </button>
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
            onclick={() => {
              overflowMenuOpen = false;
              deleteOpen = true;
            }}
            data-testid="recipe-delete-menu-item"
          >
            <Icon name="Trash2" size={14} />
            Delete
          </button>
        </PopoverContent>
      </Popover>
    {/snippet}

    <!-- Two columns from the fold up (issue #696, Phase 4). At `split` the halves are
         EQUAL, because that is the only thing keeping the gutter over the crease — the
         device reports one viewport segment, so nothing can be aligned to the fold
         directly. `gap-10` is the settled gutter, the same number #663 landed on for the
         planner. Above `lg` there is no crease and the recipe deserves the room, so the
         page keeps the 2fr/1fr it has always had. The nav seam stays at `lg`: the fold
         keeps its bottom bar AND gets two columns. -->
    <div
      class="grid gap-4 split:min-h-0 split:flex-1 split:grid-cols-2 split:gap-10 lg:grid-cols-[2fr_1fr] lg:gap-6"
      data-testid="recipe-view"
    >
      <!-- Left column: main recipe content. `min-w-0` because a grid item's automatic
           minimum size is its CONTENT's minimum, and one line of `truncate` text is
           `white-space: nowrap` — a chat titled "<a long recipe name> chat" in the list
           below would size this column to the untruncated title and take the whole page
           wider than the phone with it. -->
      <!-- From `split` up this column owns its own scrolling, so reading down the method
           does not move the conversation beside it (#737). -->
      <div class="flex min-w-0 flex-col gap-4 split:min-h-0 split:overflow-y-auto">
        <!-- Unreviewed AI import (issue #616). Informational, never a gate: the
             recipe below is fully usable. Amber matches the canon review idiom. -->
        {#if recipe.needs_approval}
          <div
            class="flex flex-wrap items-center gap-3 rounded border border-amber-300 bg-amber-50 px-3 py-2"
            data-testid="recipe-unreviewed-banner"
          >
            <p class="flex-1 text-sm text-amber-900">
              Imported automatically — nobody has checked this recipe yet.
            </p>
            <Button
              size="sm"
              variant="outline"
              onclick={handleMarkReviewed}
              loading={markingReviewed}
              disabled={markingReviewed}
              data-testid="recipe-mark-reviewed-button"
            >
              Mark reviewed
            </Button>
          </div>
        {/if}
        <!-- Hero image (Tier-2, issue #148): photoreal "arty" photo generated
             from the title + description by the onRecipeWritten trigger. -->
        {#if heroVisible}
          <div class="flex flex-col gap-2" data-testid="recipe-hero">
            <div class="group relative overflow-hidden rounded-lg border bg-muted">
              <img
                src={appendCacheBuster(
                  recipe.image!.url,
                  recipe.imageRequestedAt ?? recipe.updatedAt,
                )}
                alt={recipe.title}
                loading="lazy"
                class="aspect-[3/2] w-full object-cover"
                data-testid="recipe-hero-image"
              />
              <!-- Regenerate + Upload as subtle overlay controls: hover-revealed
                   on desktop, faint-always-visible on touch (no hover). -->
              <div class="absolute right-2 top-2 flex gap-2">
                <Button
                  size="icon"
                  variant="outline"
                  onclick={openUpload}
                  disabled={imageBusy}
                  ariaLabel="Upload a photo"
                  title="Upload a photo"
                  class="bg-background/80 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-60"
                  data-testid="recipe-image-upload"
                >
                  {#snippet leading()}<Icon name="Upload" size={16} />{/snippet}
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  onclick={openRegenerate}
                  loading={imageBusy}
                  disabled={imageBusy}
                  ariaLabel="Regenerate image"
                  title="Regenerate image"
                  class="bg-background/80 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-60"
                  data-testid="recipe-image-regenerate"
                >
                  {#snippet leading()}<Icon name="RefreshCw" size={16} />{/snippet}
                </Button>
              </div>
            </div>
          </div>
        {:else}
          <div class="flex flex-wrap gap-2" data-testid="recipe-hero-controls">
            <Button
              size="sm"
              variant="outline"
              onclick={openRegenerate}
              loading={imageBusy}
              disabled={imageBusy}
              data-testid="recipe-image-generate"
            >
              {#snippet leading()}<Icon name="ImagePlus" size={14} />{/snippet}
              Generate image
            </Button>
            <Button
              size="sm"
              variant="outline"
              onclick={openUpload}
              disabled={imageBusy}
              data-testid="recipe-image-upload-empty"
            >
              {#snippet leading()}<Icon name="Upload" size={14} />{/snippet}
              Upload a photo
            </Button>
          </div>
        {/if}

        <!-- Description + meta chips -->
        {#if recipe.description || timeParts().length > 0 || recipe.metadata.tags.length > 0 || sourceUrl || producesCanonName}
          <Card>
            <CardContent class="flex flex-col gap-3 p-4">
              {#if recipe.description}
                <p class="text-sm text-muted-foreground">{recipe.description}</p>
              {/if}
              {#if timeParts().length > 0 || recipe.metadata.tags.length > 0 || producesCanonName}
                <div class="flex flex-wrap items-center gap-2">
                  {#if producesCanonName}
                    <span
                      class="rounded bg-muted px-2 py-1 text-xs text-muted-foreground"
                      data-testid="recipe-produces-chip">Makes: {producesCanonName}</span
                    >
                  {/if}
                  {#each timeParts() as part (part)}
                    <span class="rounded bg-muted px-2 py-1 text-xs text-muted-foreground"
                      >{part}</span
                    >
                  {/each}
                  {#each recipe.metadata.tags as tag (tag)}
                    <span class="rounded bg-muted px-2 py-1 text-xs text-muted-foreground"
                      >#{tag}</span
                    >
                  {/each}
                </div>
              {/if}
              {#if sourceUrl}
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1.5 self-start text-sm text-primary hover:underline"
                  data-testid="recipe-source-link"
                >
                  <Icon name="ExternalLink" size={14} />
                  View original recipe
                </a>
              {/if}
            </CardContent>
          </Card>
        {/if}

        <!-- Where the recipe scrolls to when the drawer opens (issue #696): the strip
             left above the chat should hold what the chef is talking about, not the
             hero photograph. -->
        <div bind:this={bodyAnchorEl} class="scroll-mt-4"></div>

        <!-- Made from (issue #752). A meal's components lead, above its own
             ingredients: what a Sunday roast IS — chicken, potatoes, gravy — is
             the headline fact about it, and the ingredient list below belongs to
             the roast itself, not to the three dishes. Nothing is aggregated.
             The card is gated on the DOCUMENT having components, in the same
             idiom as Ingredients above: when the concept applies the card is
             there, and the inner guard covers the case where every component has
             since been deleted. Each card is a link to that dish, one level deep;
             a component's own components are neither shown nor read. -->
        {#if showComponents}
          <Card>
            <CardHeader class="px-4 pt-4 pb-0">
              <div class="flex items-center justify-between gap-2">
                <CardTitle class="text-sm">Made from</CardTitle>
                <!-- The same four ways in the recipe list's New menu offers, in
                     the same order and the same idiom — a dish for a meal is
                     made exactly like any other dish. Each entry only says where
                     to start; `startComponent` is what pins the meal to the URL
                     so the far end knows where to come back to. -->
                <Popover bind:open={componentMenuOpen}>
                  <PopoverTrigger>
                    {#snippet children()}
                      <button
                        type="button"
                        class="inline-flex h-8 items-center gap-1 rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                        data-testid="meal-component-new-btn"
                        aria-label="Add a dish to this meal"
                      >
                        <Icon name="Plus" size={14} />
                        New
                        <Icon name="ChevronDown" size={12} class="opacity-80" />
                      </button>
                    {/snippet}
                  </PopoverTrigger>
                  <PopoverContent align="end" class="min-w-48 p-1">
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                      onclick={() => {
                        componentMenuOpen = false;
                        showComponentUrlImport = true;
                      }}
                      data-testid="meal-component-new-import"
                    >
                      <Icon name="Link" size={14} />
                      Import URL
                    </button>
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                      onclick={() => {
                        componentMenuOpen = false;
                        showComponentPhotoImport = true;
                      }}
                      data-testid="meal-component-new-import-photo"
                    >
                      <Icon name="Camera" size={14} />
                      Import from photo
                    </button>
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                      onclick={() => startComponent('/chat')}
                      data-testid="meal-component-new-chat"
                    >
                      <Icon name="Sparkles" size={14} />
                      Chat with AI
                    </button>
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                      onclick={() => startComponent('/recipes/new')}
                      data-testid="meal-component-new-manual"
                    >
                      <Icon name="Pencil" size={14} />
                      Manual
                    </button>
                  </PopoverContent>
                </Popover>
              </div>
            </CardHeader>
            <CardContent class="px-4 pb-4 pt-3">
              {#if components.length === 0}
                <p class="text-sm text-muted-foreground">
                  The dishes this was built from are no longer in the library.
                </p>
              {:else}
                <ul class="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="recipe-components">
                  {#each components as component (component.id)}
                    <li>
                      <button
                        type="button"
                        class="group flex w-full items-center gap-3 overflow-hidden rounded-lg border border-border bg-card p-2 text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onclick={() => push(`/recipes/${component.id}`)}
                        data-testid="recipe-component-card"
                        data-recipe-id={component.id}
                      >
                        <span
                          class="h-14 w-14 shrink-0 overflow-hidden rounded bg-muted text-muted-foreground/60"
                        >
                          {#if component.image?.url}
                            <img
                              src={appendCacheBuster(
                                component.image.url,
                                component.imageRequestedAt ?? component.updatedAt,
                              )}
                              alt=""
                              loading="lazy"
                              class="h-full w-full object-cover"
                              data-testid="recipe-component-thumb"
                            />
                          {:else}
                            <span
                              class="flex h-full w-full items-center justify-center"
                              data-testid="recipe-component-thumb-fallback"
                            >
                              <!-- The kind's own placeholder icon, not a fixed
                                   pot: a cocktail component wears a martini glass
                                   here exactly as it does on the list and in the
                                   week's shop sheet. Which picture a kind wears is
                                   COPY, which is what `KIND_COPY` is for. -->
                              <Icon name={KIND_COPY[kindOf(component)].thumbIcon} size={20} />
                            </span>
                          {/if}
                        </span>
                        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span class="truncate text-sm font-medium">{component.title}</span>
                          {#if component.metadata.cookTimeMinutes !== null}
                            <span
                              class="inline-flex items-center gap-1 text-xs text-muted-foreground"
                              data-testid="recipe-component-cook-time"
                            >
                              <Icon name="Clock" size={12} />
                              {component.metadata.cookTimeMinutes} min
                            </span>
                          {/if}
                        </span>
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </CardContent>
          </Card>
        {/if}

        <!-- Ingredients. The whole CARD goes when the concept doesn't apply
             (issue #637), not just its contents: a card headed "Ingredients"
             saying "No ingredients." is worse than no card, because it reads as
             an unfinished recipe rather than a takeaway. The inner
             "No ingredients." guard stays for the half-written-recipe case it
             was written for. -->
        {#if showIngredients}
          <Card>
            <CardHeader class="px-4 pt-4 pb-0">
              <div class="flex items-center justify-between">
                <CardTitle class="text-sm">Ingredients</CardTitle>
                {#if hasParsedPending}
                  <Button
                    size="sm"
                    variant="outline"
                    onclick={handleCanonicalise}
                    loading={canonalising}
                    disabled={canonalising}
                    data-testid="recipe-canonicalise-button"
                  >
                    {#snippet leading()}<Icon name="Link" size={14} />{/snippet}
                    Canonicalise
                  </Button>
                {/if}
              </div>
            </CardHeader>
            <CardContent class="px-4 pb-4 pt-3">
              {#if recipe.ingredients.length === 0}
                <p class="text-sm text-muted-foreground">No ingredients.</p>
              {/if}
              {#each recipe.ingredients as group (group.id)}
                <div class="flex flex-col gap-1 [&+&]:mt-3" data-testid="recipe-view-group">
                  {#if group.name}
                    <p
                      class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                      data-testid="recipe-view-group-name"
                    >
                      {group.name}
                    </p>
                  {/if}
                  <ul class="flex flex-col gap-1">
                    {#each group.items as ingredient (ingredient.id)}
                      <li class="text-sm" data-testid="recipe-view-ingredient">
                        <IngredientText
                          {ingredient}
                        />{#if !hasLiveCanonMatch(ingredient, liveCanonIds)}<button
                            type="button"
                            class="ml-1 text-xs text-destructive hover:underline disabled:opacity-50"
                            title="Not matched — tap to match"
                            aria-label="Not matched — tap to match"
                            onclick={() => handleRematch(group, ingredient)}
                            disabled={matchingIds[ingredient.id] ?? false}
                            data-testid="match-state-unmatched"
                            >{(matchingIds[ingredient.id] ?? false) ? '…' : '✗'}</button
                          >{/if}
                      </li>
                    {/each}
                  </ul>
                </div>
              {/each}
            </CardContent>
          </Card>
        {/if}

        <!-- Method — same treatment, gated on the same capability as Cook. -->
        {#if showCooking}
          <Card>
            <CardHeader class="px-4 pt-4 pb-0">
              <CardTitle class="text-sm">Method</CardTitle>
            </CardHeader>
            <CardContent class="px-4 pb-4 pt-3">
              {#if recipe.steps.length === 0}
                <p class="text-sm text-muted-foreground">No steps.</p>
              {/if}
              <ol class="flex flex-col gap-4">
                {#each recipe.steps as step, idx (step.id)}
                  <li class="flex gap-3 text-sm" data-testid="recipe-view-step">
                    <span class="mt-0.5 shrink-0 font-semibold text-muted-foreground"
                      >{idx + 1}</span
                    >
                    <div class="flex flex-1 flex-col gap-1.5">
                      <span>{step.text}</span>
                      {#if step.note}
                        <div
                          class="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                          data-testid="recipe-step-note-content"
                        >
                          <Icon
                            name="TriangleAlert"
                            size={13}
                            class="mt-0.5 shrink-0 text-amber-500"
                          />
                          <span class="whitespace-pre-wrap">{step.note}</span>
                        </div>
                      {/if}
                      {#if step.timer}
                        <span class="text-xs text-muted-foreground">
                          ⏱ {step.timer.durationMinutes} min{step.timer.description
                            ? ` — ${step.timer.description}`
                            : ''}
                        </span>
                      {/if}
                    </div>
                  </li>
                {/each}
              </ol>
            </CardContent>
          </Card>
        {/if}

        <!-- Notes -->
        {#if recipe.notes}
          <Card>
            <CardHeader class="px-4 pt-4 pb-0">
              <CardTitle class="text-sm">Notes</CardTitle>
            </CardHeader>
            <CardContent class="px-4 pb-4 pt-3">
              <!-- `breaks` is what makes this a no-op for every note written before
                   notes were Markdown: it keeps each typed line break a line break,
                   exactly as the old whitespace-pre-wrap paragraph did. -->
              <Markdown text={recipe.notes} breaks class="text-sm text-muted-foreground" />
            </CardContent>
          </Card>
        {/if}

        <!-- Every chat about this dish (issue #696). Below the seam there is no second
             column, so the list lives at the foot of the recipe; from `split` up it
             moves into the chat column above the conversation it selects. Rendered in
             one place or the other, never both — one `recipe-chat-list` on the page. -->
        {#if !docked}
          {@render chatListCard()}
        {/if}
      </div>

      <!-- Right column: the chat, docked from `split` up. Below that it does not render
           at all and Phase 3's drawer is the whole story — the reveal hack this column
           used to need is gone with it. -->
      <div
        class="hidden min-w-0 flex-col split:flex split:min-h-0"
        data-testid="recipe-chat-sidebar"
      >
        <!-- The card fills this column and the transcript inside it does the scrolling.
             It used to be `sticky` with a guessed `max-h-[calc(100dvh - 5.5rem)]`, which
             was the whole of #737: the number was wrong, so the composer sat below the
             scrollport; and being sticky it only settled after the recipe had been
             scrolled past the header, which a short recipe never can. Both are gone —
             the height comes from the fill chain now, and nothing here measures chrome. -->
        <Card class="flex flex-col overflow-hidden split:min-h-0 split:flex-1">
          <CardHeader class="shrink-0 border-b px-4 py-3">
            <div class="flex items-center justify-between">
              <CardTitle class="text-sm">Chef Chat</CardTitle>
              {#if activeSession}
                <Button
                  size="sm"
                  variant="ghost"
                  onclick={() => push(`/chat/${activeSession!.id}`)}
                  aria-label="Open full chat"
                >
                  <Icon name="ExternalLink" size={14} />
                </Button>
              {/if}
            </div>
            {#if !activeSession}
              <CardDescription class="text-xs">
                Chat about this recipe while you cook.
              </CardDescription>
            {/if}
          </CardHeader>

          {#if activeSession === null}
            <!-- No session yet: the conversations this recipe already has, then the
                 prompt to start another. The list is still rendered here because there
                 is no transcript to put it above yet — without it a recipe whose chats
                 are all closed would list none of them. -->
            <CardContent class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
              {#if docked}
                <div class="shrink-0">{@render chatListCard()}</div>
              {/if}
              <div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                <p class="text-sm text-muted-foreground">
                  Ask your chef to refine this recipe, scale it, or answer cooking questions.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  class="w-full"
                  onclick={createRecipeChat}
                  loading={amendBusy}
                  disabled={amendBusy}
                >
                  {#snippet leading()}<Icon name="ChefHat" size={16} />{/snippet}
                  Start a chat
                </Button>
              </div>
            </CardContent>
          {:else}
            <!-- The list rides INSIDE the transcript's scroll box (`aboveTranscript`), so
                 it scrolls off as the conversation grows and a long reply gets the whole
                 column. Scroll the pane back to the top to switch conversations. Guarded
                 on `docked` because below the seam the list lives at the foot of the
                 recipe instead — one `recipe-chat-list` on the page, never two. -->
            <ChatThread
              session={activeSession}
              thread={chat}
              layout="panel"
              emptyText="Ask me anything about this recipe."
              aboveComposer={sidebarReviewChanges}
              aboveTranscript={docked ? dockedChatList : undefined}
            />
          {/if}
        </Card>
      </div>
    </div>
  </DetailPage>
{/if}

<!-- Add to shopping list review sheet -->
{#if recipe && $defaultListId}
  <RecipeAddToListSheet {recipe} listId={$defaultListId} bind:open={addToListOpen} />
{/if}

<!-- Day picker for "Add to planner" -->
{#if recipe}
  <RecipeAddToPlannerSheet {recipe} bind:open={addToPlannerOpen} />
{/if}

<!-- The two import dialogs, for the meal's "New" menu (issue #752, Phase 3).
     The very same components the recipe list mounts — neither navigates, so the
     landing is ours to choose, and ours carries the meal. Mounted only on a meal,
     alongside the menu that is their only way in here. -->
{#if showComponents}
  <RecipeImportUrlDialog
    bind:open={showComponentUrlImport}
    onImported={(imported) => openComponentEditor(imported, 'url')}
  />
  <RecipeImportPhotoDialog
    bind:open={showComponentPhotoImport}
    onImported={(imported) => openComponentEditor(imported, 'photo')}
  />
{/if}

<!-- The scale sheet (issue #812). Mounted only where there is a formula to scale,
     which is the same condition its menu entry is gated on — the sheet takes the
     formula as a plain prop rather than reading the store itself, so it can never
     render against a `null` one. -->
{#if recipe && breadEnabled && $formula}
  <RecipeBakeBatchSheet {recipe} formula={$formula} bind:open={bakeBatchOpen} />
{/if}

<!-- "Review changes", wherever the conversation is being read — the docked column or the
     drawer. One button, one handler, so an edit proposed from a phone and an edit
     proposed from a laptop are the same act. -->
<!-- The docked column's copy of the list, with the gap to the first message baked in
     here rather than in `ChatThread` — the hook is deliberately unstyled so the host
     owns its own spacing. -->
{#snippet dockedChatList()}
  <div class="mb-4">{@render chatListCard()}</div>
{/snippet}

{#snippet chatListCard()}
  <RecipeChatList
    chats={recipeChats}
    activeId={activeSession?.id ?? null}
    onSelect={openChat}
    onNew={handleNewChat}
    creating={amendBusy}
  />
{/snippet}

{#snippet reviewChangesAction(testid: string)}
  {#if activeSession?.messages.some((m) => m.role === 'assistant')}
    <div class="shrink-0 border-t px-3 pt-3">
      <Button
        variant="outline"
        class="w-full"
        onclick={handleSidebarReviewChanges}
        loading={sidebarIsProposing}
        disabled={sidebarIsProposing || chat.isSending}
        data-testid={testid}
      >
        {#snippet leading()}<Icon name="RefreshCw" size={14} />{/snippet}
        Review changes
      </Button>
    </div>
  {/if}
{/snippet}

<!-- Its counterpart (issue #798). Same gate — an empty conversation has nothing to
     author either — and deliberately the same shape, because the pair is the whole
     point: one folds what was said into THIS dish, the other makes it a different
     one. No `border-t`: it sits directly under "Review changes" inside the one
     footer that button opens, and a second rule would read as a second region. -->
{#snippet saveAsNewRecipeAction(testid: string)}
  {#if activeSession?.messages.some((m) => m.role === 'assistant')}
    <div class="shrink-0 px-3 pt-2">
      <Button
        variant="outline"
        class="w-full"
        onclick={handleSaveAsNewRecipe}
        loading={sidebarIsSavingNew}
        disabled={sidebarIsSavingNew || chat.isSending}
        data-testid={testid}
      >
        {#snippet leading()}<Icon name="BookOpen" size={14} />{/snippet}
        Save as new recipe
      </Button>
    </div>
  {/if}
{/snippet}

<!-- The two surfaces are separate DOM nodes and both can be mounted at once (the column
     is merely `hidden` below `lg`), so they carry distinct testids — one ambiguous
     selector is a worse trap than two names for one button. -->
{#snippet sidebarReviewChanges()}
  {@render reviewChangesAction('sidebar-apply-changes-btn')}
  {@render saveAsNewRecipeAction('sidebar-save-new-recipe-btn')}
{/snippet}

{#snippet drawerReviewChanges()}
  {@render reviewChangesAction('drawer-apply-changes-btn')}
  {@render saveAsNewRecipeAction('drawer-save-new-recipe-btn')}
{/snippet}

<!-- The chef over the live recipe (issue #696). Only below the seam: above it the same
     conversation is docked in its own column, and two of it would be one too many. -->
{#if recipe && activeSession && drawerOpen && !docked}
  <RecipeChatDrawer
    session={activeSession}
    thread={chat}
    onClose={() => (drawerOpen = false)}
    onOpenFull={() => push(`/chat/${activeSession!.id}`)}
    aboveComposer={drawerReviewChanges}
  />
{/if}

<!-- Review-and-approve gate for the pending AI edit (Phase 2) -->
<RecipeChangeSummary
  diff={sidebarPending?.diff ?? null}
  bind:open={sidebarSummaryOpen}
  applying={sidebarIsApplying}
  onApply={handleSidebarApplyChanges}
  onDiscard={handleSidebarDiscardChanges}
/>

<!-- Regenerate image dialog: the editable scene brief (issue #148) -->
<Dialog bind:open={regenOpen}>
  <DialogContent>
    <div class="flex flex-col gap-4" data-testid="recipe-image-regenerate-dialog">
      <DialogHeader>
        <DialogTitle>Regenerate image</DialogTitle>
        <DialogDescription>
          This is the art direction behind the current photo — edit it and generate. Leave it empty
          to have a fresh one written for you.
        </DialogDescription>
      </DialogHeader>
      <!--
        maxLength mirrors the 2000-char cap on RegenerateRecipeImageInputSchema.brief
        so the limit is felt at the keyboard rather than as an opaque failure after
        Generate. autoresize + rows=6 so a one-paragraph brief is visible whole
        without scrolling, which is the point — you cannot edit what you cannot read.
      -->
      <TextArea
        label="Scene brief"
        placeholder="e.g. Served in a deep bowl on a sunlit table, steam rising, shot from above."
        rows={6}
        autoresize
        maxLength={2000}
        value={regenBrief}
        onValueChange={(v) => (regenBrief = v)}
        disabled={briefBusy}
        data-testid="recipe-image-regenerate-brief"
      />

      <!--
        Ask for a revision (issue #522, Phase 3). Type a steer, press Revise, and the
        text model rewrites the brief above with that steer folded THROUGH it — light,
        props, surface and palette moving together — and hands it back here, still
        editable, before any image is paid for. maxLength mirrors the 200-char cap on
        DescribeRecipeSceneInputSchema.hint. Enter submits: this is a one-line steer
        you will press repeatedly, and reaching for the mouse each time is friction the
        iteration loop can't afford.
      -->
      <div class="flex flex-col gap-2">
        <div class="flex items-end gap-2">
          <TextField
            class="flex-1"
            label="Ask for a revision"
            placeholder="e.g. make it summery"
            maxlength={200}
            value={regenHint}
            onValueChange={(v) => (regenHint = v)}
            disabled={briefBusy}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleReviseBrief();
              }
            }}
            data-testid="recipe-image-regenerate-hint"
          />
          <Button
            variant="outline"
            onclick={handleReviseBrief}
            loading={briefBusy}
            disabled={briefBusy || !regenHint.trim() || !regenBrief.trim()}
            data-testid="recipe-image-regenerate-revise"
          >
            Revise
          </Button>
        </div>
        <div class="flex items-center justify-between gap-2">
          <!--
            Start over is ALWAYS available: the brief is sticky, so a recipe you have
            since rewritten would otherwise keep art direction for the dish it used to
            be forever. This re-reads the current recipe and discards the accumulated
            edits — hence the explicit warning in the copy.
          -->
          <button
            type="button"
            class="text-xs text-primary hover:underline disabled:opacity-50"
            onclick={handleStartOverBrief}
            disabled={briefBusy}
            data-testid="recipe-image-regenerate-start-over"
          >
            Start over from the recipe
          </button>
          {#if briefBusy}
            <span class="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner size={12} />
              Rewriting the brief…
            </span>
          {/if}
        </div>
        {#if briefError}
          <p class="text-xs text-destructive" data-testid="recipe-image-regenerate-brief-error">
            {briefError}
          </p>
        {/if}
      </div>

      <DialogFooter>
        <Button variant="outline" onclick={() => (regenOpen = false)} disabled={imageBusy}>
          Cancel
        </Button>
        <!--
          Also disabled while a brief revision is in flight: generating right then
          would pay for an image directed by the brief the user is mid-way through
          replacing — the exact wasted render this feature exists to prevent.
        -->
        <Button
          onclick={handleRegenerateConfirm}
          loading={imageBusy}
          disabled={imageBusy || briefBusy}
          data-testid="recipe-image-regenerate-confirm"
        >
          Regenerate
        </Button>
      </DialogFooter>
    </div>
  </DialogContent>
</Dialog>

<!-- Upload photo dialog: pick a local image → crop to 3:2 → Save (issue #455) -->
<Dialog bind:open={uploadOpen} onOpenChange={handleUploadOpenChange}>
  <DialogContent>
    <div class="flex flex-col gap-4" data-testid="recipe-image-upload-dialog">
      <DialogHeader>
        <DialogTitle>Upload a photo</DialogTitle>
        <DialogDescription>
          Choose a photo from your device — or paste one you've copied — and position it in the 3:2
          frame — drag to pan, scroll or use the slider to zoom.
        </DialogDescription>
      </DialogHeader>

      {#if uploadSrc}
        <ImageCropper bind:this={cropper} src={uploadSrc} />
        <div class="flex flex-wrap items-center gap-3">
          <button
            type="button"
            class="text-xs text-primary hover:underline disabled:opacity-50"
            onclick={clearUploadSrc}
            disabled={uploadBusy}
            data-testid="recipe-image-upload-choose-another"
          >
            Choose a different photo
          </button>
          {#if canPasteFromClipboard}
            <button
              type="button"
              class="text-xs text-primary hover:underline disabled:opacity-50"
              onclick={handlePasteButton}
              disabled={uploadBusy}
              data-testid="recipe-image-paste"
            >
              Paste from clipboard
            </button>
          {/if}
        </div>
      {:else}
        <label
          class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-input px-4 py-10 text-sm text-muted-foreground hover:bg-muted/50"
        >
          <Icon name="ImagePlus" size={24} />
          <span>Tap to choose a photo</span>
          <input
            type="file"
            accept="image/*"
            class="sr-only"
            onchange={handleUploadFileChange}
            data-testid="recipe-image-upload-input"
          />
        </label>
        {#if canPasteFromClipboard}
          <Button
            variant="outline"
            onclick={handlePasteButton}
            disabled={uploadBusy}
            data-testid="recipe-image-paste-empty"
          >
            {#snippet leading()}<Icon name="Clipboard" size={16} />{/snippet}
            Paste from clipboard
          </Button>
          <p class="text-center text-xs text-muted-foreground">
            or press {pasteShortcutLabel} to paste a copied image
          </p>
        {:else}
          <p
            class="text-center text-xs text-muted-foreground"
            data-testid="recipe-image-paste-hint"
          >
            Pasting isn't supported in this browser — choose a photo above instead.
          </p>
        {/if}
      {/if}

      <DialogFooter>
        <Button
          variant="outline"
          onclick={() => handleUploadOpenChange(false)}
          disabled={uploadBusy}
        >
          Cancel
        </Button>
        <Button
          onclick={handleUploadSave}
          loading={uploadBusy}
          disabled={uploadBusy || !uploadSrc}
          data-testid="recipe-image-upload-save"
        >
          Save
        </Button>
      </DialogFooter>
    </div>
  </DialogContent>
</Dialog>

<!-- Delete confirm dialog -->
<Dialog
  bind:open={deleteOpen}
  onOpenChange={(v) => {
    if (!v) deleteBusy = false;
  }}
>
  <DialogContent>
    <div class="flex flex-col gap-4" data-testid="recipe-delete-dialog">
      <DialogHeader>
        <DialogTitle>Delete "{recipe?.title ?? ''}"?</DialogTitle>
        <DialogDescription>This action cannot be undone.</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onclick={() => (deleteOpen = false)} disabled={deleteBusy}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          onclick={handleDelete}
          loading={deleteBusy}
          disabled={deleteBusy}
          data-testid="recipe-delete-confirm"
        >
          Delete
        </Button>
      </DialogFooter>
    </div>
  </DialogContent>
</Dialog>
