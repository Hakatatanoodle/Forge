# FORGE — Execution Engine ⚒️

> **A game you play by studying.** A gamified deep-work PWA that turns "I should work" into "I gotta get that XP." Stop planning. Start building.

FORGE is a **desktop-first** web app built with **zero dependencies** — vanilla HTML/CSS/JS, no framework, no build step. It's designed as an industrial cockpit / game lobby, not a cute todo app. It uses XP, streaks, coins, ranks, and themes to make focused work genuinely addictive.

---

## The core loop

1. **PLAN** — define pillars (Academics, Gamedev, Other…) → goals with deadlines → weekly tasks.
2. **FORGE** — the dashboard shows your NEXT OBJECTIVE, one hero quest, and today's quest list.
3. **LOCK IN** — write a declaration — *"I will finish Chapter 3 notes"* — pick 25/50/90/custom minutes, hit **⚔ LOCK IN**.
4. **FOCUS** — a distraction-free countdown ring (wall-clock based, immune to tab throttling). Hold, resume, or abandon.
5. **REWARD** — a timed ceremony: **+XP counts up**, focus bonus, coins, streak flame, level-up block, then *is the task done?*
6. **BREAK** — 5/10/20 min or skip. Back to the dashboard, streak +1.

Repeat. Level up, rank up, keep the streak alive, earn coins, buy themes and streak freezes in the Armory.

---

## Features

- **Game-lobby dashboard** — identity strip (streak flame, rank, coins, XP bar), hero *TODAY'S OBJECTIVE* card, *TODAY'S QUESTS* list (n/m done), collapsed **+ ADD QUEST** quick-add, empty-state funnel into first goal.
- **Reward ceremony** — the screen *plays* on timed beats instead of dumping every number at once; level-up is a dedicated identity block ("APPRENTICE ▸ OPERATOR").
- **Ritual start-flow** — locked `I will {task}` declaration line, one-tap duration with 50m default.
- **XP economy** — `500 × level^1.6` per level; session XP scales with minutes, deep-work mode, difficulty, streak, and level bonus, plus a random focus bonus. 8 canonical ranks: **INITIATE → APPRENTICE → OPERATOR → SPECIALIST → VETERAN → ELITE → COMMANDER → LEGEND** (50).
- **Streak system** — streak multiplier with freezes (buyable in the Armory).
- **Plan mode** — tabbed planner: pillar cards with progress %, goal drill-down into weekly kanban, THIS WEEK Mon–Sun board with drag-and-drop per-day scheduling + UNASSIGNED column, and a task queue tab.
- **Combat Log** — 16-week heatmap (112 cells), stats strip (hours/sessions/total XP/best day), per-day session log.
- **Weekly Debrief** — auto-summary on your chosen day if last week had sessions: hero XP, best day, a motivational line.
- **Armory (shop)** — themes priced 0–500 coins + Streak Freeze (150, max 2).
- **Themes** — each is a complete world (color, type, texture, rank identity), not a tint: FORGE (ember industrial), VENOM, HACKER, HEISENBERG, VOID, MINECRAFT, ANIME (One Piece — sail the Grand Line, *"BOUNTY INCREASED: 500,000,000"*).
- **Synthesized sound** — Web Audio API, no audio files.
- **Offline / guest mode** — pure `localStorage`, no Google sign-in required; data merges if you later sign in.
- **PWA** — installable (manifest + icons), service worker with robust cache strategy.

---

## Tech stack

| File | Role |
|---|---|
| `index.html` | All 12 views (onboarding, dashboard, intention, session, break, reward, plan, tasks, history, settings, summary, shop) — `.view.active` toggling, no router |
| `app.js` | The engine: state, view routing, rendering, events, plan mode, shop, summary, history |
| `style.css` | Design system — CSS variables + `[data-theme="x"]` overrides, industrial-terminal aesthetic |
| `storage.js` | `localStorage` wrapper — `defaultState()` is the single source of truth for the state shape, `deepMerge` handles migrations |
| `xp.js` | Pure XP/rank/streak math (level curve, session XP, task bonuses) |
| `timer.js` | Wall-clock countdown (`Date.now`) — survives tab throttling and app restarts |
| `sound.js` | Synthesized Web Audio tones |
| `firebase.js` | Optional Google Auth + Firestore sync (JSON string save/load, offline persistence) |
| `sw.js` | Service worker — network-first for HTML, cache-first for assets |
| `manifest.json` + `icons/` | PWA install metadata + generated icons |

**No build step. No dependencies. No frameworks.**

---

## Run locally

```bash
cd Forge
python3 -m http.server 8000
# open http://localhost:8000
```

> Serve over **http**, not `file://` — Firebase auth and the service worker need a real origin. Localhost counts as a secure context.

**Entry:** type an operative name → **GO**, or click **ENTER OFFLINE MODE** (recommended for pure-local study). Google sign-in works if `localhost` is an authorized domain in the Firebase console; if not, offline mode is the path.

**Reset:** Settings → Danger Zone → Reset All Data, or `localStorage.clear()`.

---

## Tests

```bash
node tests.js
# or open /test.html in the browser
```

13 assertions: storage default, date format, canonical ranks, XP curve, session XP, task XP, level-up, streak continue/reset, timer format/ring, pillar fallback, goal deletion cleanup.

---

## Project docs

The design specs that drove the current build (all in-repo):

- [`PRODUCT_DESIGN.md`](PRODUCT_DESIGN.md) — identity, the reward economy, the "game you play by studying" thesis, design rules
- [`UI_LAYOUT.md`](UI_LAYOUT.md) — dashboard / reward / start-flow layouts
- [`VISUAL_DESIGN.md`](VISUAL_DESIGN.md) — theme system and the thematic-coherence contract
- [`UX_FLOWS.md`](UX_FLOWS.md) — interaction flows + the Q8 promise→delivery map
- [`FORGE_ANALYSIS.md`](FORGE_ANALYSIS.md) — architecture audit + the "why it became unusable" post-mortem

---

## Architecture notes

- **State shape** lives in `storage.js` → `defaultState()` (user, tasks, sessions, today, settings, pillars, goals, weeks). `deepMerge` migrates old shapes forward safely.
- **The god file is real** — `app.js` is ~100 KB and holds most of the app. Deliberately kept single-file for now; modularizing is a known future task.
- **Timer integrity** — sessions anchor to `Date.now`, so closing the tab mid-session restores the countdown; the ring is SVG.
- **Reliability is a feature** — Firebase failing must never brick the app (offline path + 3s auth fallback), because Forge should never become the day's distraction.

---

## Known limitations / roadmap

- `app.js` needs splitting into modules at some point.
- Week from/to dates are manual — not auto-calculated from goal deadlines yet.
- No data export button yet (back up `localStorage.forge_state` via DevTools → Application → Local Storage).
- Coins currently buy only themes/freezes — *user-defined rewards* ("500 coins = guilt-free movie night") is the planned next step for the economy.
- **Vault (not built):** boss fights (goal-as-boss HP bar), ranked multiplayer lobby / leaderboards, real-money staking (risk-flagged), AI task generation.

---

## License

Private / personal project. No license specified.
