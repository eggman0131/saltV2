// VIOLATION: web-pwa must not import the /server subpath of @salt/ld-observability —
// it wraps the LaunchDarkly Node SDK and is for cloud-functions only. Web-pwa
// uses the default @salt/ld-observability subpath (browser SDK).
// Expected: no-restricted-imports error.
// @ts-nocheck — referenced symbols are intentionally not part of the browser
// public surface; the lint rule is what enforces the boundary at runtime.
import { createServerLDMatchLoggingAdapter } from '@salt/ld-observability/server';
console.log(createServerLDMatchLoggingAdapter);
