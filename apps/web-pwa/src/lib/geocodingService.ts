import {
  parseNominatimResponse,
  parseNominatimReverse,
  type GeocodingResult,
} from '@salt/domain/schemas';

// OpenStreetMap Nominatim geocoding (issue #382). KEYLESS and CORS-enabled, so it
// runs as a direct browser fetch — this is an admin-only, one-off "set the family
// home" action (search is button-driven, not per-keystroke), well within
// Nominatim's usage policy. Browsers always send a Referer/Origin, which Nominatim
// accepts as the required identifying header (a custom User-Agent can't be set
// from fetch). Response validation lives in `@salt/domain/schemas`
// (`parseNominatimResponse` / `parseNominatimReverse`); this file only does I/O.
//
// Nominatim resolves free-form addresses AND postcodes (the previous Open-Meteo
// gazetteer only matched place names). It carries no timezone, so we pass the
// browser's resolved IANA zone as the fallback — the family's home is almost
// always in their own zone, and the forecast window's true zone is resolved
// server-side (Open-Meteo `timezone=auto`) and stored on the forecast doc.
const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';

// Number of candidate places to show for a query. A handful is enough for an
// admin to disambiguate without a long list.
const RESULT_COUNT = 8;

export type { GeocodingResult };

// The browser's resolved IANA timezone (e.g. `Europe/London`), used as the
// fallback zone for geocoded results since Nominatim does not return one, and by
// the home-location admin field for the same fallback.
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// Searches Nominatim for an address, postcode, or place name. Returns the
// candidate places, or an empty array for a blank query / no matches. This is a
// UI action (not an adapter boundary), so a network or parse failure throws for
// the caller to surface a friendly error.
export async function searchLocations(query: string): Promise<GeocodingResult[]> {
  const q = query.trim();
  if (!q) return [];

  const url = new URL(NOMINATIM_SEARCH_URL);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '0');
  url.searchParams.set('limit', String(RESULT_COUNT));

  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Geocoding request failed (${res.status}).`);
  }

  // External API response — validated at the trust boundary by the domain parser.
  const results = parseNominatimResponse(await res.json(), browserTimezone());
  if (results === null) {
    throw new Error('Geocoding response was malformed.');
  }
  return results;
}

// Reverse-geocodes coordinates to a human-readable label, used to refresh the
// label after the admin drags the map pin. Best-effort: returns null on a failed
// / malformed lookup (a no-match Nominatim reply) so the caller can keep the
// existing label rather than surfacing an error. Never throws for the no-match
// case; a transport error still rejects for the caller to ignore.
export async function reverseGeocode(latitude: number, longitude: number): Promise<string | null> {
  const url = new URL(NOMINATIM_REVERSE_URL);
  url.searchParams.set('lat', String(latitude));
  url.searchParams.set('lon', String(longitude));
  url.searchParams.set('format', 'jsonv2');

  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  return parseNominatimReverse(await res.json());
}
