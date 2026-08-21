<script lang="ts">
  import {
    Button,
    CanonIcon,
    DisclosureChevron,
    DisclosureTrigger,
    EditableRow,
    Icon,
    Text,
  } from '@salt/ui-components';
  import type { CanonItem, ProductForm, ShoppingBehavior } from '@salt/domain';
  import { describePendingCanonChange } from '@salt/domain';
  import { titleCase } from '../../lib/titleCase.js';
  import { canonKey, formKey, type CatalogRecordKey } from './catalogRoute.js';
  import { reasoningSentence } from './reasoningSentence.js';

  /**
   * One canon item in the catalog, with its product forms underneath (issue #872).
   *
   * The row DISPLAYS; the editor edits. What used to be an inline aisle combobox,
   * behaviour select and threshold input at `sm:` and up is now the record editor
   * — beside the list on a wide screen, a full page on a phone — so this row is
   * the same at every breakpoint and carries no field controls at all.
   */
  let {
    item,
    forms,
    aisleName,
    pending,
    isFormPending,
    expanded,
    onToggle,
    openKey,
    selectionMode,
    isSelected,
    onToggleSelect,
    onOpen,
    onApprove,
    approveCount,
    onAddForm,
  }: {
    item: CanonItem;
    /** This item's forms, already narrowed to what the current filter shows. */
    forms: readonly ProductForm[];
    aisleName: string;
    /** Is the ITEM itself awaiting review, with a deferred approve already applied. */
    pending: boolean;
    isFormPending: (form: ProductForm) => boolean;
    expanded: boolean;
    /**
     * `undefined` ⇒ the body is always open and NO disclosure control renders.
     * That is the "Needs review" filter, where every row arrives opened: a
     * trigger that cannot close anything would be a lie (ui-spec-v09 §8.26).
     */
    onToggle?: (() => void) | undefined;
    /** Which record the editor is on, so the open row reads as the active one. */
    openKey: CatalogRecordKey | null;
    selectionMode: boolean;
    isSelected: (key: CatalogRecordKey) => boolean;
    onToggleSelect: (key: CatalogRecordKey) => void;
    onOpen: (key: CatalogRecordKey) => void;
    onApprove: () => void;
    /** How many records "Approve all N" covers — the item plus its pending forms. */
    approveCount: number;
    onAddForm: () => void;
  } = $props();

  const itemKey = $derived(canonKey(item.id));
  const hasBody = $derived(forms.length > 0 || pending);
  const open = $derived(hasBody && (onToggle === undefined || expanded));

  // The most recent pending change (issue #193), plus how many older ones are
  // waiting. Absent on items flagged before this shipped — nothing renders,
  // because "not recorded" is not "nothing changed".
  const changes = $derived((item.pendingChanges ?? []).map(describePendingCanonChange));
  const latest = $derived(changes.length > 0 ? changes[changes.length - 1]! : null);
  const olderCount = $derived(Math.max(changes.length - 1, 0));
  // The words the review was raised over — what the user actually typed.
  const sourceTexts = $derived(changes.map((c) => c.rawInput).filter((t): t is string => !!t));

  // What the pipeline decided, in one line — the three things a reviewer checks
  // before approving. Read-only: changing any of them happens in the editor.
  const behaviorLabel: Record<ShoppingBehavior, string> = {
    stocked: 'Stocked',
    check: 'Check',
    needed: 'Needed',
  };
  const thresholdLabel = $derived(
    item.largeQuantityThreshold != null
      ? `${item.largeQuantityThreshold}${item.unit ? ` ${item.unit}` : ''}`
      : 'No threshold',
  );
</script>

<!-- One line of words, shared by both layouts so they cannot diverge. -->
{#snippet pendingSummary()}
  {#if latest?.kind === 'synonym_added'}
    + synonym “{latest.synonym}”
  {:else if latest?.kind === 'aisle_cleared'}
    <!-- Attributed to the user's own aisle admin, not to the AI. -->
    {#if latest.origin === 'aisle_merge'}
      − aisle cleared by your merge
    {:else}
      − aisle cleared by your delete
    {/if}
  {:else}
    + new item
  {/if}
  {#if olderCount > 0}
    and {olderCount} more
  {/if}
{/snippet}

<!-- The compact row. EditableRow renders BOTH snippets into the DOM and hides one
     with CSS, so each testid carries which copy it is — a shared id would resolve
     twice (the trap CanonListRow documented). -->
{#snippet label(which: 'narrow' | 'wide')}
  <div class="flex min-w-0 flex-1 items-center gap-2">
    <CanonIcon
      thumbnail={item.thumbnail}
      name={item.name}
      size={40}
      version={item.iconRequestedAt ?? item.updatedAt}
    />
    <button
      type="button"
      class="min-w-0 flex-1 text-left"
      onclick={() => onOpen(itemKey)}
      data-testid="catalog-row-name-{which}"
    >
      <span class="block truncate text-sm font-medium">{titleCase(item.name)}</span>
      {#if pending && latest}
        <span class="block truncate text-xs text-amber-800 dark:text-amber-300">
          {@render pendingSummary()}
        </span>
      {/if}
    </button>
    {#if pending}
      <span
        class="shrink-0 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-800 dark:text-amber-200"
      >
        Review
      </span>
    {/if}
    {#if onToggle && hasBody}
      <DisclosureTrigger
        expanded={open}
        class="shrink-0 rounded p-1 text-muted-foreground"
        onclick={onToggle}
        aria-label="{open ? 'Hide' : 'Show'} details for {titleCase(item.name)}"
        data-testid="catalog-row-disclosure-{which}"
      >
        <DisclosureChevron {expanded} size={14} />
      </DisclosureTrigger>
    {/if}
  </div>
{/snippet}

<EditableRow
  selected={isSelected(itemKey) || openKey === itemKey}
  shaded={pending}
  onToggleSelect={selectionMode ? () => onToggleSelect(itemKey) : undefined}
>
  {#snippet narrow()}{@render label('narrow')}{/snippet}
  {#snippet wide()}{@render label('wide')}{/snippet}
</EditableRow>

<!-- The reveal — a sibling row rather than something inside the one above, so it
     renders ONCE at every breakpoint however the row itself is laid out. -->
{#if open}
  <li class="flex flex-col gap-2 pl-4" data-testid="catalog-row-body">
    {#if pending}
      <div
        class="flex flex-col gap-1 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
        data-testid="catalog-row-review"
      >
        {#if item.reasoning}
          <p data-testid="catalog-row-reasoning">{reasoningSentence(item.reasoning)}</p>
        {/if}
        {#each sourceTexts as source, i (i)}
          <p class="opacity-80" data-testid="catalog-row-source">from “{source}”</p>
        {/each}
        <p class="text-xs" data-testid="catalog-row-decisions">
          {aisleName} · {behaviorLabel[item.shoppingBehavior]} · {thresholdLabel}
        </p>
      </div>
    {/if}

    {#if forms.length > 0}
      <ul class="flex flex-col gap-1">
        {#each forms as form (form.id)}
          {@const key = formKey(form.id)}
          {#snippet formLabel(which: 'narrow' | 'wide')}
            <button
              type="button"
              class="min-w-0 flex-1 text-left"
              onclick={() => onOpen(key)}
              data-testid="catalog-form-row-{which}"
            >
              <span class="block truncate text-sm font-medium">{form.label}</span>
              <span class="block truncate text-xs text-muted-foreground">
                {form.matchers.join(', ')} · {form.yield.amountPerParent}
                {form.yield.formUnit} per item
              </span>
            </button>
          {/snippet}
          <EditableRow
            selected={isSelected(key) || openKey === key}
            shaded={isFormPending(form)}
            onToggleSelect={selectionMode ? () => onToggleSelect(key) : undefined}
          >
            {#snippet narrow()}{@render formLabel('narrow')}{/snippet}
            {#snippet wide()}{@render formLabel('wide')}{/snippet}
          </EditableRow>
        {/each}
      </ul>
    {:else}
      <Text muted>No product forms for this item.</Text>
    {/if}

    <div class="flex flex-wrap items-center gap-2">
      {#if approveCount > 0}
        <Button size="sm" onclick={onApprove} data-testid="catalog-row-approve">
          {approveCount > 1 ? `Approve all ${approveCount}` : 'Approve'}
        </Button>
      {/if}
      <Button size="sm" variant="outline" onclick={onAddForm} data-testid="catalog-row-add-form">
        {#snippet leading()}<Icon name="Plus" size={14} />{/snippet}
        Add form
      </Button>
    </div>
  </li>
{/if}
