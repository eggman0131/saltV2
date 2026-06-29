import { parseGeocodingResponse, type GeocodingResult } from '@salt/domain/schemas';

// Open-Meteo geocoding (issue #382). KEYLESS and CORS-enabled, so it runs as a
// direct browser fetch — this is an admin-only, one-off search action. Note:
// only the geocoding search is allowed from the browser; the shared forecast
// fetch (a later phase) must NOT call Open-Meteo from the browser.
//
// The geocoding host is `geocoding-api.open-meteo.com` (the forecast host is
// `api.open-meteo.com` — a different host). Response validation lives in
// `@salt/domain/schemas` (`parseGeocodingResponse`); this file only does I/O.
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';

// Number of candidate places to show for a query. A handful is enough for an
// admin to disambiguate (e.g. the several "London"s) without a long list.
const RESULT_COUNT = 8;

export type { GeocodingResult };

// Searches Open-Meteo geocoding for a place name. Returns the candidate places,
// or an empty array for a blank query / no matches. This is a UI action (not an
// adapter boundary), so a network or parse failure throws for the caller to
// surface a friendly error.
export async function searchLocations(query: string): Promise<GeocodingResult[]> {
  const name = query.trim();
  if (!name) return [];

  const url = new URL(GEOCODING_URL);
  url.searchParams.set('name', name);
  url.searchParams.set('count', String(RESULT_COUNT));
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Geocoding request failed (${res.status}).`);
  }

  // External API response — validated at the trust boundary by the domain parser.
  const results = parseGeocodingResponse(await res.json());
  if (results === null) {
    throw new Error('Geocoding response was malformed.');
  }
  return results;
}
