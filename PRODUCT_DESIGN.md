# FORGE — Product Design Spec

**Status:** ✅ complete — all 4 groups answered (2026-08-11). Ready for UI phase.
**Method:** answer one group of design questions at a time; each answer becomes a buildable decision for UI → UX.

---

## Group 1 — Identity

### Q1. The one job

> "Something that helps me **just do it** — reduce friction as much as possible."

**Vision scenario (user's words):**
> "I wake up in the morning, the first thing I do is open the Forge dashboard, see what I have to do today, and start a session."

**Core principle: REDUCE FRICTION.** Every screen, element, and flow gets measured against one test:
*Does this add a step between opening the app and working?*

### Q2. The core loop

Two loops — one per audience:

**New user (day one):**
Sign in → set up pillars/goals → add tasks to those goals → pick a session length → start.

**Returning user (steady state):**
Open dashboard → see today's tasks → pick one → start.

### Design implications (derived, to be confirmed in UI phase)

1. **The dashboard's #1 job is to surface TODAY'S TASKS immediately.** This is the focal point. The morning question Forge answers is *"what do I do today?"* — so today's work sits at the center of the dashboard, not stats.
2. **Path from "open app" to "working" must be minimal taps** — target 2–3 taps for a returning user. Anything more is friction.
3. **Onboarding is not a wall.** Setup (pillars/goals) must move fast and get the user into a real session on day one — otherwise they close the tab.
4. **"Add a task → nothing happens" is a friction bug.** Every action needs an immediate, visible response. Feedback isn't polish; it's the product.

---

## Group 2 — The user & the moment that matters

### Q3. Who is the user?

> "It's basically me. Wants as little friction as possible — open and start. Main problem: my phone. I procrastinate a lot, so if it's gamified, it actually feels like *'yeah, I gotta do it for the XP / for the score.'*"

**Persona: ME — a phone-driven procrastinator.**
The phone is both the tool **and the enemy**. Gamification (XP, score, streak) is the motivation engine that overrides procrastination. The user opens Forge *on the device they procrastinate with* — so friction must be near-zero, because the phone itself is the alternative.

### Q4. The one moment to nail

> "The reward screen. It should feel like I actually achieved something after completing a session."

**The reward screen is the emotional core of the product.** This is where all the polish goes. It's the payoff that makes the whole XP/score/streak loop believable — the moment that makes the user close the session satisfied and start the next one. Everything else gets functional effort; this gets 10/10.

### Q5. What failure is Forge preventing?

> "Abandoning mid-session. Not showing up. Losing a streak. Suddenly getting distracted during a session. Suddenly a random error popping up in Forge — and instead of studying, I spend all day fixing it."

**The failure modes:**
1. **Abandoning mid-session** → the session is left uncompleted (the timer's Hold/Abandon is the current guardrail — plus a gentle "what happened?" re-entry).
2. **Not showing up / losing a streak** → the app needs forgiveness + a nudge to get back in (streak freezes exist; consider re-entry prompts).
3. **Mid-session distraction** → the session itself must hold attention (timer, hold flow, minimal UI during session).
4. **Forge breaks / random error → user spends the day fixing it.** ⚠️ This is the hidden one: **the app must never become the day's distraction.** Reliability is a feature. No errors mid-flow, offline mode must just work, no hard dependency on Firebase being up.

### Emerging product thesis

> **Forge is a gamified anti-procrastination execution engine for a phone-addicted person.** The reward screen is the emotional payoff, the streak/XP loop is the motivation engine, and the whole product must be so low-friction and so reliable that it never becomes another reason not to work.

## Group 3 — The dashboard & feedback

### Q6. What does the user need in the first 3 seconds?

Ranked:
1. **Today's tasks** — "what do I have to do today."
2. **Start session** — the action. Obvious why.
3. **The motivation hook** — XP / streak / coins / some *identity thing* that makes the user click Start immediately. (User uncertain — this is the open slot.)

**Future idea (captured, NOT building now):** AI that auto-generates a task list from a goal, or prioritizes today's tasks by priority / importance / deadline. Parked — would derail scope.

### Q7. Decoration vs. decision

**User's instinct:** "Most of it is decision. I don't know about the system config, but everything else looks important — I'd need them for sure."

**Sharper lens applied (derived decision):** *"I'd need it somewhere"* ≠ *"it earns the first screen."* Everything the user listed is needed *somewhere* (settings, history, shop screens) — but the dashboard surface only shows what serves the 3-second decision from Q6. Everything else lives **one tap deeper**. Final call on what earns dashboard space happens in the UI phase, against this rule.

### Q8. The promises (the UX contract)

> **Add a task** → *"I immediately see things more clearly. I can see what I have to do and work on it easily — a big chunk of goal is divided into small chunks."*
> **Start a session** → *"I see I am finishing a task that leads to my final goal, and I can work and focus better."*
> **Finish a session** → *"I see the XP and coins — which really doesn't do much right now, since I can't buy actually good stuff with it. But there's a sense of completion: I put in the work, and I can do more sessions later."* ⚠️
> **Level up** → *"Honestly I feel nothing, since leveling up doesn't bring a lot of new things."* ⚠️

### ⚠️ Product finding: the reward economy is hollow

**The user's own words say it:** coins buy nothing that matters, leveling unlocks nothing, XP is just a number. The reward screen (Q4: *the one moment to nail*) currently delivers only a bare "sense of completion." The motivation engine the whole thesis depends on is **running on empty**.

### What should XP, coins, and levels DO? — user's answers

**A. Identity — YES.** *"Identity is sure one of it, because it matters."* If many users: a ranked lobby — *"I'll study more hours than this guy."*
→ **Near-term:** identity IS the level-up reward (rank titles, visible presence). Competitive leaderboards = future, needs multi-user.

**B. Real-money staking — user calls it "a dangerous thing."** Deposit real money (mobile banking / eSewa), earn it back by spending coins earned from sessions.
→ ⚠️ **Flagged: high-risk + huge scope.** Payment integration, wallet, transactions, compliance. Honest counsel: staking psychology (loss aversion) *backfires* on procrastinators — losing your own money makes you avoid the app entirely, which is the exact failure Forge exists to prevent. A virtual stake captures ~80% of the effect with none of the risk.
→ **Bridge:** coins buy *user-defined* rewards — "500 coins = guilt-free movie night." Real weight, zero payments.

**C. Boss fights — the ORIGINAL vision (user's words):** *"With a new level you get a new enemy and you have to kill it — by completing sessions, tasks. At some levels, boss fights. I was so crazy about it. But for now it's very big scope."*
→ **Parked full version.** Soul preserved. Lightweight path later: the goal/week rendered as a boss whose HP bar fills as you complete tasks. The boss-fight reveal explains the "vision vs. reality" gap: the vision was huge, the buildable reality was a wall of JS — that gap is why work stopped. Product design is the tool that closes it.

**D. The moment itself — YES.** *"Even if you get nothing, the feeling of a task being completed is very good."*
→ **Near-term:** the reward screen ceremony IS the session payout. Make the feeling deliberate, not accidental.

### Near-term reward economy (proposed — pending user confirmation)

1. **Level-up = identity ceremony.** Rank title changes, visible celebration. Fixes "leveling feels nothing."
2. **Session-end = completion ceremony.** Recap (sessions, minutes, streak flame, rank progress). The feeling is the payout.
3. **Coins = user-defined rewards.** Spend on your own defined payoffs. Weight without payments.

### Vault / roadmap (not now)

- Boss fights (lightweight path later)
- Real-money staking (risk-flagged)
- Ranked lobby / leaderboards (multi-user future)

## Group 4 — Boundaries

### Q9. What is Forge NOT?

> *"Forge is not a productivity app like Notion. It's a **game where you play and waste your time studying**."*

**This reframes the product.** Forge is a game whose "fun" is studying — not a productivity tool wearing a game skin. The phone is the rival; the app steals your scrolling time for work and makes it feel like play.

**UI consequence (major):** the reference is **game UI** — lobby, quest board, reward screen, HUD — NOT Notion/Linear/productivity dashboards. This resolves the original "what should a professional dashboard contain?" question: a professional *game* dashboard.

### Q10. If you had to cut 3 features, what survives?

> *"Adding goals, adding tasks, and starting."*

**The survivors are the core loop:** goals → tasks → start session. Everything else (shop, themes, history, weekly summary, plan weeks) is **support** — secondary and protectable, but not load-bearing. The minimal product is the loop.

---

## Final product statement (synthesis of all 4 groups)

> **Forge is a game you play by studying.**
> It's for a phone-driven procrastinator — me — who opens the phone to waste time; Forge redirects that wasted time into work by making work feel like a game worth playing.
> **The loop:** set goals → add tasks → start a session.
> **The reward:** a completion moment that feels like real achievement — identity and ceremony, not just numbers.
> **The rules:** reduce friction to near-zero; never become the day's distraction (reliability is a feature); cut everything that doesn't serve the loop.

## Design rules (the "what goes where" source for UI)

1. **First 3 seconds** of the dashboard: today's tasks → start → the identity hook. Nothing else competes.
2. **2–3 taps** from opening the app to working. More is friction.
3. **Reward screen = the one moment to nail.** Completion ceremony: recap, streak flame, rank progress. The feeling IS the payout.
4. **Level-up = identity ceremony.** Rank title changes, visibly. This fixes "leveling feels nothing."
5. **Game UI, not productivity UI.** References: game HUDs, lobbies, reward screens — not Notion.
6. **"Need somewhere" ≠ "first screen."** The dashboard surface only serves the 3-second decision; everything else lives one tap deeper.
7. **Reliability is a feature.** Offline/guest mode must just work; the app never becomes the day's distraction.

## UI references (chosen 2026-08-11 — user delegated the pick)

Chosen from the user's own addiction list + the two proven retention apps. Rationale: these already live in the user's head — they know what each *feels* like — so we codify that feeling instead of borrowing stranger taste.

| # | Reference | Why it's in | What we borrow |
|---|-----------|-------------|----------------|
| 1 | **Duolingo** | The retention machine | The streak (flame, "don't break it"), single daily CTA, happy reward animation, every screen pushes toward ONE action. The game-ified habit template Forge is closest to. |
| 2 | **LinkedIn daily puzzle** (user has a 300-day streak) | Proof the loop works on the user | One small daily task, streak counter, daily reset, "come back tomorrow" pull. The user is literally living proof. |
| 3 | **Pokemon (GBA)** | The feel | The level-up ceremony (screen + fanfare + stat change), badge collection = visible trophies, grind feeding something bigger. The reward screen's soul. |
| 4 | **Free Fire** | The lobby + rank energy | Lobby as "here's what to do now" (mission list), rank tiers, loud reward payout, coins with visible value. The ranked-lobby idea lives here. |
| 5 | **Hollow Knight** | The look | Minimal HUD (only what matters), dark industrial forge mood — the FORGE aesthetic done with discipline. |
| 6 | **Minecraft** | Warmth + toasts | The "Advancement Made!" toast for level-up / task-done, the XP bar. |
| 7 | **Notion** (negative) | What NOT to do | Calm, clean, professional, *not addictive*. The "professional but dead" trap. Reference it to do the opposite. |

## Vault / roadmap (not now)

- Boss fights (lightweight path later: goal-as-boss with an HP bar)
- Real-money staking (risk-flagged — virtual stakes capture the psychology)
- Ranked lobby / leaderboards (multi-user future)
- AI task generation / prioritization by deadline & importance
