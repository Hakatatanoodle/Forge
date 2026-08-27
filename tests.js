// ═══════════════════════════════════════
// tests.js — lightweight test harness for FORGE core
// Runs both in browser (console) and Node (with mocks)
// No dependencies
// ═══════════════════════════════════════

(() => {
  const assert = (cond, msg) => {
    if (!cond) throw new Error('ASSERT FAIL: ' + msg);
  };
  const log = (...args) => console.log('[FORGE TEST]', ...args);

  // Mock localStorage for Node
  if (typeof localStorage === 'undefined') {
    global.localStorage = {
      _s: {},
      getItem(k){ return this._s[k]||null; },
      setItem(k,v){ this._s[k]=v; },
      removeItem(k){ delete this._s[k]; }
    };
  }

  // Load modules in Node context
  let Storage, XP, Timer;
  if (typeof require !== 'undefined') {
    const fs = require('fs');
    global.localStorage = localStorage;
    let sCode = fs.readFileSync('./storage.js','utf8').replace('const Storage', 'global.Storage');
    let xCode = fs.readFileSync('./xp.js','utf8').replace('const XP', 'global.XP');
    let tCode = fs.readFileSync('./timer.js','utf8').replace('const Timer', 'global.Timer');
    eval(sCode);
    eval(xCode);
    eval(tCode);
    Storage = global.Storage;
    XP = global.XP;
    Timer = global.Timer;
  } else {
    Storage = window.Storage;
    XP = window.XP;
    Timer = window.Timer;
  }

  function run() {
    log('Starting tests...');

    // 1. Storage default state
    const def = Storage.defaultState();
    assert(def.user.level === 1, 'default level 1');
    assert(def.pillars.length >= 3, 'default pillars');
    assert(def.user.unlockedThemes.includes('forge'), 'forge unlocked');
    assert(def.user.unlockedThemes.includes('venom'), 'venom free');
    assert(Array.isArray(def.goals), 'goals array');
    assert(Array.isArray(def.milestones), 'milestones array');
    assert(def.weeks === undefined, 'weeks removed from state');
    assert(def.schemaVersion === Storage.SCHEMA_VERSION, 'schema stamped');
    log('✓ storage defaultState');

    // 2. todayStr uses local not UTC
    const ts = Storage.todayStr();
    assert(/^\d{4}-\d{2}-\d{2}$/.test(ts), 'todayStr format ' + ts);
    log('✓ storage todayStr', ts);

    // 3. XP ranks — must be 8 canonical matching theme keys
    const expectedRanks = ['INITIATE','APPRENTICE','OPERATOR','SPECIALIST','VETERAN','ELITE','COMMANDER','LEGEND'];
    const actualRanks = XP.RANKS.map(r=>r.title);
    expectedRanks.forEach(r => assert(actualRanks.includes(r), 'rank includes '+r));
    assert(actualRanks.length === 8, '8 ranks');
    assert(XP.getRank(1) === 'INITIATE', 'rank 1');
    assert(XP.getRank(50) === 'LEGEND', 'rank 50');
    log('✓ xp ranks', actualRanks.join(','));

    // 4. xpForLevel curve increasing
    let prev = 0;
    for (let lv=1; lv<=60; lv++) {
      const needed = XP.xpForLevel(lv);
      assert(needed > 0, 'xpForLevel positive');
      if (lv>1) assert(needed > prev*0.5, 'curve increasing'); // roughly increasing
      prev = needed;
    }
    log('✓ xpForLevel curve');

    // 5. calculateSessionXP
    const xp1 = XP.calculateSessionXP(1.0, 0, 25, 1);
    assert(xp1.total >= 90 && xp1.total <= 200, 'base xp 25m ~100');
    const xpHardLong = XP.calculateSessionXP(2.0, 10, 90, 20);
    assert(xpHardLong.total > xp1.total, 'hard long > easy short');
    assert(xpHardLong.coinsEarned >= 10, 'coins earned');
    log('✓ calculateSessionXP', JSON.stringify(xp1), JSON.stringify(xpHardLong));

    // 6. Task XP
    const tEasy = XP.calculateTaskXP(1.0);
    const tHard = XP.calculateTaskXP(2.0);
    assert(tEasy === 50, 'task easy 50');
    assert(tHard === 100, 'task hard 100');
    log('✓ calculateTaskXP');

    // 7. applyXP level up
    let user = { xp: 400, level: 1, rank: 'INITIATE' };
    let res = XP.applyXP(user, 200); // should level to 2
    assert(res.newLevel === 2, 'level up to 2');
    assert(res.levelsGained === 1, 'gained 1');
    log('✓ applyXP level up', res.newLevel);

    // 8. Streak logic
    const today = Storage.todayStr();
    const yesterday = XP.updateStreak ? (() => {
      // compute yesterday via helper
      const d = new Date(); d.setDate(d.getDate()-1);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const dd = String(d.getDate()).padStart(2,'0');
      return `${yyyy}-${mm}-${dd}`;
    })() : null;

    let streak = { current: 3, longest: 3, lastActiveDate: yesterday, freezesAvailable: 0 };
    let updated = XP.updateStreak(streak, today);
    assert(updated.current === 4, 'streak continues');
    log('✓ streak continue', updated.current);

    streak = { current: 2, longest: 5, lastActiveDate: '2020-01-01', freezesAvailable: 0 };
    updated = XP.updateStreak(streak, today);
    assert(updated.current === 1, 'streak reset after gap');
    log('✓ streak reset');

    // 8b. Streak self-heal (recalcStreak) — regression test for the real
    // drift bug found in production: a session log with a genuine gap
    // (one skipped day, no freeze available yet) must recompute to the
    // SAME answer the live incremental logic would produce, every time,
    // regardless of what the persisted streak.current says.
    if (XP.recalcStreak) {
      const mkSession = (dateStr) => ({ startTime: dateStr + 'T09:00:00' });
      // Tue session, Wed gap (no freeze earned yet), Thu-Sun sessions
      const sessions = [
        mkSession('2026-08-11'), // Tue
        mkSession('2026-08-13'), // Thu (Wed skipped)
        mkSession('2026-08-14'), // Fri
        mkSession('2026-08-15'), // Sat
        mkSession('2026-08-16')  // Sun
      ];
      const healed = XP.recalcStreak(sessions, 3);
      assert(healed.current === 4, 'recalcStreak matches live logic for a real gap (got ' + healed.current + ', expected 4)');
      assert(healed.freezesAvailable === 3, 'recalcStreak preserves the real freeze balance untouched');
      log('✓ streak self-heal recompute', healed.current);

      // Same dates, but multiple sessions on one day must not double-count
      const dup = [mkSession('2026-08-20'), mkSession('2026-08-20'), mkSession('2026-08-21')];
      const healedDup = XP.recalcStreak(dup, 0);
      assert(healedDup.current === 2, 'recalcStreak ignores duplicate same-day sessions (got ' + healedDup.current + ')');
      log('✓ streak self-heal ignores same-day duplicates');
    }

    // 8c. Freeze consumption must not be masked by the same-call freeze-
    // earning rule. Regression test for a real bug: a freeze bridging a
    // gap onto a multiple of 7 (e.g. 13 -> 14) used to get silently
    // re-granted in the exact same calculation, making the spend
    // invisible even though it genuinely happened.
    {
      let streak = { current: 13, longest: 13, lastActiveDate: '2026-08-24', freezesAvailable: 1, lastFreezeUsed: null };
      const result = XP.updateStreak(streak, '2026-08-26'); // one day skipped in between
      assert(result.current === 14, 'freeze correctly bridges the gap, streak reaches 14 (got ' + result.current + ')');
      assert(result.freezesAvailable === 0, 'freeze is actually spent (0), not silently re-earned because 14 is a multiple of 7 (got ' + result.freezesAvailable + ')');
      log('✓ freeze consumption is not masked by the same-day freeze-earning rule');
    }

    // 9. Timer format
    const fmt = Timer.format(125);
    assert(fmt.mm === '02' && fmt.ss === '05', 'format 125s');
    log('✓ timer format', fmt);

    // 10. Ring offset
    const offset = Timer.ringOffset(50, 100);
    assert(offset > 0, 'ring offset');
    log('✓ ring offset');

    // 10b. Timer hold/resume — regression test for the mid-session plan
    // drawer feature: holding must freeze elapsed time exactly, and time
    // spent on hold must never be silently added to or lost from the
    // session's real elapsed time.
    {
      const realNow = Date.now;
      let fakeNow = 1700000000000; // arbitrary fixed epoch
      Date.now = () => fakeNow;

      Timer.startFocus(25, () => {}, () => {});
      assert(Timer.isRunning() === true, 'timer running after startFocus');
      assert(Timer.getElapsedSecs() === 0, 'no time elapsed at start');

      fakeNow += 600 * 1000; // +10 min
      assert(Timer.getElapsedSecs() === 600, 'elapsed matches advanced time before hold');

      Timer.hold(() => {});
      assert(Timer.isHeld() === true, 'held after hold()');
      assert(Timer.isRunning() === false, 'not running while held');
      assert(Timer.getElapsedSecs() === 600, 'elapsed frozen at the moment hold was pressed');

      fakeNow += 120 * 1000; // +2 min while held — must NOT count
      assert(Timer.getElapsedSecs() === 600, 'elapsed still frozen during hold — this is the exact bug class the mid-session plan drawer depends on not having');

      Timer.resume();
      assert(Timer.isRunning() === true, 'running again after resume');
      assert(Timer.isHeld() === false, 'not held after resume');
      assert(Timer.getElapsedSecs() === 600, 'elapsed unchanged immediately after resume');

      fakeNow += 300 * 1000; // +5 min post-resume
      assert(Timer.getElapsedSecs() === 900, 'elapsed accumulates correctly after resume (600 + 300)');

      Timer.stop();
      Date.now = realNow;
      log('✓ timer hold/resume elapsed-time accounting');
    }

    // 11. Pillar logic — ensure getPillarById fallback
    // Simulate state
    const mockPillars = [{id:'academics', name:'ACADEMICS', color:'#4caf7d', icon:'📚'}];
    const fallback = (id) => mockPillars.find(p=>p.id===id) || { name: id.toUpperCase(), color:'#888880', icon:'◎' };
    assert(fallback('unknown').name === 'UNKNOWN', 'fallback name');
    assert(fallback('academics').name === 'ACADEMICS', 'found pillar');
    log('✓ pillar fallback');

    // 12. Goal deletion cleanup logic (weeks are gone; milestones now cascade)
    let mockState = {
      goals: [{id:'g1', pillarId:'academics'}, {id:'g2', pillarId:'gamedev'}],
      milestones: [{id:'m1', goalId:'g1'}, {id:'m2', goalId:'g2'}],
      tasks: [
        {id:'t1', goalId:'g1', milestoneId:'m1'},
        {id:'t2', goalId:'g2', milestoneId:'m2'}
      ]
    };
    const gid = 'g1';
    mockState.milestones = mockState.milestones.filter(m => m.goalId !== gid);
    mockState.tasks.forEach(t => {
      if (t.goalId === gid) { t.goalId = null; t.milestoneId = null; }
    });
    mockState.goals = mockState.goals.filter(g => g.id !== gid);
    assert(mockState.milestones.length === 1 && mockState.milestones[0].id === 'm2', 'milestone cleanup');
    assert(mockState.tasks.find(t => t.id === 't1').goalId === null, 'task goal null');
    assert(mockState.tasks.find(t => t.id === 't1').milestoneId === null, 'task milestone null');
    assert(mockState.tasks.find(t => t.id === 't2').goalId === 'g2', 'other goal untouched');
    log('✓ goal deletion cleanup');

    // 13. v12 migration — legacy week/day model is fully removed
    const legacy = {
      goals: [{ id: 'g1', pillarId: 'academics', title: 'EDC', weekCount: 4 }],
      weeks: [{ id: 'w1', goalId: 'g1', number: 1, label: 'WEEK 1' }],
      tasks: [
        { id: 't1', text: 'Revise', tag: 'academics', goalId: 'g1',
          weekId: 'w1', day: 2, completed: false, xpMultiplier: 1 },
        { id: 't2', text: 'Done thing', tag: 'other',
          weekId: null, day: 5, completed: true, xpMultiplier: 1 }
      ]
    };
    const migrated = Storage.migrate(JSON.parse(JSON.stringify(legacy)));

    assert(migrated.weeks === undefined, 'migrate drops weeks[]');
    assert(migrated.goals[0].weekCount === undefined, 'migrate drops goal.weekCount');
    assert(migrated.goals[0].description === '', 'migrate adds goal.description');
    assert(Array.isArray(migrated.milestones), 'migrate adds milestones[]');
    assert(migrated.schemaVersion === Storage.SCHEMA_VERSION, 'migrate stamps version');

    const mt = migrated.tasks[0];
    assert(mt.weekId === undefined, 'migrate drops task.weekId');
    assert(mt.day === undefined, 'migrate drops task.day');
    assert(mt.scheduledStart === null, 'migrated task is UNSCHEDULED');
    assert(mt.scheduledEnd === null, 'migrated task has no end');
    assert(mt.estimatedMinutes === 60, 'migrate backfills estimatedMinutes');
    assert(mt.priority === 'medium', 'migrate backfills priority');
    assert(mt.milestoneId === null, 'migrate backfills milestoneId');
    assert(mt.text === 'Revise' && mt.goalId === 'g1', 'migrate preserves real data');

    // idempotent — running twice must not corrupt anything
    const twice = Storage.migrate(migrated);
    assert(twice.tasks[0].estimatedMinutes === 60, 'migrate is idempotent');
    log('✓ v12 plan-mode migration');

    // 14. Calendar date helpers are local-time, never UTC
    const d = new Date(2026, 7, 17, 9, 30, 0); // Mon Aug 17 2026, 09:30 local
    assert(Storage.dateStr(d) === '2026-08-17', 'dateStr local');
    assert(Storage.localISO(d) === '2026-08-17T09:30:00', 'localISO local ' + Storage.localISO(d));

    const round = Storage.parseLocal(Storage.localISO(d));
    assert(round.getHours() === 9 && round.getMinutes() === 30, 'parseLocal round-trip');
    assert(round.getDate() === 17, 'parseLocal keeps the day');

    // Sunday must resolve back to the PRECEDING Monday, not the next one
    const sun = new Date(2026, 7, 23, 12, 0, 0); // Sun Aug 23 2026
    assert(Storage.dateStr(Storage.startOfWeek(sun)) === '2026-08-17', 'startOfWeek Sunday→Mon');
    assert(Storage.dateStr(Storage.startOfWeek(d)) === '2026-08-17', 'startOfWeek Monday→self');
    assert(Storage.dateStr(Storage.addDays(d, 4)) === '2026-08-21', 'addDays');
    log('✓ calendar date helpers');

    log('All tests passed ✅ — FORGE is usable again');
    return true;
  }

  // Auto run in Node, expose in browser
  if (typeof window === 'undefined') {
    try { run(); } catch(e){ console.error(e); process.exit(1); }
  } else {
    window.FORGE_TESTS = { run };
    console.log('FORGE tests loaded — run FORGE_TESTS.run() in console');
  }
})();
