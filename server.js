/*
 * ProofPay local server — zero dependencies.
 *
 * Serves public/ as static files and mounts the exact same handlers as
 * netlify/functions/api.js under /api/*, so the whole product can be run
 * and judged locally with nothing but Node:
 *
 *   node server.js            (http://localhost:3000)
 *
 * Optional: copy .env.example to .env and fill in sandbox credentials to
 * enable real PayPal Sandbox payments locally.
 */

'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');

var ROOT = __dirname;
var PUBLIC_DIR = path.join(ROOT, 'public');

/* Tiny .env loader (KEY=VALUE lines), only for values not already set. */
(function loadEnv() {
  var envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(function (line) {
    var m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  });
})();

var api = require('./netlify/functions/api.js');

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

var server = http.createServer(function (req, res) {
  var url = new URL(req.url, 'http://localhost');
  var pathname = decodeURIComponent(url.pathname);

  if (pathname.indexOf('/api/') === 0 || pathname === '/api') {
    var chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', async function () {
      try {
        var result = await api.handler({
          httpMethod: req.method,
          path: pathname,
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8')
        });
        res.writeHead(result.statusCode, result.headers || { 'Content-Type': 'application/json' });
        res.end(result.body);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Local server error: ' + err.message }));
      }
    });
    return;
  }

  var filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (filePath.indexOf(PUBLIC_DIR) !== 0) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

var port = Number(process.env.PORT || 3000);
server.listen(port, function () {
  console.log('ProofPay running at http://localhost:' + port);
  var configured = Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
  console.log('PayPal Sandbox configured: ' + configured +
    (configured ? '' : ' (funding panel will show "not configured" until PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are set)'));
});
