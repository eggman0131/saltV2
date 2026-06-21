import { describe, it, expect } from 'vitest';
import {
  parseImportUrl,
  isHttpsScheme,
  hostnameAsIpLiteral,
  classifyIp,
  isPublicIp,
  isIpv4,
  isIpv6,
} from '@salt/domain';

describe('parseImportUrl', () => {
  it('parses a valid https url', () => {
    const p = parseImportUrl('https://example.com/recipes/cake');
    expect(p).not.toBeNull();
    expect(p!.protocol).toBe('https:');
    expect(p!.hostname).toBe('example.com');
  });

  it('strips IPv6 brackets from hostname', () => {
    const p = parseImportUrl('https://[::1]/x');
    expect(p!.hostname).toBe('::1');
  });

  it('returns null for garbage / relative / empty', () => {
    expect(parseImportUrl('not a url')).toBeNull();
    expect(parseImportUrl('/relative/path')).toBeNull();
    expect(parseImportUrl('   ')).toBeNull();
  });
});

describe('isHttpsScheme', () => {
  it('accepts only https', () => {
    expect(isHttpsScheme('https:')).toBe(true);
    expect(isHttpsScheme('http:')).toBe(false);
    expect(isHttpsScheme('ftp:')).toBe(false);
    expect(isHttpsScheme('file:')).toBe(false);
    expect(isHttpsScheme('data:')).toBe(false);
  });
});

describe('hostnameAsIpLiteral', () => {
  it('recognises IPv4 / IPv6 literals, rejects names', () => {
    expect(hostnameAsIpLiteral('10.0.0.1')).toBe('10.0.0.1');
    expect(hostnameAsIpLiteral('::1')).toBe('::1');
    expect(hostnameAsIpLiteral('example.com')).toBeNull();
  });
  it('drops an IPv6 zone id', () => {
    expect(hostnameAsIpLiteral('fe80::1%eth0')).toBe('fe80::1');
  });
});

describe('IPv4 classification', () => {
  it('flags loopback, private, link-local, unspecified', () => {
    expect(classifyIp('127.0.0.1')).toBe('loopback');
    expect(classifyIp('10.1.2.3')).toBe('private');
    expect(classifyIp('172.16.0.1')).toBe('private');
    expect(classifyIp('172.31.255.255')).toBe('private');
    expect(classifyIp('192.168.1.1')).toBe('private');
    expect(classifyIp('169.254.169.254')).toBe('link-local'); // cloud metadata
    expect(classifyIp('100.64.0.1')).toBe('private'); // CGNAT
    expect(classifyIp('0.0.0.0')).toBe('unspecified');
  });

  it('does NOT flag 172.15/172.32 (outside the /12)', () => {
    expect(classifyIp('172.15.0.1')).toBe('public');
    expect(classifyIp('172.32.0.1')).toBe('public');
  });

  it('treats public addresses as public', () => {
    expect(isPublicIp('8.8.8.8')).toBe(true);
    expect(isPublicIp('1.1.1.1')).toBe(true);
    expect(isPublicIp('93.184.216.34')).toBe(true);
  });

  it('flags multicast/reserved/doc ranges', () => {
    expect(classifyIp('224.0.0.1')).toBe('special');
    expect(classifyIp('240.0.0.1')).toBe('special');
    expect(classifyIp('192.0.2.5')).toBe('special'); // TEST-NET-1
    expect(classifyIp('203.0.113.5')).toBe('special'); // TEST-NET-3
    expect(isPublicIp('169.254.169.254')).toBe(false);
  });

  it('rejects malformed IPv4', () => {
    expect(isIpv4('999.1.1.1')).toBe(false);
    expect(isIpv4('1.2.3')).toBe(false);
    expect(isIpv4('1.2.3.4.5')).toBe(false);
    expect(isIpv4('a.b.c.d')).toBe(false);
  });
});

describe('IPv6 classification', () => {
  it('flags loopback / unspecified / link-local / ULA', () => {
    expect(classifyIp('::1')).toBe('loopback');
    expect(classifyIp('::')).toBe('unspecified');
    expect(classifyIp('fe80::1')).toBe('link-local');
    expect(classifyIp('fc00::1')).toBe('private');
    expect(classifyIp('fd12:3456::1')).toBe('private');
    expect(classifyIp('ff02::1')).toBe('special'); // multicast
  });

  it('classifies IPv4-mapped IPv6 by the embedded v4', () => {
    expect(classifyIp('::ffff:127.0.0.1')).toBe('loopback');
    expect(classifyIp('::ffff:10.0.0.1')).toBe('private');
    expect(classifyIp('::ffff:169.254.169.254')).toBe('link-local');
    expect(classifyIp('::ffff:8.8.8.8')).toBe('public');
    // hex form of the mapped address
    expect(classifyIp('::ffff:7f00:1')).toBe('loopback');
  });

  it('treats global unicast as public', () => {
    expect(isPublicIp('2606:4700:4700::1111')).toBe(true);
    expect(classifyIp('2001:db8::1')).toBe('special'); // documentation
  });

  it('validates IPv6 syntax', () => {
    expect(isIpv6('::1')).toBe(true);
    expect(isIpv6('2001:db8::1')).toBe(true);
    expect(isIpv6('not:ipv6:::')).toBe(false);
    expect(isIpv6('gggg::1')).toBe(false);
    expect(isIpv6('1.2.3.4')).toBe(false);
  });

  it('treats unparseable input as special (blocked)', () => {
    expect(classifyIp('not-an-ip')).toBe('special');
    expect(isPublicIp('garbage')).toBe(false);
  });
});
