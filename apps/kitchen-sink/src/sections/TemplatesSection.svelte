<script lang="ts">
  import {
    ListPage,
    FormPage,
    DetailPage,
    SelectableList,
    EmptyState,
    ErrorState,
    Button,
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
  const sampleNotes: Note[] = [
    { id: 'n1', title: 'Pantry restock', updated: '2 hours ago' },
    { id: 'n2', title: 'Sourdough recipe', updated: 'Yesterday' },
    { id: 'n3', title: 'Weekly meal plan', updated: '3 days ago' },
  ];

  let search = $state('');
  const filteredNotes = $derived(
    sampleNotes.filter((n) => n.title.toLowerCase().includes(search.toLowerCase())),
  );

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
  let lastBulk = $state<string | null>(null);

  const bulkActions: BulkAction[] = [
    {
      id: 'archive',
      label: 'Archive',
      variant: 'outline',
      onAction: (ids) => (lastBulk = `Archived ${ids.length} item(s)`),
    },
    {
      id: 'delete',
      label: 'Delete',
      variant: 'destructive',
      onAction: (ids) => {
        items = items.filter((i) => !ids.includes(i.id));
        lastBulk = `Deleted ${ids.length} item(s)`;
      },
    },
  ];
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
      >
        {#snippet actions()}
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
            <li
              class="flex items-center justify-between px-3 py-2 rounded-md border border-border bg-card"
            >
              <span class="text-sm font-medium">{note.title}</span>
              <span class="text-xs text-muted-foreground">{note.updated}</span>
            </li>
          {/each}
        </ul>
      </ListPage>
    </div>
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
    <div class="rounded-lg border border-border p-6 bg-background max-w-2xl">
      {#if items.length === 0}
        <EmptyState title="All cleared" description="You deleted everything." />
      {:else}
        <SelectableList {items} bind:selected {bulkActions}>
          {#snippet row(item)}
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm font-medium">{item.name}</span>
              <span class="text-xs text-muted-foreground uppercase tracking-wide">{item.tag}</span>
            </div>
          {/snippet}
        </SelectableList>
      {/if}
      {#if lastBulk}
        <p class="mt-4 text-sm text-muted-foreground">{lastBulk}</p>
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
