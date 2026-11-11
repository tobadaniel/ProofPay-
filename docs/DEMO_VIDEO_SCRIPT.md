# ProofPay Demo Video Script — target 2:30, hard cap 2:55
Record the live hosted demo in a browser at 1080p. Narration: clear voiceover (TTS or recorded), no copyrighted music (use a generated/synth bed or none). Show the PayPal sandbox popup for real — do not mock it.

## 0:00–0:20 — Problem
On camera: landing view of ProofPay.
VO: "Freelancers deliver the work, then chase the payment. Clients pay upfront, then hope. Platforms take up to twenty percent and hold the money for days. ProofPay fixes both sides: PayPal holds the milestone, and AI verifies the work before a single dollar moves."

## 0:20–0:45 — AI creates the milestones
Click "Load demo brief" → "Parse brief with AI".
VO: "A client pastes a plain-English brief — clean a sales dataset, then deliver an analysis report. ProofPay's AI splits it into two milestones, prices them, and writes explicit acceptance criteria for each: formats, row counts, the exact sections the report must contain."
Show: milestone cards, $150 + $200, criteria lists.

## 0:45–1:15 — PayPal funds the milestone (HELD)
Click the PayPal button on Milestone 1, log in with the sandbox buyer account, approve.
VO: "The client funds milestone one with PayPal. That's a real sandbox capture — order and capture IDs are right here — and the money now sits held by ProofPay. The freelancer can start work knowing the money exists."
Show: status pill FUNDED — HELD BY PROOFPAY, ledger row with capture ID.

## 1:15–1:50 — AI verifies the deliverable
Switch to freelancer view, "Load sample deliverable", submit, run verification.
VO: "The freelancer submits the cleaned dataset with a summary. The AI checks it against every criterion — and quotes its evidence. Eleven thousand eight hundred forty-two rows cleaned, duplicates removed, CSV delivered. Score: release recommended."
Show: per-criterion PASS rows with evidence quotes, score bar.

## 1:50–2:05 — The AI says no (the moment judges remember)
Edit the deliverable live: delete the revenue-breakdown section, re-verify.
VO: "Remove the revenue-by-region breakdown, and the verdict flips: revise — and it names exactly what's missing. No black box. The freelancer knows what to fix, and the client's money stays held."
Show: REVISE banner with the named gap.

## 2:05–2:30 — Release via PayPal Payout
Restore the full deliverable (or return to the passing report), click "Release via PayPal Payout".
VO: "Restore the work, verify again, and one click releases the money — a real PayPal payout to the freelancer's PayPal account, batch ID in the ledger. Funded on proof. Released on proof. That's ProofPay."
Show: RELEASED pill, ledger with payout batch ID. End card: ProofPay — get paid for proof, not promises. [demo URL + repo URL on screen]

## Recording notes
- Rehearse once with fresh localStorage (Reset button) so the state is clean.
- Keep the PayPal sandbox login credentials off-screen: pre-type or cut that second in editing.
- Captions on. Total VO ≈ 330 words ≈ 2:25 at a natural pace; trim the problem segment first if it runs long.
