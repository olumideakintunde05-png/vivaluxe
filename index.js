/* ===========================================================
   Viva Luxe — order notifications (email + WhatsApp)
   ===========================================================
   Sends an email AND a WhatsApp message to the admin every time a new
   order document is created in Firestore.

   - Email: Gmail SMTP through her own Gmail account (unchanged from
     before — an "app password", not a third-party service).
   - WhatsApp: Meta's official WhatsApp Cloud API, through her own
     WhatsApp Business account. This is WhatsApp's own send API, not
     a notification-dashboard middleman like CallMeBot/Twilio — same
     "your own account sending itself" model as the Gmail piece above.
     There is no way to send a WhatsApp message with zero involvement
     from Meta's servers; this is the closest equivalent to raw SMTP
     that WhatsApp actually offers.

   ONE-TIME SETUP — EMAIL (unchanged, skip if already done):
   1. npm install -g firebase-tools && firebase login
   2. firebase init functions
   3. Replace functions/index.js with this file, then inside the
      functions folder: npm install nodemailer
   4. Turn on a Gmail "App Password":
        https://myaccount.google.com/apppasswords
        (needs 2-Step Verification on first)
   5. firebase functions:config:set gmail.email="vivaluxebyvivian@gmail.com" gmail.password="xxxxxxxxxxxxxxxx"

   ONE-TIME SETUP — WHATSAPP (new):
   1. Go to https://developers.facebook.com → create a free Meta
      Developer account if she doesn't have one → "Create App" →
      type "Business" → add the "WhatsApp" product to it.
   2. Meta gives a free built-in test number immediately (no need to
      buy a number to get started). Under WhatsApp → API Setup you'll
      see:
        - a "Phone number ID" (a long numeric ID)
        - a "Temporary access token" (24hr — swap for a permanent one
          below before going live)
   3. Under WhatsApp → API Setup → "To", add the admin's real WhatsApp
      number and verify it — this is the number that will receive
      order alerts.
   4. Create a message template (Meta → WhatsApp → Message Templates →
      Create Template). Business alerts need an *approved template* to
      send outside a live customer conversation window — this is the
      one Meta review step, usually approved within minutes to a day.
        - Category: Utility
        - Name: order_alert
        - Body:  New Viva Luxe order #{{1}}
                 {{2}} · {{3}}
                 {{4}}
                 Total: {{5}} via {{6}}
   5. For a permanent token (temporary ones expire in 24h): Meta
      Business Settings → System Users → create a system user → assign
      the WhatsApp app to it → generate a permanent token with
      whatsapp_business_messaging permission.
   6. Set config (from the functions folder):
        firebase functions:config:set whatsapp.token="PERMANENT_TOKEN" whatsapp.phone_id="PHONE_NUMBER_ID" whatsapp.template="order_alert" whatsapp.default_number="2349013643713"
      (default_number is a fallback — the admin can override it any
      time from the admin panel's Settings tab without redeploying;
      see saveOrderAlertSettings() in admin.js)
   7. Deploy:
        firebase deploy --only functions

   Requires Node 18+ runtime (for the global fetch used below) — add
   to functions/package.json:  "engines": { "node": "18" }
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

  // The admin can override the destination number from the admin panel's
  // Settings tab (settings/notifications, admin-only doc) without a
  // redeploy. Falls back to whatsapp.default_number from functions:config.
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

  // Template params must match the "order_alert" template body created
  // in Meta's Message Templates (see setup step 4 above).
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

exports.notifyOnNewOrder = functions.firestore
  .document('orders/{orderId}')
  .onCreate(async (snap) => {
    const order = snap.data();
    const orderNumber = order.orderNumber || snap.id.slice(-6).toUpperCase();
    await Promise.all([
      sendOrderEmail(order, orderNumber, snap.id),
      sendOrderWhatsApp(order, orderNumber)
    ]);
  });
