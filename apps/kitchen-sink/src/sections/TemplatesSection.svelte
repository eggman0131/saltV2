<script lang="ts">
  import {
    ListPage,
    FormPage,
    DetailPage,
    SelectableList,
    EmptyState,
    ErrorState,
    Button,
    Checkbox,
    TextField,
    TextArea,
    Switch,
    Card,
    CardHeader,
    CardTitle,
    CardContent,
    Icon,
    Text,
    type BulkAction,
  } from '@salt/ui-components';

  // ── ListPage state machine demo ─────────────────────────────────────────────
  type ListMode = 'data' | 'loading' | 'empty' | 'error';
  let listMode = $state<ListMode>('data');

  type Note = { id: string; title: string; updated: string };
  let sampleNotes = $state<Note[]>([
    { id: 'n1', title: 'Pantry restock', updated: '2 hours ago' },
    { id: 'n2', title: 'Sourdough recipe', updated: 'Yesterday' },
    { id: 'n3', title: 'Weekly meal plan', updated: '3 days ago' },
  ]);

  let search = $state('');
  const filteredNotes = $derived(
    sampleNotes.filter((n) => n.title.toLowerCase().includes(search.toLowerCase())),
  );

  // ── ListPage contextual action mode (selection) demo ────────────────────────
  let listSelectionMode = $state(false);
  let listSelected = $state(new Set<string>());
  let lastListAction = $state<string | null>(null);

  $effect(() => {
    if (!listSelectionMode) listSelected = new Set();
  });

  const noteIds = $derived(filteredNotes.map((n) => n.id));
  const listSelectedCount = $derived(noteIds.filter((id) => listSelected.has(id)).length);
  const allNotesSelected = $derived(
    noteIds.length > 0 && noteIds.every((id) => listSelected.has(id)),
  );
  const someNotesSelected = $derived(
    noteIds.some((id) => listSelected.has(id)) && !allNotesSelected,
  );

  function toggleNote(id: string) {
    const next = new Set(listSelected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    listSelected = next;
  }

  function toggleAllNotes() {
    listSelected = allNotesSelected ? new Set() : new Set(noteIds);
  }

  const listBulkActions: BulkAction[] = $derived([
    {
      id: 'archive',
      label: 'Archive',
      icon: 'Archive',
      onSelect: () => {
        lastListAction = `Archived ${listSelectedCount} note(s)`;
        listSelectionMode = false;
      },
    },
    {
      kind: 'picker',
      id: 'move',
      label: 'Move',
      icon: 'FolderInput',
      sheetTitle: `Move ${listSelectedCount} note(s) to…`,
      targets: [
        { id: 'recipes', label: 'Recipes' },
        { id: 'archive-folder', label: 'Archive' },
      ],
      onPick: (target) => {
        lastListAction = `Moved ${listSelectedCount} note(s) to ${target}`;
        listSelectionMode = false;
      },
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: 'Trash2',
      variant: 'destructive',
      onSelect: () => {
        const ids = new Set(listSelected);
        sampleNotes = sampleNotes.filter((n) => !ids.has(n.id));
        lastListAction = `Deleted ${ids.size} note(s)`;
        listSelectionMode = false;
      },
    },
  ]);

  // ── FormPage demo ───────────────────────────────────────────────────────────
  let formTitle = $state('');
  let formBody = $state('');
  let formPublished = $state(false);
  let isSubmitting = $state(false);
  let lastSubmission = $state<string | null>(null);

  async function handleFormSubmit() {
    isSubmitting = true;
    await new Promise((r) => setTimeout(r, 800));
    lastSubmission = `Saved "${formTitle}" (published: ${formPublished})`;
    isSubmitting = false;
  }

  // ── SelectableList demo ─────────────────────────────────────────────────────
  type Item = { id: string; name: string; tag: string };
  let items = $state<Item[]>([
    { id: 'a', name: 'Tomato', tag: 'produce' },
    { id: 'b', name: 'Olive oil', tag: 'pantry' },
    { id: 'c', name: 'Mozzarella', tag: 'dairy' },
    { id: 'd', name: 'Basil', tag: 'produce' },
  ]);
  let selected = $state(new Set<string>());
  let selectableSelectionMode = $state(true);
</script>

<section id="templates">
  <h2 class="section-title">Page templates</h2>
  <p class="text-sm text-muted-foreground mb-8 max-w-2xl">
    Slot-based page shells that lock in layout invariants — header/toolbar placement,
    loading/empty/error symmetry, and consistent footer button order. Compose them with primitives;
    opt out by setting <code class="text-xs">class</code> overrides.
  </p>

  <!-- ListPage -->
  <div class="subsection">
    <h3 class="subsection-title">ListPage</h3>
    <div class="flex flex-wrap items-center gap-2 mb-4">
      <span class="text-xs text-muted-foreground">State:</span>
      {#each ['data', 'loading', 'empty', 'error'] as mode}
        <Button
          size="sm"
          variant={listMode === mode ? 'solid' : 'outline'}
          onclick={() => (listMode = mode as ListMode)}
        >
          {mode}
        </Button>
      {/each}
    </div>

    <div class="rounded-lg border border-border p-6 bg-background">
      <ListPage
        title="Notes"
        description="Recipes, plans, and shopping lists."
        isLoading={listMode === 'loading'}
        isError={listMode === 'error'}
        isEmpty={listMode === 'empty' || (listMode === 'data' && filteredNotes.length === 0)}
        bind:selectionMode={listSelectionMode}
        selectionCount={listSelectedCount}
        bulkActions={listBulkActions}
      >
        {#snippet actions()}
          {#if listSelectionMode}
            <Button size="sm" variant="outline" onclick={() => (listSelectionMode = false)}>
              Done
            </Button>
          {:else}
            <Button size="sm" variant="outline" onclick={() => (listSelectionMode = true)}>
              Select
            </Button>
          {/if}
          <Button size="sm">
            {#snippet leading()}
              <Icon name="Plus" size={14} />
            {/snippet}
            New note
          </Button>
        {/snippet}

        {#snippet toolbar()}
          <TextField placeholder="Search notes…" bind:value={search} class="max-w-xs" />
        {/snippet}

        {#snippet selectionBar()}
          <Checkbox
            checked={allNotesSelected ? true : someNotesSelected ? 'indeterminate' : false}
            onCheckedChange={toggleAllNotes}
            label={listSelectedCount > 0 ? `${listSelectedCount} selected` : 'Select all'}
          />
        {/snippet}

        {#snippet empty()}
          <EmptyState
            title="No notes yet"
            description="Create your first note to start organising your recipes."
          >
            {#snippet actions()}
              <Button size="sm">Create note</Button>
            {/snippet}
          </EmptyState>
        {/snippet}

        <ul class="flex flex-col gap-2">
          {#each filteredNotes as note (note.id)}
            <li class="flex items-center gap-3 px-3 py-2 rounded-md border border-border bg-card">
              {#if listSelectionMode}
                <Checkbox
                  checked={listSelected.has(note.id)}
                  onCheckedChange={() => toggleNote(note.id)}
                  label=""
                  aria-label={`Select ${note.title}`}
                />
              {/if}
              <span class="flex-1 text-sm font-medium">{note.title}</span>
              <span class="text-xs text-muted-foreground">{note.updated}</span>
            </li>
          {/each}
        </ul>
      </ListPage>
    </div>
    {#if lastListAction}
      <p class="mt-3 text-sm text-muted-foreground">{lastListAction}</p>
    {/if}
  </div>

  <!-- FormPage -->
  <div class="subsection">
    <h3 class="subsection-title">FormPage</h3>
    <div class="rounded-lg border border-border p-6 bg-background max-w-2xl">
      <FormPage
        title="New note"
        description="Add a recipe, idea, or anything worth keeping."
        submitLabel="Save note"
        {isSubmitting}
        canSubmit={formTitle.trim().length > 0}
        onSubmit={handleFormSubmit}
        onCancel={() => {
          formTitle = '';
          formBody = '';
          formPublished = false;
        }}
      >
        <TextField label="Title" placeholder="e.g. Sourdough" bind:value={formTitle} />
        <TextArea label="Body" placeholder="Write something…" bind:value={formBody} autoresize />
        <Switch label="Publish to family" bind:checked={formPublished} />
      </FormPage>
      {#if lastSubmission}
        <p class="mt-4 text-sm text-muted-foreground">{lastSubmission}</p>
      {/if}
    </div>
  </div>

  <!-- DetailPage -->
  <div class="subsection">
    <h3 class="subsection-title">DetailPage</h3>
    <div class="rounded-lg border border-border p-6 bg-background">
      <DetailPage
        title="Sourdough recipe"
        subtitle="Last updated 3 days ago by Daniel"
        onBack={() => {}}
      >
        {#snippet actions()}
          <Button variant="outline" size="sm">Edit</Button>
          <Button variant="destructive" size="sm">Delete</Button>
        {/snippet}

        {#snippet metadata()}
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl class="flex flex-col gap-2 text-sm">
                <div class="flex justify-between gap-3">
                  <dt class="text-muted-foreground">Author</dt>
                  <dd>Daniel</dd>
                </div>
                <div class="flex justify-between gap-3">
                  <dt class="text-muted-foreground">Tags</dt>
                  <dd>bread, weekend</dd>
                </div>
                <div class="flex justify-between gap-3">
                  <dt class="text-muted-foreground">Published</dt>
                  <dd>Yes</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        {/snippet}

        <Card>
          <CardContent class="p-6">
            <Text>
              Mix flour, water, salt, and starter. Bulk ferment 4 hours. Shape, proof overnight in
              the fridge. Bake at 240°C with steam for 20 minutes, then 220°C for another 20.
            </Text>
          </CardContent>
        </Card>
      </DetailPage>
    </div>
  </div>

  <!-- SelectableList -->
  <div class="subsection">
    <h3 class="subsection-title">SelectableList</h3>
    <p class="text-sm text-muted-foreground mb-3 max-w-2xl">
      Row-level helper: renders each row with an optional selection checkbox and tracks the selected
      set. Bulk actions themselves live on <code class="text-xs">ListPage</code>'s contextual action
      bar (above), not here.
    </p>
    <div class="flex items-center gap-2 mb-3">
      <Switch label="Selection mode" bind:checked={selectableSelectionMode} />
      <span class="text-xs text-muted-foreground">{selected.size} selected</span>
    </div>
    <div class="rounded-lg border border-border p-6 bg-background max-w-2xl">
      {#if items.length === 0}
        <EmptyState title="All cleared" description="You deleted everything." />
      {:else}
        <SelectableList {items} bind:selected selectionMode={selectableSelectionMode}>
          {#snippet row(item)}
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm font-medium">{item.name}</span>
              <span class="text-xs text-muted-foreground uppercase tracking-wide">{item.tag}</span>
            </div>
          {/snippet}
        </SelectableList>
      {/if}
    </div>
  </div>

  <!-- Standalone empty/error primitives -->
  <div class="subsection">
    <h3 class="subsection-title">EmptyState & ErrorState (primitives)</h3>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <EmptyState title="No results" description="Try a different search term or clear filters.">
        {#snippet actions()}
          <Button size="sm" variant="outline">Clear filters</Button>
        {/snippet}
      </EmptyState>
      <ErrorState
        description="We couldn't load this list. Check your connection and try again."
        onRetry={() => {}}
      />
    </div>
  </div>
</section>
