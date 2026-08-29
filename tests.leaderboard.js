// ═══════════════════════════════════════════════════════
// tests.leaderboard.js — characterization tests for leaderboard.js
//
// Runs in Node only (mocks localStorage/window; loads storage.js +
// xp.js + achievements.js + avatars.js + leaderboard.js, same pattern
// as tests.achievements.js and tests.avatars.js).
// ═══════════════════════════════════════════════════════

(() => {
  const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAIL: ' + msg); };
  const log = (...args) => console.log('[LEADERBOARD TEST]', ...args);

  if (typeof require === 'undefined') {
    console.warn('tests.leaderboard.js: Node-only, skipping in browser.');
    return;
  }

  const fs = require('fs');

  global.localStorage = {
    _s: {},
    getItem(k)  { return this._s[k] || null; },
    setItem(k,v){ this._s[k] = v; },
    removeItem(k){ delete this._s[k]; }
  };

  let sCode = fs.readFileSync('./storage.js', 'utf8').replace('const Storage', 'global.Storage');
  eval(sCode);
  const Storage = global.Storage;

  let xCode = fs.readFileSync('./xp.js', 'utf8').replace('const XP', 'global.XP');
  eval(xCode);

  let aCode = fs.readFileSync('./achievements.js', 'utf8').replace('const Achievements', 'global.Achievements');
  eval(aCode);

  let avCode = fs.readFileSync('./avatars.js', 'utf8').replace('const Avatars', 'global.Avatars');
  eval(avCode);

  let lCode = fs.readFileSync('./leaderboard.js', 'utf8').replace('const Leaderboard', 'global.Leaderboard');
  eval(lCode);

  // window must exist AFTER all modules load (colliding with each
  // file's own trailing export line otherwise — see tests.avatars.js)
  global.window = global;

  const Leaderboard = global.Leaderboard;

  function freshState() { return Storage.defaultState(); }
  function mkSession(dateISO, opts = {}) {
    return Object.assign({
      id: Storage.uuid(), completed: true, startTime: dateISO, endTime: dateISO,
      focusedMinutes: 60
    }, opts);
  }

  function run() {
    log('Starting leaderboard tests...');

    // ═══════════════════════════════════════════════════
    // 1. METRIC CALCULATIONS
    // ═══════════════════════════════════════════════════

    {
      const st = freshState();
      st.user.streak.current = 9;
      assert(Leaderboard.calcStreak(st) === 9, 'calcStreak reads user.streak.current');
    }

    {
      const st = freshState();
      st.user.level = 7;
      assert(Leaderboard.calcLevel(st) === 7, 'calcLevel reads user.level');
    }

    {
      const st = freshState();
      st.sessions = [
        mkSession('2026-08-10T09:00:00', { focusedMinutes: 60 }),
        mkSession('2026-08-11T09:00:00', { focusedMinutes: 90 }),
        mkSession('2026-08-12T09:00:00', { focusedMinutes: 30, completed: false }) // incomplete — must not count
      ];
      // 60 + 90 = 150 min = 2.5 hours
      assert(Leaderboard.calcTotalHours(st) === 2.5, 'calcTotalHours sums only completed sessions, got ' + Leaderboard.calcTotalHours(st));
    }

    {
      const st = freshState();
      st.sessions = [];
      assert(Leaderboard.calcTotalHours(st) === 0, 'calcTotalHours on empty session list is 0');
    }

    {
      // Legacy session with no focusedMinutes falls back to wall-clock
      // span — same reasoning as achievements.js Deep Forge.
      const st = freshState();
      st.sessions = [{
        id: 'x', completed: true,
        startTime: '2026-08-10T09:00:00', endTime: '2026-08-10T10:30:00'
        // no focusedMinutes field
      }];
      assert(Leaderboard.calcTotalHours(st) === 1.5, 'calcTotalHours falls back to wall-clock span for legacy sessions, got ' + Leaderboard.calcTotalHours(st));
    }

    {
      // Rounds to 1 decimal place, doesn't leave long floats
      const st = freshState();
      st.sessions = [mkSession('2026-08-10T09:00:00', { focusedMinutes: 37 })]; // 0.6166...hr
      assert(Leaderboard.calcTotalHours(st) === 0.6, 'calcTotalHours rounds to 1 decimal, got ' + Leaderboard.calcTotalHours(st));
    }

    log('✓ metric calculations: streak, level, total hours (including legacy fallback + rounding)');

    // ═══════════════════════════════════════════════════
    // 2. BUILD ENTRY — the exact public-safe shape
    // ═══════════════════════════════════════════════════

    {
      const st = freshState();
      st.user.name = 'TESTER';
      st.user.level = 4;
      st.user.streak.current = 6;
      st.sessions = [mkSession('2026-08-10T09:00:00', { focusedMinutes: 120 })];

      const entry = Leaderboard.buildEntry(st, 'uid-123');
      assert(entry.uid === 'uid-123', 'buildEntry sets the uid passed in');
      assert(entry.name === 'TESTER', 'buildEntry reads the real name');
      assert(entry.level === 4, 'buildEntry reads the real level');
      assert(entry.streak === 6, 'buildEntry reads the real streak');
      assert(entry.totalHours === 2, 'buildEntry computes total hours, got ' + entry.totalHours);
      assert(entry.avatar === 'operative', 'buildEntry defaults to the active avatar (operative by default)');
      // Exactly these fields — nothing extra leaks from private state
      const keys = Object.keys(entry).sort();
      assert(JSON.stringify(keys) === JSON.stringify(['avatar','level','name','streak','totalHours','uid']),
        'buildEntry exposes ONLY the intended public fields, got ' + JSON.stringify(keys));
      log('✓ buildEntry produces the exact minimal public-safe shape, nothing extra leaks');
    }

    {
      const st = freshState();
      st.user.name = ''; // no name set
      const entry = Leaderboard.buildEntry(st, 'uid-456');
      assert(entry.name === 'OPERATIVE', 'buildEntry defaults an empty name to OPERATIVE, got "' + entry.name + '"');
    }

    {
      // Reflects a purchased/selected avatar, not just the default
      const st = freshState();
      st.user.coins = 5000;
      Avatars.purchase(st, 'vanguard');
      Avatars.selectAvatar(st, 'vanguard');
      const entry = Leaderboard.buildEntry(st, 'uid-789');
      assert(entry.avatar === 'vanguard', 'buildEntry reflects the actually-selected avatar, got ' + entry.avatar);
      log('✓ buildEntry reflects name defaults and the real selected avatar');
    }

    // ═══════════════════════════════════════════════════
    // 3. hasChanged — avoids redundant syncs
    // ═══════════════════════════════════════════════════

    {
      const entry = { uid: 'u1', name: 'A', avatar: 'operative', level: 1, streak: 0, totalHours: 0 };
      assert(Leaderboard.hasChanged(null, entry) === true, 'hasChanged is true when there is no previous snapshot (first sync)');
    }

    {
      const entry = { uid: 'u1', name: 'A', avatar: 'operative', level: 3, streak: 5, totalHours: 2.5 };
      const same  = { uid: 'u1', name: 'A', avatar: 'operative', level: 3, streak: 5, totalHours: 2.5 };
      assert(Leaderboard.hasChanged(entry, same) === false, 'hasChanged is false when nothing rank-relevant moved');
    }

    {
      const prev = { name: 'A', avatar: 'operative', level: 3, streak: 5, totalHours: 2.5 };
      const next = { name: 'A', avatar: 'operative', level: 4, streak: 5, totalHours: 2.5 };
      assert(Leaderboard.hasChanged(prev, next) === true, 'hasChanged is true when level changed');
    }

    {
      const prev = { name: 'A', avatar: 'operative', level: 3, streak: 5, totalHours: 2.5 };
      const next = { name: 'A', avatar: 'operative', level: 3, streak: 6, totalHours: 2.5 };
      assert(Leaderboard.hasChanged(prev, next) === true, 'hasChanged is true when streak changed');
    }

    {
      const prev = { name: 'A', avatar: 'operative', level: 3, streak: 5, totalHours: 2.5 };
      const next = { name: 'A', avatar: 'operative', level: 3, streak: 5, totalHours: 3.0 };
      assert(Leaderboard.hasChanged(prev, next) === true, 'hasChanged is true when totalHours changed');
    }

    {
      const prev = { name: 'A', avatar: 'operative', level: 3, streak: 5, totalHours: 2.5 };
      const next = { name: 'B', avatar: 'operative', level: 3, streak: 5, totalHours: 2.5 };
      assert(Leaderboard.hasChanged(prev, next) === true, 'hasChanged is true when the name changed (e.g. renamed in settings)');
    }

    {
      const prev = { name: 'A', avatar: 'operative', level: 3, streak: 5, totalHours: 2.5 };
      const next = { name: 'A', avatar: 'vanguard', level: 3, streak: 5, totalHours: 2.5 };
      assert(Leaderboard.hasChanged(prev, next) === true, 'hasChanged is true when the avatar changed');
    }

    log('✓ hasChanged correctly gates syncs — only fires on rank-relevant or display changes, never on nothing');

    // ═══════════════════════════════════════════════════
    // 4. METRICS table — sanity check the definitions used to drive
    //    both the UI tabs and the Firestore orderBy() field names
    // ═══════════════════════════════════════════════════
    {
      const ids = Leaderboard.METRICS.map(m => m.id).sort();
      assert(JSON.stringify(ids) === JSON.stringify(['hours','level','streak']), 'exactly the three intended metrics exist, got ' + JSON.stringify(ids));
      Leaderboard.METRICS.forEach(m => {
        assert(typeof m.field === 'string' && m.field.length > 0, m.id + ' has a Firestore field name');
        assert(typeof m.calc === 'function', m.id + ' has a calc function');
      });
      log('✓ METRICS table is complete and well-formed');
    }

    log('All leaderboard tests passed ✅ — metric calculations, entry building, and sync-gating verified');
  }

  try { run(); } catch (e) { console.error(e); process.exit(1); }

})();
