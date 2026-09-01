/* ===========================================================
   Viva Luxe — Admin push notifications (Firebase Cloud Messaging)
   ===========================================================
   New file — does not touch script.js or the customer-facing site.
   Only wired into admin.js (see the 4 small insertions listed in
   the writeup) and loaded from admin.html.

   Requires:
   - firebase-app.js, firebase-messaging.js compat scripts loaded
     BEFORE this file, same version as firebase-messaging-sw.js.
   - The existing global `auth` and `db` from your Firebase init.
   - A VAPID key from Firebase Console → Project settings →
     Cloud Messaging → Web Push certificates.
   =========================================================== */

/* Firebase Console → Project settings → Cloud Messaging →
   Web Push certificates → "Key pair". This is a PUBLIC key (safe in
   frontend code) — it identifies your project to the push service,
   it does not grant any access by itself. */
const FCM_VAPID_KEY = 'BM9kVJrnTVvjh_P74Qe0mOUFclooAuCuUTOfs1AZTAnXiyx8JTz_9hem_oc8JBQZW9ZtidLSFnzqHXHLHN0br5s';

/* Where tapping a notification should land. Adjust if your admin
   page isn't at this path. */
const ADMIN_DASHBOARD_URL = '/admin.html';

let fcmMessaging = null;
let fcmCurrentToken = null;
let fcmServiceWorkerReg = null;

/* ---------------- Setup (called from showAdminApp) ---------------- */
async function initAdminPushNotifications(user){
  if(!('serviceWorker' in navigator) || !('Notification' in window) || typeof firebase === 'undefined' || !firebase.messaging){
    console.warn('Push notifications not supported in this browser.');
    renderPushPermissionUI('unsupported');
    return;
  }

  try {
    fcmServiceWorkerReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    fcmMessaging = firebase.messaging();
  } catch(err){
    console.error('Could not register the FCM service worker:', err);
    renderPushPermissionUI('error');
    return;
  }

  // Reflect current permission state in the Settings tab immediately.
  renderPushPermissionUI(Notification.permission);

  // If permission was already granted in a previous session, silently
  // re-sync the token (handles token rotation / cache clears without
  // making the admin click "Enable" again every visit).
  if(Notification.permission === 'granted'){
    fetchAndSaveFcmToken(user);
  }

  // Foreground messages: the OS-level notification the service worker
  // shows only fires when the tab is backgrounded/closed, so when the
  // admin already has the tab open and focused we build our own alert
  // here instead of relying on onBackgroundMessage.
  fcmMessaging.onMessage((payload) => {
    const data = payload.data || {};
    showForegroundOrderAlert(data);
  });

  // Sent by firebase-messaging-sw.js when the admin taps a background
  // notification while a tab is already open, so we can jump straight
  // to the relevant order instead of just landing on the dashboard.
  navigator.serviceWorker.addEventListener('message', (event) => {
    if(event.data && event.data.type === 'VIVA_LUXE_OPEN_ORDER'){
      switchAdminTab('orders');
    }
  });
}

/* ---------------- Permission request (button in Settings tab) ---------------- */
async function enableAdminPushNotifications(){
  const user = auth.currentUser;
  if(!user){ return; }

  if(!fcmMessaging){
    showSettingsStatus('pushSaveStatus', 'Push notifications are not available in this browser.', false);
    return;
  }

  const btn = document.getElementById('enablePushBtn');
  if(btn) btn.disabled = true;

  try {
    const permission = await Notification.requestPermission();
    renderPushPermissionUI(permission);

    if(permission !== 'granted'){
      showSettingsStatus('pushSaveStatus', 'Notifications were not enabled. You can turn them on later from your browser\'s site settings.', false);
      return;
    }

    await fetchAndSaveFcmToken(user);
    showSettingsStatus('pushSaveStatus', 'Push notifications enabled on this device.', true);
  } catch(err){
    console.error('Could not enable push notifications:', err);
    showSettingsStatus('pushSaveStatus', 'Could not enable notifications: ' + err.message, false);
  } finally {
    if(btn) btn.disabled = false;
  }
}

/* Fetches the current FCM registration token for this browser/device
   and stores/refreshes it in Firestore. Safe to call repeatedly —
   getToken() returns the existing token if one is still valid, so
   calling this on every login just keeps the stored token fresh. */
async function fetchAndSaveFcmToken(user){
  try {
    const token = await fcmMessaging.getToken({
      vapidKey: FCM_VAPID_KEY,
      serviceWorkerRegistration: fcmServiceWorkerReg
    });
    if(!token){
      renderPushPermissionUI('denied');
      return;
    }
    fcmCurrentToken = token;

    // Doc ID = token itself, so re-registering the same device is an
    // upsert, not a duplicate row, and cleanup (see Cloud Function) is
    // a simple delete-by-ID when FCM reports the token as dead.
    await db.collection('adminFcmTokens').doc(token).set({
      uid: user.uid,
      token,
      email: user.email || null,
      userAgent: navigator.userAgent,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch(err){
    console.error('Could not fetch/save FCM token:', err);
  }
}

/* Called on admin logout — stop this device from receiving pushes for
   an account that's no longer signed in on it. */
async function teardownAdminPushNotifications(){
  if(!fcmMessaging || !fcmCurrentToken) return;
  const token = fcmCurrentToken;
  fcmCurrentToken = null;
  try {
    await db.collection('adminFcmTokens').doc(token).delete();
    await fcmMessaging.deleteToken();
  } catch(err){
    // Non-fatal — a stale token just gets cleaned up server-side the
    // next time a push to it fails (see functions/index.js).
    console.warn('Could not fully clean up FCM token on logout:', err);
  }
}

/* ---------------- Settings tab UI ---------------- */
function renderPushPermissionUI(state){
  const statusEl = document.getElementById('pushPermissionStatus');
  const btn = document.getElementById('enablePushBtn');
  if(!statusEl || !btn) return; // Settings HTML not on screen yet

  const messages = {
    granted: 'Notifications are ON for this device.',
    denied: 'Notifications are blocked. Enable them from your browser\'s site settings, then reload this page.',
    default: 'Turn on notifications to get an alert on this device the moment a new order comes in.',
    unsupported: 'This browser does not support push notifications.',
    error: 'Something went wrong setting up notifications. Try reloading the page.'
  };
  statusEl.textContent = messages[state] || messages.default;

  btn.style.display = (state === 'granted' || state === 'unsupported') ? 'none' : 'inline-block';
}

/* Foreground order alert — the tab is open and focused, so a native
   OS notification typically wouldn't even surface. Show one anyway
   (most browsers still allow it) so behavior matches the backgrounded
   case, and clicking it behaves the same way. */
function showForegroundOrderAlert(data){
  const title = data.title || '🔔 New Order';
  const body = data.body || 'Viva Luxe has a new order';

  if(Notification.permission === 'granted'){
    const notif = new Notification(title, {
      body,
      tag: data.orderId ? `viva-luxe-order-${data.orderId}` : 'viva-luxe-order'
    });
    notif.onclick = () => {
      window.focus();
      switchAdminTab('orders');
      notif.close();
    };
  }
}
