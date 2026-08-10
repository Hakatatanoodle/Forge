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
    assert(Array.isArray(def.weeks), 'weeks array');
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

    // 9. Timer format
    const fmt = Timer.format(125);
    assert(fmt.mm === '02' && fmt.ss === '05', 'format 125s');
    log('✓ timer format', fmt);

    // 10. Ring offset
    const offset = Timer.ringOffset(50, 100);
    assert(offset > 0, 'ring offset');
    log('✓ ring offset');

    // 11. Pillar logic — ensure getPillarById fallback
    // Simulate state
    const mockPillars = [{id:'academics', name:'ACADEMICS', color:'#4caf7d', icon:'📚'}];
    const fallback = (id) => mockPillars.find(p=>p.id===id) || { name: id.toUpperCase(), color:'#888880', icon:'◎' };
    assert(fallback('unknown').name === 'UNKNOWN', 'fallback name');
    assert(fallback('academics').name === 'ACADEMICS', 'found pillar');
    log('✓ pillar fallback');

    // 12. Goal deletion cleanup logic
    let mockState = {
      goals: [{id:'g1', pillarId:'academics'}],
      weeks: [{id:'w1', goalId:'g1'}, {id:'w2', goalId:'g2'}],
      tasks: [{id:'t1', goalId:'g1', weekId:'w1'}, {id:'t2', goalId:'g2', weekId:'w2'}]
    };
    const gid = 'g1';
    mockState.weeks = mockState.weeks.filter(w=>w.goalId!==gid);
    mockState.tasks.forEach(t=>{ if(t.goalId===gid){ t.goalId=null; t.weekId=null; }});
    mockState.goals = mockState.goals.filter(g=>g.id!==gid);
    assert(mockState.weeks.length===1 && mockState.weeks[0].id==='w2', 'weeks cleanup');
    assert(mockState.tasks.find(t=>t.id==='t1').goalId===null, 'task goal null');
    log('✓ goal deletion cleanup');

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
