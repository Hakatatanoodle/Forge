// ═══════════════════════════════════════════════════════
// leaderboard.js — Leaderboard system (pure calculation module)
//
// Same philosophy as xp.js / achievements.js: pure functions, no DOM.
// Actual reading/writing to the shared leaderboard collection lives in
// firebase.js (FB.syncLeaderboardEntry / FB.getLeaderboard) — this file
// only computes what SHOULD be in your public entry from your own
// private state, and never touches Firestore directly.
//
// WHY A SEPARATE PUBLIC COLLECTION, NOT THE PRIVATE users/{uid} DOC:
// Every other piece of FORGE data (tasks, goals, sessions, intentions)
// is private by design — only you can read your own users/{uid}
// document. A leaderboard needs the opposite: a few fields readable by
// everyone. Rather than loosen the private document's read rules (which
// would leak your entire task/goal/session history to every other
// user), a small separate `leaderboard/{uid}` document holds ONLY the
// three ranking numbers plus display info (name, avatar). Nothing else
// about your account is ever exposed through this collection.
//
// ANTI-CHEAT, HONESTLY STATED: without a server (no Cloud Functions —
// not available on this Firebase plan), there is no way to PROVE a
// write matches the truth. What this system CAN do, entirely through
// Firestore security rules (see the rules block below, applied in the
// Firebase console — not enforceable from client code alone):
//   - You can only write your OWN leaderboard entry.
//   - Values are bounds-checked (no negative streaks, no level 99999).
//   - A single write can't jump a value further than one real session
//     could plausibly produce (blocks one-shot "type a big number in
//     DevTools" attempts).
// It does NOT stop someone from editing their own PRIVATE save data
// first and then legitimately syncing that (fake) data up — closing
// that hole would require moving XP-granting itself server-side, which
// breaks offline mode. This is a deliberate, documented trade-off for
// an app at this scale, not an oversight.
// ═══════════════════════════════════════════════════════

const Leaderboard = (() => {

  // Metrics the leaderboard can be sorted by. `field` must match the
  // Firestore document field name exactly (see buildEntry below) —
  // Firestore's orderBy() queries against this field name directly.
  const METRICS = [
    { id: 'streak', field: 'streak',     label: 'STREAK',      unit: 'days',  calc: calcStreak },
    { id: 'level',  field: 'level',      label: 'LEVEL',       unit: '',      calc: calcLevel  },
    { id: 'hours',  field: 'totalHours', label: 'HOURS LOGGED',unit: 'hrs',   calc: calcTotalHours }
  ];

  function calcStreak(state) {
    return (state.user && state.user.streak && state.user.streak.current) || 0;
  }

  function calcLevel(state) {
    return (state.user && state.user.level) || 1;
  }

  // Total focused hours across every completed session, ever. Reuses
  // achievements.js's sessionFocusedMinutes (excludes hold time) rather
  // than re-deriving from raw startTime/endTime spans — same reasoning
  // as Deep Forge / Forge Hours: don't count paused time as worked time.
  function calcTotalHours(state) {
    if (typeof window === 'undefined' || !window.Achievements) return 0;
    const sessions = (state.sessions || []).filter(s => s && s.completed);
    const totalMinutes = sessions.reduce(
      (sum, s) => sum + Achievements._internal.sessionFocusedMinutes(s), 0
    );
    return Math.round((totalMinutes / 60) * 10) / 10; // 1 decimal place
  }

  // ── Build the public-safe entry for the current user ──
  // This is the ENTIRE set of fields that ever leaves your private
  // account and becomes visible to others. Deliberately minimal.
  function buildEntry(state, uid) {
    const avatar = (typeof window !== 'undefined' && window.Avatars)
      ? Avatars.getActiveAvatar(state).id
      : 'operative';

    return {
      uid,
      name:       (state.user && state.user.name) || 'OPERATIVE',
      avatar,
      level:      calcLevel(state),
      streak:     calcStreak(state),
      totalHours: calcTotalHours(state)
    };
  }

  // Given a previously-synced snapshot and the current one, decide
  // whether a re-sync is actually worth a Firestore write. Avoids
  // hammering the leaderboard collection on every trivial state change
  // (e.g. renaming a task doesn't move any ranking number).
  function hasChanged(prevEntry, nextEntry) {
    if (!prevEntry) return true;
    return prevEntry.level !== nextEntry.level
        || prevEntry.streak !== nextEntry.streak
        || prevEntry.totalHours !== nextEntry.totalHours
        || prevEntry.name !== nextEntry.name
        || prevEntry.avatar !== nextEntry.avatar;
  }

  return { METRICS, buildEntry, hasChanged, calcStreak, calcLevel, calcTotalHours };

})();

// Expose for classic-script consumers (app.js, tests read window.Leaderboard).
if (typeof window !== 'undefined') window.Leaderboard = Leaderboard;
