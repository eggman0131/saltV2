// Pure URL/host-classification helpers for the SSRF-hardened URL import
// (issue: recipe URL import). These are *pure* — no fetch, no DNS, no Node
// built-ins, no I/O. The live DNS resolution + connection enforcement lives in
// cloud-functions (which calls classifyIp on every resolved address and on the
// IP actually connected to). Keeping the classification rules here means the
// "is this address public?" policy is one auditable, unit-testable place that
// both the resolved-address check and the connected-IP re-check share.

// ─── URL parsing & scheme ────────────────────────────────────────────────────

export interface ParsedImportUrl {
  readonly href: string;
  readonly protocol: string; // e.g. "https:"
  readonly hostname: string; // bare host (no brackets for IPv6)
}

// Parse a user-supplied web address into the fields the SSRF guard needs.
// Pure: no WHATWG `URL` constructor (unavailable in the domain's lib and would
// be a browser/Node API), no I/O. A regex covers the absolute-URL shape the
// guard cares about — scheme + authority host. The live fetch in cloud-functions
// re-parses with the real `URL` and resolves DNS; this is the pre-flight check
// (reject garbage / non-https / IP-literal internal hosts before any network).
// Returns null when `raw` is not an absolute URL with a host.
const ABSOLUTE_URL_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*:)\/\/([^/?#]*)([/?#].*)?$/;

export function parseImportUrl(raw: string): ParsedImportUrl | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const m = ABSOLUTE_URL_RE.exec(trimmed);
  if (m === null) return null;

  const protocol = m[1]!.toLowerCase();
  let authority = m[2]!;
  if (authority === '') return null;

  // Strip userinfo ("user:pass@host").
  const at = authority.lastIndexOf('@');
  if (at >= 0) authority = authority.slice(at + 1);

  let hostname: string;
  if (authority.startsWith('[')) {
    // IPv6 literal: "[::1]:443" → "::1".
    const close = authority.indexOf(']');
    if (close < 0) return null;
    hostname = authority.slice(1, close);
  } else {
    // Strip an optional ":port".
    const colon = authority.indexOf(':');
    hostname = colon >= 0 ? authority.slice(0, colon) : authority;
  }
  if (hostname === '') return null;

  return { href: trimmed, protocol, hostname };
}

// https-only. http, ftp, file, data, etc. are all rejected — the SSRF guard
// only permits encrypted public web fetches.
export function isHttpsScheme(protocol: string): boolean {
  return protocol === 'https:';
}

// A hostname that is itself an IP literal can skip DNS resolution but must still
// be classified directly (an attacker can put a private IP straight in the URL).
// Returns the normalised IP string when the hostname is an IP literal, else null.
export function hostnameAsIpLiteral(hostname: string): string | null {
  if (isIpv4(hostname)) return hostname;
  // IPv6 literals may arrive with a zone id ("fe80::1%eth0"); drop it.
  const noZone = hostname.split('%')[0] ?? hostname;
  if (isIpv6(noZone)) return noZone;
  return null;
}

// ─── IP classification ───────────────────────────────────────────────────────

export type IpClass = 'public' | 'loopback' | 'private' | 'link-local' | 'unspecified' | 'special'; // multicast, reserved, documentation, etc.

// A non-public class means: refuse the fetch. The CF guard treats every value
// other than 'public' as blocked.
export function isPublicIp(ip: string): boolean {
  return classifyIp(ip) === 'public';
}

// Classify an IP address string (IPv4 or IPv6, including IPv4-mapped IPv6).
// Throws nothing — an unparseable string is treated as 'special' (blocked),
// which is the safe default for an SSRF guard.
export function classifyIp(ip: string): IpClass {
  const trimmed = ip.trim();
  const noZone = trimmed.split('%')[0] ?? trimmed;

  if (isIpv4(noZone)) return classifyIpv4(noZone);
  if (isIpv6(noZone)) return classifyIpv6(noZone);
  return 'special';
}

// ─── IPv4 ────────────────────────────────────────────────────────────────────

export function isIpv4(s: string): boolean {
  return parseIpv4Octets(s) !== null;
}

function parseIpv4Octets(s: string): [number, number, number, number] | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    // Reject empty / non-numeric / out-of-range; allow 1–3 digits.
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    octets.push(n);
  }
  return [octets[0]!, octets[1]!, octets[2]!, octets[3]!];
}

function classifyIpv4(s: string): IpClass {
  const octets = parseIpv4Octets(s);
  if (octets === null) return 'special';
  const [a, b, c] = octets;

  // 0.0.0.0/8 — "this network" / unspecified.
  if (a === 0) return 'unspecified';
  // 127.0.0.0/8 — loopback.
  if (a === 127) return 'loopback';
  // 10.0.0.0/8 — private.
  if (a === 10) return 'private';
  // 172.16.0.0/12 — private.
  if (a === 172 && b! >= 16 && b! <= 31) return 'private';
  // 192.168.0.0/16 — private.
  if (a === 192 && b === 168) return 'private';
  // 169.254.0.0/16 — link-local (incl. cloud metadata 169.254.169.254).
  if (a === 169 && b === 254) return 'link-local';
  // 100.64.0.0/10 — carrier-grade NAT (shared address space); treat as private.
  if (a === 100 && b! >= 64 && b! <= 127) return 'private';
  // IETF protocol assignments / TEST-NET documentation ranges.
  if (a === 192 && b === 0 && c === 0) return 'special';
  if (a === 192 && b === 0 && c === 2) return 'special';
  if (a === 198 && (b === 18 || b === 19)) return 'special';
  if (a === 198 && b === 51 && c === 100) return 'special';
  if (a === 203 && b === 0 && c === 113) return 'special';
  // 224.0.0.0/4 multicast; 240.0.0.0/4 reserved; 255.255.255.255 broadcast.
  if (a! >= 224) return 'special';

  return 'public';
}

// ─── IPv6 ────────────────────────────────────────────────────────────────────

export function isIpv6(s: string): boolean {
  return expandIpv6(s) !== null;
}

// Expand an IPv6 address to its 8 hextets (numbers 0–65535). Handles "::"
// compression and embedded IPv4 ("::ffff:1.2.3.4", "::1.2.3.4"). Returns null
// when not a valid IPv6 string.
function expandIpv6(s: string): number[] | null {
  if (!s.includes(':')) return null;

  // Split off an embedded IPv4 tail if present (last segment contains a dot).
  let head = s;
  let embeddedV4: [number, number, number, number] | null = null;
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4Octets(tail);
    if (v4 === null) return null;
    embeddedV4 = v4;
    head = s.slice(0, lastColon + 1); // keep the trailing colon for splitting
  }

  const doubleColonCount = (head.match(/::/g) ?? []).length;
  if (doubleColonCount > 1) return null;

  let groups: string[];
  if (doubleColonCount === 1) {
    const [left, right] = head.split('::');
    const leftParts = left === '' ? [] : left!.split(':').filter((p) => p !== '');
    const rightParts = right === '' ? [] : right!.split(':').filter((p) => p !== '');
    const v4Hextets = embeddedV4 ? 2 : 0;
    const missing = 8 - (leftParts.length + rightParts.length + v4Hextets);
    if (missing < 0) return null;
    groups = [...leftParts, ...Array<string>(missing).fill('0'), ...rightParts];
  } else {
    // No compression: strip a trailing colon left from the embedded-v4 split.
    const cleaned = head.endsWith(':') ? head.slice(0, -1) : head;
    groups = cleaned.split(':').filter((p) => p !== '');
  }

  const hextets: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    hextets.push(parseInt(g, 16));
  }
  if (embeddedV4) {
    hextets.push((embeddedV4[0] << 8) | embeddedV4[1]);
    hextets.push((embeddedV4[2] << 8) | embeddedV4[3]);
  }
  if (hextets.length !== 8) return null;
  return hextets;
}

function classifyIpv6(s: string): IpClass {
  const h = expandIpv6(s);
  if (h === null) return 'special';

  // Unspecified ::.
  if (h.every((x) => x === 0)) return 'unspecified';
  // Loopback ::1.
  if (
    h[0] === 0 &&
    h[1] === 0 &&
    h[2] === 0 &&
    h[3] === 0 &&
    h[4] === 0 &&
    h[5] === 0 &&
    h[6] === 0 &&
    h[7] === 1
  ) {
    return 'loopback';
  }

  // IPv4-mapped ::ffff:a.b.c.d (h[5] === 0xffff, first five hextets zero) —
  // classify by the embedded IPv4 so a mapped private/loopback address is caught.
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
    return classifyIpv4(hextetsToIpv4(h[6]!, h[7]!));
  }
  // IPv4-compatible ::a.b.c.d (deprecated) — first six hextets zero, non-zero tail.
  if (
    h[0] === 0 &&
    h[1] === 0 &&
    h[2] === 0 &&
    h[3] === 0 &&
    h[4] === 0 &&
    h[5] === 0 &&
    (h[6] !== 0 || h[7] !== 0)
  ) {
    return classifyIpv4(hextetsToIpv4(h[6]!, h[7]!));
  }

  const first = h[0]!;
  // fe80::/10 — link-local.
  if ((first & 0xffc0) === 0xfe80) return 'link-local';
  // fc00::/7 — unique local addresses (private).
  if ((first & 0xfe00) === 0xfc00) return 'private';
  // ff00::/8 — multicast.
  if ((first & 0xff00) === 0xff00) return 'special';
  // 2001:db8::/32 — documentation.
  if (first === 0x2001 && h[1] === 0x0db8) return 'special';
  // 2001:0000::/32 — Teredo; 2002::/16 — 6to4 (can tunnel to internal v4).
  if (first === 0x2001 && h[1] === 0) return 'special';
  if (first === 0x2002) return 'special';

  return 'public';
}

function hextetsToIpv4(hi: number, lo: number): string {
  const a = (hi >> 8) & 0xff;
  const b = hi & 0xff;
  const c = (lo >> 8) & 0xff;
  const d = lo & 0xff;
  return `${a}.${b}.${c}.${d}`;
}
