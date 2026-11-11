# ProofPay — Build Spec (Phase 1: scaffold + full local flow)

Product story and hackathon constraints: see
~/workspace/goals/paypal-ai-hackathon-entry-proofpay/GOAL.md

## Deliverable for this phase
A complete, locally runnable app in ~/workspace/proofpay/ :

- `public/index.html` — single-page app, polished product UI (not a wireframe).
  Views/sections:
  1. Header: ProofPay wordmark, "AI-verified milestone payments", Sandbox badge.
  2. Step 1 — Project setup: title, client name, freelancer PayPal email (sandbox),
     brief textarea, "Parse brief with AI" button. A "Load demo brief" button fills a
     realistic demo project: a Nigerian freelance data analyst hired to clean and
     analyse a sales dataset and deliver a summary report (2 milestones).
  3. AI Brief Parser output: milestone cards (title, amount, acceptance criteria list),
     amounts editable, total shown. Parser logic: split brief by milestone markers /
     sentences, extract deliverable nouns and measurable criteria (numbers, formats,
     deadlines); fall back to sensible generated criteria per milestone.
  4. Step 2 — Fund milestone: PayPal Buttons (JS SDK, sandbox client-id fetched from
     /api/config) calling server create/capture. On capture success the milestone
     becomes FUNDED — HELD BY PROOFPAY, showing order + capture IDs.
     If /api/config reports no credentials configured, show a clear "Sandbox not
     configured" notice in that panel (do NOT fake a payment).
  5. Step 3 — Freelancer deliverable: textarea + link field, Submit button.
  6. Step 4 — AI Verification report: per-criterion rows (criterion, verdict,
     evidence quote from the deliverable, score), overall score bar, verdict banner:
     RELEASE RECOMMENDED (>=80 and no critical criterion failed) or REVISE with the
     specific missing items listed.
  7. Step 5 — Release: if verdict is pass, "Release $X via PayPal Payout" button
     calling /api/payout; shows payout batch id and status on success. Client
     "Override release" link if verdict is revise (with confirm). Milestone -> RELEASED.
  8. Money Ledger: AG Grid community (CDN) grid listing every money event
     (time, milestone, type FUND/RELEASE, amount, PayPal ID, status).
  State lives in memory + localStorage. No login. All amounts USD.
- `public/ai.js` — the AI engines, dependency-free, shared logic in plain JS:
  brief parsing + deliverable verification (tokenisation, stopwords, criterion
  key-term extraction, evidence sentence matching, coverage scoring, measurable-
  element checks: numbers, file/format mentions, links). Must be deterministic and
  explainable. Export for browser (window.ProofPayAI) and Node (module.exports).
- `netlify/functions/api.js` — single function, routes:
  GET  /api/config  -> { configured: bool, clientId } (clientId only if configured)
  POST /api/orders  { amount, milestoneTitle } -> create PayPal sandbox order
  POST /api/orders/:id/capture -> capture, return capture id + status
  POST /api/payout  { amount, receiverEmail, milestoneTitle } -> Payouts API,
       return payout_batch_id + status
  PayPal base: https://api-m.sandbox.paypal.com, OAuth client_credentials with
  PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET env vars. Clean JSON errors, no secret
  ever logged or returned.
- `server.js` — tiny zero-dependency Node server for local testing that serves
  public/ and mounts the same handlers as netlify/functions/api.js under /api/*.
- `netlify.toml` — publish public/, functions dir, /api/* redirect to the function.
- `.env.example` — PAYPAL_CLIENT_ID=, PAYPAL_CLIENT_SECRET=, PAYPAL_ENV=sandbox.
- `README.md` — what it is, architecture, local run, env setup, judge instructions
  (sandbox buyer test account placeholder), AI tools statement.
- `LICENSE` — MIT, Copyright 2026 Oluwatoba John.
- `test/ai.test.js` — plain Node assertions (node:test or simple asserts) proving:
  parser produces >=2 milestones with criteria from the demo brief; verification
  passes a complete deliverable and fails an incomplete one naming the gaps.
  Run them and paste the result into your report.

Design: clean fintech look, PayPal-blue accent (#0070ba / #003087), white cards,
rounded corners, clear step numbers, mobile-friendly. No copyrighted assets, no
external fonts beyond system stack (Google Fonts link is acceptable but must
degrade gracefully offline). AG Grid via CDN
(https://cdn.jsdelivr.net/npm/ag-grid-community@32/dist/styles/ag-grid.css etc.)
with a graceful plain-table fallback if the CDN fails.

Hard rules:
- Never invent PayPal credentials and never simulate/fake a payment success.
  Without env credentials the funding panel must say it is not configured.
- No external npm dependencies (zero-install: everything must run with plain
  `node server.js`).
- Keep all code in ~/workspace/proofpay/. Do not deploy anywhere, do not create
  git repos, do not touch Netlify or any account. Report: files created, test
  output, and exactly how to run it locally.
