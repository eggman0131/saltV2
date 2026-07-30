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
  import { ChefHat, X } from '@lucide/svelte';
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
  import type { WeatherDaySummary, ShoppingSlot } from '@salt/domain/schemas';
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
    // ─── Shop day (issue #629) ──────────────────────────────────────────────
    // Both are date-only concepts, so the weekday-keyed template editor omits
    // them and stays shop-free. The parent owns which date is the shop and the
    // one-shop-per-week rule; this component only reports the picked slot.
    // `shopSlot` non-null ⇒ THIS day is the shop. The shop is DISPLAYED by the
    // page as a labelled rule across the list (#639), not by this row.
    shopSlot?: ShoppingSlot | null;
    onShopSlotChange?: (slot: ShoppingSlot | null) => void;
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
    shopSlot = null,
    onShopSlotChange,
  }: Props = $props();

  // Tapping the slot that is already set clears the shop day — one control, three
  // states (none / AM / PM), no separate "clear" affordance to find.
  function pickSlot(slot: ShoppingSlot): void {
    onShopSlotChange?.(shopSlot === slot ? null : slot);
  }

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

  // ─── The row's one grey meta line (#639) ───────────────────────────────────
  // "who is cooking · who is eating (by name) · any home time that has actually
  // been set" — names, not avatars, so the line reads as a sentence and truncates
  // gracefully. "Everyone" replaces the full roster; guests append as "+2".
  const cookNames = $derived(members.filter((m) => isChef(m.id)).map((m) => m.name));
  const attendingNames = $derived(members.filter((m) => isAttending(m.id)).map((m) => m.name));
  const everyoneEating = $derived(
    members.length > 0 && attendingNames.length === members.length && unknownAttendees.length === 0,
  );
  const eatingSegment = $derived(
    attendingNames.length === 0
      ? day.guests > 0
        ? `${day.guests} guest${day.guests === 1 ? '' : 's'}`
        : ''
      : `${everyoneEating ? 'Everyone' : attendingNames.join(', ')}${
          day.guests > 0 ? ` +${day.guests}` : ''
        }`,
  );
  const homeTimes = $derived(
    members
      .filter((m) => isAttending(m.id))
      .map((m) => ({ name: m.name, at: attendeeOf(m.id)?.homeTime ?? null }))
      .filter((x): x is { name: string; at: string } => x.at !== null && x.at !== '')
      .map((x) => `${x.name} ${x.at}`),
  );
  // Everything after the cook. Rendered as one string so the whole line is a
  // single truncating block rather than a row of competing flex children.
  const metaSegments = $derived(
    [
      ...(cookNames.length > 0 ? [`${cookNames.join(' & ')} cooking`] : []),
      ...(eatingSegment ? [eatingSegment] : []),
      ...(homeTimes.length > 0 ? [homeTimes.join(', ')] : []),
    ].join(' · '),
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

    <!-- The day's card. The photograph is a clean, undamaged rectangle — no text
         over it, no gradient scrim — with the meal title beneath it in Epilogue
         (the `font-display` family token). A day with no photo is not
         second-class: the card is the same text block with the meal one step
         larger, and no placeholder tile stands in for the missing picture. -->
    <div class="flex min-w-0 flex-1 flex-col gap-2">
      {#if photoUrl}
        <img
          src={photoUrl}
          alt=""
          loading="lazy"
          class="aspect-[3/2] w-full rounded-lg object-cover"
          data-testid={`${testid}-photo`}
        />
      {/if}
      <span
        class="truncate font-display font-semibold leading-snug {photoUrl
          ? 'text-base'
          : 'text-lg'} {mealFirstLine ? 'text-foreground' : 'text-muted-foreground'}"
        data-testid={`${testid}-meal`}
      >
        {mealFirstLine || 'No meal set'}
      </span>

      <!-- One quiet grey line: cook · who is eating (by name) · home times that
           have actually been set. Rendered as a single truncating block so the
           name list gives way gracefully on a narrow screen. "No cook" keeps its
           own colour — it is the one thing in the line that wants answering. -->
      <span class="truncate text-xs text-muted-foreground" data-testid={`${testid}-meta`}>
        {#if !hasCook}<span class="font-medium text-destructive" data-testid={`${testid}-no-cook`}
            >No cook</span
          >{/if}{#if metaSegments}{hasCook ? '' : ' · '}{metaSegments}{/if}
      </span>
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

        <!-- 1b. Shop day (#629): mark this day as the week's shop, AM or PM.
           Rendered only in the dated week editor (onShopSlotChange present); the
           weekday template editor omits the prop and stays shop-free. Tapping the
           active slot clears it — one control, three states. The parent clears any
           other shop day in the week, so there is exactly one. -->
        {#if onShopSlotChange}
          <div class="flex flex-col gap-1.5" data-testid={`${testid}-shop`}>
            <div class="flex items-center gap-2">
              <span class="flex-1 text-xs font-medium text-muted-foreground">Shopping day</span>
              <Button
                variant={shopSlot === 'am' ? 'solid' : 'outline'}
                size="sm"
                onclick={() => pickSlot('am')}
                aria-pressed={shopSlot === 'am'}
                data-testid={`${testid}-shop-am`}
              >
                AM
              </Button>
              <Button
                variant={shopSlot === 'pm' ? 'solid' : 'outline'}
                size="sm"
                onclick={() => pickSlot('pm')}
                aria-pressed={shopSlot === 'pm'}
                data-testid={`${testid}-shop-pm`}
              >
                PM
              </Button>
            </div>
          </div>
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
                      portal={DROPDOWN_PORTAL}
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
                      portal={DROPDOWN_PORTAL}
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
