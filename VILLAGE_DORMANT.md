# Village — Shelved (Product Decision)

**Status: fully built, deliberately unlinked from the live app.** If you're reading this because you're confused why `village.html` exists but nothing in the app points to it — this is why, and it's on purpose.

## The decision

FORGE's entire premise is using game mechanics to make focused work *easier to start and stick with*. A village/land-builder — buy buildings, upgrade them, arrange your layout, compare with others — is itself an engaging, open-ended activity that demands time and attention.

The problem: the moment "optimizing my village" becomes worth spending real time on, it starts *competing* with actual deep work for your attention, instead of being a quick, satisfying reward for it. That's the opposite of what the rest of FORGE is built to do. Achievements, avatars, streaks, the leaderboard — every other system in this app is deliberately *shallow* in the right way: glance at it, feel good, get back to work. A building system breaks that pattern by design, no matter how well it's built.

That's the reasoning. Nothing about the implementation was broken — see below.

## What's still active (do not touch, unrelated to this decision)

The session-resilience engineering built for village is **general-purpose and still fully protecting every session**, whether or not village exists:

- `sessionRuntime.js` — the entire heartbeat/checkpoint/mercy-abandon system. If a session is running and the tab refreshes or closes, the person gets credited for their real focused time up to the last checkpoint (~15s granularity) instead of losing everything. **This has nothing to do with village specifically** — it protects a plain FORGE session that never touches village.html at all.
- `app.js`'s `finishBootSessionHandling()`, `restoreActiveSession()`, `applyPendingAbandon()`, the heartbeat interval — all active, all still doing their job.

## What's dormant (village-specific only)

- `village.html`, `villagePage.js` — the actual village page. Untouched, still functional if reconnected.
- `app.js`: `renderVillagePreview()` and `goToVillage()` — defined, but nothing calls them anymore. Marked inline with `// DORMANT` comments.
- `app.js`: the `['btn-goto-village', 'btn-session-goto-village'].forEach(...)` click-binding loop — harmless no-op now (both IDs resolve to `null`), kept because it's the one line that would need to exist again if the buttons come back.
- `index.html`: the dashboard preview card and the mid-session "VIEW VILLAGE" button were removed. Marked inline with HTML comments pointing here.
- `style.css`: `.village-preview-*` and `.btn-session-village` rules — unused, kept so restoring the HTML wouldn't require rewriting styles.
- `sessionRuntime.js`: `issueTransferToken`/`consumeTransferToken` (session-bound, for surviving a mid-session page hop) and `issueNavHint`/`consumeNavHint` (cosmetic-only, skips the boot splash on a sanctioned hop) — both still exported and correct, just unused since nothing navigates to village.html anymore.
- `sw.js` — `village.html`, `villagePage.js` are still in the precache list. Harmless (just caches an unreachable page); remove from the list if you want a stricter cleanup, not required.
- Tests: `tests.sessionPersistence.js` covers the village-specific cross-page flows and will still pass (it doesn't require the dashboard/session buttons to exist — it drives `SessionRuntime`/`villagePage.js` directly). `tests.sessionRuntime.js` covers the core checkpoint/mercy system, which is still fully active — do not skip or remove these.

## If this gets revisited later

The actual engineering (cross-page session survival, merciful abandon, the transfer-token vs. nav-hint distinction) holds up and doesn't need to be rebuilt. What would need real thought next time, before writing any UI code again:

1. **What makes it *not* compete with focus time.** Whatever comes back needs to be genuinely shallow — a glance, not a management task. That's the actual constraint that killed this version, not the technology.
2. Re-wire the two dormant entry points (`renderVillagePreview`, `goToVillage`) and their HTML — everything downstream already works.
3. Re-add `village.html`/`villagePage.js` script tags if they were ever removed from `index.html`'s `<head>`/bottom scripts (check first — they may still be there even though nothing links to the page).

## Also fixed while this was being wound down

An unrelated but real layout bug was found and fixed during this same pass: `#app-main` (the container holding every `.view`) was missing its own `overflow: hidden` in the desktop (`@media min-width: 1024px`) layout. Without it, absolutely-positioned `.view` children couldn't get a *definite* height to scroll against, so any view whose content grew taller than the viewport (which is exactly what triggered the original "missing VIEW VILLAGE button" bug report) would silently clip content off the bottom with no way to scroll to it. This fix is independent of the village decision and applies to any current or future view.
