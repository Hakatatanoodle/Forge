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
const bundle = ['storage.js','xp.js','timer.js','sound.js','firebase.js','calendar.js','plan.js','app.js']
  .map(f => fs.readFileSync('./'+f,'utf8')).join('\n;\n');
try { w.eval(bundle); } catch(e){ errs.push('LOAD: '+e.message); }

setTimeout(() => {
  const d = w.document;
  try {
    // enter offline mode
    const btn = d.getElementById('btn-offline-enter');
    if (btn) btn.click(); else errs.push('no offline button');

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

  const results = {};
  function tryStep(name, fn){ try { fn(); results[name]='ok'; } catch(e){ results[name]='FAIL '+e.message; errs.push(name+': '+e.stack.split('\n').slice(0,3).join(' | ')); } }

  tryStep('open plan mode', ()=>{ d.getElementById('mode-plan').click(); });
  tryStep('objectives rendered', ()=>{
    const n = d.querySelectorAll('#obj-grid .obj-card').length;
    if(!n) throw new Error('no goal cards, grid html='+d.getElementById('obj-grid').innerHTML.slice(0,200));
  });
  tryStep('open goal detail', ()=>{ d.querySelector('#obj-grid .obj-card').click();
    if(!d.querySelector('.gd-title')) throw new Error('no goal detail'); });
  tryStep('goal tasks listed', ()=>{
    const n=d.querySelectorAll('#gd-task-list .gd-task').length; if(n!==3) throw new Error('tasks='+n); });
  tryStep('milestones listed', ()=>{
    if(!d.querySelector('.gd-ms')) throw new Error('no milestone'); });
  tryStep('back to objectives', ()=>{ d.getElementById('btn-goal-back').click(); });
  tryStep('open calendar', ()=>{ d.getElementById('plan-tab-calendar').click(); });
  tryStep('week grid', ()=>{
    const slots=d.querySelectorAll('.cal-slot').length;
    const cols=d.querySelectorAll('.cal-col').length;
    if(cols!==7) throw new Error('cols='+cols);
    if(slots!==7*18) throw new Error('slots='+slots);
  });
  tryStep('unscheduled rail', ()=>{
    const n=d.querySelectorAll('#cal-unscheduled .cal-us').length;
    if(n!==2) throw new Error('unscheduled='+n);
  });
  tryStep('view: day', ()=>{ d.querySelector('.cal-view-btn[data-view=day]').click();
    if(d.querySelectorAll('.cal-col').length!==1) throw new Error('day cols'); });
  tryStep('view: month', ()=>{ d.querySelector('.cal-view-btn[data-view=month]').click();
    if(d.querySelectorAll('.cal-m-cell').length!==42) throw new Error('month cells'); });
  tryStep('view: agenda', ()=>{ d.querySelector('.cal-view-btn[data-view=agenda]').click(); });
  tryStep('view: week back', ()=>{ d.querySelector('.cal-view-btn[data-view=week]').click(); });
  tryStep('nav prev/next/today', ()=>{
    d.getElementById('cal-prev').click(); d.getElementById('cal-next').click();
    d.getElementById('cal-today').click(); });
  tryStep('schedule via API', ()=>{
    const un = w.Storage.load().tasks.find(t=>!t.scheduledStart);
    w.Calendar.scheduleTask(un.id, '2026-08-18', 10*60, 90);
    const after = w.Storage.load().tasks.find(t=>t.id===un.id);
    if(!after.scheduledStart) throw new Error('not scheduled');
    if(after.scheduledStart!=='2026-08-18T10:00:00') throw new Error('bad start '+after.scheduledStart);
    if(after.estimatedMinutes!==90) throw new Error('bad dur');
  });
  tryStep('task detail opens', ()=>{
    const t = w.Storage.load().tasks[0];
    w.Calendar.openTaskDetail(t.id);
    if(!d.getElementById('td-text')) throw new Error('no inspector');
    if(d.getElementById('task-detail').classList.contains('hidden')) throw new Error('hidden');
  });
  tryStep('task detail save', ()=>{
    d.getElementById('td-text').value='RENAMED TASK';
    d.getElementById('td-mins').value='45';
    d.getElementById('td-save').click();
    const t=w.Storage.load().tasks.find(x=>x.text==='RENAMED TASK');
    if(!t) throw new Error('not saved');
    if(t.estimatedMinutes!==45) throw new Error('mins not saved');
  });
  tryStep('schedule modal', ()=>{
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
  tryStep('unschedule', ()=>{
    const t=w.Storage.load().tasks.find(x=>x.scheduledStart);
    w.Calendar.unschedule(t.id);
    if(w.Storage.load().tasks.find(x=>x.id===t.id).scheduledStart) throw new Error('still scheduled');
  });
  tryStep('new goal modal', ()=>{
    d.getElementById('plan-tab-objectives').click();
    d.getElementById('btn-new-goal').click();
    d.getElementById('goal-title-input').value='Build Godot Game';
    d.getElementById('goal-deadline-input').value='2026-10-01';
    d.getElementById('btn-goal-save').click();
    const g=w.Storage.load().goals.find(x=>x.title==='Build Godot Game');
    if(!g) throw new Error('goal not created');
    if(w.Storage.load().weeks) throw new Error('WEEKS WERE GENERATED!');
  });
  tryStep('dashboard still works', ()=>{
    d.getElementById('mode-forge').click();
    if(!d.getElementById('view-dashboard').classList.contains('active')) throw new Error('dash not active');
    if(!d.querySelectorAll('#quest-list .quest-item').length) throw new Error('no quests');
  });
  tryStep('task queue works', ()=>{
    d.getElementById('rail-tasks').click();
    if(!d.querySelectorAll('#task-list .task-item').length) throw new Error('no tasks in queue');
  });

  console.log(JSON.stringify(results,null,1));
  console.log('\nERRORS:', errs.length ? errs.slice(0,12) : 'none');
  process.exit(errs.length ? 1 : 0);
}, 600);
