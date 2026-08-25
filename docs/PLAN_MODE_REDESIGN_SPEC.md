# FORGE Plan Mode Redesign

## Product Model + UX + UI Specification

You are redesigning **Plan Mode in FORGE**.

This is **not a cosmetic UI redesign**.

The current Plan Mode has a flawed planning model, so the underlying product behavior, information architecture, interaction model, and UI all need to be redesigned together.

Read the existing `README.md`, `PRODUCT_DESIGN.md`, `UI_LAYOUT.md`, `VISUAL_DESIGN.md`, `UX_FLOWS.md`, and `FORGE_ANALYSIS.md` before implementing anything. Preserve FORGE's existing product identity and game loop unless this specification explicitly changes something.

FORGE's core loop remains:

**PLAN → FORGE → LOCK IN → FOCUS → REWARD → BREAK**

The current README describes Plan Mode as:

**pillars → goals with deadlines → weekly tasks**

The problem is that the current implementation has turned this into:

**Pillar → Goal → Week 1/2/3/4 → Tasks**

plus a separate:

**This Week → days → tasks**

plus a separate:

**Task Queue**

This creates multiple competing representations of the same work.

The redesign must eliminate that conceptual confusion.

---

# 1. THE NEW PLANNING MODEL

The fundamental model is:

**PILLARS → GOALS → TASKS → CALENDAR**

Each layer has a distinct responsibility.

## Pillars = WHERE

Pillars represent broad areas of life.

Examples:

* Academics
* Gamedev
* Health
* Other

Pillars should remain relatively stable.

They organize goals.

---

## Goals = WHY

A goal is a meaningful outcome the user wants to achieve.

Example:

**EDC — Exam Preparation**

Deadline:

**August 19**

The goal should answer:

> What am I trying to accomplish?

Goals should have:

* title
* pillar
* description/outcome
* deadline
* progress
* associated tasks
* optional milestones if useful

A goal does NOT contain artificial "Week 1", "Week 2", "Week 3", etc.

---

# 2. REMOVE THE ARTIFICIAL WEEK HIERARCHY

The current system creates things like:

**EDC**

* Week 1
* Week 2
* Week 3
* Week 4

This should be removed.

A week is a **time window**, not a planning object.

If a goal has four days remaining, the system should not create four artificial weeks.

If a goal has three months remaining, it should not automatically create twelve arbitrary week objects.

Instead, the goal has:

**tasks + deadline**

The calendar determines the temporal organization.

If meaningful intermediate checkpoints are needed, use **milestones**, not weeks.

Example:

**Build Godot Game**

* Prototype complete
* Core gameplay complete
* Polish complete
* Release

These are meaningful outcomes.

"Week 3" is not.

---

# 3. TASKS = WHAT

A task is an actionable unit of work that moves a goal forward.

Examples:

* Revise cylindrical coordinates
* Solve 2025 EDC PYQ
* Revise polymorphism
* Implement enemy AI

Every planned task should know which goal it contributes to.

Conceptually:

```text
Task
├── title
├── goalId
├── milestoneId (optional)
├── estimatedMinutes
├── difficulty
├── status
├── scheduledStart
├── scheduledEnd
└── completion data
```

The exact state shape should be adapted to the existing architecture rather than blindly copied.

Important:

Do NOT create a `weekId` just to reproduce the old architecture.

The calendar date determines which week a task appears in.

---

# 4. CALENDAR = WHEN

The calendar becomes the actual scheduling layer of FORGE.

This is the biggest UI/product change.

The user should not plan by putting tasks into artificial "Week 1 / Week 2" containers.

The user should plan by deciding:

> When am I actually going to do this?

The calendar should be a genuine calendar interface.

The primary planning view should be a **real time-based calendar**, not a Kanban board.

For example:

```text
                  AUGUST 17–23

       MON       TUE       WED       THU       FRI

08:00
────────────────────────────────────────────────────────

09:00
        ┌───────────────┐
        │ EDC           │
        │ Solve PYQ     │
        │ 09:00–10:30   │
        └───────────────┘

10:00

11:00
                              ┌───────────────┐
                              │ OOP           │
12:00                         │ Revision      │
                              │ 12:00–13:00   │
                              └───────────────┘

13:00

14:00
                  ┌───────────────────┐
                  │ DSA               │
15:00             │ Two Sum           │
                  │ 14:00–15:00       │
                  └───────────────────┘
```

Do not use Pillars or Goals as calendar rows.

The calendar is organized by:

**time × date**

just like a real calendar.

---

# 5. TASK QUEUE HAS A DIFFERENT PURPOSE

The existing Task Queue should remain, but its meaning needs to change.

It is NOT another planning screen.

It is the user's inventory of tasks that exist but have not necessarily been scheduled.

Think:

> "What could/should I do?"

rather than:

> "When am I doing it?"

Example:

```text
TASK QUEUE

UNSCHEDULED · 5 TASKS · ~6h 15m

□ Solve 2025 EDC PYQ       EDC       120m
□ Revise polymorphism      OOP        60m
□ Two Sum                  DSA        45m
□ Read Godot AI docs       GAMEDEV    90m
□ Make devlog thumbnail    GAMEDEV    30m
```

Each task should show its goal.

The user can then:

* drag it onto the calendar
* click PLAN
* assign a date/time
* edit it
* leave it unscheduled

This creates a clear distinction:

**Task Queue = inventory**

**Calendar = commitment**

---

# 6. THERE SHOULD NO LONGER BE A SEPARATE "THIS WEEK" BOARD

The current "THIS WEEK" tab should be removed as a separate planning concept.

The problem with the current version is that the user can add:

> "Play football"

or:

> "DSA PYQ"

without the system clearly communicating which goal the task belongs to.

That is bad planning.

Instead:

**This Week = Calendar → Week View**

The calendar itself represents the current planning horizon.

The user can switch between:

* Day
* Week
* Month
* Agenda

but the primary planning experience should be **Week**.

---

# 7. PLAN MODE INFORMATION ARCHITECTURE

Plan Mode should be dramatically simpler.

Instead of:

**Pillars | Goals | This Week | Tasks**

use a model centered around:

### OBJECTIVES

See and manage goals.

### CALENDAR

Schedule tasks.

The Task Queue remains accessible through the global side navigation and/or a contextual drawer, but it should not be another competing Plan Mode hierarchy.

A possible structure:

```text
PLAN MODE

OBJECTIVES
CALENDAR
```

or, if you determine a better navigation model:

```text
PLAN

[ OBJECTIVES ] [ CALENDAR ]
```

Do not preserve the four existing tabs simply because they already exist.

The information architecture should follow the new planning model.

---

# 8. OBJECTIVES SCREEN

The Objectives screen replaces the current Pillars/Goals Kanban experience.

It should show active goals grouped by pillar.

Example:

```text
PLAN MODE
OBJECTIVES

[ ALL ] [ ACADEMICS ] [ GAMEDEV ] [ OTHER ]

┌───────────────────────────────────────────────────┐
│ 📚 ACADEMICS                                      │
│                                                   │
│ EDC — Exam Preparation                    68%     │
│ Pass EDC internal examination                     │
│ DEADLINE · AUG 19 · 4 DAYS LEFT                  │
│ ████████████████░░░░                             │
│                                                   │
│ 5 / 8 tasks complete                       →     │
└───────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────┐
│ ACADEMICS                                         │
│                                                   │
│ Object Oriented Programming                35%    │
│ Pass OOP internal examination                     │
│ DEADLINE · AUG 19 · 4 DAYS LEFT                  │
│ ███████░░░░░░░░░░                                 │
│                                                   │
│ 2 / 6 tasks complete                       →     │
└───────────────────────────────────────────────────┘
```

Goals should feel like **objectives**, not Kanban columns.

The UI should make deadlines and progress immediately legible.

---

# 9. GOAL DETAIL

Clicking a goal should open a meaningful goal detail view.

Example:

```text
← OBJECTIVES

EDC — EXAM PREPARATION

PASS EDC INTERNAL EXAMINATION

DEADLINE
AUG 19
4 DAYS LEFT

PROGRESS
██████████████░░░░ 68%

TASKS
────────────────────────────

✓ Revise vectors
✓ Revise 3D geometry
□ Cylindrical coordinates
□ Infinite series PYQ
□ Solve 2025 EDC PYQ
□ Mock examination

MILESTONES
────────────────────────────

Optional.

Only use milestones if they represent meaningful checkpoints.

```

The goal detail should answer:

* What am I trying to achieve?
* When must it be achieved?
* How much progress have I made?
* What work remains?

---

# 10. CALENDAR SCREEN

This should be the centerpiece of the new planning experience.

The default should be the current week.

Example:

```text
PLAN MODE / CALENDAR

‹       AUG 17 – AUG 23       ›
         TODAY

DAY       WEEK       MONTH       AGENDA

────────────────────────────────────────────────────────────

        MON 17    TUE 18    WED 19    THU 20    FRI 21
        ─────────────────────────────────────────────────────

08:00

09:00   ┌────────────┐
        │ EDC        │
        │ Solve PYQ  │
        │ 09–10:30   │
        └────────────┘

10:00

11:00

12:00             ┌──────────────┐
                  │ OOP          │
                  │ Polymorphism │
                  │ 12–13        │
                  └──────────────┘

13:00

14:00

15:00                       ┌──────────────┐
                           │ DSA          │
                           │ Two Sum      │
                           │ 15–16        │
                           └──────────────┘
```

The calendar should support:

* click empty time slot → create/schedule task
* drag task → move it
* resize task → change duration
* drag task from Task Queue → schedule it
* click task → task detail
* navigate previous/next week
* jump to today
* switch day/week/month/agenda
* show current time
* visually distinguish completed tasks
* show overdue/unscheduled tasks
* avoid visual clutter

---

# 11. TASK CARDS ON THE CALENDAR

A scheduled task should communicate enough information without becoming huge.

Example:

```text
┌─────────────────────┐
│ EDC                 │
│ Solve 2025 PYQ     │
│ 10:00 – 12:00       │
│ +120 XP             │
└─────────────────────┘
```

The goal/pillar should be visually identifiable, but the task title must remain dominant.

Do not turn the calendar into a rainbow.

FORGE's industrial visual language should remain intact.

Use existing theme/accent semantics where appropriate.

---

# 12. SCHEDULING A TASK

A task should be schedulable through multiple paths.

### Method 1: Drag

Drag from Task Queue → calendar slot.

### Method 2: PLAN button

Click PLAN.

Open a small scheduling interface:

```text
PLAN TASK

Solve 2025 EDC PYQ

GOAL
EDC — Exam Preparation

ESTIMATED TIME
120 min

DATE
[ Aug 18 ]

START
[ 10:00 ]

END
10:00 – 12:00

[ SCHEDULE ]
```

### Method 3: Calendar creation

Click an empty calendar slot.

Create a task directly.

If created directly from the calendar, the user should still be encouraged/required to associate it with a goal before it becomes a fully planned task.

---

# 13. UNPLANNED TASKS

The system should allow tasks to exist before they are scheduled.

But clearly distinguish:

**UNSCHEDULED**

from

**SCHEDULED**

An unscheduled task is not an error.

It simply means:

> "I know this needs doing, but I haven't committed to when yet."

That is useful.

The UI should make unscheduled work visible without making it feel like a second calendar.

---

# 14. GOAL ASSOCIATION

A task should normally have a goal.

For example:

```text
□ Solve 2025 EDC PYQ
   Goal: EDC
```

The user should not have to wonder:

> "What goal does this task belong to?"

The system should make that relationship visible.

For quick miscellaneous work that genuinely does not belong to a goal, allow an appropriate fallback such as:

**Other / General**

but don't make goal-less planning the default.

---

# 15. CALENDAR + EXISTING EVENTS

If FORGE already has or later gains calendar integration, design the calendar so that external events can coexist with FORGE tasks.

Conceptually:

```text
09:00  FORGE · EDC PYQ
11:00  CLASS
13:00  LUNCH
16:00  BASKETBALL
18:00  FORGE · DSA
```

External events occupy time.

FORGE tasks consume available planning capacity.

This creates an opportunity for future intelligent planning.

For example:

```text
⚠ PLAN OVERLOAD

You have scheduled 7h 30m of FORGE work
but only ~5h 00m appears available this week.

[ REVIEW PLAN ]
```

Do not overbuild this if calendar integration does not currently exist. Architect the UI so that it can support it later.

---

# 16. PLANNING SHOULD BECOME A COMMITMENT SYSTEM

The new Plan Mode should feel like:

> "What am I trying to accomplish?"

then:

> "What actions will move those goals forward?"

then:

> "When am I actually going to do those actions?"

This is the core planning loop:

```text
OBJECTIVE
    ↓
TASKS
    ↓
COMMIT
    ↓
CALENDAR
    ↓
FORGE
```

The calendar is therefore not decoration.

It is the final commitment layer.

---

# 17. PROGRESS

Goal progress should be derived from the work underneath it.

Avoid using arbitrary week progress.

For example:

```text
EDC

8 tasks total
5 completed

PROGRESS = 62.5%
```

If task weighting or estimated effort is already supported, use the existing product logic where appropriate.

Do not invent a new progress formula without checking the current architecture.

The important principle is:

**Goal progress comes from goal work, not from artificial week containers.**

---

# 18. DEADLINES

Deadlines become much more meaningful with the new model.

A goal:

**EDC**

Deadline:

**Aug 19**

The calendar can visually show the deadline.

For example:

```text
        AUG 17       AUG 18       AUG 19
        ─────────────────────────────────
                       │
                       │ DEADLINE
                       ▼
                    EDC
```

The user should immediately understand:

> "I have four days to finish the remaining work."

This is much better than:

> "I'm currently in Week 4."

---

# 19. OVERDUE WORK

Define clear behavior for tasks whose scheduled date passes.

Do not silently lose them.

Possible behavior:

```text
OVERDUE

□ Solve EDC PYQ
   Was scheduled Aug 16
   EDC

[ RESCHEDULE ]
```

The user can move it to another calendar slot.

Do not automatically move tasks around without user control unless the existing product philosophy explicitly supports that behavior.

---

# 20. PLANNING CAPACITY

If task duration is supported, the calendar should eventually make capacity visible.

Example:

```text
MON
6h available
5h scheduled

████████████████░░ 83%
```

If the user schedules too much:

```text
⚠ OVERCOMMITTED
7h 30m scheduled
5h available
```

This should be subtle and useful, not a nagging productivity police officer.

---

# 21. WHAT TO REMOVE

The redesign should remove these concepts from Plan Mode:

* Week 1 / Week 2 / Week 3 / Week 4 goal columns
* Goals represented as Kanban boards
* A separate "This Week" task board
* A separate Tasks tab inside Plan Mode that duplicates Task Queue
* Tasks that can be added to "This Week" without a clear relationship to a goal
* Any arbitrary week objects generated solely because a goal exists
* Duplicate representations of the same task

Do not simply hide these concepts visually.

Remove their conceptual role from the planning system.

---

# 22. WHAT TO KEEP

Preserve:

* Pillars
* Goals
* Goal deadlines
* Tasks
* Task Queue
* Task difficulty
* XP
* Goal/task completion
* FORGE's existing reward economy
* existing themes
* industrial cockpit aesthetic
* desktop-first design
* offline-first reliability
* existing game loop

The README explicitly describes FORGE as an industrial cockpit/game lobby rather than a cute todo app. Preserve that identity.

---

# 23. VISUAL DIRECTION

The redesign should feel like the same FORGE product, not a completely different SaaS calendar.

Keep:

* dark industrial background
* strong typography
* restrained accent colors
* orange FORGE identity
* green/blue/purple theme semantics where appropriate
* thin borders
* subtle glow
* tactical/operational language
* compact information density
* clear hierarchy

However, improve readability.

The current UI is visually dense and sometimes makes every element equally important.

The redesigned calendar should have a stronger visual hierarchy:

1. Date/time
2. Task
3. Goal context
4. Status/XP
5. Secondary metadata

Do not sacrifice usability for aesthetic density.

---

# 24. RESPONSIVENESS

This is desktop-first.

Optimize the primary design for desktop/laptop screens.

Do not make mobile compromises dictate the desktop layout.

However, the implementation should remain reasonably responsive.

---

# 25. IMPORTANT PRODUCT PRINCIPLE

Do NOT think:

> "How do I redesign the existing four tabs?"

Think:

> "What is the simplest system that lets the user define outcomes, turn them into actionable tasks, and commit those tasks to real time?"

The old UI is not sacred.

The old week model is not sacred.

The current Plan Mode tabs are not sacred.

The underlying FORGE philosophy is what matters.

---

# 26. EXPECTED FINAL EXPERIENCE

A user should be able to do this:

### Step 1

Create:

**Academics → EDC**

Deadline:

**Aug 19**

### Step 2

Create tasks:

* Revise cylindrical coordinates — 60m
* Infinite series PYQ — 90m
* Solve 2025 EDC PYQ — 120m
* Mock test — 120m

### Step 3

Open the calendar.

Drag:

**Revise cylindrical coordinates**

to Monday 9:00–10:00.

Drag:

**Infinite series PYQ**

to Tuesday 10:00–11:30.

Drag:

**Solve 2025 EDC PYQ**

to Wednesday 14:00–16:00.

Drag:

**Mock test**

to Thursday 10:00–12:00.

Now the plan is complete.

There are no:

**Week 1 / Week 2 / Week 3 / Week 4**

objects.

There is simply:

**Goal → Tasks → Calendar commitments**

---

# 27. IMPLEMENTATION APPROACH

Before changing code:

1. Inspect the current Plan Mode implementation in `app.js`.
2. Inspect `defaultState()` in `storage.js`.
3. Identify the existing pillar/goal/week/task relationships.
4. Identify every place that depends on weeks.
5. Identify every place that depends on Plan Mode task scheduling.
6. Identify the existing Task Queue behavior.
7. Identify how dashboard "Today's Objective" and "Today's Quests" consume task/goal data.
8. Identify how completion/progress/XP currently depend on the existing task structure.
9. Identify what must remain backwards-compatible.

Do not immediately rewrite the entire application.

First determine the smallest coherent migration path from the existing state model to the new planning model.

Because `app.js` is currently a large god file, avoid making the redesign even more tangled.

Keep the implementation consistent with the existing no-framework/vanilla JS architecture.

---

# 28. DO NOT BREAK THE CORE LOOP

After the redesign:

**PLAN**

should produce scheduled tasks.

Those tasks should naturally feed:

**FORGE dashboard**

which should surface:

**TODAY'S OBJECTIVE**

and:

**TODAY'S QUESTS**

Then the existing:

**LOCK IN → FOCUS → REWARD**

flow should continue working.

The redesign must therefore integrate with the existing execution loop rather than becoming an isolated planner.

---

# 29. SUCCESS CRITERIA

The redesign is successful if a new user can answer these questions immediately:

### "What am I trying to achieve?"

→ Goals.

### "Why am I doing this task?"

→ Goal association.

### "What exactly do I need to do?"

→ Tasks.

### "When am I doing it?"

→ Calendar.

### "What should I do today?"

→ Calendar + FORGE dashboard.

### "What work haven't I scheduled yet?"

→ Task Queue / Unscheduled.

### "Am I making progress?"

→ Goal progress.

### "Am I trying to do too much?"

→ Calendar capacity / planning warnings.

The user should never have to understand an internal concept like "Week 3" in order to plan their life.

---

# FINAL DIRECTION

The new FORGE planning philosophy is:

**PILLARS define the areas of life.**

**GOALS define the outcomes.**

**TASKS define the actions.**

**CALENDAR defines the commitment.**

**FORGE executes the commitment.**

Build the UI around this model.

Do not make the current Plan Mode prettier.

**Replace the old planning model with this one.**
