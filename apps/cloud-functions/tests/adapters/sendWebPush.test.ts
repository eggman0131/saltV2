import { describe, it, expect } from 'vitest';
import { isApplePushEndpoint } from '../../src/adapters/sendWebPush.js';

// The endpoint host is the ONLY per-device platform signal in the system (issue
// #680): subscriptions carry no platform field, and Pushover identifies devices
// by name with no platform either. onCookTimerDispatch routes on this, so a wrong
// answer here silently sends a device down the wrong channel — or no channel.

describe('isApplePushEndpoint', () => {
  it('recognises the Apple web-push service', () => {
    expect(isApplePushEndpoint('https://web.push.apple.com/QBCdEf123')).toBe(true);
  });

  it('recognises a subdomain of the Apple push service', () => {
    // Apple has not published a guarantee that the host stays exactly
    // `web.push.apple.com`, and a regional/sharded sibling reaching APNs is still
    // an Apple device. Matching the suffix costs nothing and fails safe.
    expect(isApplePushEndpoint('https://eu-1.push.apple.com/QBCdEf123')).toBe(true);
  });

  it('does not recognise Chrome/FCM', () => {
    expect(isApplePushEndpoint('https://fcm.googleapis.com/fcm/send/abc123')).toBe(false);
  });

  it('does not recognise Firefox', () => {
    expect(isApplePushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(
      false,
    );
  });

  it('is not fooled by an Apple host appearing elsewhere in the URL', () => {
    // A substring match would route an attacker-shaped (or merely odd) endpoint
    // down the always-send branch.
    expect(isApplePushEndpoint('https://evil.example/web.push.apple.com/abc')).toBe(false);
    expect(isApplePushEndpoint('https://web.push.apple.com.evil.example/abc')).toBe(false);
  });

  it('treats an unparseable endpoint as non-Apple', () => {
    // Non-Apple is the FALLBACK-eligible branch, so a malformed URL still gets a
    // push whenever Pushover did not deliver. Failing the other way would let a
    // bad string silence a device that has no other channel.
    expect(isApplePushEndpoint('not-a-url')).toBe(false);
    expect(isApplePushEndpoint('')).toBe(false);
  });
});
