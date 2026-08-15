# Plan Mode Redesign — Audit & Migration Plan

Response to §27 of `PLAN_MODE_REDESIGN_SPEC.md`. Written before any code changes.

---

## A. Current implementation audit

### A1. Where Plan Mode lives

| Location | Lines | Contents |
|---|---|---|
| `index.html` 855–1029 | ~175 | `#view-plan`: 4-tab bar + 5 sub-view divs (`plan-view-pillars`, `-goals`, `-weekboard`, `-tasks`, `-weeks`) |
| `index.html` 524–~600 | ~75 | `#view-tasks` — the standalone Task Queue |
| `app.js` 1493–2370 | ~880 | 29 functions: plan routing, pillars, goals, weeks view, weekboard, move sheet |
| `app.js` 691–762 | ~70 | `renderTaskList()` — Task Queue, reused by plan TASKS tab via `target` arg |
| `style.css` | 158 rules | `.week-*`, `.plan-*`, `.pillar-*`, `.goal-*` |

### A2. The two competing scheduling models (the actual bug)

There are **two unrelated scheduling fields** on a task, and they do not talk to each other:

1. **`task.weekId`** → points into `state.weeks[]`. Set in the goal-drilldown "WEEKS VIEW". 28 references.
2. **`task.day`** (int 0–6, `getDay()`) → the "THIS WEEK" Mon–Sun kanban. 100% independent of `weekId`.

So the same task can sit in "WEEK 3" of a goal *and* on "Tuesday", with no relationship between those facts. And `task.day` is a **bare day-of-week integer with no date** — meaning last week's Tuesday task and next week's Tuesday task are indistinguishable. Tasks silently persist forever on their weekday. This is exactly the "duplicate representations" problem §21 calls out, and it's why overdue work is currently impossible to detect.

Worse: `addTask()` (line 620) and the mid-session drawer (line 1045) both default `day: new Date().getDay()`, so **every quick-added task auto-lands on today's column** whether or not the user meant to schedule it. There is no genuine "unscheduled" state today.

### A3. Week auto-generation

`app.js` 3363–3377 — on goal create, loops `_editingGoalWeekCount` (default 4) and pushes `{id, goalId, number, label:'WEEK N', fromDate:'', toDate:''}`. Dates are blank strings the user must fill manually. This is the artificial-week generator §2 kills.

### A4. What consumes task/goal data outside Plan Mode

This is the part that must not break (§28):

| Consumer | Reads | Risk |
|---|---|---|
| `getNextTask()` (467) | `tasks[].completed`, `.tag` — sorts by **pillar order only** | Ignores dates entirely. Must become schedule-aware. |
| `renderQuestList()` (532) | ALL tasks, pending-first | Shows every task ever. Should become "today's scheduled". |
| `_objectiveProgress()` (367) | tasks by `goalId` → done/total | ✅ Already goal-derived, matches §17. **No change needed.** |
| `_estimateXP()` (385) | `xpMultiplier` + `settings.workMinutes` | Should prefer `estimatedMinutes` once it exists. |
| `renderCurrentTask()` (475) | `tag`, `goalId`, `xpMultiplier` | Safe. |
| `_renderGoalSelector()` (1504) | `goals[].status==='active'` | Safe. |
| Reward flow / `markTaskComplete()` | `completed`, `completedAt` | ✅ Untouched by this redesign. |
| `sessions[]`, XP, streaks, history | `xpEarned`, `startTime` | ✅ Completely independent. Untouched. |
| `tests.js` 143–153 | Asserts week-cleanup-on-goal-delete | Must be rewritten. |
| `tests.js` 53 | Asserts `def.weeks` is an array | Must be rewritten. |

**Good news:** the XP economy, reward ceremony, timer, sessions, history and streaks have *zero* dependency on `weeks`/`day`. The blast radius is genuinely contained to Plan Mode + the two dashboard feeder functions.

### A5. Backwards-compat requirement

`Storage.deepMerge()` merges saved state over `defaultState()`. Critically — **arrays are replaced wholesale, not merged**. So a saved `tasks[]` keeps its old shape with no new default fields. Any new task field must be tolerated as `undefined` at read sites, or backfilled by an explicit migration. `deepMerge` alone will not do it.

---

## B. Proposed new state shape

Additive where possible; one destructive removal.

```js
// task — new fields
{
  id, text, tag /* pillarId */, goalId,
  milestoneId:      null,      // NEW, optional
  estimatedMinutes: 60,        // NEW — drives calendar block height + capacity
  scheduledStart:   null,      // NEW — ISO datetime "2026-08-17T09:00:00" or null
  scheduledEnd:     null,      // NEW — ISO datetime
  priority:         'medium',  // NEW — from img.png task detail
  notes:            '',        // NEW — from img.png task detail
  completed, xpMultiplier, createdAt, completedAt   // unchanged
  // weekId  — REMOVED
  // day     — REMOVED
}

// goal — one addition
{ ..., description: '' }       // NEW — "Pass EDC internal examination" subtitle in img.png
                               // weekCount kept but unused, dropped in migration

// NEW collection
milestones: [ { id, goalId, title, order, createdAt } ]

// REMOVED collection
weeks: []
```

`scheduledStart === null` **is** the unscheduled state (§13) — no separate flag, no possible disagreement between two fields.

### Migration (`storage.js`, runs once, version-stamped)

```
for each task:
  if task.day != null and task.scheduledStart == null:
      → map day-of-week onto the CURRENT week's matching date, 09:00,
        duration = estimatedMinutes default 60
  delete task.day, task.weekId
  backfill estimatedMinutes/priority/notes/milestoneId defaults
drop state.weeks entirely
stamp state.schemaVersion = 12
```

Rationale for mapping `day` → current week rather than discarding: those tasks are the user's live "this week" board. Silently unscheduling them would look like data loss. Old `weeks[]` metadata (labels like "WEEK 1") carries no schedulable information — `fromDate`/`toDate` are usually empty strings — so it is dropped, not converted.

---

## C. ⚠️ Conflict between the spec and `img.png` — RESOLVED

**Decision: follow the spec (real time-grid).** `img.png` is the authority for
visual styling, the Objectives cards, Goal Detail, Task Queue and Task Detail
panels; §4/§10 win for the calendar itself.

Original analysis:

- **`img.png` panel 3 ("SCHEDULE")** shows a board whose **rows are goals** (EDC / OOP / DSA / UNASSIGNED) and columns are dates. No time-of-day axis at all.
- **Spec §4** says, verbatim: *"Do not use Pillars or Goals as calendar rows. The calendar is organized by **time × date**, just like a real calendar."* §10 then asks for hour rows 08:00–15:00, drag-to-move, **resize to change duration**, current-time indicator, and Day/Week/Month/Agenda switching.

The mockup is the *old* kanban thinking with nicer paint; the spec explicitly forbids it. The spec is also far more work (a real time-grid with drag + resize + collision layout is the single biggest piece of this project).

The spec is dated and prescriptive, so **my default is to follow the spec (real time-grid calendar)** and treat `img.png` as the authority for *visual styling, the Objectives cards, Goal Detail, Task Queue and Task Detail panels* — which the spec and mockup fully agree on.

---

## D. Proposed build order

Six commits, each leaving the app working and testable.

| # | Step | Touches | Risk |
|---|---|---|---|
| 1 | **State + migration + tests.** New task fields, `milestones[]`, drop `weeks[]`, `day`→date migration, rewrite the 2 week-dependent tests, add migration tests. No UI change. | `storage.js`, `tests.js` | Low |
| 2 | **Rip out the old planner.** Delete weeks view, weekboard, move sheet, week form, 4-tab bar (~880 JS lines, ~175 HTML, ~158 CSS rules). Plan Mode temporarily = Objectives only. | `app.js`, `index.html`, `style.css` | Low — pure deletion |
| 3 | **Objectives screen** (§8) + **Goal Detail** (§9) with milestones, per `img.png`. | new `plan-objectives` block | Medium |
| 4 | **Calendar week grid** (§10, §11) — time×date, current-time line, task blocks, deadline markers, navigation, Day/Week/Agenda. | new `plan-calendar` block | **High** |
| 5 | **Scheduling interactions** (§12) — drag from queue, drag-move, resize, click-empty-slot-to-create, PLAN dialog, Task Detail inspector. | calendar + queue | **High** |
| 6 | **Feedback layer** — unscheduled/overdue rail (§13, §19), capacity bars (§20), and rewire `getNextTask()`/`renderQuestList()` so the dashboard surfaces *today's scheduled* work (§28). | `app.js` dashboard fns | Medium |

To keep §27's "don't make the god file more tangled" honest, steps 3–5 go into **new files — `plan.js` and `calendar.js`** — loaded as plain classic scripts exactly like the existing modules. No build step, no framework, consistent with current architecture. This also starts paying down the `app.js` debt the README flags rather than adding to it.

---

## E. Decisions taken

1. **Calendar shape** — real time-grid (spec §4/§10). ✅ built
2. **Views** — all four: Day / Week / Month / Agenda. ✅ built
3. **Old `day` tasks** — everything migrates to UNSCHEDULED. The user
   deliberately commits each task to real time. ✅ built
4. **Dashboard** — left unchanged for now. `getNextTask()` / `renderQuestList()`
   still surface all pending tasks by pillar priority, so the FORGE loop is
   untouched. Making them schedule-aware is a deliberate follow-up.

---

## F. Status

| Step | State |
|---|---|
| 1. State + migration + tests | ✅ done — 15 unit assertions |
| 2. Remove old planner | ✅ done — app.js 3640 → 2771 lines, 66 dead CSS rules dropped |
| 3. Objectives + Goal Detail + milestones | ✅ done — `plan.js` |
| 4. Calendar grid (4 views) | ✅ done — `calendar.js` |
| 5. Scheduling interactions | ✅ done — drag, resize, click-slot, PLAN modal, inspector |
| 6. Overdue + capacity + dashboard rewire | ◐ partial — overdue tray and total-capacity readout shipped; per-day capacity bars and the dashboard rewire deferred by decision (4) |

Verified by `tests.js` (15 assertions) and `tests.plan.js` (22-step DOM run).
