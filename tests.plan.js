// ═══════════════════════════════════════════════════════
// tests.plan.js — Plan Mode integration smoke test
//
// Drives the real DOM through jsdom: objectives, goal detail,
// milestones, all four calendar views, scheduling, the task detail
// inspector, and the untouched FORGE loop (dashboard + task queue).
//
//   npm install jsdom      (dev-only, not a runtime dependency)
//   node tests.plan.js
//
// The app itself still ships with ZERO dependencies and no build step.
// ═══════════════════════════════════════════════════════

const { JSDOM } = require('jsdom');
const fs = require('fs');

const html = fs.readFileSync('./index.html','utf8')
  .replace(/<script src="https:\/\/www\.gstatic[^>]*><\/script>/g,'');

const dom = new JSDOM(html, {
  runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost:8000/'
});
const w = dom.window;
w.firebase = undefined;
const errs = [];
w.addEventListener('error', e => errs.push('window error: '+e.message));

// stub AudioContext
w.AudioContext = w.webkitAudioContext = function(){
  return { createOscillator:()=>({connect(){},start(){},stop(){},frequency:{setValueAtTime(){},exponentialRampToValueAtTime(){}},type:''}),
           createGain:()=>({connect(){},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){},linearRampToValueAtTime(){},value:0}}),
           destination:{}, currentTime:0, state:'running', resume(){} };
};

// Classic scripts share one global lexical scope in a browser; concatenate
// so top-level `const Sound` etc. are visible across files as they really are.
const bundle = ['storage.js','xp.js','timer.js','sound.js','firebase.js','repository.js','achievements.js','calendar.js','plan.js','app.js']
  .map(f => fs.readFileSync('./'+f,'utf8')).join('\n;\n');
try { w.eval(bundle); } catch(e){ errs.push('LOAD: '+e.message); }

// enterOfflineMode() is async as of the Phase 0 Repository migration
// (it awaits Repository.loadState()). In real usage this resolves on the
// next microtask with no perceptible delay — Storage.load() has no real
// I/O — but a synchronous test click can no longer assume the reload has
// finished by the very next line. Small awaited settles below account
// for that; they are not masking a real bug — see the passing repository
// tests, plus enterOfflineMode()'s own internal render calls at the end
// of its body, which is what actually updates the screen for real users
// regardless of when the caller's click handler returns.
const settle = (ms = 30) => new Promise(r => setTimeout(r, ms));

setTimeout(async () => {
  const d = w.document;
  try {
    // enter offline mode
    const btn = d.getElementById('btn-offline-enter');
    if (btn) btn.click(); else errs.push('no offline button');
    await settle();

    // seed a goal + tasks through the real API
    const S = w.Storage;
    const st = S.load();
    st.user.name='TEST';
    const gid = S.uuid();
    st.goals=[{id:gid,pillarId:'academics',title:'EDC — Exam Preparation',
               description:'Pass EDC internal',deadline:'2026-08-19',
               createdAt:new Date().toISOString(),status:'active'}];
    const mk=(t,m,sched)=>Object.assign(S.taskDefaults(),{id:S.uuid(),text:t,tag:'academics',
        goalId:gid,estimatedMinutes:m,completed:false,xpMultiplier:1,
        createdAt:new Date().toISOString(),completedAt:null,
        scheduledStart:sched?sched+'T09:00:00':null,
        scheduledEnd:sched?sched+'T10:00:00':null});
    st.tasks=[mk('Revise cylindrical coords',60,'2026-08-17'),
              mk('Infinite series PYQ',90,null),
              mk('Solve 2025 EDC PYQ',120,null)];
    st.milestones=[{id:S.uuid(),goalId:gid,title:'Core Topics',order:0,createdAt:''}];
    S.save(st);
    w.location && null;
  } catch(e){ errs.push('seed: '+e.message); }

  // reload app state by re-clicking offline
  try { const b=d.getElementById('btn-offline-enter'); if(b) b.click(); } catch(e){ errs.push('reenter: '+e.message); }
  await settle();

  const results = {};
  async function tryStep(name, fn){ try { await fn(); results[name]='ok'; } catch(e){ results[name]='FAIL '+e.message; errs.push(name+': '+e.stack.split('\n').slice(0,3).join(' | ')); } }

  await tryStep('open plan mode', ()=>{ d.getElementById('mode-plan').click(); });
  await tryStep('objectives rendered', ()=>{
    const n = d.querySelectorAll('#obj-grid .obj-card').length;
    if(!n) throw new Error('no goal cards, grid html='+d.getElementById('obj-grid').innerHTML.slice(0,200));
  });
  await tryStep('open goal detail', ()=>{ d.querySelector('#obj-grid .obj-card').click();
    if(!d.querySelector('.gd-title')) throw new Error('no goal detail'); });
  await tryStep('goal tasks listed', ()=>{
    const n=d.querySelectorAll('#gd-task-list .gd-task').length; if(n!==3) throw new Error('tasks='+n); });
  await tryStep('milestones listed', ()=>{
    if(!d.querySelector('.gd-ms')) throw new Error('no milestone'); });
  await tryStep('back to objectives', ()=>{ d.getElementById('btn-goal-back').click(); });
  await tryStep('open calendar', ()=>{ d.getElementById('plan-tab-calendar').click(); });
  await tryStep('week grid', ()=>{
    const slots=d.querySelectorAll('.cal-slot').length;
    const cols=d.querySelectorAll('.cal-col').length;
    if(cols!==7) throw new Error('cols='+cols);
    if(slots!==7*18) throw new Error('slots='+slots);
  });
  await tryStep('unscheduled rail', ()=>{
    const n=d.querySelectorAll('#cal-unscheduled .cal-us').length;
    if(n!==2) throw new Error('unscheduled='+n);
  });
  await tryStep('view: day', ()=>{ d.querySelector('.cal-view-btn[data-view=day]').click();
    if(d.querySelectorAll('.cal-col').length!==1) throw new Error('day cols'); });
  await tryStep('view: month', ()=>{ d.querySelector('.cal-view-btn[data-view=month]').click();
    if(d.querySelectorAll('.cal-m-cell').length!==42) throw new Error('month cells'); });
  await tryStep('view: agenda', ()=>{ d.querySelector('.cal-view-btn[data-view=agenda]').click(); });
  await tryStep('view: week back', ()=>{ d.querySelector('.cal-view-btn[data-view=week]').click(); });
  await tryStep('nav prev/next/today', ()=>{
    d.getElementById('cal-prev').click(); d.getElementById('cal-next').click();
    d.getElementById('cal-today').click(); });
  await tryStep('schedule via API', ()=>{
    const un = w.Storage.load().tasks.find(t=>!t.scheduledStart);
    w.Calendar.scheduleTask(un.id, '2026-08-18', 10*60, 90);
    const after = w.Storage.load().tasks.find(t=>t.id===un.id);
    if(!after.scheduledStart) throw new Error('not scheduled');
    if(after.scheduledStart!=='2026-08-18T10:00:00') throw new Error('bad start '+after.scheduledStart);
    if(after.estimatedMinutes!==90) throw new Error('bad dur');
  });
  await tryStep('task detail opens', ()=>{
    const t = w.Storage.load().tasks[0];
    w.Calendar.openTaskDetail(t.id);
    if(!d.getElementById('td-text')) throw new Error('no inspector');
    if(d.getElementById('task-detail').classList.contains('hidden')) throw new Error('hidden');
  });
  await tryStep('task detail save', ()=>{
    d.getElementById('td-text').value='RENAMED TASK';
    d.getElementById('td-mins').value='45';
    d.getElementById('td-save').click();
    const t=w.Storage.load().tasks.find(x=>x.text==='RENAMED TASK');
    if(!t) throw new Error('not saved');
    if(t.estimatedMinutes!==45) throw new Error('mins not saved');
  });
  await tryStep('schedule modal', ()=>{
    const t=w.Storage.load().tasks[1];
    w.Calendar.openScheduleModal(t.id);
    if(d.getElementById('schedule-modal').classList.contains('hidden')) throw new Error('hidden');
    d.getElementById('sch-date').value='2026-08-19';
    d.getElementById('sch-time').value='14:00';
    d.getElementById('sch-mins').value='120';
    d.getElementById('btn-schedule-save').click();
    const a=w.Storage.load().tasks.find(x=>x.id===t.id);
    if(a.scheduledStart!=='2026-08-19T14:00:00') throw new Error('start='+a.scheduledStart);
  });
  await tryStep('unschedule', ()=>{
    const t=w.Storage.load().tasks.find(x=>x.scheduledStart);
    w.Calendar.unschedule(t.id);
    if(w.Storage.load().tasks.find(x=>x.id===t.id).scheduledStart) throw new Error('still scheduled');
  });
  await tryStep('new goal modal', ()=>{
    d.getElementById('plan-tab-objectives').click();
    d.getElementById('btn-new-goal').click();
    d.getElementById('goal-title-input').value='Build Godot Game';
    d.getElementById('goal-deadline-input').value='2026-10-01';
    d.getElementById('btn-goal-save').click();
    const g=w.Storage.load().goals.find(x=>x.title==='Build Godot Game');
    if(!g) throw new Error('goal not created');
    if(w.Storage.load().weeks) throw new Error('WEEKS WERE GENERATED!');
  });
  await tryStep('dashboard still works', ()=>{
    d.getElementById('mode-forge').click();
    if(!d.getElementById('view-dashboard').classList.contains('active')) throw new Error('dash not active');
    if(!d.querySelectorAll('#quest-list .quest-item').length) throw new Error('no quests');
  });
  await tryStep('task queue works', ()=>{
    d.getElementById('rail-tasks').click();
    if(!d.querySelectorAll('#task-list .task-item').length) throw new Error('no tasks in queue');
  });

  // ═══════════════════════════════════════════════════════
  // PHASE 0.5 — CHARACTERIZATION TESTS
  //
  // These pin down three specific flows that have actually broken in
  // production this cycle. Independently seeded (don't rely on the
  // exact end-state of the steps above) so they stay stable if earlier
  // steps get reordered or edited.
  // ═══════════════════════════════════════════════════════

  await tryStep('seed completion-test task', async () => {
    const S = w.Storage;
    const st = S.load();
    const gid = st.goals[0] ? st.goals[0].id : null;
    st.tasks.push(Object.assign(S.taskDefaults(), {
      id: S.uuid(), text: 'COMPLETE ME', tag: 'academics', goalId: gid,
      completed: false, xpMultiplier: 1, createdAt: new Date().toISOString(),
      completedAt: null,
      scheduledStart: '2026-08-20T09:00:00', scheduledEnd: '2026-08-20T10:00:00'
    }));
    S.save(st);
    // Force app.js to reload its in-memory state from the seed we just wrote
    const b = d.getElementById('btn-offline-enter');
    if (b) b.click(); else throw new Error('no offline button to reload state');
    await settle();
  });

  await tryStep('scheduled task visible on calendar before completion', () => {
    d.getElementById('mode-plan').click();
    d.getElementById('plan-tab-calendar').click();
    w.Calendar.setView('week');
    const task = w.Storage.load().tasks.find(t => t.text === 'COMPLETE ME');
    const block = d.querySelector(`.cal-block[data-task="${task.id}"]`);
    if (!block) throw new Error('task block missing before completion — test setup broken');
  });

  await tryStep('complete task via task queue', () => {
    d.getElementById('rail-tasks').click();
    const task = w.Storage.load().tasks.find(t => t.text === 'COMPLETE ME');
    const check = d.querySelector(`[data-complete="${task.id}"]`);
    if (!check) throw new Error('no complete checkbox for seeded task');
    check.click();
    const after = w.Storage.load().tasks.find(t => t.id === task.id);
    if (!after.completed) throw new Error('task not marked completed');
  });

  await tryStep('completed task disappears from calendar week view', () => {
    d.getElementById('mode-plan').click();
    d.getElementById('plan-tab-calendar').click();
    w.Calendar.setView('week');
    const task = w.Storage.load().tasks.find(t => t.text === 'COMPLETE ME');
    const block = d.querySelector(`.cal-block[data-task="${task.id}"]`);
    if (block) throw new Error('completed task STILL rendered on calendar — regression of the completed-task-hiding fix!');
  });

  await tryStep('completed task not in unscheduled rail either', () => {
    const task = w.Storage.load().tasks.find(t => t.text === 'COMPLETE ME');
    const item = d.querySelector(`.cal-us[data-task="${task.id}"]`);
    if (item) throw new Error('completed task showing in unscheduled rail — should be fully hidden');
  });

  await tryStep('calendar preserveScroll: in-place edit keeps scroll position', () => {
    w.Calendar.setView('week');
    const scroll = d.getElementById('cal-scroll');
    if (!scroll) throw new Error('no cal-scroll element');
    // Sentinel value scrollToRelevant() could never produce naturally
    // (it always clamps to >= 0), so any change away from it proves
    // scrollToRelevant ran; staying at it proves scroll was preserved.
    scroll.scrollTop = -12345;
    const un = w.Storage.load().tasks.find(t => !t.scheduledStart && !t.completed);
    w.Calendar.scheduleTask(un.id, '2026-08-21', 9 * 60, 60); // in-place edit
    if (d.getElementById('cal-scroll').scrollTop !== -12345) {
      throw new Error('in-place edit (scheduleTask) reset scroll position — regression of the drag/resize scroll-jump bug!');
    }
  });

  await tryStep('calendar navigation resets scroll (expected — not a bug)', () => {
    const scroll = d.getElementById('cal-scroll');
    scroll.scrollTop = -12345;
    w.Calendar.goToday(); // genuine navigation SHOULD jump to "now"
    if (d.getElementById('cal-scroll').scrollTop === -12345) {
      throw new Error('navigation did not scroll to relevant position — scrollToRelevant broken');
    }
  });

  await tryStep('goal detail inline add-task form', () => {
    d.getElementById('plan-tab-objectives').click();
    const card = d.querySelector('#obj-grid .obj-card');
    if (!card) throw new Error('no goal card to open');
    card.click();

    const addBtn = d.getElementById('gd-add-task');
    if (!addBtn) throw new Error('no gd-add-task button');
    addBtn.click(); // should expand the inline form

    const form = d.getElementById('gd-inline-add');
    if (!form || form.classList.contains('hidden')) throw new Error('inline add form did not expand');

    d.getElementById('gd-task-input').value = 'NEW INLINE TASK';
    const medBtn = d.querySelector('.gd-diff-btn[data-mult="1.5"]');
    if (!medBtn) throw new Error('MEDIUM difficulty pill not found');
    medBtn.click();

    d.getElementById('gd-task-add').click();

    const created = w.Storage.load().tasks.find(t => t.text === 'NEW INLINE TASK');
    if (!created) throw new Error('inline add-task did not create a task');
    if (created.xpMultiplier !== 1.5) throw new Error('difficulty pill selection not applied, got ' + created.xpMultiplier);
    if (!d.getElementById('gd-inline-add').classList.contains('hidden')) {
      throw new Error('inline form did not collapse after adding');
    }
  });

  // ═══════════════════════════════════════════════════════
  // ACHIEVEMENT SYSTEM — end-to-end UI integration
  //
  // Pure calculation and persistence are covered exhaustively in
  // tests.achievements.js (Node-only, no DOM). These steps verify the
  // real click paths: marking a goal complete through the actual UI,
  // and confirming task completion via the queue checkbox drives a
  // coin award end-to-end through the live app wiring.
  // ═══════════════════════════════════════════════════════

  await tryStep('mark goal complete via UI awards coins for Goal Crusher bronze', async () => {
    const S = w.Storage;
    const before = S.load();
    const coinsBefore = before.user.coins || 0;

    d.getElementById('plan-tab-objectives').click();
    const card = d.querySelector('#obj-grid .obj-card');
    if (!card) throw new Error('no goal card to open');
    card.click();

    const markBtn = d.getElementById('gd-mark-complete');
    if (!markBtn) throw new Error('no gd-mark-complete button — goal may already be completed by an earlier step');
    markBtn.click();

    // forgeConfirm shows a modal — confirm it
    const okBtn = d.getElementById('forge-confirm-ok');
    if (!okBtn || d.getElementById('forge-confirm-backdrop').classList.contains('hidden')) {
      throw new Error('confirm modal did not open');
    }
    okBtn.click();
    await settle();

    const after = S.load();
    const goal = after.goals.find(g => g.status === 'completed');
    if (!goal) throw new Error('no goal has status=completed after confirming');
    if (!goal.completedAt) throw new Error('completedAt was not set');

    if (!after.achievements.goal_crusher || !after.achievements.goal_crusher.unlockedTiers.includes('bronze')) {
      throw new Error('Goal Crusher bronze was not unlocked after completing the first goal');
    }
    if (!((after.user.coins || 0) > coinsBefore)) {
      throw new Error('coins were not awarded for the achievement unlock');
    }
  });

  await tryStep('achievements section renders in Armory with the new unlock reflected', () => {
    d.getElementById('mode-forge').click();
    d.getElementById('rail-shop').click();
    const list = d.getElementById('shop-achievements-list');
    if (!list || !list.children.length) throw new Error('achievements list did not render');
    const crusherCard = Array.from(list.children).find(c => c.textContent.includes('Goal Crusher'));
    if (!crusherCard) throw new Error('Goal Crusher card not found in Armory');
    const unlockedDot = crusherCard.querySelector('.ach-tier-dot.unlocked');
    if (!unlockedDot) throw new Error('Goal Crusher card shows no unlocked tier despite bronze being unlocked');
  });

  await tryStep('re-marking already-completed data does not re-award (anti-farm, via real app code path)', async () => {
    const S = w.Storage;
    const before = S.load();
    const coinsBefore = before.user.coins || 0;
    // Re-run the exact same detection the app runs after every
    // completion event, with no new qualifying data — must be a no-op.
    const unlocked = w.Achievements.detectNewUnlocks(before);
    if (unlocked.length !== 0) throw new Error('re-running detection with no new data returned unlocks — farming would be possible');
    S.save(before);
    const after = S.load();
    if ((after.user.coins || 0) !== coinsBefore) throw new Error('coins changed despite no new unlocks');
  });

  console.log(JSON.stringify(results,null,1));
  console.log('\nERRORS:', errs.length ? errs.slice(0,12) : 'none');
  process.exit(errs.length ? 1 : 0);
}, 600);
