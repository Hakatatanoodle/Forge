// ═══════════════════════════════════════════════════════
// storage.js — localStorage abstraction layer
// All reads/writes go through here. One source of truth.
// ═══════════════════════════════════════════════════════

const Storage = (() => {

  const KEY = 'forge_state';

  // ── DEFAULT STATE ──
  const defaultState = () => ({
    user: {
      name: '',
      xp: 0,
      level: 1,
      totalSessions: 0,
      rank: 'INITIATE',
      coins: 0,
      unlockedThemes: ['forge', 'venom'], // forge + venom always free
      activeTheme: 'forge',
      streak: {
        current: 0,
        longest: 0,
        lastActiveDate: null,
        freezesAvailable: 0  // earned via shop
      }
    },
    tasks: [],
    sessions: [],
    today: {
      date: null,
      sessionsCompleted: 0
    },
    settings: {
      workMinutes: 50,
      breakMinutes: 10,
      soundEnabled: true,
      summaryDay: 0,        // 0=Sun,1=Mon...6=Sat — day to show weekly summary
      lastSummaryWeek: null // 'YYYY-WNN' — last week summary was shown
    },
    pillars: [
      { id: 'academics', name: 'ACADEMICS', color: '#4caf7d', icon: '📚' },
      { id: 'gamedev',   name: 'GAMEDEV',   color: '#7b9de8', icon: '🎮' },
      { id: 'other',     name: 'OTHER',     color: '#888880', icon: '◎'  }
    ],
    goals: [],
    // goal shape: { id, pillarId, title, deadline, sessionsTarget, createdAt, status }
    // status: 'active' | 'completed' | 'archived'
    sprints: []
    // sprint shape: { id, goalId, weekNumber, focus, sessionsTarget, status, createdAt, completedAt }
    // status: 'active' | 'completed'
  });

  // ── LOAD ──
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      const saved = JSON.parse(raw);
      // Deep merge: ensure new default keys exist if state is old
      const base = defaultState();
      return deepMerge(base, saved);
    } catch (e) {
      console.warn('FORGE: State load failed, using default.', e);
      return defaultState();
    }
  }

  // ── SAVE ──
  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.error('FORGE: State save failed.', e);
    }
  }

  // ── RESET (dev/debug) ──
  function reset() {
    localStorage.removeItem(KEY);
    return defaultState();
  }

  // ── DEEP MERGE helper ──
  // Ensures old saves get new fields added in updates
  function deepMerge(target, source) {
    const result = { ...target };
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  // ── GENERATE UUID ──
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  // ── DATE UTILS ──
  // IMPORTANT: Uses local date, NOT UTC.
  // toISOString() always returns UTC — which breaks streak logic for
  // timezones far from UTC (e.g. Nepal UTC+5:45, Australia UTC+10).
  // A session done at 1am local time would count as "yesterday" in UTC.
  function todayStr() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  return { load, save, reset, uuid, todayStr, defaultState, deepMerge };

})();
