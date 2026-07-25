/* eslint-disable */
// Cook-timer push overlay (issue #544). importScripts'd INTO the Workbox-generated
// service worker (see vite.config.ts workbox.importScripts) — a classic worker
// script, not a module. The generated SW still owns precaching + the #141
// auto-update flow (skipWaiting/clientsClaim/deferred reload); this file adds ONLY
// the push + notificationclick listeners, so that contract is untouched.

self.addEventListener('push', function (event) {
  // Payload carries IDS + GENERIC COPY ONLY (no recipe/step free-text) — the
  // server scrubs user content out of the transport (issue #544, Phase 3).
  var payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_e) {
    payload = {};
  }
  var sessionId = payload.sessionId || null;
  var title = payload.title || 'Timer finished';
  var body = payload.body || 'A cook timer just finished.';
  var tag = payload.tag || 'cook-timer';

  event.waitUntil(
    (async function () {
      // Foreground de-dup: if a window client is already focused, the in-app tick
      // (CookModePage) alerts with the chime + fired chip, so suppress the OS
      // notification to avoid a duplicate. Otherwise show it with the OS sound.
      var clientsArr = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      var hasFocused = clientsArr.some(function (c) {
        return c.focused || c.visibilityState === 'visible';
      });
      if (hasFocused) return;

      await self.registration.showNotification(title, {
        body: body,
        tag: tag,
        renotify: true,
        // Non-silent → uses the OS notification sound (issue #544).
        silent: false,
        icon: '/icons/icon-192.png',
        // The badge is the small status-bar mark, and Android renders it from the
        // ALPHA CHANNEL ONLY — the opaque app icon came out as a solid grey blob, so
        // this is a transparent monochrome glyph (generate-icons.ts). It is shared by
        // every environment: this file is copied verbatim out of public/, so it gets
        // no %VITE_*% substitution, which is also why `icon` above stays the master
        // orange rather than the per-env variant.
        badge: '/icons/badge-96.png',
        data: { sessionId: sessionId },
      });
    })(),
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var data = event.notification.data || {};
  var sessionId = data.sessionId || null;
  // sessionId is `${recipeId}_${uid}`; recipe ids are UUIDs (hyphens, no
  // underscore) and uids are alphanumeric, so the recipe id is everything before
  // the final underscore. Hash-routed app → open the cook page.
  var recipeId = sessionId ? sessionId.substring(0, sessionId.lastIndexOf('_')) : null;
  var url = recipeId ? '/#/recipes/' + recipeId + '/cook' : '/';

  event.waitUntil(
    (async function () {
      var clientsArr = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (var i = 0; i < clientsArr.length; i++) {
        var client = clientsArr[i];
        if ('focus' in client) {
          await client.focus();
          if (recipeId && 'navigate' in client) {
            try {
              await client.navigate(url);
            } catch (_e) {
              /* navigate unsupported — focus is enough */
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })(),
  );
});
