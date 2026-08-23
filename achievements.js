// ═══════════════════════════════════════════════════════
// achievements.js — Achievement system (pure calculation module)
//
// Same philosophy as xp.js: pure functions, no DOM, no state mutation
// except the one explicit exception documented on detectNewUnlocks().
//
// DESIGN — "recompute from scratch, always":
// Every achievement's progress is a pure function of state (sessions,
// tasks, goals, milestones, the existing streak record). Nothing is
// tracked incrementally. This is the same lesson learned from the
// streak-drift bug earlier in this project (see XP.recalcStreak) —
// an incrementally-updated counter can silently drift from the truth;
// recomputing from the real historical data every time cannot.
//
// ANTI-FARMING — why the same event can't be claimed twice:
// Progress values are all monotonic aggregates over real history (best
// single day ever, cumulative completions, longest streak ever, etc).
// state.achievements[familyId].unlockedTiers is a permanent, append-only
// record of tiers already paid out. detectNewUnlocks() only returns a
// tier when the live computed value has crossed a threshold NOT already
// in that record — so recomputing again with no new qualifying data
// (or even the exact same data) returns nothing further. There is no
// discrete "event" to replay; the reward is tied to crossing a
// threshold in the underlying aggregate, which only happens once.
//
// REUSE, NOT DUPLICATION — every family maps to a metric that already
// exists somewhere in FORGE, or is directly derivable from data other
// features already produce:
//   - Iron Streak reuses state.user.streak.longest directly (no new
//     streak logic — that's XP.recalcStreak's job, not this file's).
//   - Milestone Breaker reuses the exact "all linked tasks done" rule
//     plan.js already uses to render a milestone as complete (✓) in
//     the goal detail view — no separate completed flag was added.
//   - Date/week grouping reuses Storage.dateStr / Storage.startOfWeek
//     (the same functions the calendar UI itself uses).
//   - Comeback gap detection reuses XP.getDayGap (the same day-gap
//     math the streak system already runs).
// ═══════════════════════════════════════════════════════

const Achievements = (() => {

  // ── TUNABLE CONSTANTS ──
  // Coin reward is flat per tier across all 12 families, by design — it
  // keeps the reward table predictable and trivial to rebalance later
  // (one place to edit) rather than hand-tuning 36 individual numbers.
  const TIER_COINS = { bronze: 50, silver: 125, gold: 300 };

  // "Started close to their scheduled time" — window in minutes on
  // either side of a task's scheduled start that still counts as "on
  // tempo". Sessions on unscheduled tasks never qualify (nothing to be
  // on time FOR), and never count against the family either.
  const TEMPO_WINDOW_MINUTES = 15;

  // "Meaningful inactivity gap" for The Comeback — a gap of this many
  // calendar days or more between two completed-session days (i.e. at
  // least this-minus-one full days with zero sessions in between).
  const COMEBACK_MIN_GAP_DAYS = 4;

  // "Hit your planned execution target for the week" — percentage of
  // that week's scheduled tasks that must be completed.
  const WEEK_COMMANDER_PCT = 0.9;

  // ── SHARED HELPERS ──
  // (kept here, not duplicated per-family, per the reuse requirement)

  function completedSessions(state) {
    return (state.sessions || []).filter(s => s && s.completed);
  }

  // Actual focused minutes for a session — excludes hold time. Sessions
  // logged before this field existed fall back to the wall-clock span
  // (startTime→endTime), which is an approximation since it may include
  // hold time for those older records.
  function sessionFocusedMinutes(s) {
    if (typeof s.focusedMinutes === 'number') return s.focusedMinutes;
    if (s.startTime && s.endTime) {
      const mins = Math.round((new Date(s.endTime) - new Date(s.startTime)) / 60000);
      return Math.max(0, mins);
    }
    return 0;
  }

  function groupSessionsByLocalDate(state) {
    const map = {};
    completedSessions(state).forEach(s => {
      if (!s.startTime) return;
      const ds = Storage.dateStr(new Date(s.startTime));
      (map[ds] = map[ds] || []).push(s);
    });
    return map;
  }

  function groupTasksByScheduledLocalDate(state) {
    const map = {};
    (state.tasks || []).forEach(t => {
      if (!t.scheduledStart) return;
      const ds = String(t.scheduledStart).slice(0, 10); // scheduledStart is already a local-wall ISO string
      (map[ds] = map[ds] || []).push(t);
    });
    return map;
  }

  function isMilestoneComplete(m, tasks) {
    // Mirrors plan.js renderMilestones() exactly: a milestone is
    // complete when it has at least one linked task and every linked
    // task is done. Not tracked as a separate field on purpose — see
    // file header.
    const linked = (tasks || []).filter(t => t.milestoneId === m.id);
    return linked.length > 0 && linked.every(t => t.completed);
  }

  // ── PER-FAMILY CALCULATORS ──
  // Each returns a single raw number — the family's current best/total
  // "progress value" — compared against tier thresholds below.

  function calcSessionStack(state) {
    const byDate = groupSessionsByLocalDate(state);
    let max = 0;
    for (const ds in byDate) max = Math.max(max, byDate[ds].length);
    return max;
  }

  function calcForgeHours(state) {
    const byDate = groupSessionsByLocalDate(state);
    let maxMinutes = 0;
    for (const ds in byDate) {
      const mins = byDate[ds].reduce((sum, s) => sum + sessionFocusedMinutes(s), 0);
      maxMinutes = Math.max(maxMinutes, mins);
    }
    return maxMinutes / 60;
  }

  function calcDeepForge(state) {
    let max = 0;
    completedSessions(state).forEach(s => {
      max = Math.max(max, sessionFocusedMinutes(s));
    });
    return max;
  }

  function calcIronStreak(state) {
    return (state.user && state.user.streak && state.user.streak.longest) || 0;
  }

  function calcPerfectDay(state) {
    const byDate = groupTasksByScheduledLocalDate(state);
    let count = 0;
    for (const ds in byDate) {
      const dayTasks = byDate[ds];
      // A day with zero scheduled tasks can't be "perfect" — nothing
      // was asked of it. Requires at least one scheduled task.
      if (dayTasks.length > 0 && dayTasks.every(t => t.completed)) count++;
    }
    return count;
  }

  function calcOnTempo(state) {
    let count = 0;
    completedSessions(state).forEach(s => {
      if (!s.taskScheduledStartSnapshot || !s.startTime) return;
      const diffMin = Math.abs(new Date(s.startTime) - new Date(s.taskScheduledStartSnapshot)) / 60000;
      if (diffMin <= TEMPO_WINDOW_MINUTES) count++;
    });
    return count;
  }

  function calcTaskReaper(state) {
    return (state.tasks || []).filter(t => t.completed).length;
  }

  function calcGoalCrusher(state) {
    return (state.goals || []).filter(g => g.status === 'completed').length;
  }

  function calcAheadOfSchedule(state) {
    return (state.goals || []).filter(g =>
      g.status === 'completed' &&
      g.completedAt && g.deadline &&
      g.completedAt.slice(0, 10) <= g.deadline
    ).length;
  }

  function calcWeekCommander(state) {
    const tasksByWeek = {};
    (state.tasks || []).forEach(t => {
      if (!t.scheduledStart) return;
      const weekStart = Storage.dateStr(Storage.startOfWeek(new Date(t.scheduledStart)));
      (tasksByWeek[weekStart] = tasksByWeek[weekStart] || []).push(t);
    });
    let count = 0;
    for (const wk in tasksByWeek) {
      const wkTasks = tasksByWeek[wk];
      if (!wkTasks.length) continue;
      const done = wkTasks.filter(t => t.completed).length;
      if (done / wkTasks.length >= WEEK_COMMANDER_PCT) count++;
    }
    return count;
  }

  function calcTheComeback(state) {
    const dates = Object.keys(groupSessionsByLocalDate(state)).sort();
    let count = 0;
    for (let i = 1; i < dates.length; i++) {
      const gap = XP.getDayGap(dates[i - 1], dates[i]);
      if (gap >= COMEBACK_MIN_GAP_DAYS) count++;
    }
    return count;
  }

  function calcMilestoneBreaker(state) {
    const tasks = state.tasks || [];
    return (state.milestones || []).filter(m => isMilestoneComplete(m, tasks)).length;
  }

  // ── FAMILY DEFINITIONS ──
  const ACHIEVEMENTS = [
    { id: 'session_stack', name: 'Session Stack',
      description: 'Complete multiple focus sessions in a single day.',
      unit: 'sessions', calc: calcSessionStack,
      tiers: [ { tier: 'bronze', threshold: 3 }, { tier: 'silver', threshold: 5 }, { tier: 'gold', threshold: 10 } ] },

    { id: 'forge_hours', name: 'Forge Hours',
      description: 'Rack up focused hours in a single day.',
      unit: 'hours', calc: calcForgeHours,
      tiers: [ { tier: 'bronze', threshold: 3 }, { tier: 'silver', threshold: 6 }, { tier: 'gold', threshold: 10 } ] },

    { id: 'deep_forge', name: 'Deep Forge',
      description: 'Hold focus for one long, uninterrupted session.',
      unit: 'minutes', calc: calcDeepForge,
      tiers: [ { tier: 'bronze', threshold: 60 }, { tier: 'silver', threshold: 90 }, { tier: 'gold', threshold: 120 } ] },

    { id: 'iron_streak', name: 'Iron Streak',
      description: 'Show up, day after day.',
      unit: 'days', calc: calcIronStreak,
      tiers: [ { tier: 'bronze', threshold: 3 }, { tier: 'silver', threshold: 7 }, { tier: 'gold', threshold: 30 } ] },

    { id: 'perfect_day', name: 'Perfect Day',
      description: 'Finish every task you scheduled for the day.',
      unit: 'days', calc: calcPerfectDay,
      tiers: [ { tier: 'bronze', threshold: 1 }, { tier: 'silver', threshold: 3 }, { tier: 'gold', threshold: 7 } ] },

    { id: 'on_tempo', name: 'On Tempo',
      description: 'Start sessions close to when you planned them.',
      unit: 'sessions', calc: calcOnTempo,
      tiers: [ { tier: 'bronze', threshold: 5 }, { tier: 'silver', threshold: 20 }, { tier: 'gold', threshold: 50 } ] },

    { id: 'task_reaper', name: 'Task Reaper',
      description: 'Complete tasks. A lot of them.',
      unit: 'tasks', calc: calcTaskReaper,
      tiers: [ { tier: 'bronze', threshold: 25 }, { tier: 'silver', threshold: 100 }, { tier: 'gold', threshold: 500 } ] },

    { id: 'goal_crusher', name: 'Goal Crusher',
      description: 'Cross goals off for good.',
      unit: 'goals', calc: calcGoalCrusher,
      tiers: [ { tier: 'bronze', threshold: 1 }, { tier: 'silver', threshold: 5 }, { tier: 'gold', threshold: 15 } ] },

    { id: 'ahead_of_schedule', name: 'Ahead of Schedule',
      description: 'Finish goals before their deadline.',
      unit: 'goals', calc: calcAheadOfSchedule,
      tiers: [ { tier: 'bronze', threshold: 1 }, { tier: 'silver', threshold: 3 }, { tier: 'gold', threshold: 10 } ] },

    { id: 'week_commander', name: 'Week Commander',
      description: 'Hit your planned execution target for the week.',
      unit: 'weeks', calc: calcWeekCommander,
      tiers: [ { tier: 'bronze', threshold: 1 }, { tier: 'silver', threshold: 4 }, { tier: 'gold', threshold: 12 } ] },

    { id: 'the_comeback', name: 'The Comeback',
      description: 'Return to productive work after time away.',
      unit: 'comebacks', calc: calcTheComeback,
      tiers: [ { tier: 'bronze', threshold: 1 }, { tier: 'silver', threshold: 3 }, { tier: 'gold', threshold: 10 } ] },

    { id: 'milestone_breaker', name: 'Milestone Breaker',
      description: 'Clear meaningful checkpoints on your goals.',
      unit: 'milestones', calc: calcMilestoneBreaker,
      tiers: [ { tier: 'bronze', threshold: 5 }, { tier: 'silver', threshold: 25 }, { tier: 'gold', threshold: 100 } ] }
  ];

  // ── PROGRESS (read-only, safe to call anytime — no mutation) ──
  // Returns full display data for every family: current value, which
  // tiers are unlocked (persisted OR already crossed live), and what's
  // needed for the next tier.
  function computeProgress(state) {
    const persisted = state.achievements || {};
    return ACHIEVEMENTS.map(fam => {
      const value = fam.calc(state) || 0;
      const persistedTiers = (persisted[fam.id] && persisted[fam.id].unlockedTiers) || [];
      const tiers = fam.tiers.map(t => ({
        tier: t.tier,
        threshold: t.threshold,
        coinReward: TIER_COINS[t.tier],
        // OR with the persisted record — once unlocked, always shown as
        // unlocked, even if the live value later dips below threshold
        // (e.g. a completed task was deleted afterward). Permanence.
        unlocked: value >= t.threshold || persistedTiers.includes(t.tier)
      }));
      const nextTier = tiers.find(t => !t.unlocked) || null;
      return {
        id: fam.id, name: fam.name, description: fam.description, unit: fam.unit,
        value, tiers,
        unlockedTiers: tiers.filter(t => t.unlocked).map(t => t.tier),
        nextTier: nextTier
          ? { tier: nextTier.tier, threshold: nextTier.threshold, progress: Math.min(value, nextTier.threshold) }
          : null
      };
    });
  }

  // ── DETECT + RECORD NEW UNLOCKS (the one function that mutates) ──
  // Call this after any state change that could move achievement
  // progress. Recomputes every family from scratch, compares against
  // the permanent unlocked-tiers record, and — for any tier crossed for
  // the FIRST time — records it (mutates state.achievements) and
  // returns it in the result list so the caller can award coins and
  // notify the user. Calling this again with no new qualifying data
  // returns an empty array; this is what makes farming impossible.
  function detectNewUnlocks(state) {
    if (!state.achievements) state.achievements = {};
    const newly = [];

    ACHIEVEMENTS.forEach(fam => {
      const value = fam.calc(state) || 0;
      if (!state.achievements[fam.id]) state.achievements[fam.id] = { unlockedTiers: [] };
      const rec = state.achievements[fam.id];

      fam.tiers.forEach(t => {
        if (value >= t.threshold && !rec.unlockedTiers.includes(t.tier)) {
          rec.unlockedTiers.push(t.tier); // permanent — never removed
          newly.push({ id: fam.id, name: fam.name, tier: t.tier, coinReward: TIER_COINS[t.tier] });
        }
      });
    });

    return newly;
  }

  return {
    ACHIEVEMENTS,
    TIER_COINS,
    TEMPO_WINDOW_MINUTES,
    COMEBACK_MIN_GAP_DAYS,
    WEEK_COMMANDER_PCT,
    computeProgress,
    detectNewUnlocks,
    // Exposed individually for direct unit testing of each family in
    // isolation, without needing a full detectNewUnlocks() cycle.
    calc: {
      sessionStack: calcSessionStack,
      forgeHours: calcForgeHours,
      deepForge: calcDeepForge,
      ironStreak: calcIronStreak,
      perfectDay: calcPerfectDay,
      onTempo: calcOnTempo,
      taskReaper: calcTaskReaper,
      goalCrusher: calcGoalCrusher,
      aheadOfSchedule: calcAheadOfSchedule,
      weekCommander: calcWeekCommander,
      theComeback: calcTheComeback,
      milestoneBreaker: calcMilestoneBreaker
    },
    _internal: { sessionFocusedMinutes, groupSessionsByLocalDate, isMilestoneComplete }
  };

})();

// Expose for classic-script consumers (app.js, tests read window.Achievements).
if (typeof window !== 'undefined') window.Achievements = Achievements;
