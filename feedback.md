# Acureal — Operator Feedback (Rachit)

Extracted from the 2026-05-10 session. Read this before doing autonomous
work on Acureal. Supplements `CLAUDE.md` (project rules) and the user-side
`MEMORY.md` index (cross-project rules).

---

## Direct corrections from this session

1. **Don't add CSV export features without being asked.**
   I shipped CSV export on the AuditTab as part of PR #216. Operator
   pulled it (PR #218) saying *"I feel we can remove the export csv or
   the entire CSV option for auditing as of now. Not required. I will
   tell you later what to do when it comes to auditing later."*
   ➜ **Rule**: Don't preemptively add export / CSV / download features
   to admin or audit surfaces. Wait for explicit direction. Operator
   has a sequencing plan and will surface those when ready.

2. **Don't continue with tasks the operator has paused via screenshot.**
   I outlined Tier 1 #5–#9 as "pending" in a status table. Operator
   replied with the screenshot: *"Wait. Dont do the tasks mentioned in
   the image. SKip that for now. Add to some .md file and we will
   continue later (when I ask you to do so)."*
   ➜ **Rule**: When the operator shares a screenshot or image with a
   table/list, treat every row in it as a discrete instruction. If they
   say "skip these," park the items in a `TODO_*.md` file with an
   `ON HOLD` status and **stop suggesting follow-on work in the same
   area** (e.g., extraction prompts, ingestion pipelines, UI population)
   until explicit "resume" instruction.

3. **Don't bundle unwanted features into a multi-feature PR.**
   PR #216 stacked filter chips + bulk-batch peek + CSV export. Operator
   liked the first two; the CSV had to come back out as a separate PR.
   ➜ **Rule**: When stacking multiple features in one PR, ask whether
   each independently earns its place. Default to one PR per logical
   concern. The cost of an extra PR is low; the cost of removing one
   feature from a merged blob is paid in tests, copy, and reviews.

4. **Don't call `ExitPlanMode` for status reports.**
   I wrote a "what's pending" plan and called `ExitPlanMode` — operator
   rejected the tool use and asked me to just execute the items shown
   in the table.
   ➜ **Rule**: Plan mode is for "I'm about to write code, here's the
   approach" plans. For "what's the state of X" surveys / status
   reports, just respond directly. Don't end with `ExitPlanMode`.

5. **Don't re-list applied migrations as pending operator actions.**
   I caught myself surfacing migrations the operator had already
   applied. They confirm with "Success" or "Success. No rows returned"
   — log that and remove from pending.
   ➜ **Rule**: Track migration application state. When operator says
   "Success," move the row out of pending immediately and update
   `TODO_MANUAL.md` if the entry was there.

---

## Stated preferences (from this session + handoff doc)

### Voice / interaction
- **Brutal honesty over polish.** No padding, no "I'll continue with…"
  preamble, no generic summaries.
- **Concise responses to short questions.** "Link pls" → just give the
  link. No surrounding paragraph.
- **Specific over abstract.** Cite PR numbers, file paths, exact row
  counts, exact migration filenames. Never "I think there are several
  things pending."
- **Action over planning.** Auto mode is the default. Ship, don't
  propose. If asked "what's pending," answer the question; don't
  pivot into "should I do X?".

### Sequencing
- **One PR per logical concern.** Stack two only if they share an
  obvious theme.
- **Multi-step batches when given the green light.** Phrase that
  unlocks autonomous batched work: *"Do multiple steps/tasks together
  that is convenient for you and best for the website, goes well
  together. Verify if it works and then push+commit+deploy."*
- **Verify before claiming done.** `cd backend && npm test` +
  `cd frontend && npm test` + `cd frontend && npm run build` clean.
  PR merged via auto-merge or squash-merge. Master synced. Only then
  is the work "done."
- **Cross-reference against the original handoff doc.** Don't invent
  new tasks unless explicitly asked. The handoff is the source of
  truth for what's pending.

### Output format after each shipped task
- **Plain-English recap rule** (from `CLAUDE.md`): 2–4 short bullets in
  chat right after a PR merges. Lead with what the operator can now
  see / do / trust. No jargon.
- **PR body** must include "Plain English: what the user can see now
  that they couldn't before" — separate from the technical summary.
- **`SESSION_LOG.md`** appended at the end of every session with: what
  was worked on, plain-English recap, PRs opened/merged, operator
  actions, test counts, what's left.

### Operator's confirmation patterns
- **Migration applied** → "Success" or "Success. No rows returned"
- **Wants raw migration URL** → provide GitHub raw link
  (`raw.githubusercontent.com`) for paste-into-Supabase, not the blob
  URL.
- **Wants something paused** → screenshot of the table row(s) +
  "skip" / "pause" / "later". Park in `TODO_*.md`.
- **Wants something resumed** → explicit "resume Tier 1 #X" or
  similar. Don't pre-pick which paused item to resume.

---

## Anti-patterns to avoid

| ❌ Don't do this | ✅ Do this instead |
|---|---|
| Call `ExitPlanMode` for status surveys | Answer directly, ask follow-up if needed |
| Bundle 3 features in 1 PR when 1 might be unwanted | Default to one PR per concern |
| Suggest follow-on work on paused items | Stop. Wait for explicit resume. |
| Re-list applied migrations as pending | Track + prune as operator confirms |
| Verbose response to "Link pls" | Just the link |
| Propose next steps when operator asked "what's pending" | Pure status report; recommend at the end if useful |
| Ship CSV / export features without being asked | Wait for explicit direction on export sequencing |
| Push directly to master | Always feature branch + PR + squash-merge |
| Skip the recap after a PR lands | 2–4 plain-English bullets, every time |
| Mention TodoWrite reminders | Ignore them silently |

---

## Things I'd do differently next time

1. **Status report mode**: when the operator asks "what's pending" or
   "anything left from the original plan," structure the answer as a
   clean table:
   - ✅ DONE end-to-end (with PR refs as evidence)
   - 🟡 PARTIAL (with the specific gap)
   - 🔴 NOT STARTED (with the smallest first PR)
   - ⏸ ON HOLD (operator-paused — never continue without explicit ask)
   - 🚫 SKIPPED (operator declined — don't propose again)

2. **Batched-PR proposal protocol**: before shipping a multi-PR batch,
   say:
   > "I'll ship: PR A (X), PR B (Y). Each is independent. Going."
   ...not...
   > "Should I ship PR A + B?"

   Same protocol but it makes the action posture explicit. Saves a
   round-trip.

3. **GitHub link defaults**: when sharing a migration / SQL file,
   default to BOTH the blob URL (for review) AND the raw URL (for
   paste-into-Supabase). Operator's pattern proves they want the raw.

4. **Operator-paused stream tracking**: keep an "ON HOLD" section at
   the top of `TODO_DATA.md` (or wherever the paused items belong)
   with:
   - the original task ref
   - what's already scaffolded (don't repeat work)
   - what's specifically paused (what NOT to do autonomously)
   - the resume signal (operator-supplied phrase)

5. **Don't stack the recap rule with the PR-body rule**. They're
   separate. PR body = technical + plain-English. Chat recap = ONLY
   plain-English bullets.

6. **`mcp__ccd_session__mark_chapter`** is useful for multi-PR batches.
   Use it once per logical PR scope, not once per atomic edit.

7. **When operator shows a screenshot, treat every visible cell as a
   discrete unit.** If the screenshot has 5 rows, all 5 are paused —
   not just the highlighted one.

---

## Project conventions worth re-stating (from CLAUDE.md + MEMORY.md)

- **Bengaluru first, India second.** Multi-city is deferred. Asset-class
  is the primary nav axis.
- **No fabrication, ever.** Numerical math is deterministic JS, never
  the LLM. Every market / GIS / financial fact must trace to a verified
  source. "We don't know" is always a valid answer; a confidently-wrong
  number is never.
- **No defensive UI copy.** No "Acureal is correctly withholding…", no
  migration filenames in user-facing copy. Hide empty sections cleanly.
- **Bloomberg / Stripe / Linear register.** Flat by default, hairline
  borders, semantic tokens, restrained accent use. No decorative emojis,
  no gradients on hero tiles, no spinner-for-skeleton.
- **Append-only audit trails** for everything material (deal_events for
  financial computations; deal_audit_log for mutations). RLS grants
  SELECT + INSERT only.
- **Idempotent migrations.** `CREATE TABLE IF NOT EXISTS`,
  `DROP POLICY IF EXISTS`, soft-fail on `42P01` in service code.
- **Single worktree across sessions.** Don't spawn new worktrees.
- **Apply migrations via Supabase SQL editor** — operator approves;
  agent does not bypass.

---

## Current state at end of 2026-05-10 session

After PRs #214 → #223:
- ✅ Original handoff doc Tier 0, Tier 1 (excl. #5–#9 ON HOLD), Tier 2
  all shipped end-to-end.
- ⏸ Tier 1 #5–#9 ON HOLD per operator (see `TODO_DATA.md`).
- 🆕 Two operator actions outstanding (see `TODO_MANUAL.md`):
  apply `20260526_ab_eval_runs.sql`, optionally run
  `upgrade-comps-geocoding.mjs --apply --allow-cross-locality`.
- Backend: 1198 tests pass.
- Frontend: 360 tests pass.
- Production build clean.

Next-batch candidates that don't touch ON HOLD work (don't pick
autonomously without operator nod):
- Org-wide `/admin/audit` page on top of `deal_audit_log`.
- "Recent activity" Dashboard widget for the signed-in user.
- Workspace / Team page + invite flow for user #2.
- Existing-user re-acceptance modal when a new legal-doc version
  publishes.

---

_Last updated: 2026-05-10. Append to this file (don't rewrite)
when new corrections / preferences land._
