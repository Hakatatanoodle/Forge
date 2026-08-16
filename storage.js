// ═══════════════════════════════════════════════════════
// storage.js — localStorage abstraction layer
// All reads/writes go through here. One source of truth.
// ═══════════════════════════════════════════════════════

const Storage = (() => {

  const KEY = 'forge_state';

  // Schema version. Bump when the state shape changes in a way that needs
  // an explicit migration (deepMerge alone cannot fix arrays — it replaces
  // them wholesale, so saved tasks never gain new default fields).
  const SCHEMA_VERSION = 13;

  // ── DEFAULT STATE ──
  const defaultState = () => ({
    schemaVersion: SCHEMA_VERSION,
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
      lastSummaryWeek: null, // 'YYYY-WNN' — last week summary was shown
      railCollapsed: false  // desktop sidebar collapsed to icon-only rail
    },
    pillars: [
      { id: 'academics', name: 'ACADEMICS', color: '#4caf7d', icon: '📚' },
      { id: 'gamedev',   name: 'GAMEDEV',   color: '#7b9de8', icon: '🎮' },
      { id: 'other',     name: 'OTHER',     color: '#888880', icon: '◎'  }
    ],
    goals: [],
    // goal shape:
    //   { id, pillarId, title, description, deadline, createdAt, status }
    //   status: 'active' | 'completed'
    //   NOTE: goals no longer own "weeks". A goal is an OUTCOME with a
    //   deadline; temporal organisation belongs to the calendar.
    milestones: []
    // milestone shape: { id, goalId, title, order, createdAt }
    // Optional, meaningful checkpoints ("Prototype complete") — never "Week 3".
  });

  // ── TASK SHAPE (documentation) ──
  // {
  //   id, text,
  //   tag,              // pillarId
  //   goalId,           // WHY this task exists
  //   milestoneId,      // optional checkpoint
  //   estimatedMinutes, // drives calendar block height + capacity math
  //   scheduledStart,   // ISO datetime string, or null === UNSCHEDULED
  //   scheduledEnd,     // ISO datetime string, or null
  //   priority,         // 'low' | 'medium' | 'high'
  //   notes,
  //   completed, xpMultiplier, createdAt, completedAt
  // }
  // There is exactly ONE scheduling field pair (scheduledStart/End).
  // `weekId` and `day` are gone — they were two independent, mutually
  // contradictory scheduling models.
  const taskDefaults = () => ({
    goalId:           null,
    milestoneId:      null,
    estimatedMinutes: 60,
    scheduledStart:   null,
    scheduledEnd:     null,
    priority:         'medium',
    notes:            ''
  });

  // ── MIGRATE ──
  // Runs on every load; idempotent. deepMerge cannot do this work because
  // it replaces arrays wholesale rather than merging their elements.
  //
  // v12 — Plan Mode redesign:
  //   PILLARS → GOALS → TASKS → CALENDAR
  //   • drops state.weeks entirely (artificial "Week 1..N" containers)
  //   • drops task.weekId and task.day (two competing scheduling models)
  //   • every task starts UNSCHEDULED — the user deliberately commits each
  //     one to real time on the calendar
  //   • adds milestones[] and the new task fields
  function migrate(state) {
    if (!state || typeof state !== 'object') return state;

    const from = state.schemaVersion || 0;

    if (from < 13) {
      // Artificial week containers carry no schedulable information —
      // their fromDate/toDate were almost always blank. Drop them.
      delete state.weeks;

      // Goals: weekCount was only ever used to auto-generate week objects.
      (state.goals || []).forEach(g => {
        delete g.weekCount;
        if (typeof g.description !== 'string') g.description = '';
      });

      // Tasks: strip both legacy scheduling fields, backfill new ones.
      // Per product decision, nothing is auto-scheduled: task.day was a
      // bare weekday int with no date attached, so it could not be mapped
      // to a real point in time with any confidence.
      const defaults = taskDefaults();
      (state.tasks || []).forEach(t => {
        delete t.weekId;
        delete t.day;
        for (const key in defaults) {
          if (t[key] === undefined) t[key] = defaults[key];
        }
        // A task that was already finished shouldn't demand scheduling.
        if (t.completed) {
          t.scheduledStart = t.scheduledStart || null;
          t.scheduledEnd   = t.scheduledEnd   || null;
        }
      });

      if (!Array.isArray(state.milestones)) state.milestones = [];
    }

    // ── Data hygiene: fix tasks whose text was accidentally set to their
    //    goal's title (bug in an earlier addGoalTask). Rename them clearly
    //    so the user knows to update them, rather than silently showing
    //    the wrong name.
    const goalTitleMap = {};
    (state.goals || []).forEach(g => {
      if (g.title) goalTitleMap[g.title.trim().toLowerCase()] = true;
    });
    (state.tasks || []).forEach(t => {
      const txt = (t.text || '').trim();
      if (!txt) {
        t.text = 'Unnamed task (tap to rename)';
      } else if (goalTitleMap[txt.toLowerCase()]) {
        // Text exactly matches any goal title — was never properly named
        t.text = 'New task (tap to rename)';
      }
    });

    state.schemaVersion = SCHEMA_VERSION;
    return state;
  }

  // ── LOAD ──
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      const saved = JSON.parse(raw);
      // Deep merge: ensure new default keys exist if state is old
      const base = defaultState();
      return migrate(deepMerge(base, saved));
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

  // ── DATE/TIME UTILS for the calendar ──
  // All local-time, never UTC (see todayStr note above).

  // Date object → 'YYYY-MM-DD'
  function dateStr(d) {
    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // Date object → 'YYYY-MM-DDTHH:MM:SS' (local, no timezone suffix).
  // Deliberately NOT toISOString(), which converts to UTC and would shift
  // a 09:00 Kathmandu block to 03:15 the same morning.
  function localISO(d) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${dateStr(d)}T${hh}:${mi}:${ss}`;
  }

  // 'YYYY-MM-DDTHH:MM:SS' → Date (parsed as local time)
  function parseLocal(iso) {
    if (!iso) return null;
    const [datePart, timePart = '00:00:00'] = String(iso).split('T');
    const [y, m, d]    = datePart.split('-').map(Number);
    const [hh, mi, ss] = timePart.split(':').map(Number);
    return new Date(y, m - 1, d, hh || 0, mi || 0, ss || 0);
  }

  // Monday 00:00 of the week containing `d`
  function startOfWeek(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    const dow = x.getDay();            // 0=Sun
    x.setDate(x.getDate() - ((dow + 6) % 7));
    return x;
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  return {
    load, save, reset, uuid, todayStr, defaultState, deepMerge,
    migrate, taskDefaults, SCHEMA_VERSION,
    dateStr, localISO, parseLocal, startOfWeek, addDays
  };

})();

// Expose for classic-script consumers (tests.js reads window.Storage).
// `const Storage` above is a global lexical binding, not a window property.
if (typeof window !== 'undefined') window.Storage = Storage;
