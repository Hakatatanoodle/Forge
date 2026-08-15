// ═══════════════════════════════════════════════════════
// calendar.js — THE COMMITMENT LAYER
//
// A real time × date calendar. NOT a kanban board.
// Rows are hours, columns are dates — never pillars or goals.
//
// A task with scheduledStart === null is UNSCHEDULED. That is not an
// error; it means "I know this needs doing, but haven't committed to
// when." Unscheduled work lives in the side rail, never as a second
// calendar.
// ═══════════════════════════════════════════════════════

const Calendar = (() => {

  const $ = id => document.getElementById(id);

  const HOUR_START = 6;     // grid starts 06:00
  const HOUR_END   = 24;    // ...through midnight
  const PX_PER_HOUR = 52;
  const SNAP_MIN   = 15;    // drag/resize snap granularity

  let ctx      = null;
  let view     = 'week';           // day | week | month | agenda
  let anchor   = new Date();       // any date inside the shown range
  let drag     = null;             // active drag/resize gesture
  let detailTaskId  = null;
  let scheduleTaskId = null;
  let nowTimer = null;

  // ── helpers ──
  const pad = n => String(n).padStart(2, '0');
  const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  function fmtMins(m) {
    if (!m) return '0m';
    const h = Math.floor(m / 60), mm = m % 60;
    return h ? (mm ? `${h}h ${mm}m` : `${h}h`) : `${mm}m`;
  }

  function taskEnd(t) {
    if (t.scheduledEnd) return Storage.parseLocal(t.scheduledEnd);
    const s = Storage.parseLocal(t.scheduledStart);
    return new Date(s.getTime() + (t.estimatedMinutes || 60) * 60000);
  }

  function durationMins(t) {
    if (t.scheduledStart && t.scheduledEnd) {
      return Math.max(SNAP_MIN,
        Math.round((Storage.parseLocal(t.scheduledEnd) - Storage.parseLocal(t.scheduledStart)) / 60000));
    }
    return t.estimatedMinutes || 60;
  }

  function scheduledTasks() {
    return (ctx.getState().tasks || []).filter(t => t.scheduledStart);
  }

  function tasksOnDay(date) {
    const ds = Storage.dateStr(date);
    return scheduledTasks()
      .filter(t => String(t.scheduledStart).slice(0, 10) === ds)
      .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
  }

  function unscheduledTasks() {
    return (ctx.getState().tasks || []).filter(t => !t.scheduledStart && !t.completed);
  }

  function overdueTasks() {
    const now = new Date();
    return scheduledTasks()
      .filter(t => !t.completed && taskEnd(t) < now)
      .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
  }

  function rangeDays() {
    if (view === 'day') return [new Date(anchor)];
    const mon = Storage.startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => Storage.addDays(mon, i));
  }

  // Goals whose deadline falls on a given day (§18 — deadline markers)
  function deadlinesOn(date) {
    const ds = Storage.dateStr(date);
    return (ctx.getState().goals || []).filter(g => g.deadline === ds && g.status !== 'archived');
  }

  // ══════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════
  function render() {
    if (!ctx) return;
    renderToolbar();
    const main = $('cal-main');
    if (!main) return;

    if (view === 'month')       main.innerHTML = monthHTML();
    else if (view === 'agenda') main.innerHTML = agendaHTML();
    else                        main.innerHTML = gridHTML();

    if (view === 'week' || view === 'day') {
      bindGrid();
      positionNowLine();
      scrollToRelevant();
    } else {
      bindStatic();
    }

    renderSide();
    startNowTimer();
  }

  function renderToolbar() {
    const label = $('cal-range');
    if (label) {
      if (view === 'day') {
        label.textContent = anchor.toLocaleDateString('en-US',
          { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase();
      } else if (view === 'month') {
        label.textContent = anchor.toLocaleDateString('en-US',
          { month: 'long', year: 'numeric' }).toUpperCase();
      } else {
        const days = rangeDays();
        const a = days[0], b = days[days.length - 1];
        const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
        label.textContent = `${fmt(a)} – ${fmt(b)}`;
      }
    }
    document.querySelectorAll('.cal-view-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.view === view));
  }

  // ── The time grid (WEEK / DAY) ──
  function gridHTML() {
    const days = rangeDays();
    const todayStr = Storage.todayStr();
    const hours = [];
    for (let h = HOUR_START; h < HOUR_END; h++) hours.push(h);

    const headCells = days.map(d => {
      const isToday = Storage.dateStr(d) === todayStr;
      const dls = deadlinesOn(d);
      return `
        <div class="cal-head-cell ${isToday ? 'is-today' : ''}">
          <span class="cal-head-dow">${d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}</span>
          <span class="cal-head-date">${d.getDate()}</span>
          ${isToday ? '<span class="cal-head-today">TODAY</span>' : ''}
          ${dls.length ? `<span class="cal-head-deadline" title="${dls.map(g => g.title).join(', ')}">⚑ ${dls.length} DEADLINE${dls.length > 1 ? 'S' : ''}</span>` : ''}
        </div>`;
    }).join('');

    const gutter = hours.map(h =>
      `<div class="cal-hour-label" style="height:${PX_PER_HOUR}px">${pad(h)}:00</div>`).join('');

    const cols = days.map(d => {
      const ds = Storage.dateStr(d);
      const isToday = ds === todayStr;
      const slots = hours.map(h => `
        <div class="cal-slot" data-date="${ds}" data-hour="${h}" style="height:${PX_PER_HOUR}px"></div>`).join('');
      return `
        <div class="cal-col ${isToday ? 'is-today' : ''}" data-date="${ds}">
          ${slots}
          ${blocksHTML(d)}
          ${isToday ? '<div class="cal-now-line" id="cal-now-line"><span class="cal-now-dot"></span></div>' : ''}
        </div>`;
    }).join('');

    return `
      <div class="cal-grid-wrap">
        <div class="cal-head" style="--cols:${days.length}">
          <div class="cal-head-gutter">${capacityHTML(days)}</div>
          ${headCells}
        </div>
        <div class="cal-scroll" id="cal-scroll">
          <div class="cal-grid" style="--cols:${days.length};--hourpx:${PX_PER_HOUR}px">
            <div class="cal-gutter">${gutter}</div>
            ${cols}
          </div>
        </div>
      </div>`;
  }

  // Capacity summary for the visible range (§20 — subtle, not nagging)
  function capacityHTML(days) {
    let mins = 0;
    days.forEach(d => tasksOnDay(d).forEach(t => { mins += durationMins(t); }));
    if (!mins) return '<span class="cal-cap-empty">—</span>';
    return `<span class="cal-cap" title="Total FORGE work scheduled in view">${fmtMins(mins)}</span>`;
  }

  // Overlapping blocks share the column width (simple lane packing)
  function layoutLanes(tasks) {
    const items = tasks.map(t => {
      const s = Storage.parseLocal(t.scheduledStart);
      return { t, start: s.getHours() * 60 + s.getMinutes(), dur: durationMins(t) };
    }).sort((a, b) => a.start - b.start);

    const lanes = [];
    items.forEach(it => {
      let placed = false;
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i] <= it.start) { lanes[i] = it.start + it.dur; it.lane = i; placed = true; break; }
      }
      if (!placed) { it.lane = lanes.length; lanes.push(it.start + it.dur); }
    });

    const laneCount = Math.max(1, lanes.length);
    items.forEach(it => { it.lanes = laneCount; });
    return items;
  }

  function blocksHTML(date) {
    const items = layoutLanes(tasksOnDay(date));
    const now = new Date();

    return items.map(({ t, start, dur, lane, lanes }) => {
      const top = (start - HOUR_START * 60) / 60 * PX_PER_HOUR;
      const h   = Math.max(22, dur / 60 * PX_PER_HOUR);
      const w   = 100 / lanes;
      const pillar = ctx.getPillarById(t.tag);
      const goal   = t.goalId ? ctx.getGoalById(t.goalId) : null;
      const s      = Storage.parseLocal(t.scheduledStart);
      const e      = new Date(s.getTime() + dur * 60000);
      const overdue = !t.completed && e < now;
      const compact = h < 46;

      return `
        <div class="cal-block ${t.completed ? 'is-done' : ''} ${overdue ? 'is-overdue' : ''} ${compact ? 'is-compact' : ''}"
             data-task="${t.id}" draggable="true"
             style="top:${top}px;height:${h}px;left:${lane * w}%;width:calc(${w}% - 4px);--pillar:${pillar.color}">
          <div class="cal-block-inner">
            ${goal ? `<span class="cal-block-goal">${ctx.escHtml(goal.title)}</span>` : `<span class="cal-block-goal cal-block-nogoal">GENERAL</span>`}
            <span class="cal-block-title">${ctx.escHtml(t.text)}</span>
            <span class="cal-block-time">${hhmm(s)} – ${hhmm(e)}</span>
          </div>
          <div class="cal-block-resize" data-resize="${t.id}"></div>
        </div>`;
    }).join('');
  }

  // ── MONTH ──
  function monthHTML() {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const gridStart = Storage.startOfWeek(first);
    const todayStr = Storage.todayStr();
    const cells = [];

    for (let i = 0; i < 42; i++) {
      const d = Storage.addDays(gridStart, i);
      const ds = Storage.dateStr(d);
      const inMonth = d.getMonth() === anchor.getMonth();
      const tasks = tasksOnDay(d);
      const dls = deadlinesOn(d);
      const shown = tasks.slice(0, 3);

      cells.push(`
        <div class="cal-m-cell ${inMonth ? '' : 'is-out'} ${ds === todayStr ? 'is-today' : ''}" data-date="${ds}">
          <div class="cal-m-date">
            <span>${d.getDate()}</span>
            ${dls.length ? `<span class="cal-m-flag" title="${dls.map(g => g.title).join(', ')}">⚑</span>` : ''}
          </div>
          ${shown.map(t => {
            const p = ctx.getPillarById(t.tag);
            return `<div class="cal-m-task ${t.completed ? 'is-done' : ''}" data-task="${t.id}" style="--pillar:${p.color}">
                      <span class="cal-m-dot"></span>${ctx.escHtml(t.text)}
                    </div>`;
          }).join('')}
          ${tasks.length > 3 ? `<div class="cal-m-more" data-jump="${ds}">+${tasks.length - 3} more</div>` : ''}
        </div>`);
    }

    const dows = ['MON','TUE','WED','THU','FRI','SAT','SUN']
      .map(d => `<div class="cal-m-dow">${d}</div>`).join('');

    return `<div class="cal-month"><div class="cal-m-head">${dows}</div><div class="cal-m-grid">${cells.join('')}</div></div>`;
  }

  // ── AGENDA ──
  function agendaHTML() {
    const start = new Date(anchor); start.setHours(0, 0, 0, 0);
    const rows = [];

    for (let i = 0; i < 14; i++) {
      const d = Storage.addDays(start, i);
      const tasks = tasksOnDay(d);
      const dls = deadlinesOn(d);
      if (!tasks.length && !dls.length) continue;

      const total = tasks.reduce((a, t) => a + durationMins(t), 0);
      rows.push(`
        <div class="cal-a-day">
          <div class="cal-a-date">
            <span class="cal-a-dow">${d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}</span>
            <span class="cal-a-num">${d.getDate()}</span>
            <span class="cal-a-mon">${d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</span>
          </div>
          <div class="cal-a-items">
            ${dls.map(g => `<div class="cal-a-deadline">⚑ DEADLINE · ${ctx.escHtml(g.title)}</div>`).join('')}
            ${tasks.map(t => {
              const p = ctx.getPillarById(t.tag);
              const goal = t.goalId ? ctx.getGoalById(t.goalId) : null;
              const s = Storage.parseLocal(t.scheduledStart);
              const e = new Date(s.getTime() + durationMins(t) * 60000);
              return `
                <div class="cal-a-item ${t.completed ? 'is-done' : ''}" data-task="${t.id}" style="--pillar:${p.color}">
                  <span class="cal-a-time">${hhmm(s)}–${hhmm(e)}</span>
                  <span class="cal-a-title">${ctx.escHtml(t.text)}</span>
                  ${goal ? `<span class="cal-a-goal">${ctx.escHtml(goal.title)}</span>` : ''}
                  <span class="cal-a-dur">${fmtMins(durationMins(t))}</span>
                </div>`;
            }).join('')}
            ${total ? `<div class="cal-a-total">${fmtMins(total)} scheduled</div>` : ''}
          </div>
        </div>`);
    }

    if (!rows.length) {
      return `<div class="cal-empty"><span class="cal-empty-title">NOTHING SCHEDULED</span>
              <span class="cal-empty-sub">Next 14 days are clear. Drag work from UNSCHEDULED to commit.</span></div>`;
    }
    return `<div class="cal-agenda">${rows.join('')}</div>`;
  }

  // ── Side rail: unscheduled inventory + overdue ──
  function renderSide() {
    const box = $('cal-unscheduled');
    if (!box) return;
    const list = unscheduledTasks();

    const sub = $('cal-side-sub');
    if (sub) {
      const mins = list.reduce((a, t) => a + (t.estimatedMinutes || 0), 0);
      sub.textContent = list.length ? `${list.length} · ~${fmtMins(mins)}` : '';
    }

    box.innerHTML = list.length ? list.map(t => {
      const p = ctx.getPillarById(t.tag);
      const goal = t.goalId ? ctx.getGoalById(t.goalId) : null;
      return `
        <div class="cal-us" draggable="true" data-task="${t.id}" style="--pillar:${p.color}">
          <div class="cal-us-main">
            <span class="cal-us-title">${ctx.escHtml(t.text)}</span>
            <span class="cal-us-goal">${goal ? ctx.escHtml(goal.title) : 'GENERAL'}</span>
          </div>
          <span class="cal-us-est">${fmtMins(t.estimatedMinutes || 60)}</span>
          <button class="cal-us-plan" data-plan="${t.id}">PLAN</button>
        </div>`;
    }).join('') : `<div class="cal-us-empty">Everything is committed.</div>`;

    // Overdue (§19 — never silently lost, never auto-moved)
    const od = overdueTasks();
    const odBox = $('cal-overdue-block');
    if (odBox) {
      odBox.innerHTML = od.length ? `
        <div class="cal-od-head">⚠ OVERDUE · ${od.length}</div>
        ${od.map(t => {
          const s = Storage.parseLocal(t.scheduledStart);
          const goal = t.goalId ? ctx.getGoalById(t.goalId) : null;
          return `
            <div class="cal-od" data-task="${t.id}">
              <span class="cal-od-title">${ctx.escHtml(t.text)}</span>
              <span class="cal-od-when">was ${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()}${goal ? ' · ' + ctx.escHtml(goal.title) : ''}</span>
              <button class="cal-od-btn" data-plan="${t.id}">RESCHEDULE</button>
            </div>`;
        }).join('')}` : '';
    }

    bindSide();
  }

  // ══════════════════════════════════════════
  // INTERACTION
  // ══════════════════════════════════════════
  function snap(mins) { return Math.round(mins / SNAP_MIN) * SNAP_MIN; }

  function minutesFromOffset(colEl, clientY) {
    const rect = colEl.getBoundingClientRect();
    const y = clientY - rect.top;
    return snap(HOUR_START * 60 + (y / PX_PER_HOUR) * 60);
  }

  function scheduleTask(taskId, dateStr, startMins, durMins) {
    const s = ctx.getState();
    const t = (s.tasks || []).find(x => x.id === taskId);
    if (!t) return;

    startMins = Math.max(HOUR_START * 60, Math.min(HOUR_END * 60 - SNAP_MIN, startMins));
    const dur = Math.max(SNAP_MIN, durMins || t.estimatedMinutes || 60);

    const start = Storage.parseLocal(dateStr + 'T00:00:00');
    start.setMinutes(startMins);
    const end = new Date(start.getTime() + dur * 60000);

    t.scheduledStart   = Storage.localISO(start);
    t.scheduledEnd     = Storage.localISO(end);
    t.estimatedMinutes = dur;

    ctx.save();
    render();
    ctx.onTasksChanged();
  }

  function unschedule(taskId) {
    const t = (ctx.getState().tasks || []).find(x => x.id === taskId);
    if (!t) return;
    t.scheduledStart = null;
    t.scheduledEnd   = null;
    ctx.save();
    render();
    ctx.onTasksChanged();
  }

  function bindGrid() {
    const main = $('cal-main');
    if (!main) return;

    // Click empty slot → create task there
    main.querySelectorAll('.cal-slot').forEach(slot => {
      slot.addEventListener('click', e => {
        if (drag) return;
        const mins = minutesFromOffset(slot.parentElement, e.clientY);
        openQuickCreate(slot.dataset.date, mins);
      });
    });

    // Click block → task detail
    main.querySelectorAll('.cal-block').forEach(b => {
      b.addEventListener('click', e => {
        if (e.target.dataset.resize) return;
        if (drag && drag.moved) return;
        openTaskDetail(b.dataset.task);
      });

      // Drag to move
      b.addEventListener('dragstart', e => {
        drag = { id: b.dataset.task, kind: 'move', moved: false };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', b.dataset.task);
        b.classList.add('is-dragging');
      });
      b.addEventListener('dragend', () => {
        b.classList.remove('is-dragging');
        setTimeout(() => { drag = null; }, 0);
      });

      // Resize handle → change duration
      const handle = b.querySelector('.cal-block-resize');
      if (handle) handle.addEventListener('mousedown', e => {
        e.preventDefault(); e.stopPropagation();
        const id = handle.dataset.resize;
        const t = (ctx.getState().tasks || []).find(x => x.id === id);
        if (!t) return;
        const startY = e.clientY;
        const startDur = durationMins(t);
        drag = { id, kind: 'resize', moved: false };

        const onMove = ev => {
          const deltaMin = snap((ev.clientY - startY) / PX_PER_HOUR * 60);
          const dur = Math.max(SNAP_MIN, startDur + deltaMin);
          b.style.height = Math.max(22, dur / 60 * PX_PER_HOUR) + 'px';
          drag.dur = dur;
          drag.moved = true;
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          if (drag && drag.dur) {
            const st = Storage.parseLocal(t.scheduledStart);
            scheduleTask(id, Storage.dateStr(st), st.getHours() * 60 + st.getMinutes(), drag.dur);
          }
          setTimeout(() => { drag = null; }, 0);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });

    // Columns are drop targets (from the grid or from the side rail)
    main.querySelectorAll('.cal-col').forEach(col => {
      col.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        col.classList.add('is-drop');
      });
      col.addEventListener('dragleave', () => col.classList.remove('is-drop'));
      col.addEventListener('drop', e => {
        e.preventDefault();
        col.classList.remove('is-drop');
        const id = e.dataTransfer.getData('text/plain');
        if (!id) return;
        const t = (ctx.getState().tasks || []).find(x => x.id === id);
        scheduleTask(id, col.dataset.date, minutesFromOffset(col, e.clientY), t ? durationMins(t) : 60);
      });
    });
  }

  function bindStatic() {
    const main = $('cal-main');
    if (!main) return;
    main.querySelectorAll('[data-task]').forEach(el => {
      el.addEventListener('click', () => openTaskDetail(el.dataset.task));
    });
    main.querySelectorAll('[data-jump]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        anchor = Storage.parseLocal(el.dataset.jump + 'T00:00:00');
        view = 'day';
        render();
      });
    });
    // Month cells accept drops too
    main.querySelectorAll('.cal-m-cell').forEach(cell => {
      cell.addEventListener('dragover', e => { e.preventDefault(); cell.classList.add('is-drop'); });
      cell.addEventListener('dragleave', () => cell.classList.remove('is-drop'));
      cell.addEventListener('drop', e => {
        e.preventDefault();
        cell.classList.remove('is-drop');
        const id = e.dataTransfer.getData('text/plain');
        if (id) scheduleTask(id, cell.dataset.date, 9 * 60, null);
      });
    });
  }

  function bindSide() {
    const box = $('cal-side');
    if (!box) return;

    box.querySelectorAll('.cal-us').forEach(el => {
      el.addEventListener('dragstart', e => {
        drag = { id: el.dataset.task, kind: 'new', moved: false };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', el.dataset.task);
        el.classList.add('is-dragging');
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('is-dragging');
        setTimeout(() => { drag = null; }, 0);
      });
      el.addEventListener('click', e => {
        if (e.target.dataset.plan) return;
        openTaskDetail(el.dataset.task);
      });
    });

    box.querySelectorAll('[data-plan]').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        openScheduleModal(b.dataset.plan);
      });
    });
  }

  // ── now-line + scroll ──
  function positionNowLine() {
    const line = $('cal-now-line');
    if (!line) return;
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    if (mins < HOUR_START * 60 || mins > HOUR_END * 60) { line.style.display = 'none'; return; }
    line.style.display = '';
    line.style.top = ((mins - HOUR_START * 60) / 60 * PX_PER_HOUR) + 'px';
  }

  function startNowTimer() {
    if (nowTimer) clearInterval(nowTimer);
    nowTimer = setInterval(positionNowLine, 60000);
  }

  function scrollToRelevant() {
    const scroll = $('cal-scroll');
    if (!scroll) return;
    const now = new Date();
    const target = Math.max(0, (now.getHours() - HOUR_START - 1) * PX_PER_HOUR);
    scroll.scrollTop = target;
  }

  // ══════════════════════════════════════════
  // TASK DETAIL INSPECTOR
  // ══════════════════════════════════════════
  function openTaskDetail(taskId) {
    const s = ctx.getState();
    const t = (s.tasks || []).find(x => x.id === taskId);
    if (!t) return;
    detailTaskId = taskId;

    const goals = (s.goals || []).filter(g => g.status !== 'archived');
    const milestones = (s.milestones || []).filter(m => m.goalId === t.goalId);
    const start = t.scheduledStart ? Storage.parseLocal(t.scheduledStart) : null;

    $('task-detail-body').innerHTML = `
      <input type="text" id="td-text" class="text-input td-title-input" value="${ctx.escHtml(t.text)}" maxlength="80" />

      <label class="fld-label">GOAL</label>
      <select id="td-goal" class="text-input">
        <option value="">— General / no goal —</option>
        ${goals.map(g => `<option value="${g.id}" ${g.id === t.goalId ? 'selected' : ''}>${ctx.escHtml(g.title)}</option>`).join('')}
      </select>

      <label class="fld-label">MILESTONE <span class="fld-optional">optional</span></label>
      <select id="td-milestone" class="text-input" ${milestones.length ? '' : 'disabled'}>
        <option value="">— none —</option>
        ${milestones.map(m => `<option value="${m.id}" ${m.id === t.milestoneId ? 'selected' : ''}>${ctx.escHtml(m.title)}</option>`).join('')}
      </select>

      <div class="fld-row">
        <div class="fld-col">
          <label class="fld-label">EST. TIME</label>
          <input type="number" id="td-mins" class="text-input" value="${t.estimatedMinutes || 60}" min="5" max="600" step="5" />
        </div>
        <div class="fld-col">
          <label class="fld-label">DIFFICULTY</label>
          <select id="td-diff" class="text-input">
            <option value="1"   ${(t.xpMultiplier || 1) == 1   ? 'selected' : ''}>EASY · 1×</option>
            <option value="1.5" ${(t.xpMultiplier || 1) == 1.5 ? 'selected' : ''}>MEDIUM · 1.5×</option>
            <option value="2"   ${(t.xpMultiplier || 1) == 2   ? 'selected' : ''}>HARD · 2×</option>
          </select>
        </div>
        <div class="fld-col">
          <label class="fld-label">PRIORITY</label>
          <select id="td-priority" class="text-input">
            <option value="low"    ${t.priority === 'low'    ? 'selected' : ''}>LOW</option>
            <option value="medium" ${(t.priority || 'medium') === 'medium' ? 'selected' : ''}>MEDIUM</option>
            <option value="high"   ${t.priority === 'high'   ? 'selected' : ''}>HIGH</option>
          </select>
        </div>
      </div>

      <label class="fld-label">NOTES</label>
      <textarea id="td-notes" class="text-input td-notes" rows="3" maxlength="300" placeholder="context, page numbers, links...">${ctx.escHtml(t.notes || '')}</textarea>

      <label class="fld-label">SCHEDULED</label>
      <div class="fld-row">
        <div class="fld-col">
          <input type="date" id="td-date" class="text-input date-input" value="${start ? Storage.dateStr(start) : ''}" />
        </div>
        <div class="fld-col">
          <input type="time" id="td-time" class="text-input" value="${start ? hhmm(start) : '09:00'}" step="900" />
        </div>
      </div>
      <label class="td-unsched">
        <input type="checkbox" id="td-no-date" ${start ? '' : 'checked'} />
        <span>No specific time — keep in UNSCHEDULED</span>
      </label>

      <div class="td-foot">
        <button class="btn-ghost btn-danger" id="td-delete">DELETE TASK</button>
        <button class="btn-primary" id="td-save">SAVE CHANGES</button>
      </div>`;

    $('task-detail').classList.remove('hidden');

    $('td-goal').addEventListener('change', () => {
      const gid = $('td-goal').value;
      const ms = (ctx.getState().milestones || []).filter(m => m.goalId === gid);
      const sel = $('td-milestone');
      sel.disabled = !ms.length;
      sel.innerHTML = `<option value="">— none —</option>` +
        ms.map(m => `<option value="${m.id}">${ctx.escHtml(m.title)}</option>`).join('');
    });

        $('td-delete').addEventListener('click', () => {
      // Capture the id and close the inspector BEFORE confirming: stacking a
      // dialog on top of the panel reads as "nothing happened", and the panel
      // must not linger behind the confirm.
      const id = detailTaskId;
      const label = t.text;
      closeTaskDetail();
      ctx.forgeConfirm(`Delete "${label}"?`, () => {
        const st = ctx.getState();
        st.tasks = st.tasks.filter(x => x.id !== id);
        ctx.save();
        render();
        ctx.onTasksChanged();
        ctx.showToast('TASK DELETED', 'success');
      });
    });
  }

  function saveTaskDetail() {
    const s = ctx.getState();
    const t = (s.tasks || []).find(x => x.id === detailTaskId);
    if (!t) return;

    const text = $('td-text').value.trim();
    if (!text) { ctx.showToast('TASK NEEDS A NAME', 'error'); return; }

    t.text             = text;
    t.goalId           = $('td-goal').value || null;
    t.milestoneId      = $('td-milestone').value || null;
    t.estimatedMinutes = Math.max(5, parseInt($('td-mins').value, 10) || 60);
    t.xpMultiplier     = parseFloat($('td-diff').value) || 1;
    t.priority         = $('td-priority').value;
    t.notes            = $('td-notes').value.trim();

    // Keep the pillar in sync with the goal so calendar colour stays honest
    if (t.goalId) {
      const g = (s.goals || []).find(x => x.id === t.goalId);
      if (g) t.tag = g.pillarId;
    }

    if ($('td-no-date').checked || !$('td-date').value) {
      t.scheduledStart = null;
      t.scheduledEnd   = null;
    } else {
      const [hh, mi] = ($('td-time').value || '09:00').split(':').map(Number);
      const start = Storage.parseLocal($('td-date').value + 'T00:00:00');
      start.setHours(hh, mi, 0, 0);
      const end = new Date(start.getTime() + t.estimatedMinutes * 60000);
      t.scheduledStart = Storage.localISO(start);
      t.scheduledEnd   = Storage.localISO(end);
    }

    ctx.save();
    ctx.sound.click();
    closeTaskDetail();
    render();
    ctx.onTasksChanged();
  }

  function closeTaskDetail() {
    $('task-detail').classList.add('hidden');
    detailTaskId = null;
  }

  // ══════════════════════════════════════════
  // SCHEDULE MODAL (the PLAN button path)
  // ══════════════════════════════════════════
  function openScheduleModal(taskId) {
    const s = ctx.getState();
    const t = (s.tasks || []).find(x => x.id === taskId);
    if (!t) return;
    scheduleTaskId = taskId;

    const goal = t.goalId ? ctx.getGoalById(t.goalId) : null;
    const start = t.scheduledStart ? Storage.parseLocal(t.scheduledStart) : null;
    const defDate = start ? Storage.dateStr(start) : Storage.todayStr();
    const defTime = start ? hhmm(start) : '09:00';

    $('schedule-modal-body').innerHTML = `
      <div class="sch-task">${ctx.escHtml(t.text)}</div>
      <div class="sch-goal">${goal ? ctx.escHtml(goal.title) : 'GENERAL · no goal'}</div>

      <div class="fld-row">
        <div class="fld-col">
          <label class="fld-label">DATE</label>
          <input type="date" id="sch-date" class="text-input date-input" value="${defDate}" />
        </div>
        <div class="fld-col">
          <label class="fld-label">START</label>
          <input type="time" id="sch-time" class="text-input" value="${defTime}" step="900" />
        </div>
        <div class="fld-col">
          <label class="fld-label">MINUTES</label>
          <input type="number" id="sch-mins" class="text-input" value="${t.estimatedMinutes || 60}" min="5" max="600" step="5" />
        </div>
      </div>
      <div class="sch-preview" id="sch-preview"></div>`;

    const upd = () => {
      const [hh, mi] = ($('sch-time').value || '09:00').split(':').map(Number);
      const mins = parseInt($('sch-mins').value, 10) || 60;
      const st = new Date(2000, 0, 1, hh, mi);
      const en = new Date(st.getTime() + mins * 60000);
      $('sch-preview').textContent = `${hhmm(st)} – ${hhmm(en)} · ${fmtMins(mins)}`;
    };
    ['sch-time', 'sch-mins'].forEach(id => $(id).addEventListener('input', upd));
    upd();

    $('schedule-modal').classList.remove('hidden');
  }

  function closeScheduleModal() {
    $('schedule-modal').classList.add('hidden');
    scheduleTaskId = null;
  }

  function confirmSchedule() {
    if (!scheduleTaskId) return;
    const date = $('sch-date').value;
    if (!date) { ctx.showToast('PICK A DATE', 'error'); return; }
    const [hh, mi] = ($('sch-time').value || '09:00').split(':').map(Number);
    const mins = Math.max(5, parseInt($('sch-mins').value, 10) || 60);
    const id = scheduleTaskId;
    closeScheduleModal();
    scheduleTask(id, date, hh * 60 + mi, mins);
    ctx.sound.click();
  }

  // ── Create a task straight from an empty slot ──
  // Goal association is encouraged: the detail inspector opens immediately.
  function openQuickCreate(dateStr, startMins) {
    const s = ctx.getState();
    const text = 'New task';
    const pillar = (s.pillars && s.pillars[0]) ? s.pillars[0].id : 'other';

    const start = Storage.parseLocal(dateStr + 'T00:00:00');
    start.setMinutes(startMins);
    const end = new Date(start.getTime() + 60 * 60000);

    const t = Object.assign(Storage.taskDefaults(), {
      id:               Storage.uuid(),
      text,
      tag:              pillar,
      estimatedMinutes: 60,
      scheduledStart:   Storage.localISO(start),
      scheduledEnd:     Storage.localISO(end),
      completed:        false,
      xpMultiplier:     1.0,
      createdAt:        new Date().toISOString(),
      completedAt:      null
    });
    s.tasks.push(t);
    ctx.save();
    render();
    ctx.onTasksChanged();
    openTaskDetail(t.id);
    setTimeout(() => { const el = $('td-text'); if (el) el.select(); }, 80);
  }

  // ══════════════════════════════════════════
  // NAV + BIND
  // ══════════════════════════════════════════
  function shift(dir) {
    if (view === 'day')        anchor = Storage.addDays(anchor, dir);
    else if (view === 'month') anchor = new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
    else if (view === 'agenda')anchor = Storage.addDays(anchor, dir * 14);
    else                       anchor = Storage.addDays(anchor, dir * 7);
    render();
  }

  function bind(context) {
    ctx = context;

    $('cal-prev') .addEventListener('click', () => { ctx.sound.click(); shift(-1); });
    $('cal-next') .addEventListener('click', () => { ctx.sound.click(); shift(1); });
    $('cal-today').addEventListener('click', () => { ctx.sound.click(); anchor = new Date(); render(); });

    document.querySelectorAll('.cal-view-btn').forEach(b => {
      b.addEventListener('click', () => {
        view = b.dataset.view;
        ctx.sound.click();
        render();
      });
    });

        // Side-rail quick add — creates an UNSCHEDULED task you can then drag
    // onto the grid. Enter to add, stays focused for rapid entry.
    const q = $('cal-quick-input');
    if (q) q.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const text = q.value.trim();
      if (!text) return;
      const st = ctx.getState();
      st.tasks.push(Object.assign(Storage.taskDefaults(), {
        id:           Storage.uuid(),
        text,
        tag:          (st.pillars && st.pillars[0]) ? st.pillars[0].id : 'other',
        completed:    false,
        xpMultiplier: 1.0,
        createdAt:    new Date().toISOString(),
        completedAt:  null
      }));
      ctx.save();
      q.value = '';
      ctx.sound.taskAdded ? ctx.sound.taskAdded() : ctx.sound.click();
      render();
      ctx.onTasksChanged();
      const again = $('cal-quick-input');
      if (again) again.focus();
    });

    $('task-detail-close')   .addEventListener('click', closeTaskDetail);
    $('task-detail-backdrop').addEventListener('click', closeTaskDetail);

    $('schedule-modal-close')   .addEventListener('click', closeScheduleModal);
    $('schedule-modal-backdrop').addEventListener('click', closeScheduleModal);
    $('btn-schedule-cancel')    .addEventListener('click', closeScheduleModal);
    $('btn-schedule-save')      .addEventListener('click', confirmSchedule);
    $('btn-schedule-clear')     .addEventListener('click', () => {
      if (scheduleTaskId) { const id = scheduleTaskId; closeScheduleModal(); unschedule(id); }
    });

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (!$('task-detail').classList.contains('hidden'))    closeTaskDetail();
      if (!$('schedule-modal').classList.contains('hidden')) closeScheduleModal();
    });
  }

  return {
    render, bind,
    openTaskDetail, openScheduleModal,
    scheduleTask, unschedule,
    setView: v => { view = v; render(); },
    goToday: () => { anchor = new Date(); render(); }
  };

})();

if (typeof window !== 'undefined') window.Calendar = Calendar;
