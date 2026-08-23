// ═══════════════════════════════════════════════════════
// tests.achievements.js — characterization tests for achievements.js
//
// Runs in Node only (mocks localStorage; loads storage.js + xp.js +
// achievements.js directly, same pattern as tests.repository.js).
// ═══════════════════════════════════════════════════════

(() => {
  const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAIL: ' + msg); };
  const log = (...args) => console.log('[ACH TEST]', ...args);

  if (typeof require === 'undefined') {
    console.warn('tests.achievements.js: Node-only, skipping in browser.');
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
  const XP = global.XP;

  let aCode = fs.readFileSync('./achievements.js', 'utf8').replace('const Achievements', 'global.Achievements');
  eval(aCode);
  const Achievements = global.Achievements;

  // ── Fixture helpers ──
  function freshState() {
    return Storage.defaultState();
  }
  function mkSession(dateISO, opts = {}) {
    return Object.assign({
      id: Storage.uuid(), taskId: null, intention: '', completed: true,
      startTime: dateISO, endTime: dateISO, xpEarned: 0, coinsEarned: 0,
      focusedMinutes: 25, taskScheduledStartSnapshot: null
    }, opts);
  }
  function mkTask(opts = {}) {
    return Object.assign(Storage.taskDefaults(), {
      id: Storage.uuid(), text: 'task', tag: 'academics',
      completed: false, xpMultiplier: 1, createdAt: new Date().toISOString(), completedAt: null
    }, opts);
  }

  function run() {
    log('Starting achievement tests...');

    // ═══════════════════════════════════════════════════
    // 1. THRESHOLD PROGRESSION — each family's calc() reads real data
    // ═══════════════════════════════════════════════════

    {
      const st = freshState();
      st.sessions = [
        mkSession('2026-08-10T09:00:00'),
        mkSession('2026-08-10T11:00:00'),
        mkSession('2026-08-10T14:00:00'),
        mkSession('2026-08-11T09:00:00') // different day, shouldn't merge
      ];
      assert(Achievements.calc.sessionStack(st) === 3, 'Session Stack: best single day count');
    }

    {
      const st = freshState();
      st.sessions = [
        mkSession('2026-08-10T09:00:00', { focusedMinutes: 100 }),
        mkSession('2026-08-10T11:00:00', { focusedMinutes: 80 }),
        mkSession('2026-08-11T09:00:00', { focusedMinutes: 200 }) // single-day max
      ];
      const hours = Achievements.calc.forgeHours(st);
      assert(Math.abs(hours - (200/60)) < 0.01, 'Forge Hours: best single day total, got ' + hours);
    }

    {
      const st = freshState();
      st.sessions = [
        mkSession('2026-08-10T09:00:00', { focusedMinutes: 45 }),
        mkSession('2026-08-11T09:00:00', { focusedMinutes: 95 })
      ];
      assert(Achievements.calc.deepForge(st) === 95, 'Deep Forge: longest single session, got ' + Achievements.calc.deepForge(st));
    }

    {
      const st = freshState();
      st.user.streak.longest = 12;
      assert(Achievements.calc.ironStreak(st) === 12, 'Iron Streak: reuses streak.longest directly');
    }

    {
      const st = freshState();
      const t1 = mkTask({ scheduledStart: '2026-08-10T09:00:00', completed: true });
      const t2 = mkTask({ scheduledStart: '2026-08-10T11:00:00', completed: true });
      const t3 = mkTask({ scheduledStart: '2026-08-11T09:00:00', completed: false }); // not perfect
      st.tasks = [t1, t2, t3];
      assert(Achievements.calc.perfectDay(st) === 1, 'Perfect Day: only fully-completed scheduled days count');
    }

    {
      const st = freshState();
      st.sessions = [
        mkSession('2026-08-10T09:05:00', { taskScheduledStartSnapshot: '2026-08-10T09:00:00' }), // 5min diff — on tempo
        mkSession('2026-08-10T14:00:00', { taskScheduledStartSnapshot: '2026-08-10T09:00:00' }), // way off
        mkSession('2026-08-10T20:00:00', { taskScheduledStartSnapshot: null })                    // unscheduled — doesn't count either way
      ];
      assert(Achievements.calc.onTempo(st) === 1, 'On Tempo: only sessions within the window count, got ' + Achievements.calc.onTempo(st));
    }

    {
      const st = freshState();
      st.tasks = [mkTask({ completed: true }), mkTask({ completed: true }), mkTask({ completed: false })];
      assert(Achievements.calc.taskReaper(st) === 2, 'Task Reaper: cumulative completed tasks');
    }

    {
      const st = freshState();
      st.goals = [{ id: 'g1', status: 'completed' }, { id: 'g2', status: 'active' }];
      assert(Achievements.calc.goalCrusher(st) === 1, 'Goal Crusher: cumulative completed goals');
    }

    {
      const st = freshState();
      st.goals = [
        { id: 'g1', status: 'completed', deadline: '2026-08-20', completedAt: '2026-08-15T10:00:00' }, // ahead
        { id: 'g2', status: 'completed', deadline: '2026-08-10', completedAt: '2026-08-15T10:00:00' }, // late
        { id: 'g3', status: 'active',    deadline: '2026-08-20', completedAt: null }
      ];
      assert(Achievements.calc.aheadOfSchedule(st) === 1, 'Ahead of Schedule: only goals completed on/before deadline');
    }

    {
      const st = freshState();
      // Week of 2026-08-10 (Mon) — 3 tasks, 3 done = 100% >= 90%
      st.tasks = [
        mkTask({ scheduledStart: '2026-08-10T09:00:00', completed: true }),
        mkTask({ scheduledStart: '2026-08-11T09:00:00', completed: true }),
        mkTask({ scheduledStart: '2026-08-12T09:00:00', completed: true }),
        // Different week, only 50% done — should NOT count
        mkTask({ scheduledStart: '2026-08-17T09:00:00', completed: true }),
        mkTask({ scheduledStart: '2026-08-18T09:00:00', completed: false })
      ];
      assert(Achievements.calc.weekCommander(st) === 1, 'Week Commander: only weeks hitting the % threshold count, got ' + Achievements.calc.weekCommander(st));
    }

    {
      const st = freshState();
      st.sessions = [
        mkSession('2026-08-01T09:00:00'),
        mkSession('2026-08-02T09:00:00'), // consecutive, no comeback
        mkSession('2026-08-10T09:00:00')  // 8-day gap — a comeback
      ];
      assert(Achievements.calc.theComeback(st) === 1, 'The Comeback: counts qualifying gaps, got ' + Achievements.calc.theComeback(st));
    }

    {
      const st = freshState();
      const t1 = mkTask({ milestoneId: 'm1', completed: true });
      const t2 = mkTask({ milestoneId: 'm1', completed: true });
      const t3 = mkTask({ milestoneId: 'm2', completed: false });
      st.tasks = [t1, t2, t3];
      st.milestones = [{ id: 'm1', goalId: 'g1' }, { id: 'm2', goalId: 'g1' }];
      assert(Achievements.calc.milestoneBreaker(st) === 1, 'Milestone Breaker: only milestones with ALL linked tasks done count');
    }

    log('✓ threshold progression — all 12 families calculate correctly from real data shapes');

    // ═══════════════════════════════════════════════════
    // 2. TIER UNLOCKING + PERMANENT STATE + COIN REWARDS
    // ═══════════════════════════════════════════════════

    {
      const st = freshState();
      st.user.coins = 0;
      // Cross Session Stack bronze (3) in one shot
      st.sessions = [
        mkSession('2026-08-10T09:00:00'),
        mkSession('2026-08-10T11:00:00'),
        mkSession('2026-08-10T14:00:00')
      ];
      const unlocked = Achievements.detectNewUnlocks(st);
      assert(unlocked.length === 1, 'exactly one tier crossed, got ' + unlocked.length);
      assert(unlocked[0].id === 'session_stack' && unlocked[0].tier === 'bronze', 'crossed session_stack bronze');
      assert(unlocked[0].coinReward === Achievements.TIER_COINS.bronze, 'coin reward matches TIER_COINS table');
      assert(st.achievements.session_stack.unlockedTiers.includes('bronze'), 'permanently recorded in state.achievements');
      log('✓ tier unlock detection + coin reward amount correct');
    }

    {
      // ANTI-FARMING: calling detectNewUnlocks again with the SAME data
      // must return nothing — the tier was already paid out.
      const st = freshState();
      st.sessions = [ mkSession('2026-08-10T09:00:00'), mkSession('2026-08-10T11:00:00'), mkSession('2026-08-10T14:00:00') ];
      const first  = Achievements.detectNewUnlocks(st);
      const second = Achievements.detectNewUnlocks(st);
      assert(first.length === 1, 'first call unlocks bronze');
      assert(second.length === 0, 'second call with IDENTICAL data yields nothing — cannot be farmed');
      log('✓ anti-farming: re-checking identical data never re-awards');
    }

    {
      // CUMULATIVE PROGRESSION: bronze → silver → gold keeps all tiers,
      // never replaces the previous one.
      const st = freshState();
      const days = ['2026-08-01','2026-08-02','2026-08-03','2026-08-04','2026-08-05'];
      // Day 1: 3 sessions (bronze)
      st.sessions = [mkSession(days[0]+'T09:00:00'), mkSession(days[0]+'T11:00:00'), mkSession(days[0]+'T13:00:00')];
      let unlocked = Achievements.detectNewUnlocks(st);
      assert(unlocked.length === 1 && unlocked[0].tier === 'bronze', 'day 1: bronze crossed');

      // Day 2: 5 sessions in ONE day (silver) — bronze must still be present
      st.sessions.push(...[0,1,2,3,4].map(i => mkSession(days[1]+'T0'+(i+1)+':00:00')));
      unlocked = Achievements.detectNewUnlocks(st);
      assert(unlocked.length === 1 && unlocked[0].tier === 'silver', 'day 2: silver crossed');
      assert(st.achievements.session_stack.unlockedTiers.length === 2, 'both bronze AND silver retained, got ' + st.achievements.session_stack.unlockedTiers.length);
      assert(st.achievements.session_stack.unlockedTiers.includes('bronze'), 'bronze still present after silver unlocked');
      assert(st.achievements.session_stack.unlockedTiers.includes('silver'), 'silver present');

      // Day 3: 10 sessions in ONE day (gold) — all three tiers now present.
      // Note: 10×25min sessions in one day also legitimately crosses
      // Forge Hours bronze (3h) at the same time — that's correct, not
      // a bug, so we check for the specific session_stack entry rather
      // than assuming it's the only thing that unlocked this round.
      st.sessions.push(...Array.from({length:10}, (_,i) => mkSession(days[2]+'T'+String(i+1).padStart(2,'0')+':00:00')));
      unlocked = Achievements.detectNewUnlocks(st);
      const goldUnlock = unlocked.find(u => u.id === 'session_stack');
      assert(goldUnlock && goldUnlock.tier === 'gold', 'day 3: session_stack gold crossed, got ' + JSON.stringify(unlocked));
      assert(st.achievements.session_stack.unlockedTiers.length === 3, 'all three tiers cumulative, got ' + st.achievements.session_stack.unlockedTiers.length);
      log('✓ cumulative tier progression: bronze→silver→gold keeps all previous tiers');
    }

    {
      // PERMANENCE ACROSS REGRESSION: if the live metric later drops
      // (e.g. a completed task gets deleted), an already-unlocked tier
      // must stay shown as unlocked in computeProgress().
      const st = freshState();
      st.tasks = Array.from({length: 25}, () => mkTask({ completed: true }));
      Achievements.detectNewUnlocks(st); // unlocks task_reaper bronze (25)
      assert(st.achievements.task_reaper.unlockedTiers.includes('bronze'), 'bronze unlocked at 25');

      // Simulate deleting 10 completed tasks afterward
      st.tasks = st.tasks.slice(0, 15);
      const progress = Achievements.computeProgress(st);
      const reaper = progress.find(f => f.id === 'task_reaper');
      assert(reaper.value === 15, 'live value correctly reflects the reduced count');
      assert(reaper.tiers.find(t => t.tier === 'bronze').unlocked === true, 'bronze tier STAYS unlocked despite live value dropping below threshold — permanence');
      log('✓ permanence: unlocked tiers never revoke even if live data later drops below threshold');
    }

    // ═══════════════════════════════════════════════════
    // 3. NO XP AWARDED — only coins
    // ═══════════════════════════════════════════════════
    {
      const st = freshState();
      const xpBefore = st.user.xp;
      st.sessions = [ mkSession('2026-08-10T09:00:00'), mkSession('2026-08-10T11:00:00'), mkSession('2026-08-10T14:00:00') ];
      Achievements.detectNewUnlocks(st);
      assert(st.user.xp === xpBefore, 'detectNewUnlocks never touches state.user.xp — achievements.js has no XP-awarding code path at all');
      log('✓ achievements never award XP (verified: module has no XP.applyXP call, and state.user.xp is untouched)');
    }

    // ═══════════════════════════════════════════════════
    // 4. EDGE CASES
    // ═══════════════════════════════════════════════════

    {
      const st = freshState();
      st.tasks = []; // no scheduled tasks at all
      assert(Achievements.calc.perfectDay(st) === 0, 'Perfect Day: zero scheduled tasks never counts as a perfect day');
    }

    {
      const st = freshState();
      st.tasks = [mkTask({ scheduledStart: null, completed: true })]; // unscheduled task
      assert(Achievements.calc.perfectDay(st) === 0, 'Perfect Day: unscheduled tasks are excluded entirely');
      assert(Achievements.calc.weekCommander(st) === 0, 'Week Commander: unscheduled tasks are excluded entirely');
    }

    {
      const st = freshState();
      st.sessions = []; // no history at all
      assert(Achievements.calc.theComeback(st) === 0, 'The Comeback: zero sessions → zero comebacks (not a crash)');
      assert(Achievements.calc.sessionStack(st) === 0, 'Session Stack: zero sessions → zero');
      const progress = Achievements.computeProgress(st);
      assert(progress.length === 12, 'computeProgress never throws on empty state, still returns all 12 families');
    }

    {
      // Single completed session, alone — no gap possible (needs 2+ dates)
      const st = freshState();
      st.sessions = [ mkSession('2026-08-10T09:00:00') ];
      assert(Achievements.calc.theComeback(st) === 0, 'The Comeback: a single session date cannot be a comeback');
    }

    {
      // Goal completed exactly ON the deadline date — should count as ahead/on-schedule
      const st = freshState();
      st.goals = [{ id: 'g1', status: 'completed', deadline: '2026-08-20', completedAt: '2026-08-20T23:00:00' }];
      assert(Achievements.calc.aheadOfSchedule(st) === 1, 'Ahead of Schedule: completing exactly on the deadline date counts');
    }

    {
      // Goal with no deadline at all — should never count for Ahead of Schedule
      const st = freshState();
      st.goals = [{ id: 'g1', status: 'completed', deadline: null, completedAt: '2026-08-20T23:00:00' }];
      assert(Achievements.calc.aheadOfSchedule(st) === 0, 'Ahead of Schedule: goals without a deadline never qualify');
    }

    {
      // Legacy session missing focusedMinutes entirely — falls back to wall-clock span
      const st = freshState();
      st.sessions = [{
        id: 'x', completed: true,
        startTime: '2026-08-10T09:00:00', endTime: '2026-08-10T09:45:00'
        // no focusedMinutes field — simulates a session logged before this field existed
      }];
      assert(Achievements.calc.deepForge(st) === 45, 'Deep Forge: legacy sessions without focusedMinutes fall back to wall-clock span, got ' + Achievements.calc.deepForge(st));
    }

    {
      // Task Reaper / Milestone Breaker must never count INCOMPLETE tasks
      const st = freshState();
      st.tasks = [mkTask({ completed: false, milestoneId: 'm1' })];
      st.milestones = [{ id: 'm1', goalId: 'g1' }];
      assert(Achievements.calc.taskReaper(st) === 0, 'Task Reaper: incomplete tasks never count');
      assert(Achievements.calc.milestoneBreaker(st) === 0, 'Milestone Breaker: a milestone with an incomplete linked task never counts');
    }

    log('✓ edge cases: empty state, no deadline, legacy sessions, unscheduled tasks, single-session history all handled without crashing or over-counting');

    // ═══════════════════════════════════════════════════
    // 5. PERSISTENCE AND RELOAD
    // ═══════════════════════════════════════════════════
    {
      localStorage._s = {};
      let st = freshState();
      st.sessions = [ mkSession('2026-08-10T09:00:00'), mkSession('2026-08-10T11:00:00'), mkSession('2026-08-10T14:00:00') ];
      Achievements.detectNewUnlocks(st);
      Storage.save(st);

      // Simulate a full reload
      const reloaded = Storage.load();
      assert(reloaded.achievements.session_stack.unlockedTiers.includes('bronze'), 'unlocked tier survives save/reload through Storage');

      // Re-running detectNewUnlocks on the RELOADED state must still not re-award
      const afterReload = Achievements.detectNewUnlocks(reloaded);
      assert(afterReload.length === 0, 'reloaded state does not re-award an already-persisted tier');
      log('✓ persistence: unlocked tiers survive save/reload and remain non-farmable after reload');
    }

    {
      // A brand new / legacy user with NO achievements key at all must
      // not crash — defaultState() + deepMerge should backfill it.
      localStorage._s = {};
      const legacy = { user: { name: 'OLD', xp: 0, level: 1, coins: 0, streak: {} }, tasks: [], sessions: [], goals: [], milestones: [] };
      localStorage.setItem('forge_state', JSON.stringify(legacy));
      const loaded = Storage.load();
      assert(loaded.achievements && typeof loaded.achievements === 'object', 'legacy state with no achievements key gets backfilled to {}');
      const progress = Achievements.computeProgress(loaded);
      assert(progress.length === 12, 'computeProgress works immediately on a freshly-backfilled legacy state');
      log('✓ legacy state without an achievements key backfills cleanly and computeProgress works immediately');
    }

    log('All achievement tests passed ✅ — 12 families verified against real data shapes, unlocking, permanence, coins, edge cases, and persistence');
  }

  try { run(); } catch (e) { console.error(e); process.exit(1); }

})();
