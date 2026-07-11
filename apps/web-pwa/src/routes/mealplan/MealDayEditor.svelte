<script lang="ts">
  import {
    Button,
    Icon,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxField,
    ComboboxInput,
    ComboboxItem,
    ComboboxTrigger,
    type ComboboxItemType,
  } from '@salt/ui-components';
  import { ChevronDown, ChevronRight, ChefHat, StickyNote, X } from '@lucide/svelte';
  import { push } from 'svelte-spa-router';
  import {
    appendCacheBuster,
    memberInitials,
    weatherIcon,
    type Day,
    type Member,
    type Recipe,
  } from '@salt/domain';
  import type { WeatherDaySummary } from '@salt/domain/schemas';
  import WeatherIcon from '$lib/weather-icons/WeatherIcon.svelte';
  import WeatherSummary from './WeatherSummary.svelte';

  // Collapsible editor for a single Day, shared by the weekly page (date-keyed)
  // and the template editor (weekday-keyed). Collapsed it shows a one-line
  // summary — meal + who's in (with home time) + chef + a note indicator + guest
  // count — so the whole week scans fast; expand one day to edit detail in a
  // roomy panel. It knows nothing about day keys: the parent supplies handlers
  // already bound to the right date/weekday. Members resolve live; an unknown
  // memberId renders as removable, never blocking. See docs/meal-planning.md.
  //
  // `weather` (issue #382, Phase 3) is the OPTIONAL per-day evening forecast. The
  // PARENT does the in-window gating: the dated weekly page passes
  // `forecast?.days[date]` (present only for concrete in-window days), while the
  // weekday-keyed template editor never passes it — so weather renders only on
  // in-window dated days and is blank for past/far-future days and the template.
  interface Props {
    label: string;
    sublabel?: string;
    day: Day;
    members: Member[];
    // Full recipe list, resolved live so attached ids render their current title
    // (never denormalised onto the plan doc). Missing/deleted ids are skipped.
    // Optional: the weekday-keyed template editor omits it and stays recipe-free.
    recipes?: readonly Recipe[];
    testid: string;
    // `| undefined` so the parent can pass `forecast?.days[date]` directly under
    // exactOptionalPropertyTypes (noUncheckedIndexedAccess makes it optional).
    weather?: WeatherDaySummary | undefined;
    onNoteChange: (note: string) => void;
    onChefToggle: (memberId: string) => void;
    onAttendeeToggle: (memberId: string) => void;
    onAttendeeHomeTime: (memberId: string, homeTime: string | null) => void;
    onAttendeeNote: (memberId: string, note: string) => void;
    onGuestsChange: (guests: number) => void;
    // Optional: present only in the dated week editor. When absent (the template
    // editor) the recipe picker and chips are not rendered — recipe-free.
    onRecipesChange?: (recipeIds: string[]) => void;
    // Optional: present only in the dated week editor. When provided, each attached
    // recipe row gains an "Add to shop" action that hands the FULL recipe up to the
    // page, which owns the RecipeAddToListSheet + default-list guard (Phase 4, #469).
    // Absent in the recipe-free template editor, so it gains no shopping UI — all
    // shopping imports stay out of this shared component.
    onRecipeAddToList?: (recipe: Recipe) => void;
  }
  let {
    label,
    sublabel,
    day,
    members,
    recipes = [],
    testid,
    weather,
    onNoteChange,
    onChefToggle,
    onAttendeeToggle,
    onAttendeeHomeTime,
    onAttendeeNote,
    onGuestsChange,
    onRecipesChange,
    onRecipeAddToList,
  }: Props = $props();

  let open = $state(false);

  // ─── Attached recipes (issue #17) ──────────────────────────────────────────
  // The day stores recipe IDS only; titles resolve live from the `recipes` prop
  // at render time (no denormalisation). Ids with no matching recipe — deleted
  // since they were attached — are skipped so a broken row is never rendered,
  // both in the chosen-list and the collapsed summary.
  const attachedRecipes = $derived(
    day.recipeIds
      .map((id) => recipes.find((r) => r.id === id))
      .filter((r): r is Recipe => r !== undefined),
  );
  // Picker options exclude already-attached recipes so the same dish can't be
  // added twice. Items are {value: id, label: title}, matching the canon picker.
  const recipePickerItems: ComboboxItemType[] = $derived(
    recipes
      .filter((r) => !day.recipeIds.includes(r.id))
      .map((r) => ({ value: r.id, label: r.title })),
  );
  function recipeFilter(input: string, item: ComboboxItemType): boolean {
    return item.label.toLowerCase().includes(input.trim().toLowerCase());
  }
  // Remount key: bumped after each add so the Combobox input clears (it only
  // syncs its label from `value` at mount — same reason RecipeEditPage keys it).
  let recipePickerKey = $state(0);
  function addRecipe(id: string): void {
    if (!id || day.recipeIds.includes(id)) return;
    // Auto-fill the empty meal field with the recipe's title (Phase 3, #469). The
    // title is a live UI value (resolved from `recipes`, never denormalised onto
    // the plan), so this stays purely in the app-layer handler using the existing
    // `onNoteChange` — no title knowledge leaks into the domain or any mutator.
    // Guard on `day.note` AT ATTACH TIME: `onNoteChange` is fire-and-forget and
    // `day.note` only updates once the store re-emits, so a non-empty note is
    // never overwritten and the first attached recipe wins.
    const title = recipes.find((r) => r.id === id)?.title;
    if (title && !day.note.trim()) onNoteChange?.(title);
    onRecipesChange?.([...day.recipeIds, id]);
    recipePickerKey += 1;
  }
  function removeRecipe(id: string): void {
    onRecipesChange?.(day.recipeIds.filter((r) => r !== id));
  }
  // Display-time cache-bust for the row thumbnail (mirrors RecipeListPage, issue
  // #460): a regenerated hero reuses the same Storage URL, so bust it with the
  // per-regeneration nonce (`imageRequestedAt`, falling back to `updatedAt`). Null
  // when the image is hidden/absent — the row then shows the CookingPot fallback.
  function heroUrl(recipe: Recipe): string | null {
    return recipe.image?.url && !recipe.imageHidden
      ? appendCacheBuster(recipe.image.url, recipe.imageRequestedAt ?? recipe.updatedAt)
      : null;
  }
  // Tapping a row's thumbnail/title opens that recipe's full view page. Hash
  // routing (svelte-spa-router), identical to RecipeListPage's card click; the
  // Remove button stops propagation so it never triggers navigation.
  function openRecipe(id: string): void {
    push(`/recipes/${id}`);
  }

  // The day's weather pictogram (issue #387), resolved from the forecast's
  // weatherCode/isDay. Null for absent/unknown codes — and, crucially, null for
  // every day the parent gives no `weather` (past, out-of-horizon, the template
  // row), so the watermark below simply doesn't render for them: graceful
  // absence identical to today's no-weather behaviour, no placeholder box.
  const icon = $derived(weather ? weatherIcon(weather) : null);

  // Home time is optional and picked as two short dropdowns — [HH]:[MM] — rather
  // than a native <input type="time">, which renders a different control on every
  // OS (spinner / wheel / free-text) and makes the minute field an unwanted scroll
  // through all 60 values. This field answers "when are you home for dinner", so
  // both lists are deliberately short: the hour spans the dinner window (17–22)
  // and the minute is quarter-hours only (00/15/30/45) — no scrolling in either,
  // and both seed to the usual dinner time. Empty value = no home time set (stays
  // blank until an explicit pick); stored 24h "HH:MM" matches the summary chip. A
  // legacy value outside the window still displays in the trigger (it just isn't
  // re-selectable without moving into the window).
  const HOUR_OPTIONS = Array.from({ length: 6 }, (_, i) => String(17 + i));
  const MINUTE_OPTIONS = ['00', '15', '30', '45'];
  const DINNER_HOUR = '18';
  const DINNER_MINUTE = '30';

  // Split a stored "HH:MM" (or null) into its parts; '' for each when unset so the
  // triggers can show a placeholder while the dropdowns still seed to dinner time.
  const timeParts = (t: string | null | undefined): { hh: string; mm: string } => {
    const [hh = '', mm = ''] = (t ?? '').split(':');
    return { hh, mm };
  };
  // Commit a change from either dropdown. Picking the hour's "No time" (value '')
  // clears to null; otherwise the untouched half falls back to the dinner-time
  // seed so a single pick still yields a whole, sensible time.
  const commitHour = (memberId: string, h: string): void => {
    if (h === '') return onAttendeeHomeTime(memberId, null);
    onAttendeeHomeTime(
      memberId,
      `${h}:${timeParts(attendeeOf(memberId)?.homeTime).mm || DINNER_MINUTE}`,
    );
  };
  const commitMinute = (memberId: string, m: string): void => {
    onAttendeeHomeTime(
      memberId,
      `${timeParts(attendeeOf(memberId)?.homeTime).hh || DINNER_HOUR}:${m}`,
    );
  };

  // Initial-chips grow to use the available width when there are few members and
  // shrink as the roster grows (the household is small, ~5, with rare guests).
  const chip = $derived(
    members.length <= 4
      ? { box: 'h-9 w-9 text-xs', h: 'h-9', time: 'text-[11px]', badge: 'h-4 w-4', hat: 'h-3 w-3' }
      : members.length <= 6
        ? {
            box: 'h-8 w-8 text-[11px]',
            h: 'h-8',
            time: 'text-[10px]',
            badge: 'h-3.5 w-3.5',
            hat: 'h-2.5 w-2.5',
          }
        : {
            box: 'h-7 w-7 text-[10px]',
            h: 'h-7',
            time: 'text-[9px]',
            badge: 'h-3 w-3',
            hat: 'h-2 w-2',
          },
  );

  const isAttending = (id: string): boolean => day.attendees.some((a) => a.memberId === id);
  const isChef = (id: string): boolean => day.chefs.includes(id);
  const attendeeOf = (id: string) => day.attendees.find((a) => a.memberId === id);

  // Attendees referencing someone no longer in the roster — rendered removable so
  // the document is never silently corrupted.
  const unknownAttendees = $derived(
    day.attendees.filter((a) => !members.some((m) => m.id === a.memberId)),
  );
  const attendingCount = $derived(day.attendees.length + day.guests);
  const hasNotes = $derived(day.attendees.some((a) => a.note.trim() !== ''));

  // Assigned cook(s) for the collapsed grid row (#469) — the chefs still in the
  // roster, shown as amber avatars in their own column. When `day.chefs` is empty
  // the row is flagged "no cook" so unassigned days stand out at a glance.
  const chefMembers = $derived(members.filter((m) => day.chefs.includes(m.id)));
  const hasCook = $derived(day.chefs.length > 0);

  // Auto-grow the multiline meal field to fit its content. Re-runs whenever the
  // note changes (typing, or load-template swapping the value in).
  let noteEl: HTMLTextAreaElement | undefined = $state();
  $effect(() => {
    const _note = day.note; // track
    if (noteEl) {
      noteEl.style.height = 'auto';
      noteEl.style.height = `${noteEl.scrollHeight}px`;
    }
  });
</script>

<div class="overflow-hidden rounded-lg border" data-testid={testid}>
  <!-- Collapsed header (Phase 1, #469): ONE column-aligned grid row so the whole
       week scans as a clean table — day · meal (+ note flag) · cook · who's eating
       (with home times) · weather glyph. Tapping anywhere on the row expands the
       day's detail below. Fixed-width columns (day, cook, guest slot, weather) keep
       every row's columns aligned; only the meal note flexes, and it truncates
       rather than wrapping, so nothing clips or overflows. Recipe pills and the
       evening-forecast temps strip are gone from the collapsed state — weather is a
       small glyph only here; the full forecast belongs to the expanded detail. -->
  <div class="transition-colors hover:bg-muted/40">
    <!-- Collapsed summary: tap anywhere to expand. -->
    <button
      type="button"
      class="flex w-full items-center gap-3 px-3 py-2.5 text-left sm:gap-4"
      onclick={() => (open = !open)}
      aria-expanded={open}
      data-testid={`${testid}-summary`}
    >
      <!-- Day -->
      <span class="flex w-14 shrink-0 flex-col leading-tight sm:w-16">
        <span class="text-sm font-semibold">{label}</span>
        {#if sublabel}<span class="text-[11px] text-muted-foreground">{sublabel}</span>{/if}
      </span>

      <!-- Meal (note): the only flexing column; truncates instead of wrapping. -->
      <span class="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          class="min-w-0 truncate text-sm {day.note ? 'text-foreground' : 'text-muted-foreground'}"
        >
          {day.note || 'No meal set'}
        </span>
        {#if hasNotes}
          <StickyNote
            class="h-4 w-4 shrink-0 text-primary"
            strokeWidth={2.5}
            aria-label="has notes"
            data-testid={`${testid}-note-indicator`}
          />
        {/if}
      </span>

      <!-- Cook: the assigned chef(s) as amber avatars, or a flag when nobody's on.
           Its own fixed-width column so the roster chips beside it always line up. -->
      <span
        class="flex w-16 shrink-0 items-center justify-center gap-1"
        data-testid={`${testid}-cook`}
      >
        {#if hasCook}
          {#each chefMembers as c (c.id)}
            <span
              class="relative flex {chip.box} items-center justify-center rounded-full bg-amber-500 font-semibold text-white"
              title={`${c.name} is cooking`}
              data-testid={`${testid}-cook-${c.id}`}
            >
              {memberInitials(c.name)}
              <span
                class="absolute -bottom-1 -right-1 flex {chip.badge} items-center justify-center rounded-full bg-amber-600 ring-2 ring-background"
                aria-hidden="true"
              >
                <ChefHat class="{chip.hat} text-white" strokeWidth={2.5} />
              </span>
            </span>
          {/each}
        {:else}
          <span
            class="flex items-center gap-1 text-[11px] font-medium text-destructive"
            data-testid={`${testid}-no-cook`}
          >
            <ChefHat class="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
            No cook
          </span>
        {/if}
      </span>

      <!-- Who's eating: fixed roster → constant width, so chips line up across every
           row. Attending members are filled with their home time below; the rest are
           muted (not eating). Guests get their own reserved slot so chips never shift.
           This is the row's "# eating" at a glance — the home times keep the existing
           collapsed-summary contract. -->
      <span class="flex shrink-0 items-start gap-2.5 lg:gap-3">
        {#each members as m (m.id)}
          {@const a = attendeeOf(m.id)}
          <span class="flex flex-col items-center gap-0.5">
            <span
              class="flex {chip.box} items-center justify-center rounded-full font-semibold
              {isAttending(m.id)
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground/50'}"
              title={m.name}
              data-testid={`${testid}-chip-${m.id}`}
            >
              {memberInitials(m.name)}
            </span>
            {#if isAttending(m.id) && a?.homeTime}
              <span class="{chip.time} tabular-nums text-muted-foreground">{a.homeTime}</span>
            {/if}
          </span>
        {/each}
        <!-- Guests: their own reserved column so the member chips never shift. -->
        <span class="flex {chip.h} w-8 shrink-0 items-center justify-start">
          {#if day.guests > 0}
            <span
              class="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground"
              data-testid={`${testid}-guest-badge`}>+{day.guests}</span
            >
          {/if}
        </span>
      </span>

      <!-- Weather glyph: a small pictogram only (the full evening forecast lives in
           the expanded detail). The cell is always reserved so columns stay aligned;
           it renders empty on days with no forecast and in the weather-free template
           editor (icon is null there). -->
      <span class="flex w-8 shrink-0 items-center justify-center">
        {#if icon}
          <WeatherIcon {icon} class="h-8 w-8" />
        {/if}
      </span>

      <span class="shrink-0 text-muted-foreground" aria-hidden="true">
        {#if open}<ChevronDown class="h-4 w-4" />{:else}<ChevronRight class="h-4 w-4" />{/if}
      </span>
    </button>
  </div>

  {#if open}
    <!-- Expanded detail (Phase 2, #469): three stacked blocks, top→bottom —
         (1) forecast strip, (2) Dinner (meal + recipes), (3) At the table (roster).
         Flatter and shorter than the old form: the forecast leads, and the roster
         is one tidy row per member (avatar = eating toggle, chef-hat = cooking),
         with shift/late times revealed only for people who are eating. -->
    <div class="flex flex-col gap-4 border-t px-3 py-3" data-testid={`${testid}-detail`}>
      <!-- 1. Forecast strip: the evening forecast leads the detail. Real-week only
           — gated on `weather`, so the weekday template editor and out-of-horizon
           days render nothing (parent passes no weather there). Keeps WeatherSummary's
           tap-tooltip metric chips. -->
      {#if weather}
        <WeatherSummary {weather} testid={`${testid}-weather`} />
      {/if}

      <!-- 2. Dinner: the meal field and any attached recipes, grouped. -->
      <div class="flex flex-col gap-2">
        <label class="text-xs font-medium text-muted-foreground" for={`${testid}-note`}
          >Dinner</label
        >
        <textarea
          bind:this={noteEl}
          id={`${testid}-note`}
          rows="1"
          class="w-full resize-none overflow-hidden rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="What's for dinner?"
          value={day.note}
          oninput={(e) => onNoteChange(e.currentTarget.value)}
          data-testid={`${testid}-note`}></textarea>

        <!-- Attached recipes (issue #17): the chosen recipes as thumbnail rows, then
             a quiet "Add a recipe" picker at the foot. Selecting a recipe APPENDS its
             id; the picker remounts (keyed) so its input clears, ready for the next
             add. Rendered only in the week editor (onRecipesChange present); the
             weekday template editor omits the prop and stays recipe-free. -->
        {#if onRecipesChange}
          <div class="flex flex-col gap-1.5" data-testid={`${testid}-recipes`}>
            {#each attachedRecipes as r (r.id)}
              {@const url = heroUrl(r)}
              <div
                class="flex items-center justify-between gap-2 rounded border px-2 py-1.5"
                data-testid={`${testid}-recipe-row-${r.id}`}
              >
                <!-- Thumbnail + title open the recipe's full view. One button owns the
                     leading thumbnail and the title so the whole area is the tap
                     target; the Remove button (a sibling, not nested) keeps its own
                     handler and never triggers navigation. -->
                <button
                  type="button"
                  class="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onclick={() => openRecipe(r.id)}
                  data-testid={`${testid}-recipe-open-${r.id}`}
                >
                  <span class="h-10 w-10 shrink-0 overflow-hidden rounded bg-muted">
                    {#if url}
                      <img
                        src={url}
                        alt=""
                        loading="lazy"
                        class="h-full w-full object-cover"
                        data-testid={`${testid}-recipe-thumb-${r.id}`}
                      />
                    {:else}
                      <span
                        class="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-muted/40 text-muted-foreground/60"
                        data-testid={`${testid}-recipe-thumb-fallback-${r.id}`}
                      >
                        <Icon name="CookingPot" size={18} />
                      </span>
                    {/if}
                  </span>
                  <span class="min-w-0 truncate text-sm">{r.title}</span>
                </button>
                <!-- Add to shop (Phase 4, #469): hand the full recipe up to the page,
                     which guards the default list then opens RecipeAddToListSheet.
                     Rendered only when the parent supplies the callback — the template
                     editor omits it and so stays shopping-free. -->
                {#if onRecipeAddToList}
                  <Button
                    variant="ghost"
                    size="sm"
                    onclick={(e) => {
                      e.stopPropagation();
                      onRecipeAddToList?.(r);
                    }}
                    aria-label={`Add ${r.title} to shopping list`}
                    data-testid={`${testid}-recipe-addshop-${r.id}`}
                  >
                    <Icon name="ShoppingCart" size={16} />
                  </Button>
                {/if}
                <Button
                  variant="ghost"
                  size="sm"
                  onclick={(e) => {
                    e.stopPropagation();
                    removeRecipe(r.id);
                  }}
                  aria-label={`Remove ${r.title}`}
                  data-testid={`${testid}-recipe-remove-${r.id}`}
                >
                  <X class="h-4 w-4" />
                </Button>
              </div>
            {/each}
            {#key recipePickerKey}
              <Combobox
                items={recipePickerItems}
                value=""
                filterFn={recipeFilter}
                restrict
                placeholder="Add a recipe…"
                onValueChange={addRecipe}
              >
                <ComboboxField>
                  <ComboboxInput data-testid={`${testid}-recipe-picker`} />
                  <ComboboxTrigger />
                </ComboboxField>
                <ComboboxContent>
                  {#snippet children({ filteredItems })}
                    {#each filteredItems as item, i (item.value)}
                      <ComboboxItem {item} index={i} />
                    {/each}
                    {#if filteredItems.length === 0}
                      <ComboboxEmpty>No recipes found</ComboboxEmpty>
                    {/if}
                  {/snippet}
                </ComboboxContent>
              </Combobox>
            {/key}
          </div>
        {/if}
      </div>

      <!-- 3. At the table: one compact row per member. The avatar toggles EATING
           (a checkbox — tap to opt in/out); the chef-hat toggles COOKING,
           independent of eating (a chef need not eat). Home-time + note reveal only
           for members who are eating. Unknown attendees stay removable; guests are a
           small +/- stepper at the foot. -->
      <div class="flex flex-col gap-2">
        <span class="text-xs font-medium text-muted-foreground">At the table</span>
        {#each members as m (m.id)}
          {@const a = attendeeOf(m.id)}
          <div class="flex flex-col gap-1" data-testid={`${testid}-attendee-${m.id}`}>
            <div class="flex items-center gap-2.5">
              <!-- Avatar = eating toggle. `role="checkbox"` + aria-checked keep it an
                   accessible toggle and satisfy the roster tests; filled when eating,
                   muted when not. The testid wraps it so `within(attend).getByRole`
                   resolves the avatar. -->
              <span data-testid={`${testid}-attend-${m.id}`}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isAttending(m.id)}
                  aria-label={m.name}
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors
                    {isAttending(m.id)
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground/60 hover:bg-muted/70'}"
                  onclick={() => onAttendeeToggle(m.id)}
                >
                  {memberInitials(m.name)}
                </button>
              </span>
              <span
                class="min-w-0 flex-1 truncate text-sm {isAttending(m.id)
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground'}"
              >
                {m.name}
              </span>
              <!-- Chef-hat = cooking toggle, independent of eating. Plain button so both
                   states are fully Tailwind: selected = filled amber, unselected = clear
                   neutral. Keeps `bg-amber-500` when on (styling test). -->
              <button
                type="button"
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors
                  {isChef(m.id)
                  ? 'border-amber-500 bg-amber-500 text-white hover:bg-amber-600'
                  : 'border-input bg-background text-muted-foreground hover:bg-muted'}"
                onclick={() => onChefToggle(m.id)}
                aria-pressed={isChef(m.id)}
                aria-label={`${m.name} is cooking`}
                data-testid={`${testid}-chef-${m.id}`}
              >
                <ChefHat class="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
            {#if isAttending(m.id)}
              {@const parts = timeParts(a?.homeTime)}
              <!-- Home time + note reveal only when this member is eating. Time entry
                   sits to the left of the note; both share the same height so the row
                   reads as one control. -->
              <div class="ml-11 flex items-stretch gap-2">
                <!-- Home time as [HH]:[MM]. Each dropdown's `value` seeds to the
                     dinner default so a blank field opens at ~18:30 (not midnight),
                     while the trigger shows a placeholder until a real value is set. -->
                <div class="flex shrink-0 items-center gap-0.5">
                  <Select
                    value={parts.hh || DINNER_HOUR}
                    onValueChange={(v) => commitHour(m.id, v)}
                  >
                    <SelectTrigger
                      class="h-8 w-12 justify-center px-1 tabular-nums {parts.hh
                        ? ''
                        : 'text-muted-foreground'}"
                      aria-label={`${m.name} home time hour`}
                      data-testid={`${testid}-time-${m.id}`}
                    >
                      {parts.hh || 'HH'}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">No time</SelectItem>
                      {#each HOUR_OPTIONS as h (h)}
                        <SelectItem value={h}>{h}</SelectItem>
                      {/each}
                    </SelectContent>
                  </Select>
                  <span class="text-sm text-muted-foreground">:</span>
                  <Select
                    value={parts.mm || DINNER_MINUTE}
                    onValueChange={(v) => commitMinute(m.id, v)}
                  >
                    <SelectTrigger
                      class="h-8 w-12 justify-center px-1 tabular-nums {parts.mm
                        ? ''
                        : 'text-muted-foreground'}"
                      aria-label={`${m.name} home time minute`}
                      data-testid={`${testid}-time-min-${m.id}`}
                    >
                      {parts.mm || 'MM'}
                    </SelectTrigger>
                    <SelectContent>
                      {#each MINUTE_OPTIONS as mo (mo)}
                        <SelectItem value={mo}>{mo}</SelectItem>
                      {/each}
                    </SelectContent>
                  </Select>
                </div>
                <input
                  class="h-8 w-full flex-1 rounded-md border bg-background px-2 text-sm"
                  placeholder="Add a note (e.g. portion for tomorrow)"
                  value={a?.note ?? ''}
                  oninput={(e) => onAttendeeNote(m.id, e.currentTarget.value)}
                  aria-label={`${m.name} note`}
                  data-testid={`${testid}-attnote-${m.id}`}
                />
              </div>
            {/if}
          </div>
        {/each}

        {#each unknownAttendees as a (a.memberId)}
          <div
            class="flex items-center justify-between gap-2 rounded border border-dashed px-2 py-1.5"
            data-testid={`${testid}-unknown-${a.memberId}`}
          >
            <span class="truncate text-sm text-muted-foreground">
              Unknown member ({a.memberId})
            </span>
            <Button
              variant="ghost"
              size="sm"
              onclick={() => onAttendeeToggle(a.memberId)}
              data-testid={`${testid}-unknown-remove-${a.memberId}`}
            >
              Remove
            </Button>
          </div>
        {/each}

        <!-- Occasional unnamed guests: a small +/- stepper at the foot. -->
        <div class="flex items-center gap-2 pt-1" data-testid={`${testid}-guests`}>
          <span class="flex-1 text-sm text-muted-foreground">Guests</span>
          <Button
            variant="outline"
            size="sm"
            disabled={day.guests <= 0}
            onclick={() => onGuestsChange(day.guests - 1)}
            aria-label="Fewer guests"
            data-testid={`${testid}-guests-dec`}
          >
            −
          </Button>
          <span class="w-6 text-center text-sm tabular-nums" data-testid={`${testid}-guests-count`}>
            {day.guests}
          </span>
          <Button
            variant="outline"
            size="sm"
            onclick={() => onGuestsChange(day.guests + 1)}
            aria-label="More guests"
            data-testid={`${testid}-guests-inc`}
          >
            +
          </Button>
        </div>

        <p class="text-[11px] text-muted-foreground">
          {attendingCount}
          {attendingCount === 1 ? 'person' : 'people'} eating
        </p>
      </div>
    </div>
  {/if}
</div>
