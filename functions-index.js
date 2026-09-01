/* ===========================================================
   Viva Luxe — order notifications (email + WhatsApp + push)
   ===========================================================
   Sends an email, a WhatsApp message, AND a browser/phone push
   notification to the admin every time a new order document is
   created in Firestore. Same single `orders/{orderId}` onCreate
   trigger as before — nothing new is subscribed, so no duplicate
   processing.

   - Email + WhatsApp: unchanged from before, see original setup
     notes below.
   - Push (NEW): Firebase Cloud Messaging, sent to every device the
     admin has enabled notifications on (functions/adminFcmTokens
     collection, written by admin-fcm.js in the admin panel).

   ONE-TIME SETUP — EMAIL (unchanged, skip if already done):
   1. npm install -g firebase-tools && firebase login
   2. firebase init functions
   3. Replace functions/index.js with this file, then inside the
      functions folder: npm install nodemailer
   4. Turn on a Gmail "App Password":
        https://myaccount.google.com/apppasswords
        (needs 2-Step Verification on first)
   5. firebase functions:config:set gmail.email="vivaluxebyvivian@gmail.com" gmail.password="xxxxxxxxxxxxxxxx"

   ONE-TIME SETUP — WHATSAPP (unchanged, skip if already done):
   See original comments in your previous index.js / the project
   writeup — nothing about this changed.

   ONE-TIME SETUP — PUSH (NEW):
   1. Firebase Console → Project settings → Cloud Messaging → Web
      Push certificates → generate a key pair. Put that key into
      FCM_VAPID_KEY in admin-fcm.js (frontend, admin panel only).
   2. No functions:config needed for push — the Admin SDK sends
      via FCM using the Cloud Function's own default credentials,
      the same ones already powering admin.firestore() below.
   3. Make sure functions/package.json has a recent firebase-admin
      (>= 11.0.0 is fine; this file only uses admin.messaging().send(),
      which has been stable for years, so no forced upgrade needed).
   4. Deploy:
        firebase deploy --only functions

   Requires Node 18+ runtime (for the global fetch used by the
   WhatsApp piece) — functions/package.json should already have:
     "engines": { "node": "18" }
   =========================================================== */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

admin.initializeApp();
const db = admin.firestore();

const gmailEmail = functions.config().gmail?.email;
const gmailPassword = functions.config().gmail?.password;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: gmailEmail, pass: gmailPassword }
});

const waToken = functions.config().whatsapp?.token;
const waPhoneId = functions.config().whatsapp?.phone_id;
const waTemplate = functions.config().whatsapp?.template || 'order_alert';
const waDefaultNumber = functions.config().whatsapp?.default_number || '';

// Where a tapped push notification should land. Must match
// ADMIN_DASHBOARD_URL in admin-fcm.js. If you serve the admin panel
// on its own subdomain/full URL, use the full absolute URL here
// instead (e.g. 'https://admin.vivaluxe.example.com/').
const ADMIN_DASHBOARD_URL = '/admin.html';

function nairaFmt(n){
  return '₦' + Number(n || 0).toLocaleString('en-NG');
}

async function sendOrderEmail(order, orderNumber, snapId){
  if(!gmailEmail || !gmailPassword){
    console.warn('Gmail not configured — skipping order email.');
    return;
  }
  const items = (order.items || [])
    .map(i => `  • ${i.name} × ${i.qty} — ${nairaFmt(i.price * i.qty)}`)
    .join('\n');

  const subject = `New Viva Luxe order #${orderNumber || snapId.slice(-6).toUpperCase()}`;
  const text = `New order received!

Order: #${orderNumber || snapId.slice(-6).toUpperCase()}
Customer: ${order.customer?.name || 'Guest'}
Phone: ${order.customer?.phone || ''}
Email: ${order.customer?.email || ''}
${order.deliveryMethod === 'pickup' ? 'Pickup' : 'Delivery to: ' + (order.customer?.state || '') + ', ' + (order.customer?.address || '')}

Items:
${items}

Subtotal: ${nairaFmt(order.subtotal)}
Delivery: ${order.delivery === 0 ? 'Free' : nairaFmt(order.delivery)}
Total: ${nairaFmt(order.total)}
Payment: ${order.paymentMethod || 'Bank Transfer'}${order.paystackReference ? ' (ref ' + order.paystackReference + ')' : ''}

Open the admin panel to accept or reject this order.`;

  try {
    await transporter.sendMail({
      from: `Viva Luxe Orders <${gmailEmail}>`,
      to: gmailEmail,
      subject,
      text
    });
  } catch(err) {
    console.error('Order email notification failed (order was still saved fine):', err);
  }
}

async function sendOrderWhatsApp(order, orderNumber){
  if(!waToken || !waPhoneId){
    console.warn('WhatsApp Cloud API not configured — skipping WhatsApp alert.');
    return;
  }

  let toNumber = waDefaultNumber;
  try {
    const notifDoc = await db.collection('settings').doc('notifications').get();
    if(notifDoc.exists && notifDoc.data().orderAlertWhatsapp){
      toNumber = notifDoc.data().orderAlertWhatsapp;
    }
  } catch(err) {
    console.warn('Could not read settings/notifications, using default_number:', err);
  }
  if(!toNumber){
    console.warn('No WhatsApp destination number configured — skipping WhatsApp alert.');
    return;
  }

  const itemsLine = (order.items || []).map(i => `${i.name} ×${i.qty}`).join(', ');
  const deliveryLine = order.deliveryMethod === 'pickup'
    ? 'Pickup'
    : 'Delivery to ' + (order.customer?.state || '');

  const body = {
    messaging_product: 'whatsapp',
    to: toNumber,
    type: 'template',
    template: {
      name: waTemplate,
      language: { code: 'en_US' },
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: String(orderNumber || '') },
          { type: 'text', text: order.customer?.name || 'Guest' },
          { type: 'text', text: order.customer?.phone || '' },
          { type: 'text', text: `${itemsLine} — ${deliveryLine}` },
          { type: 'text', text: nairaFmt(order.total) },
          { type: 'text', text: order.paymentMethod || 'Bank Transfer' }
        ]
      }]
    }
  };

  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${waPhoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${waToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if(!res.ok){
      const errText = await res.text();
      console.error('WhatsApp order alert failed (order was still saved fine):', res.status, errText);
    }
  } catch(err) {
    console.error('WhatsApp order alert failed (order was still saved fine):', err);
  }
}

/* ---------------- NEW: push notification ---------------- */

// FCM error codes that mean "this token is dead, stop trying it" —
// as opposed to a transient failure worth leaving alone.
const DEAD_TOKEN_ERROR_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument'
]);

async function sendOrderPush(order, orderNumber, orderId){
  let tokensSnap;
  try {
    tokensSnap = await db.collection('adminFcmTokens').get();
  } catch(err){
    console.error('Could not read adminFcmTokens (order was still saved fine):', err);
    return;
  }
  if(tokensSnap.empty){
    console.warn('No admin devices registered for push — skipping.');
    return;
  }

  const itemCount = (order.items || []).reduce((sum, i) => sum + (i.qty || 1), 0);
  const itemLabel = itemCount === 1 ? 'item' : 'items';
  const title = '🔔 New Order';
  const body = `Viva Luxe has a new order\n${itemCount} ${itemLabel} • ${nairaFmt(order.total)}\nOrder #${orderNumber}`;

  // Data-only payload (no top-level "notification" field) — the
  // service worker builds the visible notification itself so tapping
  // it can reliably open the admin dashboard. See
  // firebase-messaging-sw.js for why this matters.
  const dataPayload = {
    title,
    body,
    orderId: String(orderId),
    orderNumber: String(orderNumber || ''),
    url: ADMIN_DASHBOARD_URL,
    icon: '/icons/notification-icon-192.png',
    badge: '/icons/notification-badge-72.png'
  };
  if(order.customer?.name){
    dataPayload.customerName = order.customer.name;
  }

  const sendResults = await Promise.allSettled(
    tokensSnap.docs.map(doc =>
      admin.messaging().send({
        token: doc.id,
        data: dataPayload,
        webpush: {
          headers: { Urgency: 'high' },
          fcmOptions: { link: ADMIN_DASHBOARD_URL }
        }
      }).then(() => ({ tokenId: doc.id, ok: true }))
        .catch(err => ({ tokenId: doc.id, ok: false, code: err.code }))
    )
  );

  // Clean up dead tokens so the admin's device list (and every future
  // send) doesn't keep accumulating stale entries — e.g. a browser
  // uninstall, cleared site data, or a token FCM has since rotated out.
  const deletions = [];
  for(const result of sendResults){
    if(result.status !== 'fulfilled') continue;
    const { tokenId, ok, code } = result.value;
    if(!ok && DEAD_TOKEN_ERROR_CODES.has(code)){
      deletions.push(db.collection('adminFcmTokens').doc(tokenId).delete()
        .catch(err => console.warn('Could not delete dead FCM token', tokenId, err)));
    } else if(!ok){
      console.error('Push send failed for token', tokenId, code);
    }
  }
  await Promise.all(deletions);
}

exports.notifyOnNewOrder = functions.firestore
  .document('orders/{orderId}')
  .onCreate(async (snap, context) => {
    const order = snap.data();
    const orderNumber = order.orderNumber || snap.id.slice(-6).toUpperCase();
    await Promise.all([
      sendOrderEmail(order, orderNumber, snap.id),
      sendOrderWhatsApp(order, orderNumber),
      sendOrderPush(order, orderNumber, context.params.orderId)
    ]);
  });
