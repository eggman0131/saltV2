/* eslint-disable */
// Push overlay (issues #544, #629). importScripts'd INTO the Workbox-generated
// service worker (see vite.config.ts workbox.importScripts) — a classic worker
// script, not a module. The generated SW still owns precaching + the #141
// auto-update flow (skipWaiting/clientsClaim/deferred reload); this file adds ONLY
// the push + notificationclick listeners, so that contract is untouched.
//
// Two notification kinds ride this one path, distinguished by `payload.type`:
//   - 'cook-timer'        (#544) — deep-links via `sessionId`, has an in-app equivalent
//   - 'shopping-reminder' (#629) — deep-links via `url`, has none
// Everything that differs between them is payload-driven; nothing here is
// hard-coded per feature except the cook-timer foreground rule below.

self.addEventListener('push', function (event) {
  // Copy is entirely server-chosen, and for a cook timer it IS user content: the
  // timer's label and the recipe's title ("Simmer the sauce" / "Shepherd's pie"),
  // which #544 deliberately withheld and #680 deliberately restored. Nothing here
  // inspects or reformats it — render what you are given, fall back if it is absent.
  var payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_e) {
    payload = {};
  }
  var type = payload.type || 'cook-timer';
  var sessionId = payload.sessionId || null;
  var url = payload.url || null;
  var title = payload.title || 'Timer finished';
  var body = payload.body || 'A cook timer just finished.';
  var tag = payload.tag || 'cook-timer';
  // Payload-driven (#629): a cook timer re-buzzes on every delivery, but a
  // duplicate shopping nudge must REPLACE the first silently — which, together
  // with the date-keyed tag, is what lets the reminder skip an exactly-once
  // ledger entirely. Default true so the cook-timer path is unchanged.
  var renotify = payload.renotify !== false;

  event.waitUntil(
    (async function () {
      // Foreground de-dup, COOK TIMERS ONLY: if a window client is already
      // focused, the in-app tick (CookModePage) alerts with the chime + fired
      // chip, so the OS notification would be a duplicate. A shopping reminder
      // has NO in-app equivalent, so suppressing it with the app open would make
      // it vanish silently — gate the suppression on the type, not on focus alone.
      if (type === 'cook-timer') {
        var clientsArr = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });
        var hasFocused = clientsArr.some(function (c) {
          return c.focused || c.visibilityState === 'visible';
        });
        if (hasFocused) return;
      }

      await self.registration.showNotification(title, {
        body: body,
        tag: tag,
        renotify: renotify,
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
        data: { sessionId: sessionId, url: url },
      });
    })(),
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var data = event.notification.data || {};
  var sessionId = data.sessionId || null;
  // Two routing sources, in precedence order:
  //   1. `data.url` — an explicit deep link the server chose (#629's shopping
  //      reminder opens the DEFAULT list, whose id only the server knows).
  //   2. `sessionId` — the cook-timer path, unchanged. sessionId is
  //      `${recipeId}_${uid}`; recipe ids are UUIDs (hyphens, no underscore) and
  //      uids are alphanumeric, so the recipe id is everything before the final
  //      underscore.
  // Hash-routed app, so both are '/#/…' paths. Falling back to '/' opens the app.
  var recipeId = sessionId ? sessionId.substring(0, sessionId.lastIndexOf('_')) : null;
  var url = data.url || (recipeId ? '/#/recipes/' + recipeId + '/cook' : null);

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
          if (url && 'navigate' in client) {
            try {
              await client.navigate(url);
            } catch (_e) {
              /* navigate unsupported — focus is enough */
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url || '/');
    })(),
  );
});
