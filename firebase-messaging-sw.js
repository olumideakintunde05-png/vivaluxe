/* ===========================================================
   Viva Luxe — Firebase Cloud Messaging service worker
   ===========================================================
   Handles PUSH notifications for the ADMIN/SELLER only, while the
   admin panel tab is in the background or the browser is closed
   (but the browser process is still running, per how web push works
   on the target platforms — see limitations in the writeup).

   MUST be deployed at the SITE ROOT, e.g.:
     https://vivaluxe.example.com/firebase-messaging-sw.js
   (same folder as your index.html / admin.html). A service worker's
   default scope is the folder it's served from, and the FCM SDK
   looks for it at "/firebase-messaging-sw.js" by default — putting
   it anywhere else (like /js/) will break registration unless you
   pass a custom scope, which adds needless complexity.

   This file is loaded directly by the browser as a raw <script>,
   NOT through your bundler/module system, so it uses the Firebase
   COMPAT + importScripts pattern (same SDK style as the rest of the
   project) rather than ES module imports.
   =========================================================== */

/* Match this version to whatever firebase-app/firebase-*.js version
   you're already loading in index.html / admin.html. Do not mix
   versions between the page and the service worker. */
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

/* ---------------------------------------------------------------
   Same Firebase config object already sitting in your index.html /
   admin.html <script> tag (apiKey, authDomain, projectId, etc.).
   This is PUBLIC client config, not a secret — Firebase's own
   security rules (not this object) are what protect your data, so
   it's safe to duplicate it here. Copy it in verbatim.
   --------------------------------------------------------------- */
firebase.initializeApp({
  apiKey: 'AIzaSyDn-AIlKa2OvOBSBkr5Zdst-bxDZoOUubE',
  authDomain: 'viva-perf.firebaseapp.com',
  projectId: 'viva-perf',
  storageBucket: 'viva-perf.firebasestorage.app',
  messagingSenderId: '764281350514',
  appId: '1:764281350514:web:6e1c6c1ebe92ff74ca55eb'
});

const messaging = firebase.messaging();

/* ---------------------------------------------------------------
   We send DATA-ONLY messages from the Cloud Function (no top-level
   "notification" field — see functions/index.js). That's deliberate:
   FCM auto-displays "notification" payloads itself with NO click
   handler you control, which fails requirement #10 ("clicking opens
   the admin dashboard"). Data-only messages give us full control
   over both what's shown and what happens on tap, in exchange for
   having to call showNotification() ourselves here.
   --------------------------------------------------------------- */
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};

  const title = data.title || '🔔 New Order';
  const body = data.body || 'Viva Luxe has a new order';
  const orderUrl = data.url || '/admin.html';
  const orderId = data.orderId || '';

  const notificationOptions = {
    body,
    // Adjust to wherever your actual logo/notification icon lives.
    tag: orderId ? `viva-luxe-order-${orderId}` : 'viva-luxe-order',
    // Prevents Chrome/Android from silently collapsing rapid
    // back-to-back order notifications into one.
    renotify: true,
    data: { url: orderUrl, orderId }
  };

  return self.registration.showNotification(title, notificationOptions);
});

/* Tapping the notification: focus an already-open admin tab if one
   exists, otherwise open a new one — either way, land on the admin
   dashboard/orders page. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/admin.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        // If an admin tab is already open (regardless of exact hash/query),
        // focus it and tell the page to jump to the Orders tab instead of
        // stacking up duplicate admin tabs.
        if (client.url.indexOf('/admin.html') !== -1 && 'focus' in client) {
          client.postMessage({ type: 'VIVA_LUXE_OPEN_ORDER', orderId: event.notification.data?.orderId || null });
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
