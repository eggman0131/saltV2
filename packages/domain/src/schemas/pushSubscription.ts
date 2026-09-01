import { z } from 'zod';

// Web-push subscription for cook-timer notifications (issue #544). A raw browser
// PushSubscription (endpoint + p256dh/auth keys) that the `web-push` library
// POSTs to. Per-DEVICE, owner-scoped: id is composed by `pushSubscriptionId`
// (pushSubscription/pushSubscriptionId.ts) as `${uid}_${deviceHash}` (one user
// has many devices) — the THIRD owner-scoped collection, a deliberate exception
// to the family-shared rule (see CLAUDE.md / docs/salt-architecture.md).
//
// Additive on read: old docs never existed (greenfield collection), and the
// optional expirationTime keeps it forward-compatible.
export const PushSubscriptionSchema = z.object({
  id: z.string(), // composed by `pushSubscriptionId` — `${uid}_${deviceHash}`
  schemaVersion: z.literal(1),
  ownerUid: z.string(),
  endpoint: z.string(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
  // The browser may supply an expiry (usually null). Optional so absent is valid.
  expirationTime: z.number().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PushSubscriptionDoc = z.infer<typeof PushSubscriptionSchema>;
