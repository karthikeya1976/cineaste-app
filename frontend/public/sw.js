// Gatekept Web Push service worker — issue #24 / U5 (frontend half).
//
// SCOPE: this is a NEW file. `frontend/public/` had no service worker of
// any kind before this (confirmed by directory listing at implementation
// time) — nothing else registers one, so there is no existing worker to
// extend, and this one owns the whole scope ("/") without conflict.
//
// This worker does exactly one thing: show a browser notification when a
// Web Push message arrives, using the payload shape webPush.ts (gatekept
// backend) sends — see WebPushPayload there: { title, body?, data? }.
// Clicking the notification focuses/opens the app; it does not attempt any
// deep-linking beyond that (kept intentionally minimal per the issue's own
// "no new UI surface beyond what's minimally needed" scope note).

self.addEventListener("push", (event) => {
  let payload = { title: "Gatekept", body: "You have a new notification." };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      // Non-JSON push payload (shouldn't happen given our own backend
      // always sends JSON.stringify'd data) — fall back to the generic
      // notice above rather than throwing inside the push handler, which
      // would silently drop the notification entirely.
      const text = event.data.text();
      if (text) payload.body = text;
    }
  }

  const title = payload.title || "Gatekept";
  const options = {
    body: payload.body,
    data: payload.data || {},
    // Browser default icon/badge are used when omitted — no custom asset
    // is in scope for this issue.
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Clicking the notification focuses an already-open Gatekept tab if one
// exists, otherwise opens a new one — standard notification-click pattern,
// no deep-linking into a specific conversation/request (out of scope here;
// the payload's `data` field already carries enough for a future unit to
// add that without changing this worker's shape).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});
