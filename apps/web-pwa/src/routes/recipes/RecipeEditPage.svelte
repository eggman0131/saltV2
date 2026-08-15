<script lang="ts">
  import {
    Button,
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxField,
    ComboboxInput,
    ComboboxItem,
    ComboboxTrigger,
    DetailPage,
    Icon,
    Markdown,
    Switch,
    TextArea,
    TextField,
    type ComboboxItemType,
  } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import { goBack } from '../../lib/nav.js';
  import { trackUsageEvent } from '@salt/observability';
  import {
    emptyRecipe,
    emptyIngredientGroup,
    newIngredient,
    newStep,
    clearIngredientMatch,
    hasLiveCanonMatch,
    isCookable,
    takesIngredients,
    type Recipe,
    type RecipeKind,
    type IngredientGroup,
    type Ingredient,
    type Step,
    type RecipeMetadata,
  } from '@salt/domain';
  import {
    recipes,
    persistRecipe,
    parseIngredients,
    matchIngredient,
    takeImportedDraft,
  } from '../../lib/recipeService.js';
  import { RecipeKindSchema } from '@salt/domain/schemas';
  import { canonItems } from '../../lib/canonService.js';
  import { addToast } from '../../lib/toastStore.js';
  import { KIND_COPY, kindOf } from './recipeKind.js';
  import NotesFormattingToolbar from './NotesFormattingToolbar.svelte';

  interface Props {
    // `id` is present on /recipes/:id/edit; `kind` on /recipes/new/:kind. Both
    // absent on /recipes/new, which is still the plain new-recipe route.
    params?: { id?: string; kind?: string };
  }
  let { params }: Props = $props();

  const editingId = $derived(params?.id ?? null);

  // The kind arrives as a raw URL segment, so it is user input: validate it and
  // fall back rather than persisting whatever was typed. /recipes/new/pudding
  // opens an ordinary new recipe instead of writing a document with a kind
  // nothing downstream can read. /recipes/new (no segment) takes the same path,
  // which is why that route's behaviour is untouched.
  function parseKindParam(raw: string | undefined): RecipeKind {
    const parsed = RecipeKindSchema.safeParse(raw);
    return parsed.success ? parsed.data : 'recipe';
  }

  // Live canon ids drive the unmatched indicator: an ingredient whose canon
  // item has since been deleted reads as unmatched (re-matchable), same as the
  // view page and shopping list (reference-integrity, #188).
  const liveCanonIds = $derived(new Set($canonItems.map((c) => c.id)));

  // Did the editor open on a handed-off draft rather than a blank form? A stashed
  // draft (a duplicate, #735; a share-target import) arrives fully populated and
  // already titled, so the first thing you do is rename it — the title takes
  // focus. A blank "New recipe" does not grab the keyboard.
  let openedFromStash = $state(false);

  // The draft is a local, mutable copy of the recipe entity assembled with the
  // Phase 1 builders. It is validated only on read (adapter/schema); the whole
  // document is persisted on save. `rawText` is preserved verbatim.
  let draft = $state<Recipe>(buildInitialDraft());
  let loaded = $state(false);

  function buildInitialDraft(): Recipe {
    // Consume a one-shot imported draft if the URL-import flow stashed one
    // (single-use: takeImportedDraft clears it). Clone so editing doesn't mutate
    // the stashed object.
    //
    // Since #616 the import callable PERSISTS the recipe, so an import arrives
    // here as /recipes/{id}/edit rather than /recipes/new — the stash is then
    // just a way to paint the editor immediately instead of waiting for the
    // Firestore listener to deliver a doc the server wrote moments ago. The id
    // must match: a stale stash must never bleed into a different recipe's
    // editor. /recipes/new still consumes an unmatched stash for back-compat
    // with any older stash-then-navigate path.
    const id = params?.id ?? null;
    if (id === null) {
      const imported = takeImportedDraft();
      if (imported) {
        openedFromStash = true;
        return cloneRecipe(imported);
      }
    }
    return emptyRecipe(crypto.randomUUID(), new Date().toISOString(), parseKindParam(params?.kind));
  }

  // Which sections this entry gets. Sourced from the DRAFT, never from the URL:
  // on /recipes/:id/edit there is no kind segment and the answer must follow the
  // loaded recipe, and the draft is the one object that is right in both modes.
  // Both questions go through the domain predicates — nothing here compares
  // against `'outing'`.
  const draftKind = $derived(kindOf(draft));
  const showIngredients = $derived(takesIngredients(draftKind));
  const showCooking = $derived(isCookable(draftKind));

  // Hydrate the draft from the store in edit mode. Depends on `$recipes` so a
  // cold deep-link (store not yet hydrated) populates once the subscription
  // delivers the recipe; new-recipe mode starts from a blank draft immediately.
  $effect(() => {
    if (loaded) return;
    if (editingId === null) {
      loaded = true;
      return;
    }
    const existing = $recipes.find((r) => r.id === editingId);
    if (existing) {
      // Deep-clone into mutable structures so editing doesn't touch the store copy.
      draft = cloneRecipe(existing);
      loaded = true;
      return;
    }
    // Not in the store yet. A URL import (#616) is persisted server-side and
    // routed straight here, so the listener may not have delivered it — the
    // stashed copy of the very same recipe paints the editor now instead of
    // showing a blank form until the round-trip lands. Id-matched, so an
    // unrelated recipe's editor leaves the stash untouched.
    const imported = takeImportedDraft(editingId);
    if (imported) {
      draft = cloneRecipe(imported);
      loaded = true;
    }
  });

  function cloneRecipe(r: Recipe): Recipe {
    return {
      ...r,
      ingredients: r.ingredients.map((g) => ({ ...g, items: g.items.map((i) => ({ ...i })) })),
      steps: r.steps.map((s) => ({ ...s, timer: s.timer ? { ...s.timer } : null })),
      metadata: { ...r.metadata, tags: [...r.metadata.tags] },
    };
  }

  // ─── Metadata helpers ───────────────────────────────────────────────────────
  function setMetadata(patch: Partial<RecipeMetadata>): void {
    draft = { ...draft, metadata: { ...draft.metadata, ...patch } };
  }

  function parseNumberOrNull(value: string): number | null {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeTag(raw: string): string {
    return raw.toLowerCase().trim().replace(/\s+/g, '-');
  }

  let tagInput = $state('');

  const allExistingTags = $derived([...new Set($recipes.flatMap((r) => r.metadata.tags))].sort());

  const availableSuggestions = $derived(
    allExistingTags.filter((t) => !draft.metadata.tags.includes(t)),
  );

  function addTag(raw: string): void {
    const tag = normalizeTag(raw);
    if (tag && !draft.metadata.tags.includes(tag)) {
      setMetadata({ tags: [...draft.metadata.tags, tag] });
    }
    tagInput = '';
  }

  function removeTag(tag: string): void {
    setMetadata({ tags: draft.metadata.tags.filter((t) => t !== tag) });
  }

  function handleTagKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (tagInput.trim()) addTag(tagInput);
    } else if (e.key === 'Backspace' && !tagInput && draft.metadata.tags.length > 0) {
      removeTag(draft.metadata.tags[draft.metadata.tags.length - 1]!);
    }
  }

  // ─── Source helpers ───────────────────────────────────────────────────────────
  // The source URL is surfaced so imported recipes show their provenance and it
  // survives an edit/save. An empty url clears the source entirely (back to a
  // manual recipe); a non-empty url marks it as url-sourced.
  const sourceUrl = $derived(draft.source?.type === 'url' ? (draft.source.url ?? '') : '');

  function setSourceUrl(value: string): void {
    const trimmed = value.trim();
    draft = { ...draft, source: trimmed === '' ? null : { type: 'url', url: trimmed } };
  }

  // ─── "This recipe makes…" (produces canon link) ─────────────────────────────
  // A searchable picker over the canon store: link this recipe to the grocery
  // item it produces (e.g. a Mayonnaise recipe makes "Mayonnaise"), or clear it.
  // Items are {value: canonId, label: name}; the filter also matches synonyms via
  // a lowercased name+synonyms index. The picker is remounted via `{#key}` on the
  // selection so an external change — the blank→hydrated draft on a cold deep
  // link, or the Clear button — re-initialises the input label (the Combobox only
  // syncs its input from `value` at mount).
  const canonComboItems: ComboboxItemType[] = $derived(
    $canonItems.map((c) => ({ value: c.id, label: c.name })),
  );
  const canonSearchIndex = $derived(
    new Map($canonItems.map((c) => [c.id, [c.name, ...c.synonyms].join(' ').toLowerCase()])),
  );
  function canonFilter(input: string, item: ComboboxItemType): boolean {
    const hay = canonSearchIndex.get(item.value) ?? item.label.toLowerCase();
    return hay.includes(input.trim().toLowerCase());
  }
  const producesKey = $derived(
    `${draft.producesCanonId ?? ''}|${canonComboItems.some((i) => i.value === draft.producesCanonId)}`,
  );
  function setProduces(canonId: string): void {
    draft = { ...draft, producesCanonId: canonId };
  }
  function clearProduces(): void {
    draft = { ...draft, producesCanonId: null };
  }

  // ─── Ingredient-group helpers ─────────────────────────────────────────────────
  function setGroups(groups: IngredientGroup[]): void {
    draft = { ...draft, ingredients: groups };
  }

  function addGroup(): void {
    setGroups([...draft.ingredients, emptyIngredientGroup(crypto.randomUUID())]);
  }

  function removeGroup(groupId: string): void {
    setGroups(draft.ingredients.filter((g) => g.id !== groupId));
  }

  function moveGroup(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= draft.ingredients.length) return;
    const groups = [...draft.ingredients];
    const [g] = groups.splice(index, 1);
    groups.splice(target, 0, g!);
    setGroups(groups);
  }

  function setGroupName(groupId: string, name: string): void {
    const trimmed = name.trim();
    setGroups(
      draft.ingredients.map((g) =>
        g.id === groupId ? { ...g, name: trimmed === '' ? null : trimmed } : g,
      ),
    );
  }

  function updateGroupItems(groupId: string, items: Ingredient[]): void {
    setGroups(draft.ingredients.map((g) => (g.id === groupId ? { ...g, items } : g)));
  }

  function addIngredient(group: IngredientGroup): void {
    updateGroupItems(group.id, [...group.items, newIngredient(crypto.randomUUID(), '')]);
  }

  function removeIngredient(group: IngredientGroup, ingredientId: string): void {
    updateGroupItems(
      group.id,
      group.items.filter((i) => i.id !== ingredientId),
    );
  }

  function setIngredientRawText(
    group: IngredientGroup,
    ingredientId: string,
    rawText: string,
  ): void {
    updateGroupItems(
      group.id,
      group.items.map((i) => {
        if (i.id !== ingredientId) return i;
        if (i.rawText === rawText) return i;
        return { ...clearIngredientMatch(i), rawText };
      }),
    );
  }

  function setIngredientOptional(
    group: IngredientGroup,
    ingredientId: string,
    isOptional: boolean,
  ): void {
    updateGroupItems(
      group.id,
      group.items.map((i) => (i.id === ingredientId ? { ...i, isOptional } : i)),
    );
  }

  // ─── Step helpers ───────────────────────────────────────────────────────────
  function setSteps(steps: Step[]): void {
    draft = { ...draft, steps };
  }

  function addStepRow(): void {
    setSteps([...draft.steps, newStep(crypto.randomUUID(), '')]);
  }

  function removeStep(stepId: string): void {
    setSteps(draft.steps.filter((s) => s.id !== stepId));
  }

  function moveStep(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= draft.steps.length) return;
    const steps = [...draft.steps];
    const [s] = steps.splice(index, 1);
    steps.splice(target, 0, s!);
    setSteps(steps);
  }

  function setStepText(stepId: string, text: string): void {
    setSteps(draft.steps.map((s) => (s.id === stepId ? { ...s, text } : s)));
  }

  function toggleStepTimer(stepId: string, on: boolean): void {
    setSteps(
      draft.steps.map((s) =>
        s.id === stepId
          ? { ...s, timer: on ? { durationMinutes: 0, description: null } : null }
          : s,
      ),
    );
  }

  function setStepTimerMinutes(stepId: string, value: string): void {
    const minutes = parseNumberOrNull(value) ?? 0;
    setSteps(
      draft.steps.map((s) =>
        s.id === stepId && s.timer ? { ...s, timer: { ...s.timer, durationMinutes: minutes } } : s,
      ),
    );
  }

  function setStepTimerDescription(stepId: string, value: string): void {
    const trimmed = value.trim();
    setSteps(
      draft.steps.map((s) =>
        s.id === stepId && s.timer
          ? { ...s, timer: { ...s.timer, description: trimmed === '' ? null : trimmed } }
          : s,
      ),
    );
  }

  function setStepNote(stepId: string, value: string): void {
    const trimmed = value.trim();
    setSteps(
      draft.steps.map((s) =>
        s.id === stepId ? { ...s, note: trimmed === '' ? null : trimmed } : s,
      ),
    );
  }

  // ─── Per-row match ───────────────────────────────────────────────────────────
  let matchingIds = $state<Record<string, boolean>>({});

  async function handleMatchIngredient(group: IngredientGroup, ing: Ingredient): Promise<void> {
    if (matchingIds[ing.id]) return;
    matchingIds = { ...matchingIds, [ing.id]: true };
    const result = await matchIngredient(ing);
    matchingIds = { ...matchingIds, [ing.id]: false };
    if (result.kind !== 'ok') {
      addToast('Failed to match ingredient.', 'destructive');
      return;
    }
    // Discard stale result if text was edited while the match was in flight.
    const currentGroup = draft.ingredients.find((g) => g.id === group.id);
    if (!currentGroup) return;
    const currentIng = currentGroup.items.find((i) => i.id === ing.id);
    if (!currentIng || currentIng.rawText !== ing.rawText) return;
    updateGroupItems(
      group.id,
      currentGroup.items.map((i) => (i.id === ing.id ? result.value : i)),
    );
  }

  // ─── Notes editing (issue #717) ──────────────────────────────────────────────
  // Both are view state only — the text itself lives in `draft.notes`, so
  // flipping to preview and back cannot lose an edit. `notesEl` is the
  // textarea the formatting toolbar acts on; it is re-bound whenever the
  // textarea is re-created by the mode switch, and is undefined in preview.
  let notesMode = $state<'edit' | 'preview'>('edit');
  let notesEl = $state<HTMLTextAreaElement | undefined>(undefined);

  // ─── AI parse ────────────────────────────────────────────────────────────────
  let showPasteArea = $state(false);
  let pasteText = $state('');
  let parsing = $state(false);

  async function handleParse(): Promise<void> {
    if (parsing || pasteText.trim() === '') return;
    parsing = true;
    const result = await parseIngredients(pasteText);
    parsing = false;
    if (result.kind !== 'ok') {
      addToast('Failed to parse ingredients.', 'destructive');
      return;
    }
    setGroups(result.value);
    showPasteArea = false;
    pasteText = '';
  }

  // ─── Save ─────────────────────────────────────────────────────────────────────
  let saving = $state(false);
  const canSave = $derived(draft.title.trim().length > 0);

  // Drop editor noise on save: ingredient rows with no rawText, groups left
  // empty once those are removed, and stepless steps. `rawText` itself is never
  // trimmed or rewritten — only blank rows are dropped, so the sacred original
  // of every kept ingredient survives verbatim.
  function pruneDraft(r: Recipe): Recipe {
    const ingredients = r.ingredients
      .map((g) => ({ ...g, items: g.items.filter((i) => i.rawText.trim() !== '') }))
      .filter((g) => g.items.length > 0);
    const steps = r.steps.filter((s) => s.text.trim() !== '' || s.note !== null);
    // Saving from the editor IS the human review (issue #616): a person read the
    // AI's output and committed it, so the unreviewed flag comes off. Dropped
    // rather than set false — absent means reviewed, matching the schema.
    const { needs_approval: _wasUnreviewed, ...reviewed } = r;
    return { ...reviewed, title: r.title.trim(), ingredients, steps };
  }

  async function handleSave(): Promise<void> {
    if (!canSave || saving) return;
    saving = true;
    const toSave: Recipe = pruneDraft(draft);
    const result = await persistRecipe(toSave);
    saving = false;
    if (result.kind !== 'ok') {
      addToast('Failed to save recipe.', 'destructive');
      return;
    }
    // Creation is a route-level fact (/recipes/new[/:kind] has no id) —
    // persistRecipe is a blind upsert and cannot tell create from edit.
    if (editingId === null)
      trackUsageEvent('recipe.created', {
        recipe_id: toSave.id,
        recipe_kind: draftKind,
        recipe_method: 'manual',
      });
    const copy = KIND_COPY[draftKind];
    addToast(editingId === null ? copy.createdToast : copy.savedToast, 'success');
    push(`/recipes/${toSave.id}`);
  }

  function handleCancel(): void {
    goBack(editingId === null ? '/recipes' : `/recipes/${editingId}`);
  }

  const pageTitle = $derived(
    editingId === null ? KIND_COPY[draftKind].newTitle : KIND_COPY[draftKind].editTitle,
  );
</script>

<DetailPage title={pageTitle} onBack={handleCancel} backLabel="Back" class="p-4 sm:p-6">
  {#snippet actions()}
    <Button variant="outline" size="sm" onclick={handleCancel} disabled={saving}>Cancel</Button>
    <Button
      size="sm"
      onclick={handleSave}
      loading={saving}
      disabled={!canSave || saving}
      data-testid="recipe-save-btn"
    >
      Save
    </Button>
  {/snippet}

  <div class="flex flex-col gap-8" data-testid="recipe-editor">
    <!-- Basics -->
    <section class="flex flex-col gap-3">
      <TextField
        label="Title"
        placeholder="e.g. Spiced lentil dahl"
        value={draft.title}
        onValueChange={(v) => (draft = { ...draft, title: v })}
        required
        autofocus={openedFromStash}
        data-testid="recipe-title-input"
      />
      <TextArea
        label="Description"
        placeholder="A short description (optional)"
        value={draft.description ?? ''}
        onValueChange={(v) => (draft = { ...draft, description: v.trim() === '' ? null : v })}
        rows={2}
        autoresize
        data-testid="recipe-description-input"
      />
    </section>

    <!-- Ingredient groups. Absent entirely for a kind that takes no ingredients
         (a takeaway has none to list) — an empty section you can add rows to
         would invite filling in something the rest of the app never reads. -->
    {#if showIngredients}
      <section class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium">Ingredients</p>
          <div class="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onclick={() => (showPasteArea = !showPasteArea)}
              data-testid="recipe-parse-toggle-btn"
            >
              {#snippet leading()}<Icon name="Wand" size={16} />{/snippet}
              Parse from text
            </Button>
            <Button
              variant="outline"
              size="sm"
              onclick={addGroup}
              data-testid="recipe-add-group-btn"
            >
              {#snippet leading()}<Icon name="Plus" size={16} />{/snippet}
              Add group
            </Button>
          </div>
        </div>

        {#if showPasteArea}
          <div
            class="flex flex-col gap-2 rounded border border-border bg-muted/50 p-3"
            data-testid="recipe-parse-area"
          >
            <p class="text-sm text-muted-foreground">
              Paste an ingredient list. The AI will detect groups and structure each ingredient
              while preserving the original text.
            </p>
            <TextArea
              label="Ingredient list"
              placeholder="1 cup plain flour, sifted&#10;2 eggs&#10;&#10;For the sauce:&#10;2 cloves garlic, crushed"
              value={pasteText}
              onValueChange={(v) => (pasteText = v)}
              rows={6}
              autoresize
              data-testid="recipe-parse-text-input"
            />
            <div class="flex gap-2">
              <Button
                size="sm"
                onclick={handleParse}
                loading={parsing}
                disabled={pasteText.trim() === '' || parsing}
                data-testid="recipe-parse-btn"
              >
                Parse
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onclick={() => {
                  showPasteArea = false;
                  pasteText = '';
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        {/if}

        {#if draft.ingredients.length === 0}
          <p class="text-sm text-muted-foreground">
            No ingredient groups yet. Add a group to start entering ingredients.
          </p>
        {/if}

        {#each draft.ingredients as group, gIdx (group.id)}
          <div
            class="flex flex-col gap-3 rounded border border-border bg-card p-3"
            data-testid="recipe-group"
            data-group-id={group.id}
          >
            <div class="flex items-end gap-2">
              <TextField
                label="Group name"
                placeholder="e.g. For the sauce (leave blank for the main list)"
                value={group.name ?? ''}
                onValueChange={(v) => setGroupName(group.id, v)}
                class="flex-1"
                data-testid="recipe-group-name-input"
              />
              <Button
                variant="ghost"
                size="sm"
                onclick={() => moveGroup(gIdx, -1)}
                disabled={gIdx === 0}
                aria-label="Move group up"
              >
                <Icon name="ChevronUp" size={16} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onclick={() => moveGroup(gIdx, 1)}
                disabled={gIdx === draft.ingredients.length - 1}
                aria-label="Move group down"
              >
                <Icon name="ChevronDown" size={16} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onclick={() => removeGroup(group.id)}
                aria-label="Remove group"
                data-testid="recipe-remove-group-btn"
              >
                <Icon name="Trash2" size={16} />
              </Button>
            </div>

            {#each group.items as ingredient (ingredient.id)}
              <div
                class="flex items-center gap-2"
                data-testid="recipe-ingredient"
                data-ingredient-id={ingredient.id}
              >
                <TextField
                  label="Ingredient"
                  placeholder="e.g. 1 ½ cups plain flour, sifted"
                  value={ingredient.rawText}
                  onValueChange={(v) => setIngredientRawText(group, ingredient.id, v)}
                  class="flex-1"
                  data-testid="recipe-ingredient-input"
                />
                {#if ingredient.rawText.trim() !== '' && !hasLiveCanonMatch(ingredient, liveCanonIds)}
                  <Button
                    variant="ghost"
                    size="sm"
                    onclick={() => handleMatchIngredient(group, ingredient)}
                    loading={matchingIds[ingredient.id] ?? false}
                    disabled={matchingIds[ingredient.id] ?? false}
                    aria-label="Not matched — tap to match this ingredient"
                    title="Not matched — tap to match this ingredient"
                    class="shrink-0 text-destructive"
                    data-testid="recipe-ingredient-match-btn"
                  >
                    <Icon name="CircleX" size={16} />
                  </Button>
                {/if}
                <Switch
                  label="Optional"
                  checked={ingredient.isOptional}
                  onCheckedChange={(c) => setIngredientOptional(group, ingredient.id, c)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onclick={() => removeIngredient(group, ingredient.id)}
                  aria-label="Remove ingredient"
                >
                  <Icon name="X" size={16} />
                </Button>
              </div>
            {/each}

            <Button
              variant="ghost"
              size="sm"
              onclick={() => addIngredient(group)}
              class="self-start"
              data-testid="recipe-add-ingredient-btn"
            >
              {#snippet leading()}<Icon name="Plus" size={16} />{/snippet}
              Add ingredient
            </Button>
          </div>
        {/each}
      </section>
    {/if}

    <!-- Steps. Gated on the same capability as the Cook button and the timings:
         an outing is eaten, not cooked, so there is no method to write. -->
    {#if showCooking}
      <section class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium">Method</p>
          <Button
            variant="outline"
            size="sm"
            onclick={addStepRow}
            data-testid="recipe-add-step-btn"
          >
            {#snippet leading()}<Icon name="Plus" size={16} />{/snippet}
            Add step
          </Button>
        </div>

        {#if draft.steps.length === 0}
          <p class="text-sm text-muted-foreground">No steps yet.</p>
        {/if}

        {#each draft.steps as step, sIdx (step.id)}
          <div
            class="flex flex-col gap-2 rounded border border-border bg-card p-3"
            data-testid="recipe-step"
            data-step-id={step.id}
          >
            <div class="flex items-start gap-2">
              <span class="mt-2 text-sm font-medium text-muted-foreground">{sIdx + 1}.</span>
              <TextArea
                label="Step"
                placeholder="Describe this step"
                value={step.text}
                onValueChange={(v) => setStepText(step.id, v)}
                rows={2}
                autoresize
                class="flex-1"
                data-testid="recipe-step-input"
              />
              <div class="flex flex-col">
                <Button
                  variant="ghost"
                  size="sm"
                  onclick={() => moveStep(sIdx, -1)}
                  disabled={sIdx === 0}
                  aria-label="Move step up"
                >
                  <Icon name="ChevronUp" size={16} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onclick={() => moveStep(sIdx, 1)}
                  disabled={sIdx === draft.steps.length - 1}
                  aria-label="Move step down"
                >
                  <Icon name="ChevronDown" size={16} />
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onclick={() => removeStep(step.id)}
                aria-label="Remove step"
              >
                <Icon name="Trash2" size={16} />
              </Button>
            </div>

            <div class="flex items-center gap-3 pl-6">
              <Switch
                label="Timer"
                checked={step.timer !== null}
                onCheckedChange={(c) => toggleStepTimer(step.id, c)}
              />
              {#if step.timer}
                <TextField
                  label="Minutes"
                  inputmode="numeric"
                  value={String(step.timer.durationMinutes)}
                  onValueChange={(v) => setStepTimerMinutes(step.id, v)}
                  class="w-28"
                  data-testid="recipe-step-timer-minutes"
                />
                <TextField
                  label="Timer label"
                  placeholder="e.g. until golden"
                  value={step.timer.description ?? ''}
                  onValueChange={(v) => setStepTimerDescription(step.id, v)}
                  class="flex-1"
                  data-testid="recipe-step-timer-description"
                />
              {/if}
            </div>

            <div class="pl-6">
              <TextArea
                label="Note (optional)"
                placeholder="Any note for this step"
                value={step.note ?? ''}
                onValueChange={(v) => setStepNote(step.id, v)}
                rows={2}
                autoresize
                data-testid="recipe-step-note-input"
              />
            </div>
          </div>
        {/each}
      </section>
    {/if}

    <!-- Metadata -->
    <section class="flex flex-col gap-3">
      <p class="text-sm font-medium">Details</p>
      <!-- Servings and timings only where they mean something. Source URL and
           "makes…" below stay: a takeaway can still have a menu page it came
           from. -->
      {#if showCooking}
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <TextField
            label="Servings"
            inputmode="numeric"
            value={draft.metadata.servings === null ? '' : String(draft.metadata.servings)}
            onValueChange={(v) => setMetadata({ servings: parseNumberOrNull(v) })}
            data-testid="recipe-servings-input"
          />
          <TextField
            label="Prep (min)"
            inputmode="numeric"
            value={draft.metadata.prepTimeMinutes === null
              ? ''
              : String(draft.metadata.prepTimeMinutes)}
            onValueChange={(v) => setMetadata({ prepTimeMinutes: parseNumberOrNull(v) })}
            data-testid="recipe-prep-input"
          />
          <TextField
            label="Cook (min)"
            inputmode="numeric"
            value={draft.metadata.cookTimeMinutes === null
              ? ''
              : String(draft.metadata.cookTimeMinutes)}
            onValueChange={(v) => setMetadata({ cookTimeMinutes: parseNumberOrNull(v) })}
            data-testid="recipe-cook-input"
          />
          <TextField
            label="Total (min)"
            inputmode="numeric"
            value={draft.metadata.totalTimeMinutes === null
              ? ''
              : String(draft.metadata.totalTimeMinutes)}
            onValueChange={(v) => setMetadata({ totalTimeMinutes: parseNumberOrNull(v) })}
            data-testid="recipe-total-input"
          />
        </div>
      {/if}
      <!-- Source -->
      <TextField
        label="Source URL"
        type="url"
        placeholder="https://example.com/original-recipe (optional)"
        value={sourceUrl}
        onValueChange={setSourceUrl}
        data-testid="recipe-source-input"
      />
      <!-- Produces: link this recipe to the grocery item it makes -->
      <div class="flex flex-col gap-1.5" data-testid="recipe-produces">
        <p class="text-sm font-medium">This recipe makes…</p>
        <p class="text-xs text-muted-foreground">
          Optionally link this recipe to the grocery item it produces (e.g. a Mayonnaise recipe
          makes “Mayonnaise”).
        </p>
        <div class="flex items-center gap-2">
          <div class="relative flex-1">
            {#key producesKey}
              <Combobox
                items={canonComboItems}
                value={draft.producesCanonId ?? ''}
                filterFn={canonFilter}
                restrict
                placeholder="Search grocery items…"
                onValueChange={setProduces}
              >
                <ComboboxField>
                  <ComboboxInput />
                  <ComboboxTrigger />
                </ComboboxField>
                <ComboboxContent>
                  {#snippet children({ filteredItems })}
                    {#each filteredItems as item, i (item.value)}
                      <ComboboxItem {item} index={i} />
                    {/each}
                    {#if filteredItems.length === 0}
                      <ComboboxEmpty>No grocery items found</ComboboxEmpty>
                    {/if}
                  {/snippet}
                </ComboboxContent>
              </Combobox>
            {/key}
          </div>
          {#if draft.producesCanonId}
            <Button
              variant="ghost"
              size="sm"
              onclick={clearProduces}
              data-testid="recipe-produces-clear"
            >
              Clear
            </Button>
          {/if}
        </div>
      </div>
      <!-- Tag picker -->
      <div class="flex flex-col gap-1.5">
        <p class="text-sm font-medium">Tags</p>
        <div
          class="flex min-h-9 flex-wrap items-center gap-1.5 rounded border border-input bg-background px-3 py-1.5 focus-within:ring-2 focus-within:ring-ring"
        >
          {#each draft.metadata.tags as tag (tag)}
            <span
              class="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs font-medium"
            >
              {tag}
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground"
                onclick={() => removeTag(tag)}
                aria-label="Remove {tag}"
              >
                <Icon name="X" size={10} />
              </button>
            </span>
          {/each}
          <input
            type="text"
            class="min-w-24 flex-1 bg-transparent py-0.5 text-sm outline-none"
            placeholder={draft.metadata.tags.length === 0 ? 'Add tags…' : ''}
            bind:value={tagInput}
            onkeydown={handleTagKeydown}
            data-testid="recipe-tags-input"
          />
        </div>
        {#if KIND_COPY[draftKind].tagsHint}
          <p class="text-xs text-muted-foreground" data-testid="recipe-tags-hint">
            {KIND_COPY[draftKind].tagsHint}
          </p>
        {/if}
        {#if availableSuggestions.length > 0}
          <div class="flex flex-wrap gap-1.5">
            {#each availableSuggestions as tag (tag)}
              <button
                type="button"
                class="rounded border border-dashed border-muted-foreground/40 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-muted-foreground hover:text-foreground"
                onclick={() => addTag(tag)}
              >
                + {tag}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </section>

    <!-- Notes (issue #717). Notes render as Markdown on the view page, so the
         editor offers the three formats worth having without knowing the
         syntax, and a preview to check the result before saving. Preview
         renders through the same `<Markdown … breaks />` the view page uses, so
         the two cannot disagree. `draft.notes` stays a plain nullable string
         throughout — none of this touches the save path. -->
    <section class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-2">
        <p class="text-sm font-medium">Notes</p>
        <div class="flex items-center gap-1" role="group" aria-label="Notes mode">
          <Button
            size="sm"
            variant={notesMode === 'edit' ? 'solid' : 'ghost'}
            onclick={() => (notesMode = 'edit')}
            data-testid="recipe-notes-edit-btn"
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant={notesMode === 'preview' ? 'solid' : 'ghost'}
            onclick={() => (notesMode = 'preview')}
            data-testid="recipe-notes-preview-btn"
          >
            Preview
          </Button>
        </div>
      </div>

      {#if notesMode === 'edit'}
        <!-- The toolbar drives the textarea's DOM node, so it is rendered only
             beside a live one; in preview there is no selection to act on. -->
        <NotesFormattingToolbar element={notesEl} />
        <TextArea
          bind:element={notesEl}
          label="Notes"
          placeholder="Anything else worth remembering"
          value={draft.notes ?? ''}
          onValueChange={(v) => (draft = { ...draft, notes: v.trim() === '' ? null : v })}
          rows={3}
          autoresize
          data-testid="recipe-notes-input"
        />
      {:else}
        <div
          class="rounded-md border border-input px-4 py-2 min-h-9"
          data-testid="recipe-notes-preview"
        >
          {#if draft.notes}
            <Markdown text={draft.notes} breaks class="text-sm text-muted-foreground" />
          {:else}
            <p class="text-sm text-muted-foreground">Nothing to preview yet.</p>
          {/if}
        </div>
      {/if}
    </section>
  </div>
</DetailPage>
