import https from 'node:https';
import { lookup as dnsLookupCb } from 'node:dns';
import type { LookupAddress, LookupAllOptions, LookupOneOptions, LookupOptions } from 'node:dns';
import { isHttpsScheme, parseImportUrl, isPublicIp } from '@salt/domain';
import { startSpan, type ObservabilitySpan } from '@salt/observability/server';

// SSRF-guarded HTTP(S) fetch for the URL-import flow. Lives in cloud-functions
// (Node-only) — the *pure* classification policy (https-only, IP ranges) lives
// in @salt/domain; this module performs the live DNS resolution + connection
// enforcement and the byte/time/redirect caps.
//
// Defence in depth against SSRF / DNS-rebinding:
//   1. https-only scheme check (domain helper).
//   2. A custom `lookup` passed to https.request runs at connect time and
//      re-classifies every resolved address — so the IP we actually connect to
//      is the one that was validated (closing the TOCTOU/DNS-rebinding window
//      where a hostname resolves public on a pre-check then private at connect).
//   3. Manual redirect handling: each hop is re-parsed, re-scheme-checked, and
//      re-resolved through the same guarded lookup. A redirect to an internal
//      host is refused.
//   4. Response size cap (abort once exceeded) and a wall-clock timeout.
//   5. Only text/html is accepted.

export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // ~2 MB
export const FETCH_TIMEOUT_MS = 12_000; // wall-clock cap for the whole fetch
export const MAX_REDIRECTS = 5;
const USER_AGENT = 'SaltRecipeImporter/1.0 (+https://salt.app; recipe import bot)';

// Why a fetch failed. 'blocked' is an SSRF refusal (caller maps to blocked-url,
// no internal detail leaked); everything else is a reach/transport failure.
export type SsrfFetchErrorReason =
  | 'blocked' // non-https, private/internal host, or redirect to internal
  | 'dns' // host did not resolve
  | 'timeout'
  | 'connection' // socket / TLS error
  | 'http-status' // non-2xx
  | 'too-large'
  | 'wrong-content-type';

export class SsrfFetchError extends Error {
  constructor(
    readonly reason: SsrfFetchErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'SsrfFetchError';
  }
}

export interface SsrfFetchResult {
  readonly html: string;
  readonly finalUrl: string;
}

// A DNS lookup that rejects when *any* resolved address is non-public. Used as
// the `lookup` option on https.request so enforcement happens at connect time.
function guardedLookup(
  hostname: string,
  options: LookupOneOptions | LookupAllOptions | LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
): void {
  // Force `all` so we can inspect every candidate address; we pick the first
  // public one. If any address is non-public we refuse the whole connection.
  dnsLookupCb(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) {
      callback(err, '', undefined);
      return;
    }
    if (!addresses || addresses.length === 0) {
      callback(new Error('no addresses'), '', undefined);
      return;
    }
    for (const a of addresses) {
      if (!isPublicIp(a.address)) {
        const blocked: NodeJS.ErrnoException = Object.assign(
          new Error('SSRF: resolved address is not public'),
          { code: 'SSRF_BLOCKED' },
        );
        callback(blocked, '', undefined);
        return;
      }
    }
    const first = addresses[0]!;
    // Honour the caller's requested shape: `all:true` wants the array.
    if ((options as LookupAllOptions).all) {
      callback(null, addresses, undefined);
    } else {
      callback(null, first.address, first.family);
    }
  });
}

// Validate a single URL string for the SSRF guard (scheme + obvious IP-literal
// hosts). DNS-based host validation happens in guardedLookup at connect time.
function assertUrlAllowed(raw: string): URL {
  const parsed = parseImportUrl(raw);
  if (parsed === null) throw new SsrfFetchError('blocked', 'unparseable url');
  if (!isHttpsScheme(parsed.protocol)) {
    throw new SsrfFetchError('blocked', 'non-https scheme');
  }
  return new URL(parsed.href);
}

function fetchOnce(url: URL, signalAbort: AbortSignal): Promise<SingleFetch> {
  return new Promise<SingleFetch>((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        lookup: guardedLookup,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: signalAbort,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers['location'];

        // Redirect — drain and report the next hop to the caller.
        if (status >= 300 && status < 400 && typeof location === 'string') {
          res.resume(); // discard body
          resolve({ kind: 'redirect', location });
          return;
        }

        if (status < 200 || status >= 300) {
          res.resume();
          reject(new SsrfFetchError('http-status', `status ${status}`));
          return;
        }

        const contentType = String(res.headers['content-type'] ?? '');
        if (!contentType.toLowerCase().includes('text/html')) {
          res.resume();
          reject(new SsrfFetchError('wrong-content-type', `content-type ${contentType}`));
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_RESPONSE_BYTES) {
            res.destroy();
            reject(new SsrfFetchError('too-large', 'response exceeded size cap'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({ kind: 'body', html: Buffer.concat(chunks).toString('utf8') });
        });
        res.on('error', (err) => reject(mapSocketError(err)));
      },
    );

    req.on('error', (err) => reject(mapSocketError(err)));
    req.end();
  });
}

type SingleFetch = { kind: 'body'; html: string } | { kind: 'redirect'; location: string };

function mapSocketError(err: unknown): SsrfFetchError {
  if (err instanceof SsrfFetchError) return err;
  const e = err as NodeJS.ErrnoException;
  if (e.code === 'SSRF_BLOCKED') return new SsrfFetchError('blocked', 'blocked address');
  const dnsFailed =
    e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN' || /no addresses/.test(e.message ?? '');
  if (dnsFailed) return new SsrfFetchError('dns', 'dns lookup failed');
  if (e.name === 'AbortError' || e.code === 'ABORT_ERR') {
    return new SsrfFetchError('timeout', 'fetch timed out');
  }
  return new SsrfFetchError('connection', e.message ?? 'connection error');
}

// Fetch a recipe page through the SSRF guard. Follows up to MAX_REDIRECTS
// redirects, re-validating each hop. Returns the raw HTML and the final URL.
//
// Wrapped in a `Fetch recipe page` child span. The recipe-import flow body runs
// inside the Genkit flow span (it is the active OTel context), so a plain
// startSpan nests this under the flow trace; an explicit parent can still be
// threaded for robustness/parity. The span is best-effort and never throws
// (CLAUDE.md Rule 10): it is .end()-ed in a finally and its only attributes are
// bounded scalars (final host, response byte size).
export async function ssrfGuardedFetch(
  rawUrl: string,
  parentSpan?: ObservabilitySpan,
): Promise<SsrfFetchResult> {
  const span = startSpan('Fetch recipe page', parentSpan ? { parent: parentSpan } : {});
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let current = assertUrlAllowed(rawUrl);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const result = await fetchOnce(current, controller.signal);
      if (result.kind === 'body') {
        span.setAttribute('http.host', current.host);
        span.setAttribute('http.response_size', Buffer.byteLength(result.html, 'utf8'));
        return { html: result.html, finalUrl: current.href };
      }
      // Resolve the redirect target against the current URL, then re-validate.
      const next = new URL(result.location, current);
      current = assertUrlAllowed(next.href);
    }
    throw new SsrfFetchError('connection', 'too many redirects');
  } finally {
    clearTimeout(timer);
    span.end();
  }
}
