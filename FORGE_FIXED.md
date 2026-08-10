# FORGE — Fixed & Usable Again v11.8

> **What was broken:** Rank system mismatch (Builder/Craftsman vs Veteran/Elite), reward screen buttons disappearing after 2nd session, deleting a pillar threw `ReferenceError: renderPillarChips is not defined` → app became unusable, goal delete left orphan weeks, service worker cache failed on external fonts, manifest icons missing, no offline path so Firebase failure = stuck at CONNECTING.

> **What's fixed now:** All above, plus offline guest mode, robust SW, generated icons, tests.

## Quick Start (study mode)

**No build needed.**

### 1. Run locally
```bash
cd Forge
python3 -m http.server 8000
# open http://localhost:8000
```
In this arena sandbox, live preview is already running: https://8000-xxx.e2b.app — just open it.

### 2. Enter offline (recommended while studying)
On onboarding:
- Type your name in "OPERATIVE NAME" field → **GO**
- Or click **ENTER OFFLINE MODE**

Offline = pure localStorage, no Google sync. No Firebase domains needed. Data stays in `localStorage.forge_state`.

If you *want* cloud sync: Continue with Google (works if Firebase auth domain allows localhost). Offline data will merge when you sign in later (deepMerge).

### 3. Core loop while studying
1. **PLAN Mode** (top toggle): Create pillars: ACADEMICS, PROJECT, HEALTH etc → color + icon
2. Inside pillar → Add Goal (e.g., "SEM 2 Finals") + deadline + 4 weeks → auto-generates WEEK 1..4
3. Open goal → Weeks columns → Add tasks per week. Drag drop on desktop, ⇄ move on mobile.
4. **FORGE Mode**: NEXT OBJECTIVE shows highest priority incomplete task. Quick Add Task bottom: type + pick pillar chip + EASY/MED/HARD
5. Hit **START SESSION** → type intention: "I will finish Chapter 3 notes" → pick 25/50/90 or custom → **LOCK IN**
6. Focus timer → Hold if needed (5min auto-resume) → Complete → Reward: XP + Coins
7. On reward: **TASK DONE** (+50/75/100 XP) vs CONTINUE TASK. Both go to break.
8. Break → back to dashboard. Streak +1.

### 4. Where XP goes
- Session XP: `100 * (mins/25) * deepWork(1/1.1/1.2) * diff(1/1.5/2) * streak(1+0.05*days capped 2x) * levelBonus(+10% per 5 lvls)` + random 15% focus bonus +50
- Coins: `floor(XP/10) + 5 if bonus`
- Task done bonus: 50/75/100
- Levels: `500 * level^1.6` to next. Ranks: INITIATE(1), APPRENTICE(3), OPERATOR(6), SPECIALIST(10), VETERAN(15), ELITE(20), COMMANDER(30), LEGEND(50) → theme overrides (e.g., HEISENBERG: SMALL-TIME→SAY MY NAME)

### 5. Features to use while studying
- **Combat Log (History)**: Heatmap 16 weeks, tap day to see sessions. Stats strip hours/sessions/XP/best day.
- **Armory (Shop)**: Earn coins → buy themes (350-500) + Streak Freeze (150, max2). Themes change CSS variables, rank names, sounds effects stay.
- **Weekly Debrief**: On your chosen day (Settings → Summary Day, default Sun) if last week had sessions, shows hero XP, stats, best day, motivational line.
- **Sound**: Web Audio synthesized, toggle in Settings.
- **Export safety**: Settings → Account shows sync status. LocalStorage holds JSON. For backup: DevTools → Application → Local Storage → forge_state → copy.

## Files changed in this fix session

- `xp.js`: Rank table fixed to 8 canonical ranks matching THEME_RANKS
- `app.js`: 
  - **Critical**: Moved `renderPillarChips` to outer scope (was causing ReferenceError on pillar delete)
  - `showReward` now resets `task-bonus-display` hidden & `task-decision` visible
  - Task switcher badge now uses pillar color/icon not old hardcoded classes
  - Pillar delete: also moves goals to OTHER, resets selected pillar
  - Goal delete: deletes associated weeks + unlinks tasks
  - `enterOfflineMode()` new, `showAuthLoading` shows offline block, FB timeout 3s fallback, offline inputs wired
- `sw.js`: Cache v11.7, robust install loop (try/catch per file), ignore Firebase/Google external requests, relative './' paths
- `index.html`: Offline block added with name input + buttons
- `style.css`: Offline block styles appended
- `icons/icon-*.png`: Generated placeholder icons (orange F on black)
- `tests.js` + `test.html`: Lightweight harness, 13 assertions, run via `node tests.js` or open test.html
- `FORGE_ANALYSIS.md`: Full audit

## Tests

```bash
node tests.js
# or open /test.html in browser
```

13 checks: storage default, todayStr format, ranks canonical, xp curve, session XP, task XP, applyXP level up, streak continue/reset, timer format/ring, pillar fallback, goal deletion cleanup.

All green now.

## Known limitations / next improvements while studying

- `app.js` still 100KB god file — split into modules later if you want
- Firebase sync needs `localhost` whitelisted in Firebase console → Auth → Settings → Authorized domains. If not, use offline.
- Service worker updates: if you see old version, hard refresh Ctrl+Shift+R or unregister in DevTools → Application → Service Workers
- Weeks from/to dates not auto-calculated from goal deadline — manual for now
- No export button yet — copy from localStorage

## Study workflow suggestion

- Morning: PLAN → create 3 priorities for day as tasks
- Each 50min: FORGE → intention specificity = key to topping again
- After 3 sessions: check Combat Log heatmap — keep it orange
- Sunday: review Weekly Debrief, buy theme as reward

> Stop planning. Start building. The forge is hot again.

— fixed 2026-08-10

## How to commit

This branch `arena/019fec1c-forge` contains fixes. Merge to main when happy:

```bash
git add -A
git commit -m "fix: make Forge usable again — ranks, reward reset, pillar delete crash, offline mode, SW robust, icons, tests"
git push origin arena/019fec1c-forge
```
