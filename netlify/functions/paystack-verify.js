/* ===========================================================
   PAYSTACK VERIFY — confirms a completed Paystack transaction
   server-side before script.js writes the order to Firestore as
   "paid". This is the step that actually needs the SECRET key,
   which is why it has to run here (Netlify Function) and not in
   the browser.

   Set PAYSTACK_SECRET_KEY in Netlify: Site settings → Environment
   variables. Never put the secret key in script.js, index.html, or
   anywhere else in the repo — only here, read from process.env.

   Called by script.js (verifyAndSavePaystackOrder) right after the
   Paystack popup reports a successful charge, with the transaction
   reference it returned.
   =========================================================== */
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'PAYSTACK_SECRET_KEY is not set in Netlify environment variables.' })
    };
  }

  let reference;
  try {
    ({ reference } = JSON.parse(event.body || '{}'));
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }
  if (!reference) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing transaction reference' }) };
  }

  try {
    const paystackRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${secretKey}` } }
    );
    const result = await paystackRes.json();

    if (!result.status || !result.data || result.data.status !== 'success') {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verified: false })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verified: true,
        reference: result.data.reference,
        amount: result.data.amount, // kobo
        currency: result.data.currency,
        paidAt: result.data.paid_at,
        customerEmail: result.data.customer ? result.data.customer.email : null
      })
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Could not reach Paystack to verify this transaction.' })
    };
  }
};
                  
