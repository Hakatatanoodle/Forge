// ═══════════════════════════════════════════════════════
// tests.avatars.js — characterization tests for avatars.js
//
// Runs in Node only (mocks localStorage; loads storage.js + xp.js +
// achievements.js + avatars.js, same pattern as tests.repository.js
// and tests.achievements.js).
// ═══════════════════════════════════════════════════════

(() => {
  const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAIL: ' + msg); };
  const log = (...args) => console.log('[AVATAR TEST]', ...args);

  if (typeof require === 'undefined') {
    console.warn('tests.avatars.js: Node-only, skipping in browser.');
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
  const Achievements = global.Achievements;

  let avCode = fs.readFileSync('./avatars.js', 'utf8').replace('const Avatars', 'global.Avatars');
  eval(avCode);
  const Avatars = global.Avatars;

  // Set up window AFTER all modules have loaded — avatars.js checks
  // `typeof window !== 'undefined' && window.Achievements` at CALL time
  // (not load time), so this only needs to exist before the test code
  // below actually calls Avatars functions. Setting it earlier would
  // collide with each file's own trailing `if (typeof window...)
  // window.X = X` export line, which references the bare (now renamed
  // away) identifier and throws.
  global.window = global;

  function freshState() { return Storage.defaultState(); }
  function mkSession(dateISO, opts = {}) {
    return Object.assign({
      id: Storage.uuid(), completed: true, startTime: dateISO, endTime: dateISO,
      focusedMinutes: 25, taskScheduledStartSnapshot: null
    }, opts);
  }

  function run() {
    log('Starting avatar tests...');

    // ═══════════════════════════════════════════════════
    // 1. DEFAULT TIER — always owned, free, no state needed
    // ═══════════════════════════════════════════════════
    {
      const st = freshState();
      assert(Avatars.isOwned(st, 'operative'), 'operative (default) is always owned');
      assert(Avatars.isOwned(st, 'forgeborn'), 'forgeborn (default) is always owned');
      assert(!Avatars.isOwned(st, 'vanguard'), 'coins-tier avatar NOT owned by default');
      assert(!Avatars.isOwned(st, 'ironborn'), 'achievement-tier avatar NOT owned by default');
      log('✓ default tier: always owned, nothing else is');
    }

    // ═══════════════════════════════════════════════════
    // 2. PURCHASE — coins tier
    // ═══════════════════════════════════════════════════
    {
      const st = freshState();
      st.user.coins = 100;
      const fail = Avatars.purchase(st, 'vanguard'); // costs 300
      assert(fail.ok === false && fail.reason === 'insufficient coins', 'purchase fails with insufficient coins');
      assert(!Avatars.isOwned(st, 'vanguard'), 'not owned after failed purchase');
      assert(st.user.coins === 100, 'coins untouched after failed purchase');
    }

    {
      const st = freshState();
      st.user.coins = 500;
      const result = Avatars.purchase(st, 'vanguard'); // costs 300
      assert(result.ok === true, 'purchase succeeds with enough coins');
      assert(st.user.coins === 200, 'coins deducted correctly (500-300=200), got ' + st.user.coins);
      assert(Avatars.isOwned(st, 'vanguard'), 'owned after successful purchase');
    }

    {
      const st = freshState();
      st.user.coins = 10000;
      Avatars.purchase(st, 'vanguard');
      const coinsAfterFirst = st.user.coins;
      const second = Avatars.purchase(st, 'vanguard'); // already owned
      assert(second.ok === false && second.reason === 'already owned', 'cannot buy the same avatar twice');
      assert(st.user.coins === coinsAfterFirst, 'coins not deducted again for an already-owned avatar');
      log('✓ purchase: coin deduction, insufficient-funds guard, no double-purchase');
    }

    {
      const st = freshState();
      st.user.coins = 10000;
      const result = Avatars.purchase(st, 'ironborn'); // achievement tier, not purchasable
      assert(result.ok === false && result.reason === 'not purchasable', 'achievement-tier avatars cannot be bought with coins, even with plenty of coins');
      log('✓ achievement-tier avatars reject coin purchase entirely');
    }

    // ═══════════════════════════════════════════════════
    // 3. ACHIEVEMENT AUTO-UNLOCK — tied to Achievements gold tiers
    // ═══════════════════════════════════════════════════
    {
      const st = freshState();
      st.user.streak.longest = 30; // Iron Streak gold threshold
      Achievements.detectNewUnlocks(st); // records iron_streak gold
      const newly = Avatars.checkAutoUnlocks(st);
      assert(newly.length === 1 && newly[0].id === 'ironborn', 'Ironborn auto-unlocks when Iron Streak reaches Gold, got ' + JSON.stringify(newly));
      assert(Avatars.isOwned(st, 'ironborn'), 'Ironborn is owned after auto-unlock');
      log('✓ Ironborn auto-unlocks on Iron Streak Gold');
    }

    {
      const st = freshState();
      st.sessions = [mkSession('2026-08-10T09:00:00', { focusedMinutes: 120 })]; // Deep Forge gold
      Achievements.detectNewUnlocks(st);
      const newly = Avatars.checkAutoUnlocks(st);
      assert(newly.some(a => a.id === 'deepwalker'), 'Deepwalker auto-unlocks on Deep Forge Gold, got ' + JSON.stringify(newly));
      log('✓ Deepwalker auto-unlocks on Deep Forge Gold');
    }

    {
      // Anti-farm: calling checkAutoUnlocks again with no new qualifying
      // data returns nothing further.
      const st = freshState();
      st.user.streak.longest = 30;
      Achievements.detectNewUnlocks(st);
      Avatars.checkAutoUnlocks(st);
      const second = Avatars.checkAutoUnlocks(st);
      assert(second.length === 0, 'second call with unchanged data does not re-unlock Ironborn');
      log('✓ anti-farm: avatar auto-unlock does not repeat for the same qualifying data');
    }

    {
      // Forge Master — the meta-unlock: Gold on 5 DIFFERENT families
      const st = freshState();
      st.user.streak.longest = 30;                                   // iron_streak gold
      st.sessions = [mkSession('2026-08-10T09:00:00', { focusedMinutes: 120 })]; // deep_forge gold
      st.tasks = Array.from({ length: 500 }, () => ({
        id: Storage.uuid(), completed: true, text: 't', tag: 'academics',
        xpMultiplier: 1, createdAt: '', completedAt: ''
      }));                                                            // task_reaper gold
      st.goals = Array.from({ length: 15 }, (_, i) => ({ id: 'g'+i, status: 'completed' })); // goal_crusher gold
      // session_stack gold — 10 sessions in one day
      for (let i = 0; i < 10; i++) {
        st.sessions.push(mkSession('2026-08-11T' + String(i+1).padStart(2,'0') + ':00:00'));
      }
      Achievements.detectNewUnlocks(st);
      const newly = Avatars.checkAutoUnlocks(st);
      assert(newly.some(a => a.id === 'forge_master'), 'Forge Master unlocks once 5 families reach Gold, got ' + JSON.stringify(newly.map(a=>a.id)));
      log('✓ Forge Master (meta-unlock) fires once 5 families reach Gold');
    }

    {
      // Exactly 4 golds — Forge Master must NOT unlock yet
      const st = freshState();
      st.user.streak.longest = 30;
      st.sessions = [mkSession('2026-08-10T09:00:00', { focusedMinutes: 120 })];
      st.tasks = Array.from({ length: 500 }, () => ({
        id: Storage.uuid(), completed: true, text: 't', tag: 'academics',
        xpMultiplier: 1, createdAt: '', completedAt: ''
      }));
      st.goals = Array.from({ length: 15 }, (_, i) => ({ id: 'g'+i, status: 'completed' }));
      Achievements.detectNewUnlocks(st);
      const newly = Avatars.checkAutoUnlocks(st);
      assert(!newly.some(a => a.id === 'forge_master'), 'Forge Master must NOT unlock with only 4 families at Gold');
      log('✓ Forge Master correctly withheld at exactly 4 golds (boundary case)');
    }

    // ═══════════════════════════════════════════════════
    // 4. SELECTION — can only select what you own
    // ═══════════════════════════════════════════════════
    {
      const st = freshState();
      const failed = Avatars.selectAvatar(st, 'vanguard'); // not owned
      assert(failed === false, 'cannot select an unowned avatar');
      assert(Avatars.getActiveAvatar(st).id === 'operative', 'active avatar remains the default');
    }

    {
      const st = freshState();
      st.user.coins = 500;
      Avatars.purchase(st, 'vanguard');
      const ok = Avatars.selectAvatar(st, 'vanguard');
      assert(ok === true, 'can select an owned avatar');
      assert(Avatars.getActiveAvatar(st).id === 'vanguard', 'active avatar updates to the selected one');
      log('✓ selection: only owned avatars can be made active');
    }

    // ═══════════════════════════════════════════════════
    // 5. PERSISTENCE AND RELOAD
    // ═══════════════════════════════════════════════════
    {
      localStorage._s = {};
      let st = freshState();
      st.user.coins = 500;
      Avatars.purchase(st, 'vanguard');
      Avatars.selectAvatar(st, 'vanguard');
      Storage.save(st);

      const reloaded = Storage.load();
      assert(Avatars.isOwned(reloaded, 'vanguard'), 'ownership survives save/reload');
      assert(Avatars.getActiveAvatar(reloaded).id === 'vanguard', 'active selection survives save/reload');
      log('✓ persistence: ownership and active selection survive save/reload');
    }

    {
      // Legacy state with no avatar fields at all must not crash
      localStorage._s = {};
      const legacy = { user: { name: 'OLD', xp: 0, level: 1, coins: 0, streak: {} }, tasks: [], sessions: [], goals: [], milestones: [] };
      localStorage.setItem('forge_state', JSON.stringify(legacy));
      const loaded = Storage.load();
      assert(loaded.user.avatar === 'operative', 'legacy state backfills avatar to the default');
      assert(Array.isArray(loaded.user.unlockedAvatars), 'legacy state backfills unlockedAvatars to an array');
      const list = Avatars.listWithStatus(loaded);
      assert(list.length === 10, 'listWithStatus works immediately on a freshly-backfilled legacy state, got ' + list.length);
      log('✓ legacy state without avatar fields backfills cleanly');
    }

    log('All avatar tests passed ✅ — ownership, purchase, achievement auto-unlock, selection, and persistence verified');
  }

  try { run(); } catch (e) { console.error(e); process.exit(1); }

})();
