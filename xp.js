// ═══════════════════════════════════════════════════════
// xp.js — XP engine, level progression, streaks, ranks
// Pure calculation functions. No DOM, no state mutation.
// ═══════════════════════════════════════════════════════

const XP = (() => {

  // ── RANK TABLE ──
  // Identity anchoring: what you're called matters.
  // Canonical 8 ranks — must match THEME_RANKS keys in app.js (INITIATE, APPRENTICE, OPERATOR, SPECIALIST, VETERAN, ELITE, COMMANDER, LEGEND)
  const RANKS = [
    { minLevel: 1,  title: 'INITIATE'    },
    { minLevel: 3,  title: 'APPRENTICE'  },
    { minLevel: 6,  title: 'OPERATOR'    },
    { minLevel: 10, title: 'SPECIALIST'  },
    { minLevel: 15, title: 'VETERAN'     },
    { minLevel: 20, title: 'ELITE'       },
    { minLevel: 30, title: 'COMMANDER'   },
    { minLevel: 50, title: 'LEGEND'      },
  ];

  // ── BREAK TIPS ──
  const BREAK_TIPS = [
    "Step away from the screen.",
    "Drink some water.",
    "Walk for 5 minutes.",
    "Look at something 20+ feet away.",
    "Stretch your hands and wrists.",
    "Take 5 deep breaths.",
    "Stand up. Move your body.",
    "Rest your eyes. You earned it.",
  ];

  // ── XP TO REACH NEXT LEVEL ──
  // Non-linear curve. Level 1→2 is easy. Higher levels cost more.
  function xpForLevel(level) {
    return Math.floor(500 * Math.pow(level, 1.6));
  }

  // ── CALCULATE SESSION XP ──
  // Base: 100 XP per 25 minutes
  // × time scaling (sessionMinutes / 25)
  // × deep work bonus (1.0 / 1.1 / 1.2 for <90 / 90-119 / 120+ min)
  // × difficulty multiplier (1.0, 1.5, 2.0)
  // × streak multiplier (1 + streak * 0.05, capped at 2.0)
  // × level bonus (+10% per 5 levels, capped at +50%)
  // Variable bonus: ~15% chance of +50 XP "Focus Bonus"
  function calculateSessionXP(difficultyMultiplier, streakDays, sessionMinutes, level) {
    const basePer25 = 100;
    const mins = sessionMinutes || 25;

    // Time scaling — longer sessions earn proportionally more
    const timeScale = mins / 25;

    // Deep work bonus — reward for committing to long sessions
    let deepWorkBonus = 1.0;
    if (mins >= 120) deepWorkBonus = 1.2;
    else if (mins >= 90) deepWorkBonus = 1.1;

    const streakMult = Math.min(1 + (streakDays * 0.05), 2.0);

    // Level bonus — every 5 levels = +10% XP, capped at +50% (level 25+)
    // Mirrors game design: higher level = tougher content = more XP
    const lvl = level || 1;
    const levelBonus = 1 + (Math.min(Math.floor((lvl - 1) / 5), 5) * 0.10);

    const earned = Math.round(basePer25 * timeScale * deepWorkBonus * difficultyMultiplier * streakMult * levelBonus);

    // Variable reward — 15% chance of Focus Bonus
    const bonusTriggered = Math.random() < 0.15;
    const bonusXP = bonusTriggered ? 50 : 0;

    // Coins: 1 per 10 XP earned + bonus on focus bonus
    const coinsEarned = Math.floor(earned / 10) + (bonusTriggered ? 5 : 0);

    return {
      base: earned,
      bonus: bonusXP,
      total: earned + bonusXP,
      bonusTriggered,
      coinsEarned
    };
  }

  // ── CALCULATE TASK COMPLETION XP ──
  // Bonus XP earned when user marks a task as DONE after a session.
  // Intentionally less than session XP — rewards result, not just work.
  // Easy=50, Medium=75, Hard=100
  // Cannot be earned by manually ticking tasks — only via reward screen.
  function calculateTaskXP(xpMultiplier) {
    const base = 50;
    return Math.round(base * xpMultiplier);
  }

  // ── APPLY XP TO USER ──
  // Returns updated user object + levelup info
  function applyXP(user, xpGained) {
    let { xp, level } = user;
    xp += xpGained;

    let levelsGained = 0;
    let prevRank = getRank(level);

    // Keep leveling up while XP threshold exceeded
    while (xp >= xpForLevel(level)) {
      xp -= xpForLevel(level);
      level++;
      levelsGained++;
    }

    const newRank = getRank(level);
    const rankChanged = newRank !== prevRank;

    return {
      updatedUser: { ...user, xp, level, rank: newRank },
      levelsGained,
      newLevel: level,
      rankChanged,
      newRank
    };
  }

  // ── GET RANK TITLE FOR LEVEL ──
  function getRank(level) {
    let rank = RANKS[0].title;
    for (const r of RANKS) {
      if (level >= r.minLevel) rank = r.title;
    }
    return rank;
  }

  // ── XP PROGRESS PERCENTAGE ──
  function xpProgress(user) {
    const needed = xpForLevel(user.level);
    return Math.min((user.xp / needed) * 100, 100);
  }

  // ── UPDATE STREAK ──
  // Called when a session is completed.
  // Handles: new streak, continuation, break, same-day repeat
  // todayStr: "YYYY-MM-DD" string passed in — keeps xp.js pure (no Storage dep)
  function updateStreak(streak, todayStr) {
    const today = todayStr || new Date().toISOString().split('T')[0];
    const last = streak.lastActiveDate;

    let { current, longest, freezesAvailable } = streak;

    const yesterday = getPreviousDay(today);

    if (last === today) {
      // Already logged today — no change to streak count
      return { ...streak };
    }

    if (last === yesterday) {
      // Continued streak
      current += 1;
      if (current > longest) longest = current;
    } else if (last === null) {
      // First ever session
      current = 1;
      longest = 1;
    } else {
      // Streak broken — check for freeze
      const dayGap = getDayGap(last, today);
      if (dayGap === 2 && freezesAvailable > 0) {
        current += 1;
        freezesAvailable -= 1;
        streak.lastFreezeUsed = today; // mark so dashboard shows frozen state
        if (current > longest) longest = current;
      } else {
        current = 1; // reset streak
      }
    }

    // Earn a new freeze every 7 consecutive days
    if (current > 0 && current % 7 === 0) {
      freezesAvailable = Math.min(freezesAvailable + 1, 3); // max 3 freezes
    }

    return {
      current,
      longest,
      lastActiveDate: today,
      freezesAvailable,
      lastFreezeUsed: streak.lastFreezeUsed || null
    };
  }

  // ── SELF-HEALING STREAK RECOMPUTE ──
  // The incremental updateStreak() above can drift from the truth over time —
  // timezone edge cases around midnight, old bugs, manual data edits. Rather
  // than trust a running counter forever, rebuild current/longest by replaying
  // the actual session history through the SAME logic used live. This makes
  // the number always match what really happened, permanently.
  //
  // Only current/longest/lastActiveDate are corrected — the user's real
  // freezesAvailable balance (earned + purchased) is left untouched, since
  // it's a resource, not a derived value. The replay starts fresh at 0
  // freezes purely to decide which historical gaps *would* have been
  // bridged, matching the live app's own behavior.
  function recalcStreak(sessions, realFreezesAvailable) {
    const dates = [...new Set(
      (sessions || [])
        .filter(s => s && s.startTime)
        .map(s => {
          const d = new Date(s.startTime);
          const yyyy = d.getFullYear();
          const mm   = String(d.getMonth() + 1).padStart(2, '0');
          const dd   = String(d.getDate()).padStart(2, '0');
          return `${yyyy}-${mm}-${dd}`;
        })
    )].sort();

    let streak = { current: 0, longest: 0, lastActiveDate: null, freezesAvailable: 0, lastFreezeUsed: null };
    for (const ds of dates) {
      streak = updateStreak(streak, ds);
    }

    return {
      current:         streak.current,
      longest:         streak.longest,
      lastActiveDate:  streak.lastActiveDate,
      freezesAvailable: realFreezesAvailable, // preserve the real resource
      lastFreezeUsed:  streak.lastFreezeUsed
    };
  }


  // Returns true if it's after 20:00 and no session today
  function isStreakAtRisk(streak) {
    if (!streak.lastActiveDate || streak.current === 0) return false;
    const today = Storage.todayStr();
    if (streak.lastActiveDate === today) return false; // already logged today
    const hour = new Date().getHours();
    return hour >= 20; // 8 PM or later
  }

  // ── HELPERS ──
  // ── DATE HELPERS ──
  // Both use local-date arithmetic only — no toISOString() to avoid UTC bleed.
  function getPreviousDay(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function getDayGap(fromStr, toStr) {
    const from = new Date(fromStr + 'T00:00:00');
    const to   = new Date(toStr   + 'T00:00:00');
    return Math.round((to - from) / (1000 * 60 * 60 * 24));
  }

  function randomBreakTip() {
    return BREAK_TIPS[Math.floor(Math.random() * BREAK_TIPS.length)];
  }

  return {
    xpForLevel,
    calculateSessionXP,
    calculateTaskXP,
    applyXP,
    getRank,
    xpProgress,
    updateStreak,
    recalcStreak,
    isStreakAtRisk,
    randomBreakTip,
    getDayGap,
    RANKS
  };

})();

// Expose for classic-script consumers (tests.js reads window.XP).
if (typeof window !== 'undefined') window.XP = XP;
