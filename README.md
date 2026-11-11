# ProofPay — AI-verified milestone payments for freelancers

**Built for the PayPal AI Hackathon** (Devpost, deadline Nov 12, 2026).

Clients fear paying upfront for work that never matches the brief. Freelancers —
especially Nigerian and other global online earners — fear delivering work and
never getting paid, or waiting days while a platform holds their money for a
~20% fee. ProofPay removes the trust problem from both sides:

1. **The client pastes a plain-English brief.** ProofPay's AI Brief Parser splits
   it into priced milestones, each with explicit acceptance criteria.
2. **The client funds the milestone with PayPal.** A real PayPal Sandbox order is
   created and captured server-side (Orders API). The money is held by ProofPay.
3. **The freelancer submits the deliverable.** ProofPay's AI Verification Engine
   scores it against every acceptance criterion — quoting evidence, checking
   measurable requirements (counts, word counts, file formats) exactly, and
   naming what is missing when it falls short.
4. **A passing verdict releases the money.** One click sends a real PayPal
   Payout (Payouts API) to the freelancer's PayPal email. On a REVISE verdict
   the money stays held while the freelancer fixes the listed gaps; the client
   can override, but the AI's objections stay on the record.

PayPal is load-bearing — funding is a real PayPal capture and release is a real
PayPal payout. AI is load-bearing — no human reviews the work; the AI parses
the brief and its verdict is the gate between capture and payout. Every money
movement lands in an AG Grid-powered ledger with its PayPal IDs.

## Architecture

```
public/index.html   Single-page product UI (steps 1–5 + money ledger)
public/ai.js        The two AI engines — dependency-free, deterministic NLP:
                    brief parsing + deliverable verification. Runs identically
                    in the browser and in Node (used by the tests).
netlify/functions/api.js
                    One Netlify Function exposing /api/* — the only place the
                    PayPal client secret exists (environment variables).
server.js           Zero-dependency local server: serves public/ and mounts
                    the same /api/* handlers, so the full product runs
                    locally with plain Node — no installs, no Netlify CLI.
netlify.toml        Publishes public/, registers the function, rewrites
                    /api/* to it.
test/ai.test.js     Node tests for the AI engines (parser + verification).
```

PayPal integration (all Sandbox, all server-side):

| Action | Endpoint |
|---|---|
| OAuth | `POST /v1/oauth2/token` (client credentials) |
| Create order | `POST /v2/checkout/orders` |
| Capture order | `POST /v2/checkout/orders/:id/capture` |
| Release payout | `POST /v1/payments/payouts` |

The frontend uses the PayPal JS SDK Buttons with the server-side
create/capture pattern. If the server has no PayPal credentials configured,
the funding panel says so plainly — **ProofPay never simulates or fakes a
payment**, and the payout route returns the same honest error.

## Run it locally (judges)

Requirements: Node.js 18+ only. No `npm install` — there are no dependencies.

```bash
node server.js
# → http://localhost:3000
```

Without credentials you can still run the full AI flow: click
**Load demo brief**, then in step 3 **Load sample deliverable (demo)** and
submit it to see the AI verification report. The funding panel will show
“PayPal Sandbox is not configured” — that is expected until you add
credentials (next section).

Run the AI engine tests:

```bash
node test/ai.test.js
```

## Environment setup (enabling real PayPal Sandbox payments)

1. Create a free developer account at <https://developer.paypal.com> and log in.
2. Dashboard → **Apps & Credentials** → Sandbox → **Create App**.
3. Copy the app's **Client ID** and **Secret**.
4. Provide them as environment variables (never commit them):

   **Local:** copy `.env.example` to `.env` and fill it in:

   ```
   PAYPAL_CLIENT_ID=<your sandbox client id>
   PAYPAL_CLIENT_SECRET=<your sandbox secret>
   PAYPAL_ENV=sandbox
   ```

   **Netlify:** Site settings → Environment variables → add the same three
   variables, then redeploy.

5. Reload the app. `GET /api/config` now reports `configured: true`, the
   PayPal Buttons appear in step 2, and funding/payouts run against the
   PayPal Sandbox (`https://api-m.sandbox.paypal.com`).

## Judge instructions

**Hosted demo:** use the deployed URL from the Devpost submission, or run
locally as above.

**Sandbox buyer test account** (use this to fund a milestone in step 2 —
sandbox money only, no real funds):

- Email: `sb-eiss4753858287@personal.example.com`
- Password: `,m#Ms|2O`

**Freelancer payout account:** the demo brief pre-fills the “Freelancer PayPal
email” field with the same sandbox personal account
(`sb-eiss4753858287@personal.example.com`) — in this sandbox demo it plays both
roles: the client who funds at checkout, and the freelancer who receives the
release. The release in step 5 is a real Sandbox payout to that account,
visible in the ledger with its payout batch ID. (The ProofPay vault in the
middle is the sandbox business account `sb-3p5ad53787804@business.example.com`,
which receives the funding capture and sends the payout.)

**Suggested 2-minute walkthrough:**

1. Click **Load demo brief** — the AI parses a 2-milestone data-analysis job
   ($150 + $200) with measurable acceptance criteria.
2. Fund milestone 1 with the sandbox buyer account (PayPal button, step 2) —
   the ledger gains a FUND row with the capture ID.
3. Click **Load sample deliverable (demo)**, then **Submit deliverable** —
   the AI report scores it 100/100 and recommends RELEASE.
4. Click **Release $150 via PayPal Payout** — the ledger gains a RELEASE row
   with the payout batch ID.
5. Optional: edit the sample deliverable to remove the revenue-column work and
   resubmit — the verdict flips to REVISE and names the exact gaps.

## AI tools statement

ProofPay's intelligence is **original, dependency-free code written for this
hackathon** (`public/ai.js`): a brief parser that extracts milestones, prices
and acceptance criteria from plain English, and a verification engine that
scores deliverables with tokenisation, light stemming, key-term evidence
matching, and exact measurable checks (numbers, word counts, file formats).
It is deliberately deterministic and explainable — the same deliverable always
gets the same verdict, and every score can be traced to quoted evidence — and
it needs no third-party AI API keys, so judges can run everything offline.
AI-assisted developer tools were used during development; no external AI
service is called at runtime.

## Sponsor tools

- **AG Grid (Community)** powers the money ledger grid (with an automatic
  plain-table fallback if the CDN is unreachable).
- **PayPal** Orders API, Payouts API and JS SDK are the product's core.

## Licence

MIT — see `LICENSE`. Copyright (c) 2026 Oluwatoba John.
