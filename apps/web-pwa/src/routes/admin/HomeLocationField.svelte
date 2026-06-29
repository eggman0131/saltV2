<script lang="ts">
  import { Button, TextField } from '@salt/ui-components';
  import type { HomeLocation, GeocodingResult } from '@salt/domain/schemas';
  import { searchLocations } from '../../lib/geocodingService.js';
  import {
    appSettings,
    isLoadingAppSettings,
    setHomeLocation,
    resetHomeLocation,
  } from '../../lib/appSettingsService.js';
  import { addToast } from '../../lib/toastStore.js';

  // Family home location (issue #382). Search a place via Open-Meteo's keyless
  // geocoding and pick a result, or enter coordinates by hand as a fallback.
  // Picking/saving stores { latitude, longitude, timezone, label } on the
  // app-settings doc. No weather is fetched or rendered here.

  // ── Geocoding search ────────────────────────────────────────────────────────
  let query = $state('');
  let searching = $state(false);
  let searchError = $state<string | null>(null);
  let results = $state<GeocodingResult[]>([]);

  async function onSearch(): Promise<void> {
    const q = query.trim();
    if (!q) return;
    searching = true;
    searchError = null;
    results = [];
    try {
      results = await searchLocations(q);
      if (results.length === 0) {
        searchError = 'No matching places — try a different name, or enter coordinates below.';
      }
    } catch {
      searchError = 'Location search failed. Check your connection, or enter coordinates below.';
    } finally {
      searching = false;
    }
  }

  // ── Manual entry fallback ───────────────────────────────────────────────────
  // Coordinates entered by hand. The browser's resolved IANA zone seeds the
  // timezone (the schema needs a non-empty zone); an admin can override it.
  let manualLat = $state('');
  let manualLng = $state('');
  let manualTimezone = $state('');
  let manualLabel = $state('');

  function resolveBrowserTimezone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }

  // ── Shared save plumbing ────────────────────────────────────────────────────
  let saving = $state(false);

  async function save(location: HomeLocation): Promise<void> {
    saving = true;
    const result = await setHomeLocation(location);
    saving = false;
    if (result.kind !== 'ok') {
      addToast('Failed to save the home location.', 'error');
    } else {
      addToast('Home location saved.', 'success');
      // Clear the search UI; the saved-location readout reflects the new value.
      results = [];
      searchError = null;
    }
  }

  async function onPick(r: GeocodingResult): Promise<void> {
    await save(r.location);
  }

  async function onSaveManual(): Promise<void> {
    const lat = Number(manualLat.trim());
    const lng = Number(manualLng.trim());
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      addToast('Latitude must be a number between -90 and 90.', 'error');
      return;
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      addToast('Longitude must be a number between -180 and 180.', 'error');
      return;
    }
    const timezone = manualTimezone.trim() || resolveBrowserTimezone();
    const label = manualLabel.trim() || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    await save({ latitude: lat, longitude: lng, timezone, label });
  }

  async function onReset(): Promise<void> {
    saving = true;
    const result = await resetHomeLocation();
    saving = false;
    if (result.kind !== 'ok') {
      addToast('Failed to clear the home location.', 'error');
    } else {
      addToast('Home location cleared.', 'success');
    }
  }

  const saved = $derived($appSettings?.homeLocation ?? null);
  const busy = $derived($isLoadingAppSettings || saving);
</script>

<div class="rounded-lg border p-4" data-testid="app-settings-home-location">
  <h2 class="text-base font-medium">Home location</h2>
  <p class="mt-0.5 text-sm text-muted-foreground">
    The family's home location. Used to anchor location-dependent features. Search for a place
    below, or enter coordinates by hand.
  </p>

  {#if saved}
    <p class="mt-2 text-sm" data-testid="app-settings-home-location-saved">
      Saved location:
      <code class="rounded bg-muted px-1 py-0.5 text-xs">{saved.label}</code>
      <span class="text-muted-foreground">
        ({saved.latitude.toFixed(4)}, {saved.longitude.toFixed(4)} · {saved.timezone})
      </span>
    </p>
  {:else}
    <p class="mt-2 text-sm text-muted-foreground" data-testid="app-settings-home-location-unset">
      No home location set.
    </p>
  {/if}

  <!-- Search -->
  <div class="mt-3 flex items-end gap-2">
    <div class="flex-1">
      <TextField
        label="Search for a place"
        type="search"
        placeholder="e.g. London"
        bind:value={query}
        disabled={busy || searching}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void onSearch();
          }
        }}
        data-testid="app-settings-home-location-search-input"
      />
    </div>
    <Button
      size="sm"
      onclick={() => void onSearch()}
      disabled={busy || searching || !query.trim()}
      data-testid="app-settings-home-location-search"
    >
      {searching ? 'Searching…' : 'Search'}
    </Button>
  </div>

  {#if searchError}
    <p class="mt-2 text-sm text-red-700" data-testid="app-settings-home-location-search-error">
      {searchError}
    </p>
  {/if}

  {#if results.length > 0}
    <ul class="mt-2 flex flex-col gap-1" data-testid="app-settings-home-location-results">
      {#each results as r (r.id)}
        <li>
          <button
            type="button"
            class="flex w-full items-center justify-between gap-3 rounded-md border p-2 text-left text-sm hover:bg-muted disabled:opacity-50"
            onclick={() => void onPick(r)}
            disabled={busy}
            data-testid="app-settings-home-location-result-{r.id}"
          >
            <span>{r.label}</span>
            <span class="text-xs text-muted-foreground">
              {r.location.latitude.toFixed(2)}, {r.location.longitude.toFixed(2)} · {r.location
                .timezone}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <!-- Manual entry fallback -->
  <details class="mt-3" data-testid="app-settings-home-location-manual">
    <summary class="cursor-pointer text-sm font-medium">Enter coordinates manually</summary>
    <div class="mt-2 flex flex-col gap-2">
      <div class="flex gap-2">
        <div class="flex-1">
          <TextField
            label="Latitude"
            placeholder="51.5085"
            bind:value={manualLat}
            disabled={busy}
            data-testid="app-settings-home-location-manual-lat"
          />
        </div>
        <div class="flex-1">
          <TextField
            label="Longitude"
            placeholder="-0.1257"
            bind:value={manualLng}
            disabled={busy}
            data-testid="app-settings-home-location-manual-lng"
          />
        </div>
      </div>
      <TextField
        label="Timezone (IANA)"
        description="Defaults to this browser's timezone if left blank."
        placeholder="Europe/London"
        bind:value={manualTimezone}
        disabled={busy}
        data-testid="app-settings-home-location-manual-tz"
      />
      <TextField
        label="Label"
        description="A friendly name for this place. Defaults to the coordinates if left blank."
        placeholder="Home"
        bind:value={manualLabel}
        disabled={busy}
        data-testid="app-settings-home-location-manual-label"
      />
      <div>
        <Button
          size="sm"
          onclick={() => void onSaveManual()}
          disabled={busy}
          data-testid="app-settings-home-location-manual-save"
        >
          Save coordinates
        </Button>
      </div>
    </div>
  </details>

  {#if saved}
    <div class="mt-3">
      <Button
        variant="outline"
        size="sm"
        onclick={() => void onReset()}
        disabled={busy}
        data-testid="app-settings-home-location-reset"
      >
        Clear home location
      </Button>
    </div>
  {/if}
</div>
