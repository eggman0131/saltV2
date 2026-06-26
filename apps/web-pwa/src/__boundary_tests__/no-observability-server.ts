// VIOLATION: web-pwa must not import the /server subpath of @salt/observability —
// it wraps posthog-node + Node OTel and is for cloud-functions only. Web-pwa
// uses the default @salt/observability subpath (browser posthog-js SDK).
// Expected: no-restricted-imports error.
// @ts-nocheck — referenced symbols are intentionally not part of the browser
// public surface; the lint rule is what enforces the boundary at runtime.
import { createServerObservabilityMatchLoggingAdapter } from '@salt/observability/server';
console.log(createServerObservabilityMatchLoggingAdapter);
