# FORGE — Dashboard Layout Spec

**Status:** draft v1 — dashboard only (reward/level-up spec comes next)
**Basis:** PRODUCT_DESIGN.md (7 design rules) + UI references (Duolingo, LinkedIn daily, Pokemon, Free Fire, Hollow Knight, Minecraft, Notion-as-negative)
**Source files:** index.html `view-dashboard` (lines 128–231), app.js `renderDashboard`/`renderCurrentTask` (lines 216–315)

---

## The dashboard's job

Answer the morning question — **"what do I do today?"** — in 3 seconds, and make starting so obvious it feels like a game lobby, not a todo app.

**The 3-second contract (from design rule 1):**
1. TODAY'S OBJECTIVE — the quest card (the hero)
2. ▶ START — the button, in the thumb zone
3. The identity hook — streak flame, coins, rank, XP bar (the "don't break it" pull)

---

## Mobile wireframe (primary — phone, ~480px, top to bottom)

```
┌──────────────────────────────────┐
│ FORGE                  🔥 12      │  ⬅ identity strip row 1 · retention hook, top-right
│ INITIATE · HAKATA     ◎ 340       │  ⬅ row 2 · rank/name + coins
│ ████████░░░  LVL 3 · 340/500 XP   │  ⬅ XP bar · progression, always on
├──────────────────────────────────┤
│  TODAY'S OBJECTIVE               │
│ ┌──────────────────────────────┐ │
│ │  [ACAD] C EXAM PREP          │ │
│ │  Finals: revise ch. 5        │ │  ⬅ HERO quest card
│ │  ★★ MEDIUM    ·  3 in queue  │ │
│ └──────────────────────────────┘ │
│    ⚡ 180 XP to next rank         │  ⬅ the "one more session" pull
│                                  │
│     ╔══════════════════════╗     │
│     ║   ▶  START SESSION   ║     │  ⬅ THE button · biggest thing on screen
│     ╚══════════════════════╝     │
│                                  │
│  TODAY'S QUESTS   (2/5 done)     │
│  [ACAD] revise ch. 3      ★      │
│  [GAME] collision system  ★★★    │  ⬅ tap a quest → becomes the objective
│  [OTHER] laundry          ★★     │
│                                  │
│  + ADD QUEST                      │  ⬅ expands quick-add (pillar/diff/input)
└──────────────────────────────────┘
```

---

## What goes where, and why

### 1. Identity strip (top) — from: Free Fire lobby + Duolingo + Minecraft XP bar
Compact, always on, **decision-serving only**:
- **Streak flame 🔥 top-right** (Duolingo). Retention is the product's engine — the flame is the "don't break it" guilt. It's the first thing the eye should find.
- **Rank + name** — identity (Q6 #3, "the identity thing"). Rank titles ARE the identity reward.
- **Coins ◎ with a visible number** (Free Fire) — coins feel worthless when hidden; a number on screen says "your balance matters."
- **XP bar under it** (Minecraft) — always-visible progression to the next level. Slim, not chunky.

### 2. TODAY'S OBJECTIVE + START (center) — the hero — from: Free Fire lobby + Duolingo single-CTA
This is the focal point. The one thing Forge exists to do.
- **The quest card**: pillar badge (color-coded), task text, difficulty stars, queue count, **goal breadcrumb** (the "→ leads to my goal" promise from Q8).
- **"⚡ X XP to next rank"** under the card — the "one more session" pull. Links the identity hook to the action.
- **▶ START SESSION — the biggest element on screen**, in the lower-half thumb zone. One button, unmissable. Disabled only when no quest is set (never invisible).

### 3. TODAY'S QUESTS list — from: Free Fire mission list + LinkedIn daily
The "big chunk of goal divided into small chunks" (Q8) made visible.
- Flat list of pending tasks: pillar color chip, text, difficulty stars.
- **Tap a quest → it becomes the objective** (updates the hero card, then START). This replaces the old "SWITCH" flow — fewer taps, no separate screen.
- Header shows progress: **"(2/5 done)"** — a built-in "clear your quests = day done" moment, no scheduler needed.

### 4. + ADD QUEST (collapsed) — the loop's entry
- One affordance at the bottom. Expands into input + pillar chips + difficulty + ADD (the existing quick-add, just tucked away so it doesn't compete with the hero).
- On add: the task **instantly appears in TODAY'S QUESTS with a toast/flash** (Minecraft toast). This is the fix for "add a task → nothing happens."

---

## What we removed, and why (design rule 6: "need somewhere" ≠ "first screen")

| Removed from surface | Where it lives now | Why |
|---|---|---|
| The 3 stat boxes (SESSIONS / TODAY / BEST STREAK) | Combat Log (one tap) + the "(2/5 done)" counter | Stats don't serve the 3-second *decision to start*. They're proof, not a call to action. |
| Quick-add controls (pillar chips, difficulty) in the open | Collapsed behind **+ ADD QUEST** | They compete with the hero. They appear only when adding. |
| "QUICK ADD TASK" label / dead styling | Folded into the + ADD QUEST affordance | Was taking prime vertical space. |
| Nav clutter in the drawer | Drawer keeps PLAN / TASK QUEUE / COMBAT LOG / ARMORY / SYSTEM CONFIG | Secondary screens stay one tap deeper. |

---

## Empty states (a funnel, not a wall)

1. **Brand-new user (no pillars/goals):** hero card becomes → "FORGE YOUR FIRST GOAL" → jumps to PLAN. (Duolingo: first lesson is a CTA, not a blank screen.)
2. **Goals exist, no tasks:** → "ADD A QUEST TO C EXAM PREP" — pre-links the task to the goal.
3. **All quests done:** → "QUESTS CLEARED ✓" celebration — the day's done, come back tomorrow (streak fires here). This is the LinkedIn-daily loop: one clear daily goal, then rest.

---

## Desktop adaptation

Rail (left sidebar) stays as the persistent identity block: rank/name, XP bar, coins, streak, nav. Main area shows the same hero + quest list in a wider, 2-column arrangement: quest card + START on the left, TODAY'S QUESTS on the right. Same hierarchy, same 3-second contract.

---

## Decisions (confirmed 2026-08-11)

1. **"TODAY'S QUESTS" = pending queue.** Clearing the list = day done. ✅ User accepted for now, **expects to change later** (see Future changes).
2. **Rank names — theme-dependent stays, but ANIME → One Piece themed.** ✅
3. **Quest list: flat for v1.** Grouped under goals later (goal A → its tasks, goal B → its tasks). ✅

### ANIME theme ranks → One Piece (draft proposal)

User wants the ANIME theme to use One Piece as reference (currently shinobi ranks). Draft 8-rank Pirate progression matching the canonical 8 ranks — user to confirm/tweak names:

| Level | Canonical | ANIME (One Piece) |
|---|---|---|
| 1 | INITIATE | CABIN BOY |
| 3 | APPRENTICE | SAILOR |
| 6 | OPERATOR | PIRATE |
| 10 | SPECIALIST | SUPER ROOKIE |
| 15 | VETERAN | CAPTAIN |
| 20 | ELITE | WARLORD |
| 30 | COMMANDER | EMPEROR |
| 50 | LEGEND | PIRATE KING |

*(Pirate King as the capstone — the "I am the king" identity moment. Names are a draft; finalize in the theme/identity phase.)*

## Future changes (parked, user confirmed they're coming)

- **Per-day task scheduling** — the "today" concept will get real later (when AI task-generation / prioritization arrives). For v1, clearing the queue = day done.
- **Quest list grouped by goal** — goal A → task list, goal B → task list. v2+.

---

---

# FORGE — Reward Screen Spec (the one moment to nail)

**Job:** make "I just finished a session" feel like real achievement (Q4). The feeling IS the payout (rule 3). Fix "leveling feels nothing" (Q8) with an identity ceremony.

**References:** Pokemon level-up ceremony (dedicated moment + fanfare) · Free Fire payout (loud, single hero) · Duolingo streak (flame) · Minecraft toast (task-done stamp).

## The core principle: the reveal is a SEQUENCE, not a dump

The current reward screen shows every number at once — that's why it feels flat. Games make you *feel* it by pacing it: build-up → hero → cascade → decision. Every beat is timed (JS), so the screen plays like a moment, even before you tap anything.

**Source file:** index.html `view-reward` (lines 352–397), app.js reward logic.

## The sequence (timed beats)

| Beat | Timing | What happens | Feel |
|---|---|---|---|
| 0 | 0.0s | "SESSION COMPLETE" + **the task you just did** (pillar badge + text) | Context: "I did THIS." |
| 1 | 0.3s | **+XP counts up** — THE hero, huge, center, chime | The payoff. The one thing your eye lands on. |
| 1b | 0.9s | ⚡ FOCUS BONUS chip pops (if earned) | Surprise = delight |
| 2 | 1.2s | **+coins** and **🔥 DAY STREAK** slide in as small chips | Proof, not decoration |
| 3 | only if level-up / rank / streak milestone | **LEVEL UP ceremony block** (fanfare + particles + rank change) | The identity moment — "I'm a PIRATE now" |
| 4 | 2.5s+ | **"IS THE TASK DONE?"** → CONTINUE / TASK DONE | The action. |

## Wireframe

```
[SESSION COMPLETE]                     ← beat 0 · small, top
[ACAD] Finals: revise ch.5             ← the task you just did

             +120 XP                   ← beat 1 · THE hero · counts up
             ⚡ FOCUS BONUS            ← 1b · surprise chip (if earned)

        +15 ◎     🔥 12 DAY STREAK     ← beat 2 · chips slide in

   ┌────────────────────────────┐
   │     LEVEL UP!  LVL 3       │    ← beat 3 · ONLY on level-up
   │   APPRENTICE ▸ OPERATOR    │       fanfare + particle burst
   └────────────────────────────┘

        IS THE TASK DONE?               ← beat 4 · the decision
   [ ↺ CONTINUE ]   [ ✓ TASK DONE ]
```

## What we keep vs. change

**Keep (already built):** +XP, coins earned, focus bonus, level-up banner, rank change, freeze-award, streak, task-decision buttons.

**Change:**
1. **Order** — beats instead of all-at-once. The screen *plays*, it doesn't *list*.
2. **Hierarchy** — +XP is the ONLY hero. **"TOTAL SESSIONS" stat removed** from this moment (a number without meaning here — it belongs in Combat Log).
3. **Motion** — count-up on XP, slide-in on chips, particle burst on level-up, ✓ stamp on task-done.
4. **Sound** — a chime per beat (sound.js already synthesizes — add a level-up fanfare).

## The level-up ceremony (the identity fix)

Level-up is NOT a text line — it's **a block with its own beat**: "LEVEL UP! LVL 3 — APPRENTICE ▸ OPERATOR" with fanfare + particles. This is the difference between *"leveling feels nothing"* (current) and *"I'm a PIRATE now"* (goal). In ANIME theme: "CABIN BOY ▸ SAILOR" — the identity reward, real.

## What the ceremony does NOT include (v1 scope)

- Coins still don't buy anything meaningful (user-defined reward spending = future feature, separate).
- No boss fights yet (vault). The level-up block IS the "achievement moment" until they arrive.

## Implementation notes (for the UI build phase)

- Timed sequence via `setTimeout` chain / small state machine — no library.
- Count-up: `requestAnimationFrame` animator (~10 lines).
- Particle burst: reuse existing `xp-particle`.
- Sound: sound.js has tones; add a 3-note level-up fanfare.

---

# FORGE — Start-Session Flow Spec (the intention ritual)

**Job:** get from dashboard to "locked in, working" in **2–3 taps** (rule 2) while keeping the "I will..." declaration sacred. The intention is the soul of the product — it forces specificity and kills decision fatigue. This flow makes writing it *feel* like a declaration, not a form.

**References:** game "Ready up" screens (mission shown, then accept) · Pokemon "Go, [pokemon]!" (commitment moment) · Duolingo (one clear action).

**Current flow:** dashboard → tap START → intention view (task + SWITCH + session length + linked-goal selector + textarea + 2 buttons) → LOCK IN → session. The screen works but reads as a *form* — too many choices compete with the ritual.

**Source file:** index.html `view-intention` (lines 236–283), app.js intention logic.

## The core principle: it's a RITUAL, not a form

Everything is already decided by the dashboard — the mission, the goal, the default length. The flow's only real jobs: **confirm the mission, pick a duration, declare.** Anything that makes you re-decide is friction to cut.

## Wireframe

```
┌────────────────────────────────┐
│  MISSION BRIEF                 │  ← ritual header
│  [ACAD] Finals: revise ch.5    │  ← your mission (already decided)
│    ▸ C EXAM PREP               │  ← goal breadcrumb · context, NOT a selector
│ ───────────────────────────────│
│  SESSION LENGTH                │
│   ( 25m | 50m | 90m | custom ) │  ← one tap · 50m pre-chosen
│ ───────────────────────────────│
│  DECLARE:                      │
│  I will _revise ch.5________   │  ← big centered line · "I will" prefix locked
│  "specific beats vague"        │  ← micro-hint
│ ───────────────────────────────│
│  [← CANCEL]    [⚔ LOCK IN ▶]   │  ← LOCK IN = the hero · commitment language
└────────────────────────────────┘
```

## Element decisions

1. **"I will" is a locked prefix + inline input.** The user never types "I will" — the app renders `I will {input}` as one big declaration line. The input **pre-fills with the task text** (editable), so writing the intention is near-zero friction but the *declaration ceremony* stays. The ritual is the sentence, not the typing.
2. **Mission is context, not a form.** Task + pillar + goal breadcrumb shown as your mission (from the dashboard's quest tap). The **SWITCH button becomes a small fallback** under the mission — the dashboard quest list is the primary switcher now.
3. **Goal selector REMOVED from the flow.** The goal comes from the task (set when the task was created under a goal). The flow shows it as breadcrumb; it never asks you to re-pick. One less decision, matches rule 2.
4. **Session length: one tap, 50m default.** Presets stay (25/50/90/custom). Nothing new — just no friction around it.
5. **CANCEL is quiet, LOCK IN is the hero.** "⚔ LOCK IN ▶" — commitment language, not "Save." Cancel is a ghost button.

## The transition: LOCK IN → session

On LOCK IN: brief **"✓ INTENTION LOCKED"** stamp (one beat, ~500ms), then straight into the session — no countdown, no extra screen (rule 2). The session screen then shows the full intention persistently: *"INTENTION: I will revise ch.5"* (already exists as the session-intention bar — it's the Q8 echo, keep it).

## Loop rhythm (the full arc, for reference)

Dashboard (see the quest) → **LOCK IN** (declare) → focus session (distraction-free ring) → **reward ceremony** (the moment) → break (simple, skippable) → back to dashboard. Break stays as-is: 5/10/20 + SKIP — it's the "step away" moment, not a screen to redesign.

## Implementation notes (UI build phase)

- The `I will {input}` line: a prefix span + inline input styled as one sentence (flex layout, no library).
- Pre-fill = current task text; user can edit in place.
- "✓ INTENTION LOCKED" stamp: reuse the toast/flash pattern already in app.js.

## Next phase: VISUAL DESIGN

Layouts are specced (dashboard, reward, start-flow). Next is the **look**: the forge industrial-cockpit aesthetic — colors, type, texture, how the FORGE (orange), VENOM, HACKER, etc. themes map onto these screens. Then UX flows, then build.
