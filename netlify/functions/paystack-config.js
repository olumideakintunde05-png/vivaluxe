/* ===========================================================
   PAYSTACK CONFIG — returns the Paystack PUBLIC key to the browser.
   Called by script.js (getPaystackPublicKey) right before opening
   the Paystack checkout popup.

   The public key is safe to expose to the browser — it's the same
   key Paystack's own inline.js requires on every checkout page.
   Keeping it in an environment variable (instead of pasted into
   script.js) just means it's not sitting in your Git history and
   can be changed without touching code.

   Set PAYSTACK_PUBLIC_KEY in Netlify: Site settings → Environment
   variables. See netlify/functions/paystack-verify.js for the
   SECRET key, which never reaches the browser.
   =========================================================== */
exports.handler = async function () {
  const publicKey = process.env.PAYSTACK_PUBLIC_KEY;

  if (!publicKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'PAYSTACK_PUBLIC_KEY is not set in Netlify environment variables.' })
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey })
  };
};

