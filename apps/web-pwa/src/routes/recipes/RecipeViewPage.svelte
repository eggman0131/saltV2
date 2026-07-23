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
  import {
    recipes,
    isLoadingRecipes,
    removeRecipe,
    canonicaliseIngredients,
    matchIngredient,
    persistRecipe,
    authorRecipeTraced,
    regenerateRecipeImage,
    reviseRecipeSceneBrief,
    startOverRecipeSceneBrief,
    setRecipeImageUpload,
  } from '../../lib/recipeService.js';
  import RecipeAddToListSheet from './RecipeAddToListSheet.svelte';
  import RecipeChangeSummary from './RecipeChangeSummary.svelte';
  import IngredientText from './IngredientText.svelte';
  import { canonItems } from '../../lib/canonService.js';
  import {
    appendCacheBuster,
    diffRecipe,
    hasLiveCanonMatch,
    type IngredientGroup,
    type Ingredient,
    type Recipe,
  } from '@salt/domain';
  import type { ChatSessionDoc, RecipeDiff } from '@salt/domain/schemas';
  import type { DomainError, ReadResult } from '@salt/shared-types';
  import { defaultListId } from '../../lib/shoppingListService.svelte.js';
  import { addToast } from '../../lib/toastStore.js';
  import { auth } from '../../lib/auth.svelte.js';
  import { createChatSession, sessions, sendMessage } from '../../lib/chatService.js';
  import { equipment } from '../../lib/equipmentService.js';
  import { saveRecipe as saveRecipeDoc } from '@salt/firebase-sync';
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

  function timeParts(): string[] {
    if (!recipe) return [];
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

  // ─── Add to shopping list ─────────────────────────────────────────────────
  // The review sheet (issue #185) owns servings + per-ingredient Add/Check
  // toggles + the commit; this page only guards that a default list exists.
  let addToListOpen = $state(false);

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

  // ─── Ask / amend ────────────────────────────────────────────────────────────
  let amendBusy = $state(false);

  async function handleAskAmend(): Promise<void> {
    if (!recipe) return;
    const uid = auth.user?.uid;
    if (!uid) return;
    amendBusy = true;
    const result = await createChatSession(uid, recipe.id);
    amendBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to open chat.', 'destructive');
      return;
    }
    push(`/chat/${result.value.id}`);
  }

  // ─── Sidebar chat ────────────────────────────────────────────────────────────
  const activeSession = $derived(
    [...$sessions]
      .filter((s) => s.recipeId === recipe?.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null,
  );

  let sidebarStreamingText = $state('');
  let sidebarIsSending = $state(false);
  let sidebarInputText = $state('');
  let sidebarInputEl = $state<HTMLTextAreaElement | undefined>(undefined);
  let sidebarMessagesEnd = $state<HTMLDivElement | undefined>(undefined);
  // The chat column is desktop-only by default (`hidden lg:flex`). An action that
  // streams its answer INTO that column has to reveal it below `lg`, or the reply
  // arrives somewhere the user cannot see. Set once, never unset: having asked for
  // a turn, you keep the transcript.
  let sidebarRevealed = $state(false);

  $effect(() => {
    // Read these reactive values so the effect re-runs and scrolls to the bottom
    // whenever messages or streaming text change.
    activeSession?.messages.length;
    sidebarStreamingText;
    sidebarMessagesEnd?.scrollIntoView({ behavior: 'smooth' });
  });

  async function handleStartSidebarChat(): Promise<void> {
    if (!recipe) return;
    const uid = auth.user?.uid;
    if (!uid) return;
    amendBusy = true;
    const result = await createChatSession(uid, recipe.id);
    amendBusy = false;
    if (result.kind !== 'ok') addToast('Failed to open chat.', 'destructive');
  }

  // Shared core: append `text` as a user turn on `session` and stream the reply
  // into the sidebar. Takes the session explicitly because `activeSession` is
  // $derived off the sessions store — a turn sent immediately after creating a
  // session must use the object `createChatSession` handed back rather than wait
  // for the derived value. The composer is deliberately NOT touched here; the
  // caller owns it, so a canned prompt never lands in the user's input box.
  async function streamSidebarTurn(session: ChatSessionDoc, text: string): Promise<boolean> {
    sidebarIsSending = true;
    sidebarStreamingText = '';

    const result = await sendMessage(session, text, (chunk) => {
      sidebarStreamingText += chunk;
    });

    sidebarIsSending = false;
    sidebarStreamingText = '';

    if (result.kind !== 'ok') {
      addToast('Failed to send message.', 'destructive');
      return false;
    }
    return true;
  }

  async function handleSidebarSend(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!activeSession || !trimmed || sidebarIsSending) return;
    sidebarInputText = '';
    if (sidebarInputEl) sidebarInputEl.style.height = '';

    const ok = await streamSidebarTurn(activeSession, trimmed);
    if (!ok) sidebarInputText = trimmed;
  }

  function handleSidebarKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSidebarSend(sidebarInputText);
    }
  }

  function handleSidebarInput(e: Event): void {
    const el = e.target as HTMLTextAreaElement;
    sidebarInputText = el.value;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

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
    if (!recipe || optimiseBusy || sidebarIsSending) return;
    const uid = auth.user?.uid;
    if (!uid) return;
    sidebarRevealed = true;
    optimiseBusy = true;

    let session = activeSession;
    if (!session) {
      const created = await createChatSession(uid, recipe.id);
      if (created.kind !== 'ok') {
        optimiseBusy = false;
        addToast('Failed to open chat.', 'destructive');
        return;
      }
      session = created.value;
    }

    await streamSidebarTurn(session, OPTIMISE_FOR_KITCHEN_PROMPT);
    optimiseBusy = false;
  }

  // Review-and-approve gate (Phase 2). "Update recipe" now generates a PENDING
  // proposal and opens a diff summary; nothing is written until "Apply changes".
  // `sidebarIsProposing` guards the AI call; `sidebarIsApplying` guards the save.
  let sidebarIsProposing = $state(false);
  let sidebarIsApplying = $state(false);
  let sidebarSummaryOpen = $state(false);
  let sidebarPendingUpdate = $state<Recipe | null>(null);
  let sidebarPendingDiff = $state<RecipeDiff | null>(null);

  async function handleSidebarReviewChanges(): Promise<void> {
    if (!activeSession || !recipe || sidebarIsProposing) return;
    sidebarIsProposing = true;
    const existingTags = [...new Set($recipes.flatMap((r) => r.metadata.tags))];
    const result = await authorRecipeTraced(
      {
        messages: activeSession.messages,
        existingTags,
        recipeId: recipe.id,
      },
      recipe.title,
    );
    if (result.kind !== 'ok') {
      sidebarIsProposing = false;
      addToast('Failed to generate recipe update.', 'destructive');
      return;
    }
    const now = new Date().toISOString();
    const ai = result.value;
    const updated = {
      ...ai,
      id: recipe.id,
      createdAt: recipe.createdAt,
      updatedAt: now,
      // Preserve fields the AI always returns as null/empty (it only extracts from conversation)
      image: recipe.image,
      source: recipe.source,
      metadata: {
        servings: ai.metadata.servings ?? recipe.metadata.servings,
        totalTimeMinutes: ai.metadata.totalTimeMinutes ?? recipe.metadata.totalTimeMinutes,
        prepTimeMinutes: ai.metadata.prepTimeMinutes ?? recipe.metadata.prepTimeMinutes,
        cookTimeMinutes: ai.metadata.cookTimeMinutes ?? recipe.metadata.cookTimeMinutes,
        tags: ai.metadata.tags.length > 0 ? ai.metadata.tags : recipe.metadata.tags,
      },
    };
    // Diff the merged result against the existing recipe (post-merge, so the
    // preserved-metadata fallbacks don't show as spurious "changed to null").
    sidebarPendingDiff = diffRecipe(recipe, updated);
    sidebarPendingUpdate = updated;
    sidebarIsProposing = false;
    sidebarSummaryOpen = true;
  }

  async function handleSidebarApplyChanges(): Promise<void> {
    if (!sidebarPendingUpdate || sidebarIsApplying) return;
    sidebarIsApplying = true;
    const saveResult = await saveRecipeDoc(sidebarPendingUpdate);
    sidebarIsApplying = false;
    if (saveResult.kind !== 'ok') {
      addToast('Failed to save recipe update.', 'destructive');
      return;
    }
    sidebarSummaryOpen = false;
    sidebarPendingUpdate = null;
    sidebarPendingDiff = null;
    addToast('Recipe updated!', 'success');
  }

  function handleSidebarDiscardChanges(): void {
    sidebarSummaryOpen = false;
    sidebarPendingUpdate = null;
    sidebarPendingDiff = null;
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
  <DetailPage
    title={recipe.title}
    onBack={() => push('/recipes')}
    backLabel="Recipes"
    class="p-4 sm:p-6"
  >
    {#snippet actions()}
      <!-- Cook + Add to list are the two primary actions and stay visible at
           every width. Ask/amend, Edit and Delete are hidden below `sm` and
           collapse into the ⋮ overflow menu at the end so the header fits a
           phone; from `sm:` up all five render inline as before. -->
      <Button
        size="sm"
        variant="outline"
        onclick={handleAskAmend}
        loading={amendBusy}
        disabled={amendBusy}
        class="hidden sm:inline-flex"
        data-testid="recipe-ask-amend-button"
      >
        {#snippet leading()}<Icon name="ChefHat" size={16} />{/snippet}
        Ask / amend
      </Button>
      {#if hasEquipment}
        <Button
          size="sm"
          variant="outline"
          onclick={handleOptimiseForKitchen}
          loading={optimiseBusy}
          disabled={optimiseBusy || sidebarIsSending}
          class="hidden sm:inline-flex"
          data-testid="recipe-optimise-kitchen-button"
        >
          {#snippet leading()}<Icon name="Blender" size={16} />{/snippet}
          Optimise for my kitchen
        </Button>
      {/if}
      <Button
        size="sm"
        variant="outline"
        onclick={() => push(`/recipes/${recipe.id}/cook`)}
        data-testid="recipe-cook-button"
      >
        {#snippet leading()}<Icon name="CookingPot" size={16} />{/snippet}
        Cook
      </Button>
      <Button
        size="sm"
        variant="outline"
        onclick={openAddToList}
        data-testid="recipe-add-to-list-button"
      >
        {#snippet leading()}<Icon name="ShoppingCart" size={16} />{/snippet}
        Add to list
      </Button>
      <Button
        size="sm"
        onclick={() => push(`/recipes/${recipe.id}/edit`)}
        class="hidden sm:inline-flex"
        data-testid="recipe-edit-button"
      >
        {#snippet leading()}<Icon name="Pencil" size={16} />{/snippet}
        Edit
      </Button>
      <Button
        variant="destructive"
        size="sm"
        onclick={() => (deleteOpen = true)}
        class="hidden sm:inline-flex"
        data-testid="recipe-delete-button"
      >
        {#snippet leading()}<Icon name="Trash2" size={16} />{/snippet}
        Delete
      </Button>

      <!-- Mobile overflow (⋮): the three secondary actions above, hidden from
           `sm:` up. Menu items carry their own testids so the desktop button
           testids stay unique. -->
      <div class="sm:hidden">
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
              Ask / amend
            </button>
            {#if hasEquipment}
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
                onclick={() => {
                  overflowMenuOpen = false;
                  void handleOptimiseForKitchen();
                }}
                disabled={optimiseBusy || sidebarIsSending}
                data-testid="recipe-optimise-kitchen-menu-item"
              >
                <Icon name="Blender" size={14} />
                Optimise for my kitchen
              </button>
            {/if}
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
      </div>
    {/snippet}

    <div class="grid gap-4 lg:grid-cols-[2fr_1fr] lg:gap-6" data-testid="recipe-view">
      <!-- Left column: main recipe content -->
      <div class="flex flex-col gap-4">
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

        <!-- Ingredients -->
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
                    class="text-xs font-medium uppercase tracking-wide text-muted-foreground"
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

        <!-- Method -->
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
                  <span class="mt-0.5 shrink-0 font-semibold text-muted-foreground">{idx + 1}</span>
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

        <!-- Notes -->
        {#if recipe.notes}
          <Card>
            <CardHeader class="px-4 pt-4 pb-0">
              <CardTitle class="text-sm">Notes</CardTitle>
            </CardHeader>
            <CardContent class="px-4 pb-4 pt-3">
              <p class="whitespace-pre-wrap text-sm text-muted-foreground">{recipe.notes}</p>
            </CardContent>
          </Card>
        {/if}
      </div>

      <!-- Right column: embedded chat sidebar. Desktop-only by default; below `lg`
           it is revealed on demand by an action that streams a turn into it
           ("Optimise for my kitchen"), where it stacks under the recipe content. -->
      <div
        class="{sidebarRevealed ? 'flex' : 'hidden'} flex-col lg:flex"
        data-testid="recipe-chat-sidebar"
      >
        <Card
          class="flex flex-col overflow-hidden lg:sticky lg:top-4 lg:min-h-0 lg:max-h-[calc(100dvh_-_5.5rem)] lg:flex-1"
        >
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
            <!-- No session yet: prompt to start -->
            <CardContent
              class="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center"
            >
              <p class="text-sm text-muted-foreground">
                Ask your chef to refine this recipe, scale it, or answer cooking questions.
              </p>
              <Button
                size="sm"
                variant="outline"
                class="w-full"
                onclick={handleStartSidebarChat}
                loading={amendBusy}
                disabled={amendBusy}
              >
                {#snippet leading()}<Icon name="ChefHat" size={16} />{/snippet}
                Start a chat
              </Button>
            </CardContent>
          {:else}
            <!-- Messages -->
            <div class="min-h-0 flex-1 overflow-y-auto p-4">
              <div class="flex flex-col gap-3">
                {#if activeSession.messages.length === 0 && !sidebarIsSending}
                  <p class="py-8 text-center text-xs text-muted-foreground">
                    Ask me anything about this recipe.
                  </p>
                {/if}
                {#each activeSession.messages as msg (msg.id)}
                  <div class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'}">
                    <div
                      class="max-w-[90%] text-sm {msg.role === 'user'
                        ? 'rounded-lg bg-muted px-3 py-2'
                        : ''}"
                    >
                      {#if msg.role === 'assistant'}
                        <Markdown text={msg.text} />
                      {:else}
                        {msg.text}
                      {/if}
                    </div>
                  </div>
                {/each}
                {#if sidebarIsSending && sidebarStreamingText}
                  <div class="flex justify-start">
                    <div class="max-w-[90%] text-sm">
                      <Markdown text={sidebarStreamingText} />
                    </div>
                  </div>
                {:else if sidebarIsSending}
                  <div class="flex items-center gap-2 text-xs text-muted-foreground">
                    <Spinner size={12} />
                    Thinking…
                  </div>
                {/if}
                <div bind:this={sidebarMessagesEnd}></div>
              </div>
            </div>

            <!-- Update recipe -->
            {#if activeSession.messages.some((m) => m.role === 'assistant')}
              <div class="shrink-0 border-t px-3 pt-3">
                <Button
                  variant="outline"
                  class="w-full"
                  onclick={handleSidebarReviewChanges}
                  loading={sidebarIsProposing}
                  disabled={sidebarIsProposing || sidebarIsSending}
                  data-testid="sidebar-apply-changes-btn"
                >
                  {#snippet leading()}<Icon name="RefreshCw" size={14} />{/snippet}
                  Review changes
                </Button>
              </div>
            {/if}

            <!-- Input -->
            <div class="shrink-0 border-t p-3">
              <div class="flex items-end gap-2">
                <div
                  class="flex flex-1 items-start rounded-md border border-input bg-background px-3 text-sm focus-within:ring-2 focus-within:ring-ring {sidebarIsSending
                    ? 'opacity-50'
                    : ''}"
                >
                  <textarea
                    bind:this={sidebarInputEl}
                    class="flex-1 resize-none bg-transparent py-2 outline-none placeholder:text-muted-foreground"
                    rows={2}
                    placeholder="Message the chef…"
                    value={sidebarInputText}
                    onkeydown={handleSidebarKeydown}
                    oninput={handleSidebarInput}
                    disabled={sidebarIsSending}></textarea>
                </div>
                <Button
                  size="sm"
                  onclick={() => handleSidebarSend(sidebarInputText)}
                  disabled={sidebarIsSending || !sidebarInputText.trim()}
                  loading={sidebarIsSending}
                  aria-label="Send"
                >
                  {#snippet leading()}<Icon name="SendHorizontal" size={14} />{/snippet}
                  Send
                </Button>
              </div>
            </div>
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

<!-- Review-and-approve gate for the pending AI edit (Phase 2) -->
<RecipeChangeSummary
  diff={sidebarPendingDiff}
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
