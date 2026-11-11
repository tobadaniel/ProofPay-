/*
 * ProofPay API — a single Netlify Function that talks to the PayPal
 * Sandbox REST API with the app's client credentials.
 *
 * Routes (mounted under /api/* via netlify.toml redirect, and under
 * /api/* by the local server.js):
 *
 *   GET  /api/config               -> { configured, clientId? }
 *   POST /api/orders               { amount, milestoneTitle }
 *                                  -> { id, status }            (create order)
 *   POST /api/orders/:id/capture   -> { id, captureId, status } (capture order)
 *   POST /api/payout               { amount, receiverEmail, milestoneTitle }
 *                                  -> { payoutBatchId, status } (Payouts API)
 *
 * Credentials come only from the environment:
 *   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV (=sandbox default)
 * The secret is never logged and never included in any response.
 * If the credentials are absent, payment routes return a clean 503 JSON
 * error — no payment is ever simulated or faked.
 */

'use strict';

var cachedToken = null; // { value, expiresAt }

function paypalBase() {
  return process.env.PAYPAL_ENV === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

function configured() {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

function json(statusCode, obj) {
  return {
    statusCode: statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  };
}

function validAmount(amount) {
  var n = Number(amount);
  if (!isFinite(n) || n <= 0 || n > 100000) return null;
  return n;
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30000) {
    return cachedToken.value;
  }
  var auth = Buffer.from(
    process.env.PAYPAL_CLIENT_ID + ':' + process.env.PAYPAL_CLIENT_SECRET
  ).toString('base64');
  var res = await fetch(paypalBase() + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + auth,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok || !data.access_token) {
    throw new Error('PayPal authentication failed (' + res.status + ')' +
      (data.error_description ? ': ' + data.error_description : ''));
  }
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in || 300) * 1000)
  };
  return cachedToken.value;
}

async function paypalFetch(path, options) {
  var token = await getAccessToken();
  var res = await fetch(paypalBase() + path, {
    method: options.method || 'GET',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  var data = await res.json().catch(function () { return {}; });
  return { res: res, data: data };
}

function paypalError(prefix, res, data) {
  var detail = '';
  if (data && data.details && data.details.length) {
    detail = ': ' + data.details.map(function (d) {
      return (d.issue || '') + (d.description ? ' — ' + d.description : '');
    }).join('; ');
  } else if (data && data.message) {
    detail = ': ' + data.message;
  }
  return new Error(prefix + ' (' + res.status + ')' + detail);
}

/* ------------------------------ routes ------------------------------ */

async function createOrder(body) {
  var amount = validAmount(body.amount);
  if (amount === null) return json(400, { error: 'A valid amount greater than 0 is required.' });
  var title = String(body.milestoneTitle || 'ProofPay milestone').slice(0, 120);

  var out = await paypalFetch('/v2/checkout/orders', {
    method: 'POST',
    body: {
      intent: 'CAPTURE',
      purchase_units: [{
        description: title,
        amount: { currency_code: 'USD', value: amount.toFixed(2) }
      }]
    }
  });
  if (!out.res.ok) throw paypalError('PayPal order creation failed', out.res, out.data);
  return json(201, { id: out.data.id, status: out.data.status });
}

async function captureOrder(orderId) {
  var out = await paypalFetch('/v2/checkout/orders/' + encodeURIComponent(orderId) + '/capture', {
    method: 'POST',
    body: {}
  });
  if (!out.res.ok) throw paypalError('PayPal order capture failed', out.res, out.data);
  var captureId = null;
  try {
    captureId = out.data.purchase_units[0].payments.captures[0].id;
  } catch (e) { /* leave null; status still returned */ }
  return json(200, { id: out.data.id || orderId, captureId: captureId, status: out.data.status });
}

async function createPayout(body) {
  var amount = validAmount(body.amount);
  if (amount === null) return json(400, { error: 'A valid amount greater than 0 is required.' });
  var receiver = String(body.receiverEmail || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(receiver)) {
    return json(400, { error: 'A valid freelancer PayPal email is required.' });
  }
  var title = String(body.milestoneTitle || 'ProofPay milestone').slice(0, 120);
  var stamp = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

  var out = await paypalFetch('/v1/payments/payouts', {
    method: 'POST',
    body: {
      sender_batch_header: {
        sender_batch_id: 'proofpay-' + stamp,
        email_subject: 'You have a payment from ProofPay',
        email_message: 'Your milestone "' + title + '" was verified and the payment has been released.'
      },
      items: [{
        recipient_type: 'EMAIL',
        amount: { value: amount.toFixed(2), currency: 'USD' },
        receiver: receiver,
        note: 'ProofPay milestone release: ' + title,
        sender_item_id: 'proofpay-item-' + stamp
      }]
    }
  });
  if (!out.res.ok) throw paypalError('PayPal payout failed', out.res, out.data);
  var header = out.data.batch_header || {};
  return json(201, {
    payoutBatchId: header.payout_batch_id || null,
    status: header.batch_status || out.data.status || 'PENDING'
  });
}

/* ----------------------------- handler ------------------------------ */

exports.handler = async function (event) {
  var method = (event.httpMethod || 'GET').toUpperCase();
  var path = event.path || '';
  path = path.replace(/^\/.netlify\/functions\/api/, '');
  path = path.replace(/^\/api/, '');
  if (path.charAt(0) !== '/') path = '/' + path;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

  try {
    if (method === 'GET' && path === '/config') {
      if (configured()) {
        return json(200, { configured: true, clientId: process.env.PAYPAL_CLIENT_ID });
      }
      return json(200, { configured: false });
    }

    if (path === '/orders' || path.indexOf('/orders/') === 0 || path === '/payout') {
      if (!configured()) {
        return json(503, {
          error: 'PayPal Sandbox is not configured on the server. ' +
            'Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to enable payments.'
        });
      }
      var body = {};
      if (event.body) {
        try { body = JSON.parse(event.body); } catch (e) {
          return json(400, { error: 'Request body must be valid JSON.' });
        }
      }
      if (method === 'POST' && path === '/orders') return await createOrder(body);
      var cap = path.match(/^\/orders\/([^/]+)\/capture$/);
      if (method === 'POST' && cap) return await captureOrder(decodeURIComponent(cap[1]));
      if (method === 'POST' && path === '/payout') return await createPayout(body);
      return json(404, { error: 'Route not found.' });
    }

    return json(404, { error: 'Route not found.' });
  } catch (err) {
    return json(502, { error: err.message || 'Unexpected server error.' });
  }
};
