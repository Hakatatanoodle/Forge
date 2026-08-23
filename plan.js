// ═══════════════════════════════════════════════════════
// plan.js — PLAN MODE: Objectives + Goal Detail
//
// The planning model:  PILLARS → GOALS → TASKS → CALENDAR
//
//   Pillars  = WHERE  (areas of life; organise goals, filter only)
//   Goals    = WHY    (outcomes with deadlines)
//   Tasks    = WHAT   (actions that move a goal forward)
//   Calendar = WHEN   (the commitment layer — see calendar.js)
//
// There are NO week objects. A week is a time window, not a planning
// object. Meaningful checkpoints are milestones, never "Week 3".
// ═══════════════════════════════════════════════════════

const Plan = (() => {

  const $ = id => document.getElementById(id);

  let ctx        = null;   // wiring back to app.js
  let activeTab  = 'objectives';
  let filterPillar = 'all';
  let hideCompleted = false;
  let activeGoalId = null;
  let editingGoalId = null;

  // ── Small date helpers (local time, never UTC) ──
  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const d = Storage.parseLocal(dateStr + 'T00:00:00');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((d - today) / 86400000);
  }

  function deadlineLabel(dateStr) {
    if (!dateStr) return { text: 'NO DEADLINE', cls: 'dl-none' };
    const n = daysUntil(dateStr);
    const d = Storage.parseLocal(dateStr + 'T00:00:00');
    const pretty = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
    if (n < 0)   return { text: `${pretty} · ${Math.abs(n)}D OVERDUE`, cls: 'dl-overdue' };
    if (n === 0) return { text: `${pretty} · TODAY`,                   cls: 'dl-urgent'  };
    if (n === 1) return { text: `${pretty} · 1 DAY LEFT`,              cls: 'dl-urgent'  };
    if (n <= 7)  return { text: `${pretty} · ${n} DAYS LEFT`,          cls: 'dl-soon'    };
    return { text: `${pretty} · ${n} DAYS LEFT`, cls: 'dl-ok' };
  }

  function fmtMins(m) {
    if (!m) return '0m';
    const h = Math.floor(m / 60), mm = m % 60;
    return h ? (mm ? `${h}h ${mm}m` : `${h}h`) : `${mm}m`;
  }

  // ── Goal progress — derived from goal WORK, never from week containers ──
  function goalProgress(goalId) {
    const s = ctx.getState();
    const tasks = (s.tasks || []).filter(t => t.goalId === goalId);
    const done  = tasks.filter(t => t.completed).length;
    const total = tasks.length;
    const pct   = total ? Math.round(done / total * 100) : 0;
    const estRemaining = tasks
      .filter(t => !t.completed)
      .reduce((a, t) => a + (t.estimatedMinutes || 0), 0);
    const estTotal = tasks.reduce((a, t) => a + (t.estimatedMinutes || 0), 0);
    return { done, total, pct, estRemaining, estTotal, tasks };
  }

  // ══════════════════════════════════════════
  // TAB ROUTING
  // ══════════════════════════════════════════
  function showTab(tab, context) {
    if (context) ctx = context;
    activeTab = tab;

    const surfaces = {
      objectives: 'plan-view-objectives',
      goal:       'plan-view-goal',
      calendar:   'plan-view-calendar'
    };
    Object.entries(surfaces).forEach(([k, id]) => {
      const el = $(id);
      if (el) el.classList.toggle('hidden', k !== tab);
    });

    // Goal detail is a drill-down of Objectives, so it keeps that tab lit.
    const lit = tab === 'goal' ? 'objectives' : tab;
    ['objectives', 'calendar'].forEach(t => {
      const btn = $(`plan-tab-${t}`);
      if (btn) btn.classList.toggle('active', t === lit);
    });

    const sub = $('plan-subtitle');
    if (sub) {
      sub.textContent = tab === 'calendar'
        ? 'WHEN YOU WILL DO IT'
        : 'OUTCOMES · ACTIONS · COMMITMENT';
    }

    if (tab === 'objectives') renderObjectives();
    if (tab === 'goal')       renderGoalDetail();
    if (tab === 'calendar' && window.Calendar) Calendar.render();
  }

  function render(context) {
    if (context) ctx = context;
    showTab(activeTab === 'goal' ? 'objectives' : activeTab);
  }

  function refresh() {
    if (!ctx) return;
    if (activeTab === 'objectives') renderObjectives();
    else if (activeTab === 'goal')  renderGoalDetail();
    else if (activeTab === 'calendar' && window.Calendar) Calendar.render();
  }

  // ══════════════════════════════════════════
  // OBJECTIVES SCREEN
  // ══════════════════════════════════════════
  function renderObjectives() {
    renderFilters();
    renderGoalGrid();
    renderPillarList();
  }

  function renderFilters() {
    const row = $('obj-filters');
    if (!row) return;
    const s = ctx.getState();
    const pillars = s.pillars || [];

    const chips = [{ id: 'all', name: 'ALL', color: 'var(--accent)', icon: '' }]
      .concat(pillars);

    row.innerHTML = chips.map(p => `
      <button class="obj-filter ${p.id === filterPillar ? 'active' : ''}"
              data-pillar="${p.id}"
              style="--chip:${p.color || 'var(--accent)'}">
        ${p.icon ? p.icon + ' ' : ''}${ctx.escHtml(p.name)}
      </button>`).join('');

    row.querySelectorAll('.obj-filter').forEach(b => {
      b.addEventListener('click', () => {
        filterPillar = b.dataset.pillar;
        ctx.sound.click();
        renderObjectives();
      });
    });
  }

  function visibleGoals() {
    const s = ctx.getState();
    let goals = (s.goals || []).filter(g => g.status !== 'archived');
    if (filterPillar !== 'all') goals = goals.filter(g => g.pillarId === filterPillar);
    if (hideCompleted)          goals = goals.filter(g => g.status !== 'completed');
    // Soonest deadline first; undated goals sink to the bottom.
    return goals.sort((a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline.localeCompare(b.deadline);
    });
  }

  function renderGoalGrid() {
    const grid = $('obj-grid');
    if (!grid) return;
    const goals = visibleGoals();
    const s = ctx.getState();

    const countEl = $('obj-count');
    if (countEl) {
      const active = (s.goals || []).filter(g => g.status !== 'completed' && g.status !== 'archived').length;
      countEl.textContent = `${active} ACTIVE GOAL${active === 1 ? '' : 'S'}`;
    }

    if (!goals.length) {
      grid.innerHTML = `
        <div class="obj-empty">
          <span class="obj-empty-title">NO OBJECTIVES YET</span>
          <span class="obj-empty-sub">A goal is an outcome with a deadline.<br/>Define one, break it into tasks, then commit them to the calendar.</span>
          <button class="btn-primary" id="obj-empty-new">+ FORGE YOUR FIRST GOAL</button>
        </div>`;
      const b = $('obj-empty-new');
      if (b) b.addEventListener('click', () => openGoalModal(null));
      return;
    }

    grid.innerHTML = goals.map(g => {
      const pillar = ctx.getPillarById(g.pillarId);
      const p      = goalProgress(g.id);
      const dl     = deadlineLabel(g.deadline);
      const isDone = g.status === 'completed';
      return `
        <div class="obj-card ${isDone ? 'is-done' : ''}" data-goal="${g.id}"
             role="button" tabindex="0" style="--pillar:${pillar.color}">
          <div class="obj-card-top">
            <span class="obj-card-icon">${pillar.icon}</span>
            <span class="obj-card-pillar">${ctx.escHtml(pillar.name)}</span>
            <span class="obj-card-pct">${p.pct}%</span>
          </div>
          <div class="obj-card-title">${ctx.escHtml(g.title)}</div>
          ${g.description ? `<div class="obj-card-desc">${ctx.escHtml(g.description)}</div>` : ''}
          <div class="obj-card-deadline ${dl.cls}">${dl.text}</div>
          <div class="obj-progress"><div class="obj-progress-fill" style="width:${p.pct}%"></div></div>
          <div class="obj-card-foot">
            <span>${p.done} / ${p.total} tasks complete</span>
            ${p.estRemaining ? `<span class="obj-card-est">${fmtMins(p.estRemaining)} left</span>` : ''}
            <span class="obj-card-arrow">→</span>
          </div>
          <div class="obj-card-actions">
            <span class="obj-card-act" data-edit-goal="${g.id}" role="button" tabindex="0" title="Edit goal">EDIT</span>
            <span class="obj-card-act danger" data-del-goal="${g.id}" role="button" tabindex="0" title="Delete goal">✕</span>
          </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.obj-card').forEach(c => {
      c.addEventListener('click', e => {
        // Let the per-card action buttons win the click.
        if (e.target.closest('[data-edit-goal],[data-del-goal]')) return;
        activeGoalId = c.dataset.goal;
        ctx.sound.click();
        showTab('goal');
      });
    });

    grid.querySelectorAll('[data-edit-goal]').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        openGoalModal(b.dataset.editGoal);
      });
    });

    grid.querySelectorAll('[data-del-goal]').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        deleteGoal(b.dataset.delGoal);
      });
    });
  }

  // ── Pillars strip (pillars kept — they organise goals) ──
  function renderPillarList() {
    const list = $('plan-pillars-list');
    if (!list) return;
    const s = ctx.getState();
    const pillars = s.pillars || [];

    if (!pillars.length) {
      list.innerHTML = `<div class="plan-empty-state">No pillars yet.</div>`;
      return;
    }

    list.innerHTML = pillars.map((p, i) => {
      const goals = (s.goals || []).filter(g => g.pillarId === p.id).length;
      return `
        <div class="pillar-chip-row" style="--pillar:${p.color}">
          <span class="pillar-chip-icon">${p.icon}</span>
          <span class="pillar-chip-name">${ctx.escHtml(p.name)}</span>
          <span class="pillar-chip-count">${goals} goal${goals === 1 ? '' : 's'}</span>
          <button class="pillar-action-btn" data-edit-pillar="${i}">EDIT</button>
          <button class="pillar-action-btn danger" data-del-pillar="${i}">✕</button>
        </div>`;
    }).join('');

    list.querySelectorAll('[data-edit-pillar]').forEach(b => {
      b.addEventListener('click', () => {
        if (ctx.editPillar) ctx.editPillar(parseInt(b.dataset.editPillar, 10));
      });
    });

    list.querySelectorAll('[data-del-pillar]').forEach(b => {
      b.addEventListener('click', () => {
        const idx = parseInt(b.dataset.delPillar, 10);
        const pillar = s.pillars[idx];
        if (!pillar) return;
        ctx.forgeConfirm(`Delete ${pillar.name}? Its goals and tasks move to OTHER.`, () => {
          const st = ctx.getState();
          const fallback = (st.pillars.find(p => p.id === 'other') || st.pillars[0] || {}).id || 'other';
          (st.goals || []).forEach(g => { if (g.pillarId === pillar.id) g.pillarId = fallback; });
          (st.tasks || []).forEach(t => { if (t.tag === pillar.id) t.tag = fallback; });
          st.pillars = st.pillars.filter(p => p.id !== pillar.id);
          if (filterPillar === pillar.id) filterPillar = 'all';
          ctx.save();
          renderObjectives();
          ctx.onTasksChanged();
        });
      });
    });
  }

  // ══════════════════════════════════════════
  // GOAL DETAIL
  // ══════════════════════════════════════════
  function renderGoalDetail() {
    const body = $('goal-detail-body');
    if (!body) return;
    const s = ctx.getState();
    const goal = (s.goals || []).find(g => g.id === activeGoalId);

    if (!goal) { showTab('objectives'); return; }

    const pillar = ctx.getPillarById(goal.pillarId);
    const p      = goalProgress(goal.id);
    const dl     = deadlineLabel(goal.deadline);
    const milestones = (s.milestones || [])
      .filter(m => m.goalId === goal.id)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    body.innerHTML = `
      <div class="goal-detail" style="--pillar:${pillar.color}">

        <div class="gd-hero">
          <div class="gd-hero-main">
            <span class="gd-pillar">${pillar.icon} ${ctx.escHtml(pillar.name)}</span>
            <h2 class="gd-title">${ctx.escHtml(goal.title)}</h2>
            ${goal.description ? `<p class="gd-desc">${ctx.escHtml(goal.description)}</p>` : ''}
            ${goal.status === 'completed' ? `<span class="gd-completed-badge">✓ COMPLETED ${goal.completedAt ? ctx.escHtml(goal.completedAt.slice(0,10)) : ''}</span>` : ''}
          </div>
          <div class="gd-hero-actions">
            <button class="btn-ghost" id="gd-edit">EDIT GOAL</button>
            ${goal.status !== 'completed' ? `<button class="btn-ghost" id="gd-mark-complete">✓ MARK COMPLETE</button>` : ''}
            <button class="btn-primary" id="gd-add-task">+ ADD TASK</button>
          </div>
        </div>

        <div class="gd-stats">
          <div class="gd-stat">
            <span class="gd-stat-label">DEADLINE</span>
            <span class="gd-stat-value ${dl.cls}">${dl.text}</span>
          </div>
          <div class="gd-stat">
            <span class="gd-stat-label">PROGRESS</span>
            <span class="gd-stat-value">${p.pct}%</span>
          </div>
          <div class="gd-stat">
            <span class="gd-stat-label">TASKS</span>
            <span class="gd-stat-value">${p.done} / ${p.total}</span>
          </div>
          <div class="gd-stat">
            <span class="gd-stat-label">EST. REMAINING</span>
            <span class="gd-stat-value">${fmtMins(p.estRemaining)}</span>
          </div>
        </div>

        <div class="obj-progress gd-progress"><div class="obj-progress-fill" style="width:${p.pct}%"></div></div>

        <!-- Inline add-task form — hidden until + ADD TASK is clicked -->
        <div class="gd-inline-add hidden" id="gd-inline-add">
          <div class="gd-inline-add-label">NEW TASK</div>
          <div class="gd-inline-add-row">
            <input type="text" id="gd-task-input" class="text-input gd-inline-input"
                   placeholder="what action moves this forward..." maxlength="80" />
            <div class="gd-inline-add-meta">
              <div class="gd-inline-diff-row" id="gd-inline-diff-row">
                <button class="gd-diff-btn active" data-mult="1.0" title="Easy">EASY</button>
                <button class="gd-diff-btn" data-mult="1.5" title="Medium">MED</button>
                <button class="gd-diff-btn" data-mult="2.0" title="Hard">HARD</button>
              </div>
              <input type="number" id="gd-task-mins" class="text-input gd-mins"
                     value="60" min="5" max="600" step="5" title="Estimated minutes" />
              <button class="btn-primary gd-inline-add-btn" id="gd-task-add">ADD</button>
              <button class="btn-ghost gd-inline-cancel" id="gd-inline-cancel">✕</button>
            </div>
          </div>
        </div>

        <div class="gd-cols">
          <section class="gd-section">
            <div class="gd-section-head">
              <span class="plan-section-label">TASKS</span>
              <span class="gd-section-sub">${p.total} total</span>
            </div>
            <div class="gd-task-list" id="gd-task-list"></div>
          </section>

          <section class="gd-section">
            <div class="gd-section-head">
              <span class="plan-section-label">MILESTONES</span>
              <span class="gd-section-sub">meaningful checkpoints</span>
            </div>
            <div class="gd-milestones" id="gd-milestones"></div>
            <div class="gd-add-row">
              <input type="text" id="gd-ms-input" class="text-input" placeholder="e.g. Prototype complete" maxlength="50" />
              <button class="btn-ghost" id="gd-ms-add">+</button>
            </div>
          </section>
        </div>
      </div>`;

    renderGoalTasks(goal);
    renderMilestones(goal, milestones);

    $('gd-edit').addEventListener('click', () => openGoalModal(goal.id));

    const markCompleteBtn = $('gd-mark-complete');
    if (markCompleteBtn) {
      markCompleteBtn.addEventListener('click', () => {
        ctx.forgeConfirm(`Mark "${goal.title}" as complete?`, () => {
          goal.status      = 'completed';
          goal.completedAt = new Date().toISOString();
          if (ctx.checkAchievements) ctx.checkAchievements();
          ctx.save();
          ctx.sound.click();
          ctx.showToast('GOAL COMPLETE ✓', 'success');
          showTab('objectives');
        });
      });
    }

    // + ADD TASK hero button → expand inline form
    $('gd-add-task').addEventListener('click', () => {
      $('gd-inline-add').classList.remove('hidden');
      $('gd-add-task').classList.add('hidden');
      setTimeout(() => $('gd-task-input').focus(), 60);
    });

    // Cancel → collapse form
    $('gd-inline-cancel').addEventListener('click', () => {
      $('gd-inline-add').classList.add('hidden');
      $('gd-add-task').classList.remove('hidden');
      $('gd-task-input').value = '';
    });

    // Difficulty pills inside inline form
    document.querySelectorAll('.gd-diff-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.gd-diff-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    $('gd-task-add').addEventListener('click', () => addGoalTask(goal));
    $('gd-task-input').addEventListener('keydown', e => { if (e.key === 'Enter') addGoalTask(goal); });
    $('gd-ms-add').addEventListener('click', () => addMilestone(goal));
    $('gd-ms-input').addEventListener('keydown', e => { if (e.key === 'Enter') addMilestone(goal); });
  }

  function renderGoalTasks(goal) {
    const list = $('gd-task-list');
    if (!list) return;
    const s = ctx.getState();
    const tasks = (s.tasks || []).filter(t => t.goalId === goal.id);

    if (!tasks.length) {
      list.innerHTML = `<div class="plan-empty-state">No tasks yet. Break this outcome into actions.</div>`;
      return;
    }

    const sorted = [...tasks].sort((a, b) => (a.completed ? 1 : 0) - (b.completed ? 1 : 0));

    list.innerHTML = sorted.map(t => {
      const sched = t.scheduledStart ? Storage.parseLocal(t.scheduledStart) : null;
      const schedLabel = sched
        ? sched.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase() +
          ' ' + String(sched.getHours()).padStart(2, '0') + ':' + String(sched.getMinutes()).padStart(2, '0')
        : 'UNSCHEDULED';
      const overdue = sched && !t.completed && sched < new Date();
      const dots = Math.round((t.xpMultiplier || 1) * 2); // 1→2, 1.5→3, 2→4
      return `
        <div class="gd-task ${t.completed ? 'is-done' : ''}" data-task="${t.id}">
          <button class="gd-task-check ${t.completed ? 'checked' : ''}" data-toggle="${t.id}">${t.completed ? '✓' : ''}</button>
          <span class="gd-task-text">${ctx.escHtml(t.text)}</span>
          <span class="gd-task-diff">${'●'.repeat(dots)}${'○'.repeat(5 - dots)}</span>
          <span class="gd-task-est">${fmtMins(t.estimatedMinutes || 0)}</span>
          <span class="gd-task-sched ${t.scheduledStart ? (overdue ? 'is-overdue' : 'is-sched') : 'is-unsched'}">${schedLabel}</span>
          <button class="gd-task-plan" data-plan="${t.id}">PLAN</button>
        </div>`;
    }).join('');

    list.querySelectorAll('[data-toggle]').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        const t = ctx.getState().tasks.find(x => x.id === b.dataset.toggle);
        if (!t) return;
        t.completed = !t.completed;
        t.completedAt = t.completed ? new Date().toISOString() : null;
        ctx.save();
        ctx.sound.click();
        renderGoalDetail();
        ctx.onTasksChanged();
      });
    });

    list.querySelectorAll('[data-plan]').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        if (window.Calendar) Calendar.openScheduleModal(b.dataset.plan);
      });
    });

    list.querySelectorAll('.gd-task').forEach(row => {
      row.addEventListener('click', () => {
        if (window.Calendar) Calendar.openTaskDetail(row.dataset.task);
      });
    });
  }

  function addGoalTask(goal) {
    const input = $('gd-task-input');
    const mins  = $('gd-task-mins');
    const text  = input.value.trim();
    if (!text) { input.focus(); return; }

    // Read difficulty from active pill
    const activeDiff = document.querySelector('.gd-diff-btn.active');
    const xpMultiplier = activeDiff ? parseFloat(activeDiff.dataset.mult) : 1.0;

    const s = ctx.getState();
    s.tasks.push(Object.assign(Storage.taskDefaults(), {
      id:               Storage.uuid(),
      text,
      tag:              goal.pillarId,
      goalId:           goal.id,
      estimatedMinutes: Math.max(5, parseInt(mins.value, 10) || 60),
      completed:        false,
      xpMultiplier,
      createdAt:        new Date().toISOString(),
      completedAt:      null
    }));

    ctx.save();
    input.value = '';
    // Reset difficulty to easy and collapse the form
    document.querySelectorAll('.gd-diff-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
    $('gd-inline-add').classList.add('hidden');
    $('gd-add-task').classList.remove('hidden');
    ctx.sound.taskAdded ? ctx.sound.taskAdded() : ctx.sound.click();
    renderGoalDetail();
    ctx.onTasksChanged();
  }

  function renderMilestones(goal, milestones) {
    const box = $('gd-milestones');
    if (!box) return;
    const s = ctx.getState();

    if (!milestones.length) {
      box.innerHTML = `<div class="plan-empty-state gd-ms-empty">Optional. Only add milestones that represent meaningful checkpoints — not "Week 3".</div>`;
      return;
    }

    box.innerHTML = milestones.map(m => {
      const mt    = (s.tasks || []).filter(t => t.milestoneId === m.id);
      const done  = mt.filter(t => t.completed).length;
      const total = mt.length;
      const complete = total > 0 && done === total;
      return `
        <div class="gd-ms ${complete ? 'is-complete' : ''}">
          <span class="gd-ms-mark">${complete ? '✓' : '○'}</span>
          <span class="gd-ms-title">${ctx.escHtml(m.title)}</span>
          <span class="gd-ms-count">${done} / ${total}</span>
          <button class="gd-ms-del" data-del-ms="${m.id}">✕</button>
        </div>`;
    }).join('');

    box.querySelectorAll('[data-del-ms]').forEach(b => {
      b.addEventListener('click', () => {
        const st = ctx.getState();
        const id = b.dataset.delMs;
        st.milestones = st.milestones.filter(m => m.id !== id);
        (st.tasks || []).forEach(t => { if (t.milestoneId === id) t.milestoneId = null; });
        ctx.save();
        renderGoalDetail();
      });
    });
  }

  function addMilestone(goal) {
    const input = $('gd-ms-input');
    const title = input.value.trim();
    if (!title) return;
    const s = ctx.getState();
    if (!s.milestones) s.milestones = [];
    s.milestones.push({
      id:        Storage.uuid(),
      goalId:    goal.id,
      title,
      order:     s.milestones.filter(m => m.goalId === goal.id).length,
      createdAt: new Date().toISOString()
    });
    ctx.save();
    input.value = '';
    ctx.sound.click();
    renderGoalDetail();
  }

  // ══════════════════════════════════════════
  // GOAL MODAL
  // ══════════════════════════════════════════
  function openGoalModal(goalId) {
    editingGoalId = goalId || null;
    const s = ctx.getState();
    const goal = goalId ? (s.goals || []).find(g => g.id === goalId) : null;

    $('goal-modal-title').textContent = goal ? 'EDIT GOAL' : 'NEW GOAL';
    $('goal-title-input').value    = goal ? goal.title : '';
    $('goal-desc-input').value     = goal ? (goal.description || '') : '';
    $('goal-deadline-input').value = goal ? (goal.deadline || '') : '';

    const sel = $('goal-pillar-select');
    sel.innerHTML = (s.pillars || []).map(p =>
      `<option value="${p.id}">${p.icon} ${ctx.escHtml(p.name)}</option>`).join('');
    if (goal) sel.value = goal.pillarId;
    else if (filterPillar !== 'all') sel.value = filterPillar;

    $('btn-goal-delete').style.display = goal ? '' : 'none';
    $('goal-modal').classList.remove('hidden');
    setTimeout(() => $('goal-title-input').focus(), 100);
  }

  function closeGoalModal() {
    $('goal-modal').classList.add('hidden');
    editingGoalId = null;
  }

  function saveGoal() {
    const title = $('goal-title-input').value.trim();
    if (!title) { ctx.showToast('ENTER A TITLE', 'error'); return; }

    const s = ctx.getState();
    const data = {
      title,
      description: $('goal-desc-input').value.trim(),
      deadline:    $('goal-deadline-input').value,
      pillarId:    $('goal-pillar-select').value
    };

    if (editingGoalId) {
      const g = (s.goals || []).find(x => x.id === editingGoalId);
      if (g) Object.assign(g, data);
    } else {
      if (!s.goals) s.goals = [];
      // NOTE: no weeks are generated. A goal is tasks + a deadline.
      const g = Object.assign({
        id:        Storage.uuid(),
        createdAt: new Date().toISOString(),
        status:    'active'
      }, data);
      s.goals.push(g);
      activeGoalId = g.id;
    }

    ctx.save();
    ctx.sound.click();
    closeGoalModal();
    refresh();
    ctx.onTasksChanged();
  }

  // Callable from the goal modal OR straight from a goal card's ✕.
  function deleteGoal(goalId) {
    const id = goalId || editingGoalId;
    if (!id) return;
    const s = ctx.getState();
    const goal = (s.goals || []).find(g => g.id === id);
    if (!goal) return;

    const taskCount = (s.tasks || []).filter(t => t.goalId === id).length;

    // Close the modal FIRST — stacking the confirm on top of it reads as
    // "nothing happened", and it must not linger behind the confirm.
    closeGoalModal();

    const warn = taskCount
      ? `Delete "${goal.title}"? Its ${taskCount} task${taskCount === 1 ? '' : 's'} will be kept but unlinked from any goal.`
      : `Delete "${goal.title}"?`;

    ctx.forgeConfirm(warn, () => {
      const st = ctx.getState();
      st.goals      = (st.goals || []).filter(g => g.id !== id);
      st.milestones = (st.milestones || []).filter(m => m.goalId !== id);
      (st.tasks || []).forEach(t => {
        if (t.goalId === id) { t.goalId = null; t.milestoneId = null; }
      });
      ctx.save();
      if (activeGoalId === id) activeGoalId = null;
      showTab('objectives');
      ctx.onTasksChanged();
      ctx.showToast('GOAL DELETED', 'success');
    });
  }

  // ══════════════════════════════════════════
  // BIND
  // ══════════════════════════════════════════
  function bind(context) {
    ctx = context;

    $('plan-tab-objectives').addEventListener('click', () => { ctx.sound.click(); showTab('objectives'); });
    $('plan-tab-calendar')  .addEventListener('click', () => { ctx.sound.click(); showTab('calendar'); });
    $('btn-goal-back')      .addEventListener('click', () => { ctx.sound.click(); showTab('objectives'); });

    $('btn-new-goal').addEventListener('click', () => openGoalModal(null));

    $('obj-hide-completed').addEventListener('change', e => {
      hideCompleted = e.target.checked;
      renderObjectives();
    });

    $('goal-modal-close')   .addEventListener('click', closeGoalModal);
    $('goal-modal-backdrop').addEventListener('click', closeGoalModal);
    $('btn-goal-cancel')    .addEventListener('click', closeGoalModal);
    $('btn-goal-save')      .addEventListener('click', saveGoal);
    $('btn-goal-delete')    .addEventListener('click', () => deleteGoal());
    $('goal-title-input')   .addEventListener('keydown', e => { if (e.key === 'Enter') saveGoal(); });

    if (window.Calendar) Calendar.bind(context);
  }

  return {
    render, refresh, bind, showTab,
    openGoalModal,
    goalProgress, deadlineLabel, daysUntil, fmtMins,
    getActiveGoalId: () => activeGoalId
  };

})();

if (typeof window !== 'undefined') window.Plan = Plan;
