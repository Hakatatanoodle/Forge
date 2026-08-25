# FORGE — UX Flows Spec

**Status:** v1 — final planning phase. Ready to plan the build.
**Basis:** PRODUCT_DESIGN.md · UI_LAYOUT.md · VISUAL_DESIGN.md · app.js/timer.js/sound.js (what already works).
**Job:** wire the Q8 promises ("when I ___ I see ___") into exact interactions. Every flow = user action → app response, so the build has behavior to code, not vibes.

---

## 1. The interaction language (shared micro-interactions)

| Interaction | What it is | Where it's used |
|---|---|---|
| **Toast** | small, ~2s, Minecraft-advancement style | "QUEST ADDED ✓", "INTENTION LOCKED", "LEVEL UP", errors |
| **Flash** | button/target pulses (app.js `flashElement` exists) | add-task button, quest tap |
| **Count-up** | XP animates 0→N via `requestAnimationFrame` (~10 lines) | reward Beat 1 |
| **Slide-in** | chips ease in | reward Beat 2 |
| **Particle burst** | reuse existing `xp-particle` | level-up ceremony |
| **Pulse CTA** | empty-state button gently pulses | first-run funnel |
| **Chime** | sound.js tone per action (add a 3-note level fanfare) | add, lock-in, reward beats |

These are the only building blocks. Every flow is composed from them.

---

## 2. The flows

### Flow A — First run (new user → first session in one sitting)

1. Open app → **CONNECTING...** (Google sign-in) with **ENTER OFFLINE** fallback visible.
2. Land on dashboard → empty state: *"FORGE YOUR FIRST GOAL"* → **pulsing CTA** → PLAN mode.
3. Create pillar (pre-focused name input) → create goal → add a task under it.
4. Return to dashboard → the task is now **the objective** (hero card) — the empty state is replaced by a real quest.
5. START → intention → LOCK IN → **first session on day one.** Onboarding is not a wall (Duolingo rule).

### Flow B — Morning routine (returning user) — THE money flow

**Tap budget: 2–3 taps to working (rule 2).**

1. Open app → dashboard loads <1s → **identity strip** (streak flame 🔥 top-right, coins, rank, XP bar).
2. **Hero quest card** shows the next objective (persisted from last session).
3. **TODAY'S QUESTS (2/5 done)** — pending tasks with pillar color + difficulty stars.
4. **Tap a quest** → it becomes the objective: hero updates + subtle highlight (1 tap). *Switching objectives no longer needs the task screen.*
5. **Tap START** (2 taps) → intention screen: "I will _revise ch.5__" pre-filled → confirm or sharpen.
6. **LOCK IN** (3 taps) → "✓ INTENTION LOCKED" → session starts, intention echoed in the bar.
7. Open → 3 taps → working in ~10 seconds.

### Flow C — The session

1. Focus ring counts down **wall-clock** (throttling-proof, timer.js — keep as-is).
2. **Intention bar** shows the declaration persistently ("I will revise ch.5") — the Q8 focus promise, visible the whole time.
3. **HOLD** → overlay "SESSION ON HOLD" + 5min auto-resume countdown → RESUME. The "step away for a second" guardrail.
4. **ABANDON** → confirm modal *"Abandon session? Progress is lost"* → confirm → back to dashboard, no XP, task stays.
5. **App closed mid-session** → timer survives (wall-clock). Reopen restores session state — no "fix your app" day (rule 7).
6. During the session the screen is minimal (Hollow Knight) — no nav, no drawer, no stats. One task, one timer, one intention.

### Flow D — Complete → reward ceremony (the moment, timed beats)

1. **COMPLETE** → reward screen plays, no input needed until Beat 4:

| Beat | Time | On screen | Feel |
|---|---|---|---|
| 0 | 0.0s | "SESSION COMPLETE" + task (pillar badge) | "I did THIS" |
| 1 | 0.4s | **+XP counts up** + chime | the payout |
| 1b | 0.9s | ⚡ FOCUS BONUS chip (if earned) | surprise |
| 2 | 1.4s | +coins + 🔥 streak slide in | proof |
| 3 | ~1.8s | **LEVEL UP ceremony** (if leveling): fanfare + particles + rank/bounty change | identity |
| 4 | after ceremony | **"IS THE TASK DONE?"** → CONTINUE / TASK DONE fade in | the decision |

2. **TASK DONE** → task gets a **✓ stamp** + bonus-XP chime → task leaves TODAY'S QUESTS → **hero auto-advances to the next quest** (getNextTask).
3. **CONTINUE** → task stays; next session picks it up.
4. → **Break** (5/10/20, skippable — keep as-is) → back to dashboard: quest list refreshed, streak incremented, **streak flame still burning** (the "come back tomorrow" pull).

### Flow E — Level-up identity ceremony (inside the reward, Beat 3)

- **FORGE theme:** "FORGED LVL 3 — APPRENTICE ▸ OPERATOR" + fanfare + particles.
- **ANIME theme:** "BOUNTY INCREASED: 500,000,000" — poster flash, not a notification.
- Dashboard identity strip updates to the new rank on return. This is the "leveling feels nothing" fix, delivered.

### Flow F — Add a quest (quick-add, dashboard)

1. **+ ADD QUEST** → expands: input + pillar chips + difficulty (defaults: current pillar, EASY).
2. Type → ADD → **task appears instantly in TODAY'S QUESTS** + toast "QUEST ADDED ✓" + chime. *(The "add a task → nothing happens" bug, killed.)*
3. If the list was empty → hero card updates to the new task as objective immediately ("a big chunk of goal divided into small chunks" — the clarity promise).

### Flow G — Add a task under a goal (plan mode)

- Task created under a goal gets `goalId` → on the dashboard it shows the **"▸ GOAL" breadcrumb** (Q8: "finishing a task that leads to my final goal" — made visible on every quest).

### Flow H — Navigation & loop rhythm

- Drawer: FORGE / PLAN / TASK QUEUE / COMBAT LOG / ARMORY / SYSTEM CONFIG — secondary screens one tap deeper (rule 6).
- Loop: dashboard → LOCK IN → session → reward → break → dashboard. After a session, always auto-return to dashboard (the streak flame greets you).

---

## 3. Q8 promise validation (every promise → where it's delivered)

| Q8 promise | Delivered by |
|---|---|
| "I add a task → I see things clearly, goal broken into chunks" | Flow F (instant appear + toast) + quest list = the chunks |
| "I start a session → I see it leads to my goal, I focus better" | Flow B/G (goal breadcrumb) + Flow C (intention bar) |
| "I finish → sense of completion, I can do more later" | Flow D (ceremony + streak flame on return) |
| "I level up → I feel something" | Flow E (identity/bounty ceremony) |

---

## 4. Reliability checklist (rule 7 — Forge never becomes the day's distraction)

- [ ] Offline/guest entry always reachable on onboarding.
- [ ] Firebase down → full local operation, no modal walls (built).
- [ ] Mid-session app close → wall-clock timer restores, no data loss.
- [ ] Errors surface as toasts, never blocking modals.
- [ ] Streak "at risk" state visible (exists) so a freeze is used, not lost.
- [ ] Data reset confined to Settings → Danger Zone.

---

## 5. What this unblocks

The build phase can now be task-planned against concrete behavior:
1. Dashboard rebuild (layout + identity strip + hero + quest list + quick-add)
2. Reward ceremony (timed beats + count-up + level-up block)
3. Start-session flow ("I will" prefix line + LOCK IN)
4. Theme system extension (new roles + One Piece + per-theme type)
5. Interaction layer (toast, count-up, slide-in, fanfare)
6. Empty states + first-run funnel

All inside the existing codebase — **timer.js, xp.js, storage.js, firebase.js untouched.**
