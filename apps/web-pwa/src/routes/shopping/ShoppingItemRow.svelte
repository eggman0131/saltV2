<!--
  One shopping list item row. Lifted out of `ShoppingListPage`'s `plainItemRow`
  snippet unchanged, then given the check-off celebration (lively list, Phase 1).

  It renders every plain row on the page: singles in an aisle, the Other bucket,
  the recipe-sorted view, the Checked section, and the per-contributor breakdown
  under a combined row (`subordinate`). The combined row itself stays in the page
  — it is a different shape — but shares this row's `CheckOffButton` and the same
  `salt-row-collapse` shell, so both celebrate identically.

  The outermost element is the collapse shell, not the row: `salt-row-collapse`
  walks the row's real height to zero on the way out, which needs a wrapper it can
  own. `data-testid="shopping-item-row"` stays on the row proper.
-->
<script lang="ts">
  import { CanonIcon, Icon, RowSelectCheckbox, Spinner } from '@salt/ui-components';
  import type { ListSelection } from '@salt/ui-components';
  import { resolveItemDisplayName, resolveProductForm } from '@salt/domain';
  import type { ProductForm, ShoppingListItem } from '@salt/domain';
  import type { Snippet } from 'svelte';
  import type { TransitionConfig } from 'svelte/transition';
  import { titleCase } from '../../lib/titleCase.js';
  import { productForms } from '../../lib/productFormService.js';
  import { swipe } from '../../lib/swipe.svelte.js';
  import { revealProgress } from '../../lib/swipe.js';
  import CheckOffButton from './CheckOffButton.svelte';

  // Only the canon name is read here (for a product-form row's parent headline);
  // the page's richer map satisfies this.
  interface CanonNameInfo {
    readonly name: string;
  }

  // A crossfade half (send/receive) from the page's single `crossfade()` instance,
  // or the instant no-op used where this row plays no reveal part. Typed loosely so
  // both the deferred crossfade return and the eager no-op assign cleanly.
  type RevealTransition = (
    node: Element,
    params: { key: string },
  ) => TransitionConfig | (() => TransitionConfig);

  interface Props {
    item: ShoppingListItem;
    /** Show a spinner: the row is still waiting on its canon match. */
    pending: boolean;
    /** Rendered inside a combined row's breakdown — indented, no icon. */
    subordinate?: boolean;
    /** Show the source recipe / "Added by" line. */
    showSource?: boolean;
    /** Held open mid-celebration: tinted, disc popped, collapsing out. */
    exiting?: boolean;
    /**
     * The row's match just landed — play the one-shot CanonIcon shimmer (lively
     * list, Phase 3). Held true only for the reveal window by the page.
     */
    revealing?: boolean;
    /**
     * Which half of the Other→aisle match-reveal crossfade this row plays:
     * `'send'` in the Other bucket, `'receive'` in a resolved aisle, `'none'`
     * everywhere else (breakdown / checked / recipe / manual). The two functions
     * come from the page's single `crossfade()` so send and receive can pair.
     */
    revealRole?: 'send' | 'receive' | 'none';
    revealSend?: RevealTransition;
    revealReceive?: RevealTransition;
    selectionMode: boolean;
    selection: ListSelection;
    canonMap: ReadonlyMap<string, CanonNameInfo>;
    thumbnailFor: (canonId: string | null) => string | null;
    iconVersionFor: (canonId: string | null) => string | number | undefined;
    /** The page's "Need it?" confirm/drop pair, so both row shapes share one copy. */
    verifyControls: Snippet<[string[]]>;
    onEdit: (item: ShoppingListItem) => void;
    onToggleChecked: (item: ShoppingListItem) => void;
    /** Delete this single row through the shared deferred-delete + undo snackbar. */
    onDelete: (item: ShoppingListItem) => void;
  }

  let {
    item,
    pending,
    subordinate = false,
    showSource = false,
    exiting = false,
    revealing = false,
    revealRole = 'none',
    revealSend,
    revealReceive,
    selectionMode,
    selection,
    canonMap,
    thumbnailFor,
    iconVersionFor,
    verifyControls,
    onEdit,
    onToggleChecked,
    onDelete,
  }: Props = $props();

  // Instant no-op transition for rows that play no reveal part, so `out:`/`in:`
  // can stay declared unconditionally on the root (Svelte has no way to omit a
  // directive by condition) without ever animating a delete / check-off / stream.
  const noReveal: RevealTransition = () => ({ duration: 0 });
  // Only the Other row *sends* and only an aisle row *receives*; a matching
  // send+receive pair for the same id in one flush is exactly the Other→aisle move
  // (crossfade flies it). Any unpaired half falls back to the page's zero-duration
  // fallback, so everything that is NOT a match reveal stays an instant snap.
  const outReveal = $derived(revealRole === 'send' ? (revealSend ?? noReveal) : noReveal);
  const inReveal = $derived(revealRole === 'receive' ? (revealReceive ?? noReveal) : noReveal);

  // The item is matched to a canon — its bare tile reads sage, not grey. Real
  // reactive state; observed, never written (Phase 3).
  const matched = $derived(item.matchState === 'matched');

  const isSelected = $derived(selection.isSelected(item.id));
  const amountStr = $derived(formatAmount(item.amount, item.unit));
  const productForm = $derived(productFormFor(item));

  // A row mid-celebration reads as done even though the copy it was handed still
  // says `checked: false` (that inversion is what keeps it rendering here at all —
  // see `holdInPlace`). Struck through and dimmed from the moment of the tap, so
  // it looks the way it will look in the Checked section it is on its way to.
  const done = $derived(item.checked || exiting);

  // Verify controls replace the check button, so a flagged row can never be
  // checked off — but if one ever is mid-flight, the celebration wins the slot.
  const flagged = $derived(needsVerify(item) && !exiting);

  // ─── Swipe (lively list, Phase 4) ────────────────────────────────────────────
  // Touch-only horizontal drag: swipe right past +78px to check off, left past
  // -78px to delete. The gesture is EXCLUDED from the breakdown-under-combined row,
  // the product-form row and the "Need it?" verify row (each is a different shape
  // with its own affordance), and from selection mode / a row mid-celebration.
  // Coarse-pointer + reduced-motion gating lives in the action itself, so on a
  // desktop the row simply is not draggable and the buttons stay primary.
  const swipeEnabled = $derived(
    !subordinate && productForm === null && !flagged && !selectionMode && !exiting,
  );
  // Live drag offset, fed by the action, driving the reveal-behind layers. The
  // action owns the row's `translateX`; this only fades the layer beneath it.
  let swipeDx = $state(0);
  const revealFraction = $derived(revealProgress(swipeDx)); // -1 (delete) … +1 (check)
  const checkRevealOpacity = $derived(Math.max(0, revealFraction));
  const deleteRevealOpacity = $derived(Math.max(0, -revealFraction));

  // The row proper's classes, lifted to a binding so the swipeable and plain
  // branches below share exactly one source of truth. A swipeable row always
  // lands on the opaque `bg-card` arm (selection / verify / exiting are excluded),
  // which is what hides the reveal layer beneath it at rest.
  const rowClass = $derived(
    `flex items-center gap-3 rounded border px-3 py-2 text-sm transition-colors duration-base ease-standard motion-reduce:transition-none ${
      subordinate ? 'ml-[46px]' : ''
    } ${
      exiting
        ? 'border-secondary/40 bg-secondary-container/50'
        : isSelected
          ? 'border-ring ring-2 ring-ring bg-card'
          : needsVerify(item)
            ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/20'
            : 'border-border bg-card'
    }`,
  );

  function toSentenceCase(text: string): string {
    if (!text) return text;
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // Label a single row, title-cased: the user's / recipe's wording with the
  // amount, unit and context the parser lifts out removed ("1 whole chicken" →
  // "Whole Chicken"), so it reads as the item without the quantity that's shown
  // separately, and without collapsing to the leaner canon name ("Chicken").
  // Combined aggregate rows label by canon name instead — see the page's rowLabel.
  function displayLabel(value: ShoppingListItem): string {
    return titleCase(resolveItemDisplayName(value));
  }

  // A resolved product-form row (issue #500): a recipe row bound to a buyable
  // parent canon and carrying a whole parent-count (the recipeService 'count' unit
  // sentinel), re-derived from the productForms snapshot rather than a stored id
  // (additive / back-compat). null for manual rows, non-count rows, and any row
  // whose form no longer resolves to its own canon — those keep today's label.
  // When non-null the row reads "Lime ×3" with the original wording underneath.
  function productFormFor(value: ShoppingListItem): ProductForm | null {
    if (value.unit !== 'count' || !value.canonId || value.amount === undefined) return null;
    const form = resolveProductForm(value.rawText, $productForms);
    return form && form.parentCanonId === value.canonId ? form : null;
  }

  function sourceLabel(value: ShoppingListItem): string {
    const src = value.sources[0];
    if (!src) return '';
    if (src.kind === 'manual') return src.addedBy ? `Added by ${src.addedBy}` : '';
    if (src.kind === 'recipe') return src.label ?? 'Recipe';
    return '';
  }

  function formatAmount(amount: number | undefined, unit: string | undefined): string | null {
    if (amount === undefined) return null;
    return unit ? `${amount} ${unit}` : `${amount}`;
  }

  // A flagged item (recipe-add "check" item, #185) gets a quick confirm/drop
  // affordance instead of the check circle.
  function needsVerify(value: ShoppingListItem): boolean {
    return value.needsCheck && !value.checked;
  }
</script>

<!--
  The row's own content, lifted to a snippet so the swipeable and plain branches
  below render exactly one copy of it. Only the wrapping row-proper `<div>` (its
  class, `use:swipe`, `touch-pan-y`) differs between the two.
-->
{#snippet rowContents()}
  {#if selectionMode}
    <RowSelectCheckbox {selection} id={item.id} label="" aria-label="Select {item.rawText}" />
  {/if}
  {#if !subordinate}
    <CanonIcon
      thumbnail={thumbnailFor(item.canonId)}
      name={displayLabel(item)}
      dimmed={done}
      size={34}
      version={iconVersionFor(item.canonId)}
      {matched}
      shimmer={revealing}
    />
  {/if}
  <button
    type="button"
    class="flex-1 min-w-0 text-left"
    onclick={() => onEdit(item)}
    aria-label="Edit {item.rawText}"
    data-testid="shopping-item-edit-btn"
  >
    {#if productForm && subordinate}
      <!-- Under a combined parent the headline is inverted (issue #530): the
           parent row already carries "Whole Chicken ×1", so repeating it here
           adds nothing and reads as one chicken PER CHILD — the parent count is
           an aggregate (Σwhole + MAXforms, see countSubtotal) that must never be
           summed down the column. Lead with this contributor's own wording
           instead; the recipe name follows from the showSource block below. -->
      {#each item.originalText?.length ? item.originalText : [titleCase(resolveItemDisplayName(item))] as line (line)}
        <span class="block truncate {done ? 'line-through text-muted-foreground' : ''}">{line}</span
        >
      {/each}
    {:else if productForm}
      <span class="block truncate {done ? 'line-through text-muted-foreground' : ''}">
        {titleCase(canonMap.get(item.canonId ?? '')?.name ?? '')}{' '}<span
          class="text-muted-foreground">×{item.amount}</span
        >
      </span>
      <!-- The headline is the PARENT product ("Lime ×3"), which by design reads
           nothing like the recipe's own line, so show the wording that justified
           the count beneath it (issue #528). Sibling of the truncating label
           span, and unclipped itself — a long line wraps rather than clips.
           Items written before the field fall back to today's cleaned name. -->
      {#if item.originalText?.length}
        {#each item.originalText as line (line)}
          <span
            class="block text-xs text-muted-foreground"
            data-testid="shopping-item-original-text">{line}</span
          >
        {/each}
      {:else}
        <span class="block text-xs text-muted-foreground truncate"
          >{resolveItemDisplayName(item)}</span
        >
      {/if}
    {:else}
      <span class="block truncate {done ? 'line-through text-muted-foreground' : ''}">
        {displayLabel(item)}{#if amountStr}{' '}<span class="text-muted-foreground"
            >({amountStr})</span
          >{/if}
      </span>
    {/if}
    {#if item.notes}
      <span class="block text-xs text-muted-foreground truncate">{toSentenceCase(item.notes)}</span>
    {/if}
    {#if showSource && sourceLabel(item)}
      <span class="block text-xs text-muted-foreground/70">{sourceLabel(item)}</span>
    {/if}
  </button>
  {#if pending}
    <Spinner size={14} />
  {/if}
  {#if flagged}
    {@render verifyControls([item.id])}
  {:else}
    <CheckOffButton checked={item.checked} {exiting} onSelect={() => onToggleChecked(item)} />
  {/if}
{/snippet}

<div
  class="salt-row-collapse motion-reduce:transition-none {exiting ? 'salt-row-collapse-out' : ''}"
  out:outReveal={{ key: item.id }}
  in:inReveal={{ key: item.id }}
>
  <div class="min-h-0 overflow-hidden">
    {#if swipeEnabled}
      <!-- Swipe surface (lively list, Phase 4). The reveal-behind layers and the
           `translateX` drag live HERE, on an inner wrapper — NEVER on the
           `salt-row-collapse` root above, whose Phase 1 collapse and Phase 3
           crossfade assume it is the untransformed direct `{#each}` child. The
           layers are `pointer-events-none` so they never swallow a button tap, and
           the opaque `bg-card` row proper hides them until it slides. -->
      <div class="relative overflow-hidden rounded">
        <!-- Swipe RIGHT past +78px → check: sage layer on the revealed left edge. -->
        <div
          class="pointer-events-none absolute inset-0 flex items-center justify-start px-4 bg-secondary-container text-accent-foreground"
          style:opacity={checkRevealOpacity}
          aria-hidden="true"
        >
          <Icon name="Check" size={20} />
        </div>
        <!-- Swipe LEFT past -78px → delete: destructive layer on the revealed right edge. -->
        <div
          class="pointer-events-none absolute inset-0 flex items-center justify-end px-4 bg-destructive text-destructive-foreground"
          style:opacity={deleteRevealOpacity}
          aria-hidden="true"
        >
          <Icon name="Trash2" size={20} />
        </div>
        <div
          use:swipe={{
            enabled: swipeEnabled,
            onCheck: () => onToggleChecked(item),
            onDelete: () => onDelete(item),
            onProgress: (d) => (swipeDx = d),
          }}
          class="relative touch-pan-y {rowClass}"
          data-testid="shopping-item-row"
          data-item-id={item.id}
        >
          {@render rowContents()}
        </div>
      </div>
    {:else}
      <div class={rowClass} data-testid="shopping-item-row" data-item-id={item.id}>
        {@render rowContents()}
      </div>
    {/if}
  </div>
</div>
