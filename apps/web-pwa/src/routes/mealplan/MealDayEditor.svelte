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
    Sheet,
    SheetClose,
    SheetContent,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    type ComboboxItemType,
  } from '@salt/ui-components';
  import { ChefHat, Clock, Utensils, X } from '@lucide/svelte';
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

  // Editor for a single Day, shared by the weekly page (date-keyed) and the
  // template editor (weekday-keyed).
  //
  // Collapsed it is a LEDGER ROW (#639, Phase 1): a dated rail down the left
  // (weekday over date, today's date in a filled teal disc) and, to its right,
  // the day's card — the recipe photograph as a clean, undamaged rectangle, the
  // meal title beneath it in Epilogue, then one quiet grey meta line (who is
  // cooking · who is eating, by name · any home time actually set). No text over
  // the photo, no scrim, no border, no wash. A day with no photo is not
  // second-class: the card is a text block with the meal one step larger.
  //
  // TAPPING THE ROW OPENS THE DAY IN A BOTTOM SHEET (#640, Phase 1) — the detail
  // is no longer a panel pushed in underneath, which shoved the rest of the week
  // down the deck. `open` is a BINDABLE prop, not row-local state: the PAGE owns
  // which day is open (in memory only — Rule 3), so exactly one day is ever open,
  // and a Firestore snapshot re-render can no longer collapse the day you are
  // editing. It knows nothing about day keys: the parent supplies handlers
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
    // The day's sheet heading. `label`/`sublabel` are sized for the RAIL — "THU"
    // over "30" — so the planner passes the day written out in full here
    // ("Thursday 30 July") rather than widening the rail. Optional: the template
    // editor's `label` is already the whole weekday, so it says nothing extra and
    // the fallback below is exactly right.
    sheetTitle?: string;
    // Which day is open is owned by the PAGE, not the row (#640): bindable so the
    // parent can hold one `openDay` for the whole week and get one-at-a-time for
    // free. In memory only — never persisted (Rule 3).
    open?: boolean;
    day: Day;
    members: Member[];
    // Full recipe list, resolved live so attached ids render their current title
    // (never denormalised onto the plan doc). Missing/deleted ids are skipped.
    // Optional: the weekday-keyed template editor omits it and stays recipe-free.
    recipes?: readonly Recipe[];
    testid: string;
    // Today's row wears its date in a filled teal disc, so the eye lands on it
    // without reading. Date-only, so the weekday-keyed template editor omits it.
    isToday?: boolean;
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
    sheetTitle,
    open = $bindable(false),
    day,
    members,
    recipes = [],
    testid,
    isToday = false,
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

  // The sheet's heading. Falls back to the rail's own words, which is the whole
  // answer for the template editor ("Monday") and a sane one anywhere else.
  const heading = $derived(sheetTitle ?? `${label}${sublabel ? ` ${sublabel}` : ''}`);

  // ─── Where this sheet's dropdowns portal to (#640, Phase 1) ────────────────
  // A modal dialog makes the rest of the page inert by putting
  // `pointer-events: none` on <body>. Select/Combobox portal their popover to
  // <body> by DEFAULT, which lands it OUTSIDE the dialog and therefore inert:
  // the list renders, and every option is unclickable. So this sheet's dropdowns
  // portal INTO the sheet's own content element instead — inside the live layer,
  // and outside the scrolling region below, so nothing clips them either. The
  // hook is a plain marker class on SheetContent (not a bits-ui internal), and
  // only one day's sheet is ever open, so the selector is unambiguous.
  const DROPDOWN_HOST = 'meal-day-sheet';
  const DROPDOWN_PORTAL = `.${DROPDOWN_HOST}`;

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

  // Home time is optional and picked as ONE dropdown (#640, Phase 2) rather than a
  // native <input type="time">, which renders a different control on every OS
  // (spinner / wheel / free-text) and makes the minutes an unwanted scroll through
  // all 60 values. This field answers "when are you home for dinner", so the list
  // is deliberately short and whole: the dinner window on the quarter hour,
  // 17:00–22:45 (24 entries), plus "No time" to clear. One tap, one choice — the
  // times on offer are exactly what the old [HH]:[MM] pair could produce. Empty
  // value = no home time set: the trigger reads "No time" while the Select's own
  // value seeds to the dinner default so an opened list lands on ~18:30 rather
  // than at the top. Stored 24h "HH:MM" matches the summary chip. A legacy value
  // off the quarter hour or outside the window is displayed VERBATIM in the
  // trigger (never silently reset); it simply isn't in the list, so re-picking
  // means moving into the window.
  const DINNER_TIME = '18:30';
  const TIME_OPTIONS = Array.from(
    { length: 24 },
    (_, i) => `${17 + Math.floor(i / 4)}:${String((i % 4) * 15).padStart(2, '0')}`,
  );

  // Picking "No time" (value '') clears to null; every other option is already a
  // whole "HH:MM" and stores verbatim.
  const commitTime = (memberId: string, t: string): void => {
    onAttendeeHomeTime(memberId, t === '' ? null : t);
  };

  // ─── The personal note lives behind an affordance (#640, Phase 3) ──────────
  // A member is ONE LINE. The per-person note is the rare exception ("portion for
  // tomorrow"), so it costs one extra tap to write and nothing to ignore — but a
  // note that already exists is never hidden: it renders unprompted, and its
  // affordance is tinted, so nobody has to go looking. Which notes are open is
  // in-memory only (Rule 3) and per member — a plain record, keyed by memberId,
  // deliberately not persisted anywhere. An entry is absent until the member's
  // affordance is tapped; absent means "whatever the note itself implies", so the
  // toggle is handed the state it is flipping rather than reading the record.
  let notesOpen = $state<Record<string, boolean>>({});
  function toggleNote(id: string, shown: boolean): void {
    notesOpen[id] = !shown;
  }

  const isAttending = (id: string): boolean => day.attendees.some((a) => a.memberId === id);
  const isChef = (id: string): boolean => day.chefs.includes(id);
  const attendeeOf = (id: string) => day.attendees.find((a) => a.memberId === id);

  // Attendees referencing someone no longer in the roster — rendered removable so
  // the document is never silently corrupted.
  const unknownAttendees = $derived(
    day.attendees.filter((a) => !members.some((m) => m.id === a.memberId)),
  );
  const attendingCount = $derived(day.attendees.length + day.guests);

  // `day.chefs` empty ⇒ the row's meta line opens with a "No cook" flag so an
  // unassigned day still stands out in an otherwise uniformly grey line.
  const hasCook = $derived(day.chefs.length > 0);

  // The meal's FIRST line only for the collapsed row — the meal field is a
  // multi-line textarea, but the row shows a single truncating title. Empty →
  // the muted "No meal set" placeholder.
  const mealFirstLine = $derived(day.note.split('\n')[0]?.trim() ?? '');

  // ─── The row's photograph (#639) ───────────────────────────────────────────
  // The first attached recipe that actually has a visible hero. Null on a day
  // with no recipe (or none with a photo) — the card then becomes a text block
  // with the meal one step larger, deliberately NOT a placeholder tile.
  const photoUrl = $derived(
    attachedRecipes.map((r) => heroUrl(r)).find((u): u is string => u !== null) ?? null,
  );

  // ─── The row's cook-and-table line (#639, reshaped in #640) ────────────────
  // Two facts, one at each end: who is cooking, and how many are at the table.
  // It used to be one sentence naming every eater, but with five in the house —
  // two of them here only part of the week — that list was the longest and least
  // stable thing in the row. The head count survives any width; WHO is eating is
  // named in the sheet, one tap away, where it can be read and changed.
  const cookNames = $derived(members.filter((m) => isChef(m.id)).map((m) => m.name));
  const homeTimes = $derived(
    members
      .filter((m) => isAttending(m.id))
      .map((m) => ({ name: m.name, at: attendeeOf(m.id)?.homeTime ?? null }))
      .filter((x): x is { name: string; at: string } => x.at !== null && x.at !== '')
      .map((x) => `${x.name} ${x.at}`),
  );

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

<!-- One day = one object in the list (#639). No card border and no wash: the day
     is held together by the dated rail on its left and the air around it (the
     page spaces the rows 24px apart), not by a box. -->
<div data-testid={testid}>
  <!-- The two rows of the card, defined once and rendered into either the scrim
       over the photograph or the bare text block, so a change lands in both.
       Every colour is passed in, because the ink is a fact about the GROUND the
       row sits on (near-black photograph vs the page) and nothing else differs. -->
  {#snippet mealLine(sizeCls: string, inkCls: string, mutedCls: string)}
    <span
      class="line-clamp-2 text-center font-display font-semibold leading-snug {sizeCls} {mealFirstLine
        ? inkCls
        : mutedCls}"
      data-testid={`${testid}-meal`}
    >
      {mealFirstLine || 'No meal set'}
    </span>
  {/snippet}

  <!-- Cook on the left, the table on the right, and the row's priority written
       into the flex: the cook and any home time are shrink-0 and never truncate,
       so the ONE thing that can give way is the head count — which is already a
       number. Who is actually eating is named in the sheet, a tap away. -->
  {#snippet tableLine(inkCls: string, noCookCls: string)}
    <span class="flex items-center gap-2.5 text-xs {inkCls}" data-testid={`${testid}-meta`}>
      <span class="flex min-w-0 shrink items-center gap-1.5">
        <ChefHat class="h-[15px] w-[15px] shrink-0" aria-hidden="true" />
        {#if hasCook}
          <span class="truncate">{cookNames.join(' & ')}</span>
        {:else}
          <span class="whitespace-nowrap {noCookCls}" data-testid={`${testid}-no-cook`}>
            No cook
          </span>
        {/if}
      </span>
      <span class="flex min-w-0 flex-1 items-center justify-end gap-1.5">
        <span class="shrink-0 font-semibold tabular-nums">{attendingCount}</span>
        <Utensils class="h-[15px] w-[15px] shrink-0" aria-hidden="true" />
        {#if homeTimes.length}
          <span class="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
            <Clock class="h-[15px] w-[15px] shrink-0" aria-hidden="true" />
            {homeTimes.join(', ')}
          </span>
        {/if}
      </span>
    </span>
  {/snippet}

  <!-- The collapsed row (#639, Phase 1): dated rail | photograph → title → meta.
       The whole row is the tap target; tapping raises the day's sheet (#640).
       No `aria-expanded`: nothing expands in place any more, and the dialog the
       sheet opens carries its own ARIA set (role, modality, labelled by its
       title). Markup otherwise untouched. -->
  <button
    type="button"
    class="flex w-full gap-3 text-left"
    onclick={() => (open = true)}
    data-testid={`${testid}-summary`}
  >
    <!-- The dated rail: weekday over date, an edge to run the eye down. Today's
         date sits in a filled teal disc (the primary token), so "where am I in
         the week" is answered without reading. The evening forecast rides at the
         foot of the rail — gated on `weather` (not `icon`), so an older cached
         doc with no pictogram still shows its temperature; the glyph self-hides
         when the code is absent. -->
    <!-- The rail is narrow when it carries a date disc (the planner, where a tight
         column is the point). The template editor has no dates, so its rail holds a
         bare weekday word — "Wednesday" wraps at w-14, hence the wider track. -->
    <div class="flex {sublabel ? 'w-14' : 'w-20'} shrink-0 flex-col items-center gap-1">
      <span
        class="text-center text-[11px] font-semibold uppercase leading-tight tracking-wider text-muted-foreground"
      >
        {label}
      </span>
      {#if sublabel}
        <span
          class="flex h-8 min-w-8 items-center justify-center rounded-full px-1 text-base font-semibold leading-none tabular-nums {isToday
            ? 'bg-primary text-primary-foreground'
            : 'text-foreground'}"
          data-testid={`${testid}-date`}
        >
          {sublabel}
        </span>
      {/if}
      {#if weather}
        <span class="flex flex-col items-center" data-testid={`${testid}-weather-header`}>
          {#if icon}
            <WeatherIcon {icon} class="h-8 w-8" />
          {/if}
          <span
            class="text-[10px] leading-none tabular-nums {band ? BAND_CLASS[band] : ''}"
            data-testid={`${testid}-header-temp`}
          >
            <span class="font-semibold">{weather.tempHigh}°</span><span
              class="font-normal opacity-80">/{weather.tempLow}°</span
            >
          </span>
        </span>
      {/if}
    </div>

    <!-- The day's card. The two rows RIDE THE FOOT of the photograph rather than
         sitting under it: the row gives back the height the text used to cost and
         the picture gets a wider 1.6:1 crop in the same space. A day with no photo
         is not second-class — the same two rows, unboxed, with the meal one step
         larger and in the page's own ink. Both cases render from the snippets
         below, so the two layouts cannot drift apart. -->
    <div class="flex min-w-0 flex-1 flex-col">
      {#if photoUrl}
        <div class="relative overflow-hidden rounded-lg">
          <img
            src={photoUrl}
            alt=""
            loading="lazy"
            class="aspect-[1.6] w-full object-cover"
            data-testid={`${testid}-photo`}
          />
          <!-- The scrim is readability, not decoration: opaque at the foot and
               clear before the middle, so no more of the dish is veiled than the
               two rows actually need. -->
          <div
            class="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-black/100 via-black/60 to-transparent px-3 py-2.5"
          >
            {@render mealLine('text-base', 'text-white', 'text-white/70')}
            {@render tableLine(
              'text-white/80',
              'rounded bg-destructive px-1.5 font-medium text-destructive-foreground',
            )}
          </div>
        </div>
      {:else}
        <div class="flex flex-col gap-2">
          {@render mealLine('text-lg', 'text-foreground', 'text-muted-foreground')}
          {@render tableLine('text-muted-foreground', 'text-destructive')}
        </div>
      {/if}
    </div>
  </button>

  <!-- The day opens in a bottom sheet (#640, Phase 1). The deck moves its column
       with a transform, which creates a containing block — so an in-row `fixed`
       panel would be trapped by it. `portal` is left at its default ('body'),
       which is what puts the sheet over the whole dimmed week. Scrim, focus trap,
       scroll lock, Escape and outside-click dismissal all come from the Dialog
       underneath; there is no drag-to-dismiss. -->
  <Sheet bind:open side="bottom">
    <SheetContent
      class="{DROPDOWN_HOST} max-h-[85dvh] gap-3 p-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
    >
      <SheetHeader>
        <SheetTitle>{heading}</SheetTitle>
      </SheetHeader>

      <!-- Detail (Phase 2, #469): three stacked blocks, top→bottom —
           (1) forecast strip, (2) Dinner (meal + recipes), (3) At the table (roster).
           Flatter and shorter than the old form: the forecast leads, and the roster
           is one tidy row per member (avatar = eating toggle, chef-hat = cooking),
           with shift/late times revealed only for people who are eating.
           The base sheet class carries no max-height and no overflow, so the
           scrolling region is constrained here — the header and footer stay put
           and only the day's detail moves. -->
      <div
        class="flex max-h-[70dvh] flex-col gap-4 overflow-y-auto"
        data-testid={`${testid}-detail`}
      >
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
            onblur={(e) => {
              // Re-seed an emptied meal field from the first attached recipe. The
              // attach-time seed (see `addRecipe`) only fires once, so clearing the
              // text used to leave a day with a recipe and no meal. BLUR, not input:
              // while the caret is in the field the text is the user's — they may be
              // mid-way through replacing it — so the refill waits until they leave
              // it empty. Read the DOM value, not `day.note`: `onNoteChange` is
              // fire-and-forget and the prop lags the store re-emit. Guard on
              // `attachedRecipes` so a since-deleted recipe id can't seed nothing.
              if (!e.currentTarget.value.trim() && attachedRecipes[0])
                onNoteChange(attachedRecipes[0].title);
            }}
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
                  portal={DROPDOWN_PORTAL}
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

        <!-- 3. At the table: A MEMBER IS ONE LINE (#640, Phase 3). Avatar, name,
           home time and chef hat all sit on a single row; the free-text personal
           note — the rare thing, wanted on maybe one person on maybe one evening —
           hides behind a small affordance beside the chef hat. On an ordinary
           evening with nobody noted the whole table fits without scrolling.
           The avatar toggles EATING (a checkbox — tap to opt in/out); the chef-hat
           toggles COOKING, independent of eating (a chef need not eat). Home time
           and the note affordance show only for members who are eating. Unknown
           attendees stay removable; guests are a small +/- stepper at the foot. -->
        <div class="flex flex-col gap-2">
          <span class="text-xs font-medium text-muted-foreground">At the table</span>
          {#each members as m (m.id)}
            {@const a = attendeeOf(m.id)}
            {@const attending = isAttending(m.id)}
            {@const note = a?.note ?? ''}
            <!-- Untouched (`undefined`) ⇒ open iff a note is already written, so an
               existing note is never hidden; once the member's affordance has been
               tapped that explicit choice wins in both directions. -->
            {@const noteShown = attending && (notesOpen[m.id] ?? note !== '')}
            <div class="flex flex-col gap-1" data-testid={`${testid}-attendee-${m.id}`}>
              <div class="flex items-center gap-2">
                <!-- Avatar = eating toggle. `role="checkbox"` + aria-checked keep it an
                   accessible toggle and satisfy the roster tests; filled when eating,
                   muted when not. The testid wraps it so `within(attend).getByRole`
                   resolves the avatar. -->
                <span data-testid={`${testid}-attend-${m.id}`}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={attending}
                    aria-label={m.name}
                    class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors
                    {attending
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground/60 hover:bg-muted/70'}"
                    onclick={() => onAttendeeToggle(m.id)}
                  >
                    {memberInitials(m.name)}
                  </button>
                </span>
                <span
                  class="min-w-0 flex-1 truncate text-sm {attending
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground'}"
                >
                  {m.name}
                </span>
                {#if attending}
                  <!-- Home time as one quarter-hour dropdown (#640, Phase 2), now on
                     the member's own line. `value` seeds to the dinner default so a
                     blank field opens at ~18:30 (not at the top of the window), while
                     the trigger reads "No time" until a real value is set. -->
                  <Select
                    value={a?.homeTime || DINNER_TIME}
                    portal={DROPDOWN_PORTAL}
                    onValueChange={(v) => commitTime(m.id, v)}
                  >
                    <SelectTrigger
                      class="h-8 w-20 shrink-0 justify-center px-1 tabular-nums {a?.homeTime
                        ? ''
                        : 'text-muted-foreground'}"
                      aria-label={`${m.name} home time`}
                      data-testid={`${testid}-time-${m.id}`}
                    >
                      {a?.homeTime || 'No time'}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">No time</SelectItem>
                      {#each TIME_OPTIONS as t (t)}
                        <SelectItem value={t}>{t}</SelectItem>
                      {/each}
                    </SelectContent>
                  </Select>
                  <!-- The note affordance. Empty note = a quiet outline the eye skips;
                     a note already written = filled in the primary tint, so "someone
                     has said something about tonight" reads off the closed row without
                     opening anything. -->
                  <button
                    type="button"
                    class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors
                    {note !== ''
                      ? 'border-primary bg-primary/10 text-primary hover:bg-primary/20'
                      : 'border-input bg-background text-muted-foreground hover:bg-muted'}"
                    onclick={() => toggleNote(m.id, noteShown)}
                    aria-expanded={noteShown}
                    aria-label={note !== ''
                      ? `${m.name} note: ${note}`
                      : `Add a note for ${m.name}`}
                    data-testid={`${testid}-attnote-toggle-${m.id}`}
                  >
                    <Icon name="StickyNote" size={16} />
                  </button>
                {/if}
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
                  <ChefHat class="h-4 w-4" />
                </button>
              </div>
              {#if noteShown}
                <!-- The note itself, on its own line under the name (ml-11 = the avatar
                   plus the row gap). Still fire-and-forget per keystroke — the parent
                   owns the write; opening it here pins the row so clearing the text
                   mid-edit cannot yank the field out from under the caret. -->
                <input
                  class="ml-11 h-8 rounded-md border bg-background px-2 text-sm"
                  placeholder="Add a note (e.g. portion for tomorrow)"
                  value={note}
                  oninput={(e) => {
                    notesOpen[m.id] = true;
                    onAttendeeNote(m.id, e.currentTarget.value);
                  }}
                  aria-label={`${m.name} note`}
                  data-testid={`${testid}-attnote-${m.id}`}
                />
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
            <span
              class="w-6 text-center text-sm tabular-nums"
              data-testid={`${testid}-guests-count`}
            >
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

      <!-- Every edit above is already saved (fire-and-forget through the parent's
           handlers), so the footer has nothing to confirm — only a way out that
           does not require finding the scrim. -->
      <SheetFooter>
        <SheetClose class="h-9 w-auto rounded-md border border-input px-4 text-sm font-medium">
          Done
        </SheetClose>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</div>
