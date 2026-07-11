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
    temperatureBand,
    type Day,
    type Member,
    type Recipe,
    type TemperatureBand,
  } from '@salt/domain';
  import type { WeatherDaySummary } from '@salt/domain/schemas';
  import WeatherIcon from '$lib/weather-icons/WeatherIcon.svelte';
  import WeatherSummary from './WeatherSummary.svelte';

  // Collapsible editor for a single Day, shared by the weekly page (date-keyed)
  // and the template editor (weekday-keyed). Collapsed it shows a compact,
  // stacked summary — a taller header built for at-a-glance scanning: day +
  // weather glyph & temperature on top, then the roster of member avatars
  // (coloured for eating/not, home time beneath, the cook marked ONCE with a
  // chef-hat badge overlapping their top-left and 15% larger, and a note badge
  // on the top-right of anyone with an attendee note), then the meal's first
  // line beneath the avatars (with a "No cook" flag when unassigned). Expand one
  // day to edit detail in a roomy panel. It knows nothing about day keys: the
  // parent supplies handlers already bound to the right date/weekday. Members
  // resolve live; an unknown memberId renders as removable, never blocking. See
  // docs/meal-planning.md.
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
  // `cookBox` is the same avatar 15% larger — the cook's chip is bumped one nudge
  // so it stands out in the roster without breaking the row's alignment.
  const chip = $derived(
    members.length <= 4
      ? {
          box: 'h-9 w-9 text-xs',
          cookBox: 'h-[41px] w-[41px] text-sm',
          h: 'h-9',
          time: 'text-[11px]',
          badge: 'h-4 w-4',
          hat: 'h-3 w-3',
        }
      : members.length <= 6
        ? {
            box: 'h-8 w-8 text-[11px]',
            cookBox: 'h-[37px] w-[37px] text-xs',
            h: 'h-8',
            time: 'text-[10px]',
            badge: 'h-3.5 w-3.5',
            hat: 'h-2.5 w-2.5',
          }
        : {
            box: 'h-7 w-7 text-[10px]',
            cookBox: 'h-[32px] w-[32px] text-[11px]',
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
  const hasNote = (id: string): boolean => (attendeeOf(id)?.note.trim() ?? '') !== '';

  // The cook is now marked ONCE, inside the roster, via a chef-hat badge on the
  // chef's own avatar (no separate cook column). When `day.chefs` is empty the
  // summary shows a "No cook" flag beside the meal so unassigned days stand out.
  const hasCook = $derived(day.chefs.length > 0);

  // The meal's FIRST line only for the collapsed summary — the meal field is a
  // multi-line textarea, but the header shows a single truncating line beneath
  // the avatars. Empty → the muted "No meal set" placeholder.
  const mealFirstLine = $derived(day.note.split('\n')[0]?.trim() ?? '');

  // Evening-window temperature band (drives the header temp colour, cool→warm),
  // mirroring WeatherSummary. Null whenever there's no forecast for this day.
  const band = $derived<TemperatureBand | null>(weather ? temperatureBand(weather.tempHigh) : null);
  const BAND_CLASS: Record<TemperatureBand, string> = {
    freezing: 'text-sky-600',
    cold: 'text-sky-500',
    cool: 'text-cyan-600',
    mild: 'text-emerald-600',
    warm: 'text-orange-500',
    hot: 'text-red-600',
  };

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
  <!-- Collapsed header (#469, restacked): a taller, at-a-glance summary in three
       stacked bands instead of one squeezed row — (1) the day label with the
       weather glyph + evening temperature on the right, (2) the member-avatar
       roster (each coloured for eating/not, home time beneath, the cook marked
       ONCE with a chef-hat badge on their top-left and their avatar 15% larger, a
       note badge on the top-right of anyone with an attendee note, then a guest
       chip), and (3) the meal's first line beneath the avatars with a "No cook"
       flag when unassigned. Tapping anywhere expands the day's detail below. -->
  <div class="transition-colors hover:bg-muted/40">
    <!-- Collapsed summary: tap anywhere to expand. -->
    <button
      type="button"
      class="flex w-full flex-col gap-2.5 px-3 py-3 text-left"
      onclick={() => (open = !open)}
      aria-expanded={open}
      data-testid={`${testid}-summary`}
    >
      <!-- Band 1: day label (left) · weather glyph + evening temperature · chevron.
           The weather block is gated on `weather` (not `icon`), so the temperature
           still shows on days whose older cached forecast has no pictogram; the glyph
           itself self-hides when the code is absent (WeatherIcon renders nothing). -->
      <div class="flex items-start justify-between gap-3">
        <span class="flex min-w-0 flex-col leading-tight">
          <span class="text-base font-semibold">{label}</span>
          {#if sublabel}<span class="text-xs text-muted-foreground">{sublabel}</span>{/if}
        </span>
        <div class="flex shrink-0 items-center gap-2">
          {#if weather}
            <span class="flex items-center gap-1.5" data-testid={`${testid}-weather-header`}>
              {#if icon}
                <WeatherIcon {icon} class="h-8 w-8" />
              {/if}
              <span
                class="text-sm leading-tight tabular-nums {band ? BAND_CLASS[band] : ''}"
                data-testid={`${testid}-header-temp`}
              >
                <span class="font-semibold">{weather.tempHigh}°</span><span
                  class="font-normal opacity-80"
                >
                  / {weather.tempLow}°</span
                >
              </span>
            </span>
          {/if}
          <span class="text-muted-foreground" aria-hidden="true">
            {#if open}<ChevronDown class="h-5 w-5" />{:else}<ChevronRight class="h-5 w-5" />{/if}
          </span>
        </div>
      </div>

      <!-- Band 2: the roster. Every member appears exactly once — attending members
           are filled, the rest muted. The cook is the same avatar 15% larger with an
           amber chef-hat badge overlapping the top-left; a sky note badge overlaps the
           top-right of anyone with an attendee note. Home time sits beneath whoever
           has one set. Guests are a trailing chip. Wraps on narrow widths. -->
      <div class="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        {#each members as m (m.id)}
          {@const a = attendeeOf(m.id)}
          {@const attending = isAttending(m.id)}
          {@const chef = isChef(m.id)}
          <span class="flex flex-col items-center gap-0.5">
            <span
              class="relative flex {chef ? chip.cookBox : chip.box} items-center justify-center
              rounded-full font-semibold
              {attending
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground/50'}"
              title={chef ? `${m.name} is cooking` : m.name}
              data-testid={`${testid}-chip-${m.id}`}
            >
              {memberInitials(m.name)}
              {#if chef}
                <!-- Chef-hat badge: the cook, marked once, top-left overlap (amber). -->
                <span
                  class="absolute -left-1 -top-1 flex {chip.badge} items-center justify-center
                  rounded-full bg-amber-500 ring-2 ring-background"
                  aria-hidden="true"
                  data-testid={`${testid}-cook-${m.id}`}
                >
                  <ChefHat class="{chip.hat} text-white" strokeWidth={2.5} />
                </span>
              {/if}
              {#if hasNote(m.id)}
                <!-- Note badge: attendee has a note, top-right overlap (sky) — same
                     size/style as the chef hat, a different colour so it stands out. -->
                <span
                  class="absolute -right-1 -top-1 flex {chip.badge} items-center justify-center
                  rounded-full bg-sky-500 ring-2 ring-background"
                  aria-label="has a note"
                  data-testid={`${testid}-note-badge-${m.id}`}
                >
                  <StickyNote class="{chip.hat} text-white" strokeWidth={2.5} />
                </span>
              {/if}
            </span>
            {#if attending && a?.homeTime}
              <span class="{chip.time} tabular-nums text-muted-foreground">{a.homeTime}</span>
            {/if}
          </span>
        {/each}
        {#if day.guests > 0}
          <span class="flex {chip.h} items-center">
            <span
              class="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground"
              data-testid={`${testid}-guest-badge`}>+{day.guests}</span
            >
          </span>
        {/if}
      </div>

      <!-- Band 3: the meal's first line beneath the avatars, truncating. The "No cook"
           flag sits at the end when nobody's assigned, since the chef-hat badge is the
           only other cook cue and it's absent on an unassigned day. -->
      <div class="flex items-center gap-2">
        <span
          class="min-w-0 flex-1 truncate text-sm {mealFirstLine
            ? 'text-foreground'
            : 'text-muted-foreground'}"
        >
          {mealFirstLine || 'No meal set'}
        </span>
        {#if !hasCook}
          <span
            class="flex shrink-0 items-center gap-1 text-[11px] font-medium text-destructive"
            data-testid={`${testid}-no-cook`}
          >
            <ChefHat class="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
            No cook
          </span>
        {/if}
      </div>
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
