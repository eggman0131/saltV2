<script lang="ts">
  import { Button, DetailPage, Icon, Switch, TextArea, TextField } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import {
    emptyRecipe,
    emptyIngredientGroup,
    newIngredient,
    newStep,
    clearIngredientMatch,
    hasLiveCanonMatch,
    type Recipe,
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
  import { canonItems } from '../../lib/canonService.js';
  import { addToast } from '../../lib/toastStore.js';

  interface Props {
    // Present on /recipes/:id/edit; absent (undefined) on /recipes/new.
    params?: { id?: string };
  }
  let { params }: Props = $props();

  const editingId = $derived(params?.id ?? null);

  // Live canon ids drive the unmatched indicator: an ingredient whose canon
  // item has since been deleted reads as unmatched (re-matchable), same as the
  // view page and shopping list (reference-integrity, #188).
  const liveCanonIds = $derived(new Set($canonItems.map((c) => c.id)));

  // The draft is a local, mutable copy of the recipe entity assembled with the
  // Phase 1 builders. It is validated only on read (adapter/schema); the whole
  // document is persisted on save. `rawText` is preserved verbatim.
  let draft = $state<Recipe>(buildInitialDraft());
  let loaded = $state(false);

  function buildInitialDraft(): Recipe {
    // On /recipes/new, consume a one-shot imported draft if the URL-import flow
    // stashed one (single-use: takeImportedDraft clears it). Clone so editing
    // doesn't mutate the stashed object. Otherwise start from a blank recipe.
    if ((params?.id ?? null) === null) {
      const imported = takeImportedDraft();
      if (imported) return cloneRecipe(imported);
    }
    return emptyRecipe(crypto.randomUUID(), new Date().toISOString());
  }

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
    return { ...r, title: r.title.trim(), ingredients, steps };
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
    addToast(editingId === null ? 'Recipe created' : 'Recipe saved', 'success');
    push(`/recipes/${toSave.id}`);
  }

  function handleCancel(): void {
    push(editingId === null ? '/recipes' : `/recipes/${editingId}`);
  }

  const pageTitle = $derived(editingId === null ? 'New recipe' : 'Edit recipe');
</script>

<DetailPage title={pageTitle} onBack={handleCancel} backLabel="Recipes" class="p-4 sm:p-6">
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

    <!-- Ingredient groups -->
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
          <Button variant="outline" size="sm" onclick={addGroup} data-testid="recipe-add-group-btn">
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
            Paste an ingredient list. The AI will detect groups and structure each ingredient while
            preserving the original text.
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

    <!-- Steps -->
    <section class="flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <p class="text-sm font-medium">Method</p>
        <Button variant="outline" size="sm" onclick={addStepRow} data-testid="recipe-add-step-btn">
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

    <!-- Metadata -->
    <section class="flex flex-col gap-3">
      <p class="text-sm font-medium">Details</p>
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
      <!-- Source -->
      <TextField
        label="Source URL"
        type="url"
        placeholder="https://example.com/original-recipe (optional)"
        value={sourceUrl}
        onValueChange={setSourceUrl}
        data-testid="recipe-source-input"
      />
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
            class="min-w-24 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground"
            placeholder={draft.metadata.tags.length === 0 ? 'Add tags…' : ''}
            bind:value={tagInput}
            onkeydown={handleTagKeydown}
            data-testid="recipe-tags-input"
          />
        </div>
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

    <!-- Notes -->
    <section class="flex flex-col gap-3">
      <p class="text-sm font-medium">Notes</p>
      <TextArea
        label="Notes"
        placeholder="Anything else worth remembering"
        value={draft.notes ?? ''}
        onValueChange={(v) => (draft = { ...draft, notes: v.trim() === '' ? null : v })}
        rows={3}
        autoresize
        data-testid="recipe-notes-input"
      />
    </section>
  </div>
</DetailPage>
