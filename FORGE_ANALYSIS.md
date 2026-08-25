# FORGE — Analysis v11.7

## What is FORGE?
FORGE is a **gamified deep-work execution engine**. The name: you FORGE yourself through work. It's a PWA built vanilla HTML/CSS/JS, mobile-first (max 480px), designed like an industrial cockpit, not a cute todo app.

Core loop:
1. **Queue tasks** with a Pillar (Academics, Gamedev, Other — user can add more) + difficulty (Easy 1x, Medium 1.5x, Hard 2x XP)
2. **Pick NEXT OBJECTIVE** — sorted by pillar priority
3. **Lock intention** — you must type "I will..." + pick session length (25/50/90/custom) + optional linked Goal
4. **Focus session** — countdown with SVG ring, Hold (5min auto-resume), Abandon, Complete
5. **Reward** — XP + Coins calculated on *actual* elapsed time, streak multiplier, level bonus, random Focus Bonus. Then decide: Task Done (bonus XP) vs Continue Task
6. **Break** — configurable 5/10/20 min
7. Repeat. Level up, rank up, keep streak, earn coins, buy themes & streak freezes in Armory

Goal: **Stop planning, start building**. It helped the author top 1st semester because it forces specificity (intention), removes decision fatigue (one next task), and makes work addictive (XP float, sounds, rank names).

---

## Architecture — 8 files, no build step

```
index.html  — All views (onboarding, dashboard, intention, session, break, reward, tasks, settings, history, summary, shop, plan). No SPA router, just .view.active toggling.
style.css   — Design system: CSS variables --bg, --accent etc. Industrial Terminal aesthetic. Grain overlay. Themes override variables via [data-theme="x"].
app.js      — 95KB God file. Owns state, view routing, render functions, event binding, plan mode (pillars/goals/weeks/tasks), shop, summary, history, goal selector.
storage.js  — localStorage wrapper. defaultState() is single source of truth for shape. deepMerge for migrations. todayStr() uses local date not UTC.
xp.js       — Pure calculation: xpForLevel = 500*level^1.6, calculateSessionXP = 100*(mins/25)*deepWork*diff*streak*level + random bonus. Streak with freeze logic.
timer.js    — Wall-clock based countdown (Date.now) immune to tab throttling. Hold captures remainAtHold, resume with new anchor.
sound.js    — Web Audio API synthesized sounds, no files.
firebase.js — Google Auth only, Firestore save/load JSON string, offline persistence, LOCAL persistence (stay signed in).
sw.js       — Service worker cache-first strat. Currently buggy.
manifest.json — PWA manifest, icons missing.
```

### State Shape (storage.js defaultState)

```js
user: { name, xp, level, totalSessions, rank, coins, unlockedThemes[name], activeTheme, streak{current, longest, lastActiveDate, freezesAvailable, lastFreezeUsed} }
tasks: [{id, text, tag=pillarId, goalId, weekId, completed, xpMultiplier, createdAt, completedAt}]
sessions: [{id, taskId, intention, startTime, endTime, completed, xpEarned, coinsEarned}]
today: {date, sessionsCompleted}
settings: {workMinutes, breakMinutes, soundEnabled, summaryDay (0=Sun), lastSummaryWeek}
pillars: [{id, name, color, icon}]
goals: [{id, pillarId, title, deadline, weekCount, createdAt, status:'active'|'completed'}]
weeks: [{id, goalId, number, label, fromDate, toDate}]
```

### Key Flows

- **Plan Mode**: Pillars (focus areas) -> Goals (deadline + N weeks) -> Weeks (WEEK 1..N with from/to dates) -> Tasks per week (drag drop desktop, move sheet mobile, unassigned column). War room view was earlier, now replaced by weeks columns.
- **History**: 16 weeks heatmap (Mon-Sun, 112 cells) XP intensity 0-4, stats strip (hours, sessions, total XP, best day XP), day log.
- **Weekly Summary**: Shows if today Dow == summaryDay AND lastSummaryWeek != thisWeek AND lastWeek had sessions. Hero XP, grid, best day, quote.
- **Shop**: Themes price 0-500 coins, consumable freeze 150 coins max 2 (3 code max actually). applyTheme sets data-theme attribute + updates rank label.
- **Themes**: FORGE (orange industrial default), VENOM (toxic green free), HACKER (terminal heavy scanlines), HEISENBERG (gold cook), VOID (black blood red silent), MINECRAFT (pixelated), ANIME (navy neon pink, shinobi ranks)

---

## Why it became unusable

From static + runtime audit:

1. **Rank mismatch**: xp.js RANKS = INITIATE, APPRENTICE, BUILDER, CRAFTSMAN, SPECIALIST, OPERATOR, ARCHITECT, FORGE MASTER (8 levels). Theme rank overrides in app.js expect INITIATE, APPRENTICE, OPERATOR, SPECIALIST, VETERAN, ELITE, COMMANDER, LEGEND. So after Lv6+ ranks break / fallback, reward rank change etc wrong.
2. **Reward UI state leak**: After TASK DONE, task-decision gets hidden and task-bonus visible, then startBreak. On next session reward, decision still hidden unless reset. So 2nd session reward shows no buttons.
3. **Pillar/Goal delete orphans**: Deleting pillar only moved tasks to OTHER, left goals with dead pillarId. Deleting goal only removed goal, left weeks orphaned and tasks with goalId pointing to nowhere.
4. **Task switcher badge**: Used old hardcoded tag classes (finals/game/urgent) not pillar colors, so badges looked broken after pillar system.
5. **SW cache bomb**: CACHE_NAME v7 but app v11.7, FILES_TO_CACHE includes '/' absolute and google fonts URL which fails cross-origin addAll -> install fails -> offline broken. Also caches '/' but no file.
6. **Manifest icons missing**: icons/ folder doesn't exist, PWA install warning.
7. **No offline/guest path**: After Firebase integration, app REPLACES old name-input onboarding with Google-only. If Firebase fails/offline or you don't want to sign in while studying, app is stuck at CONNECTING... / login screen. Original goal was vibe coded local app.
8. **_selectedPillar leak**: After adding pillars then deleting selected one, chip selection points to dead id -> quick-add tasks get tag 'other' but UI shows none selected.
9. **Goal selector & week inputs**: Minor but custom mins input not validated, move sheet backdrop not closing on ESC etc.
10. **No tests**: 96KB app.js impossible to refactor safely.

---

## Make it usable again — Plan

**Phase 1 — Critical fixes (this commit)**
- [x] Fix XP ranks to 8 canonical: INITIATE(1), APPRENTICE(3), OPERATOR(6), SPECIALIST(10), VETERAN(15), ELITE(20), COMMANDER(30), LEGEND(50) — matches theme overrides.
- [x] Reset reward UI each showReward
- [x] Fix task switcher to use pillar colors
- [x] Delete cleanup: pillar delete moves goals to 'other', goal delete removes weeks + nulls task weekId/goalId
- [x] _selectedPillar fallback to first pillar or 'other' after delete
- [x] sw.js bump to forge-v11-7, robust install (ignore fail), remove '/' and google font, use relative './' files, network-first for HTML, cache-first else
- [x] manifest icons: generate simple orange/black 192 & 512 placeholders OR remove icons until generated — we generate via tool
- [x] Offline guest mode: Add "ENTER OFFLINE" button in onboarding, plus "Dev Quick Enter" that bypasses auth and loads local state. Show local badge.

**Phase 2 — Usability while studying**
- Add local dev server + fast feedback
- Add simple test page / test harness for XP & timer
- Clarify dashboard: if no tasks, CTA, show plan mode hint
- Ensure session picker sync and hold overlay z-index
- Ensure sound toggle defaults on but respects saved

**Phase 3 — While studying (future)**
- Split app.js into modules? Keep single file for now but add comments.
- Add goals -> weeks auto date calc
- Add data export/import for safety (since Firebase may be deleted)
- Polish themes preview

---

## How to run locally

No build. Just `python3 -m http.server 8000` or use arena preview.

- Open index.html via server (not file:// because Firebase & SW need http)
- If Google sign-in blocked (localhost not in Firebase allowed domains), use OFFLINE mode.
- To test summary: localStorage.__forgeSummaryTest='1' then refresh.

Storage: `localStorage.forge_state`

To reset: Settings > Danger Zone > Reset All Data OR localStorage.clear()

---

## Vault

The author says: "Stop planning. Start building." The app's magic is sound + XP float + rank. Keep it.
Don't add heavy frameworks. Keep vanilla. Keep 480px cockpit.
