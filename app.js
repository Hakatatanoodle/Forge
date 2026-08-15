// ═══════════════════════════════════════════════════════
// app.js — Main application controller
// Owns: state, view routing, UI updates, event handling.
// Depends on: storage.js, xp.js, timer.js
// ═══════════════════════════════════════════════════════

(() => {
  'use strict';

  // ══════════════════════════════════════════
  // STATE
  // ══════════════════════════════════════════
  let state = Storage.load();

  // Session context (not persisted — lives in memory during a session)
  let sessionContext = {
    taskId: null,
    intention: '',
    difficultyMultiplier: 1.0,
    startTime: null,
    sessionMinutes: null, // set by intention screen timer picker
  };

  // ══════════════════════════════════════════
  // DOM REFERENCES
  // ══════════════════════════════════════════
  const $ = id => document.getElementById(id);

  const views = {
    onboarding: $('view-onboarding'),
    dashboard:  $('view-dashboard'),
    intention:  $('view-intention'),
    session:    $('view-session'),
    break:      $('view-break'),
    reward:     $('view-reward'),
    tasks:      $('view-tasks'),
    settings:   $('view-settings'),
    history:    $('view-history'),
    summary:    $('view-summary'),
    shop:       $('view-shop'),
    plan:       $('view-plan'),
  };

  // ══════════════════════════════════════════
  // VIEW ROUTING
  // ══════════════════════════════════════════
  function showView(name) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    if (views[name]) views[name].classList.add('active');
    // Hide the rail on chrome-free, focused moments
    document.body.classList.toggle('no-rail', ['onboarding','session','break','reward','summary'].indexOf(name) !== -1);
  }

  // ══════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════
  function init() {
    bindEvents();
    // Fallback offline timer — if Firebase doesn't respond in 3s, show login with offline option
    const fbTimeout = setTimeout(() => {
      if (!views.onboarding.classList.contains('active') || $('btn-google-signin').style.display !== 'none') return;
      // Still in loading state, show buttons
      showAuthLoading(false);
    }, 3000);

    // Wrap onAuthStateChanged to clear timeout
    const origHandler = onAuthStateChanged;
    window._clearFbTimeout = () => clearTimeout(fbTimeout);

    FB.init((user) => {
      clearTimeout(fbTimeout);
      origHandler(user);
    });

    // Also render pillar chips for quick-add if state already available locally (offline first paint)
    try {
      if (state.pillars && state.pillars.length) {
        setTimeout(() => { if (typeof renderPillarChips === 'function') renderPillarChips(); }, 100);
      }
    } catch(e) {}
  }

  // ── Called by Firebase when auth state is known ──
  async function onAuthStateChanged(user) {
    if (!user) {
      // No session — show sign in screen
      showView('onboarding');
      showAuthLoading(false); // make sure button is visible
      return;
    }

    showAuthLoading(true);

    const result = await FB.loadState();

    if (result.ok && result.state) {
      // Returning user — load their cloud data
      const base = Storage.defaultState();
      state = Storage.deepMerge(base, result.state);
      // Clean up legacy sprints data (removed in v11)
      if (state.sprints) delete state.sprints;
      checkDayReset();
    } else {
      // First time signing in — set name from Google profile
      if (!state.user.name) {
        state.user.name = user.displayName
          ? user.displayName.split(' ')[0].toUpperCase()
          : 'OPERATIVE';
        state.user.rank = XP.getRank(1);
      }
      checkDayReset();
    }

    Sound.setEnabled(state.settings.soundEnabled !== false);
    // Migrate old hardcoded tags → pillar ids
    const TAG_MIGRATE = { finals: 'academics', game: 'gamedev', urgent: 'academics' };
    state.tasks.forEach(t => { if (TAG_MIGRATE[t.tag]) t.tag = TAG_MIGRATE[t.tag]; });
    // Single save after all init mutations — awaited to prevent race conditions
    await saveState();
    applyTheme(state.user.activeTheme || 'forge');
    applyRailCollapsed();
    showAuthLoading(false);

    // Check if today is summary day and this week hasn't been shown
    if (_shouldShowSummary()) {
      _markSummaryShown();
      renderWeeklySummary();
      showView('summary');
      setTimeout(() => Sound.weeklySummary(), 300);
    } else {
      showView('dashboard');
      renderDashboard();
    }
  }

  let _isOfflineMode = false;
  function showAuthLoading(show) {
    const loading = $('auth-loading');
    const btn     = $('btn-google-signin');
    const offBtn  = $('btn-offline-enter');
    const skipBtn = $('btn-skip-auth');
    const offBlock = $('offline-block');
    const nameRow = $('input-offline-name')?.parentElement?.parentElement || offBlock;
    if (!loading || !btn) return;
    if (show && !_isOfflineMode) {
      loading.classList.remove('hidden');
      btn.style.display = 'none';
      if (offBlock) offBlock.style.display = 'none';
      if (offBtn) offBtn.style.display = 'none';
      if (skipBtn) skipBtn.style.display = 'none';
    } else {
      loading.classList.add('hidden');
      btn.style.display = '';
      btn.disabled = false;
      if (offBlock) offBlock.style.display = '';
      if (offBtn) offBtn.style.display = '';
      if (skipBtn) skipBtn.style.display = '';
    }
  }

  function enterOfflineMode(nameOverride) {
    _isOfflineMode = true;
    const base = Storage.defaultState();
    // load local state, ensure offline
    state = Storage.load();
    // if no name, allow override
    if (nameOverride) state.user.name = nameOverride.toUpperCase();
    if (!state.user.name) state.user.name = 'OPERATIVE';
    if (!state.user.rank) state.user.rank = XP.getRank(state.user.level || 1);
    checkDayReset();
    // migration
    const TAG_MIGRATE = { finals: 'academics', game: 'gamedev', urgent: 'academics' };
    state.tasks.forEach(t => { if (TAG_MIGRATE[t.tag]) t.tag = TAG_MIGRATE[t.tag]; });
    if (state.sprints) delete state.sprints;
    Storage.save(state);
    Sound.setEnabled(state.settings.soundEnabled !== false);
    applyTheme(state.user.activeTheme || 'forge');
    applyRailCollapsed();
    showAuthLoading(false);
    if (_shouldShowSummary()) {
      _markSummaryShown();
      renderWeeklySummary();
      showView('summary');
    } else {
      showView('dashboard');
      renderDashboard();
    }
  }

  // ── Save locally AND to cloud ──
  async function saveState() {
    Storage.save(state);
    await FB.saveState(state);
  }

  // ── COLLAPSIBLE RAIL (desktop sidebar) ──
  // Mirror state.settings.railCollapsed onto the DOM.
  function applyRailCollapsed() {
    const rail = $('rail');
    const btn  = $('btn-toggle-rail');
    if (!rail || !btn) return;
    const collapsed = !!(state.settings && state.settings.railCollapsed);
    rail.classList.toggle('rail-collapsed', collapsed);
    btn.textContent = collapsed ? '▶' : '◀';
    btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    btn.setAttribute('aria-label', btn.title);
  }
  function toggleRail() {
    state.settings.railCollapsed = !(state.settings && state.settings.railCollapsed);
    applyRailCollapsed();
    Sound.click();
    saveState();
  }
  function checkDayReset() {
    const today = Storage.todayStr();

    // ── ONE-TIME MIGRATION ──
    const streak = state.user.streak;
    if (streak.lastActiveDate) {
      const utcToday = new Date().toISOString().split('T')[0];
      if (streak.lastActiveDate === utcToday && utcToday !== today) {
        state.user.streak.lastActiveDate = today;
      }
    }

    if (state.today.date !== today) {
      state.today = { date: today, sessionsCompleted: 0 };
      // Don't save here — caller handles saving after all init is done
      // This prevents a race condition where checkDayReset's save
      // fires concurrently with the main onAuthStateChanged saveState
    }
  }

  // ══════════════════════════════════════════
  // RENDER DASHBOARD
  // ══════════════════════════════════════════
  function renderDashboard() {
    const { user, tasks, today } = state;

    // User info — "LVL 7 · SPECIALIST" identity line (theme-flavored rank)
    const activeTheme = state.user.activeTheme || 'forge';
    const themeRanks = THEME_RANKS[activeTheme];
    const rankTitle = (themeRanks && themeRanks[user.rank]) ? themeRanks[user.rank] : user.rank;
    $('display-rank').textContent = `LVL ${user.level} · ${rankTitle}`;
    $('display-name').textContent  = user.name.toUpperCase();
    $('display-level').textContent = user.level;

    // Avatar — initials monogram
    const avatarEl = $('avatar-initials');
    if (avatarEl) {
      const initials = String(user.name || 'OPERATIVE')
        .trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || 'OP';
      avatarEl.textContent = initials;
    }

    // Greeting + date + quote
    const greetEl = $('dash-greeting');
    if (greetEl) greetEl.textContent = `${_greeting()}, ${user.name.toUpperCase()}.`;
    const dateEl = $('dash-date');
    if (dateEl) dateEl.textContent = _dateLine();
    const quoteEl = $('quote-text');
    if (quoteEl) quoteEl.textContent = _quoteOfDay();

    // XP bar
    const xpNeeded = XP.xpForLevel(user.level);
    $('display-xp').textContent      = user.xp;
    $('display-xp-next').textContent = xpNeeded;
    $('xp-bar-fill').style.width     = XP.xpProgress(user) + '%';

    // Streak chip
    $('display-streak').textContent = user.streak.current;
    const chip = $('streak-chip');

    // Freeze indicator
    const freezes = user.streak.freezesAvailable || 0;
    const freezeDiv = $('freeze-divider');
    const freezeEl  = $('freeze-indicator');
    if (freezes > 0) {
      $('display-freezes').textContent = freezes;
      freezeDiv.style.display = '';
      freezeEl.style.display  = '';
    } else {
      freezeDiv.style.display = 'none';
      freezeEl.style.display  = 'none';
    }

    // Frozen state — freeze was used on last session
    const wasFrozen = user.streak.lastFreezeUsed === Storage.todayStr();
    if (wasFrozen) {
      chip.classList.add('frozen');
      chip.classList.remove('at-risk');
    } else if (XP.isStreakAtRisk(user.streak)) {
      chip.classList.add('at-risk');
      chip.classList.remove('frozen');
    } else {
      chip.classList.remove('at-risk', 'frozen');
    }

    // Coins
    $('display-coins').textContent = user.coins || 0;

    // Rank progress — "⚡ X XP to NEXT RANK"
    const rankLine = $('rank-progress-line');
    if (rankLine) {
      const next = getNextRankInfo(user);
      rankLine.textContent = next
        ? `⚡ ${next.xpNeeded} XP to ${next.rankTitle}`
        : '★ MAX RANK ACHIEVED ★';
    }

    // Current task (first incomplete, prioritizing urgent > finals > game > other)
    const nextTask = getNextTask(tasks);
    renderCurrentTask(nextTask);

    // Today's Quests
    renderQuestList();

    // Focus stats panel (right sidebar)
    _renderFocusStats();
  }

  // ── Rank → next rank math (drives the hero "XP to next rank" line) ──
  function getNextRankInfo(user) {
    const ranks = XP.RANKS || [];
    const next = ranks.find(r => r.minLevel > user.level);
    if (!next) return null; // already max rank
    let xpNeeded = 0;
    let lvl = user.level;
    while (lvl < next.minLevel) {
      xpNeeded += XP.xpForLevel(lvl);
      lvl++;
    }
    xpNeeded -= (user.xp || 0);
    return { rankTitle: next.title, xpNeeded: Math.max(xpNeeded, 0) };
  }

  // ── Greeting / date / quote (dashboard center column) ──
  function _greeting() {
    const h = new Date().getHours();
    if (h < 12) return 'GOOD MORNING';
    if (h < 18) return 'GOOD AFTERNOON';
    return 'GOOD EVENING';
  }

  function _dateLine() {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric'
    }).toUpperCase();
  }

  const QUOTES = [
    'Discipline today, freedom tomorrow.',
    'Lock in. Focus. Get stronger.',
    'The grind is the reward.',
    'Small steps, forged daily.',
    'Future you is watching. Do not disappoint.',
    'One session at a time. One level at a time.'
  ];

  function _quoteOfDay() {
    const d = new Date();
    const start = new Date(d.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((d - start) / 86400000);
    return QUOTES[dayOfYear % QUOTES.length];
  }

  // ── Objective progress bar on the hero ──
  // If the task belongs to a goal → goal completion. Otherwise → today's quests.
  function _objectiveProgress(task) {
    if (!task) return null;
    if (task.goalId) {
      const gTasks = (state.tasks || []).filter(t => t.goalId === task.goalId);
      const done = gTasks.filter(t => t.completed).length;
      const total = gTasks.length;
      if (!total) return { pct: 0, label: '0/0' };
      return { pct: Math.min(100, Math.round(done / total * 100)), label: `${done}/${total}` };
    }
    const all = state.tasks || [];
    const done = all.filter(t => t.completed).length;
    const total = all.length;
    if (!total) return null;
    return { pct: Math.min(100, Math.round(done / total * 100)), label: `${done}/${total}` };
  }

  // ── Estimated XP for one session at current settings/streak/level ──
  function _estimateXP(task) {
    if (!task) return 0;
    const mult  = task.xpMultiplier || 1;
    const mins  = state.settings.workMinutes || 50;
    const streak = (state.user.streak && state.user.streak.current) || 0;
    return XP.calculateSessionXP(mult, streak, mins, state.user.level || 1).total;
  }

  // ── Focus stats (right sidebar) — today + weekly XP chart ──
  function _inCurrentWeek(date) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const mon = new Date(now);
    const dow = now.getDay(); // 0=Sun
    mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
    mon.setHours(0, 0, 0, 0);
    const day = new Date(date); day.setHours(0, 0, 0, 0);
    const diff = Math.round((day - mon) / 86400000);
    return diff >= 0 && diff <= 6;
  }

  function _computeFocusStats() {
    const todayStr = Storage.todayStr();
    const stats = { focusMins: 0, sessions: 0, xpToday: 0, week: [0, 0, 0, 0, 0, 0, 0] };
    for (const s of state.sessions) {
      if (!s.startTime) continue;
      const d  = new Date(s.startTime);
      const ds = _localDateStr(d);
      if (ds === todayStr) {
        stats.sessions++;
        stats.xpToday += s.xpEarned || 0;
        if (s.endTime) {
          stats.focusMins += Math.max(0, Math.round((new Date(s.endTime) - d) / 60000));
        }
      }
      if (_inCurrentWeek(d)) {
        stats.week[d.getDay()] += s.xpEarned || 0;
      }
    }
    return stats;
  }

  function _renderFocusStats() {
    const panel = $('focus-stats');
    if (!panel) return;
    const stats = _computeFocusStats();

    const mins = stats.focusMins;
    const timeEl = $('focus-time');
    if (timeEl) timeEl.textContent = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
    const sEl = $('focus-sessions');
    if (sEl) sEl.textContent = stats.sessions;
    const xEl = $('focus-xp');
    if (xEl) xEl.textContent = stats.xpToday;

    const chart = $('focus-week-chart');
    if (!chart) return;
    const max      = Math.max.apply(null, stats.week.concat([1]));
    const MON_FIRST = [1, 2, 3, 4, 5, 6, 0]; // getDay() order → Mon-first display
    const LABELS   = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const todayDow = new Date().getDay();
    chart.innerHTML = MON_FIRST.map((dayIdx, i) => {
      const xp  = stats.week[dayIdx];
      const pct = Math.max(xp > 0 ? 6 : 2, Math.round(xp / max * 100));
      return `
        <div class="week-bar-col ${dayIdx === todayDow ? 'is-today' : ''}">
          <div class="week-bar ${xp > 0 ? 'has-xp' : ''}" style="height:${pct}%"></div>
          <span class="week-bar-label">${LABELS[i]}</span>
        </div>`;
    }).join('');
  }

  // ── Pillar picker state — moved up for outer renderPillarChips access ──
  let _selectedPillar = (state.pillars && state.pillars[0]) ? state.pillars[0].id : 'other';

  // ── Priority sort based on pillar order ──
  function getPillarPriority(pillarId) {
    const pillars = state.pillars || [];
    const idx = pillars.findIndex(p => p.id === pillarId);
    return idx === -1 ? 99 : idx;
  }

  function getNextTask(tasks) {
    const incomplete = tasks.filter(t => !t.completed);
    if (!incomplete.length) return null;
    return incomplete.sort((a, b) =>
      getPillarPriority(a.tag) - getPillarPriority(b.tag)
    )[0];
  }

  function renderCurrentTask(task) {
    const display  = $('current-task-display');
    const startBtn = $('btn-start-session');

    if (!task) {
      display.innerHTML = `<span class="task-empty-state">No tasks queued.<br/>Add one below.</span>`;
      startBtn.disabled = true;
      sessionContext.taskId = null;
      const progRow = $('objective-progress-row');
      if (progRow) progRow.classList.add('hidden');
      const xpEst = $('objective-xp-est');
      if (xpEst) xpEst.textContent = '';
      return;
    }

    const pillar = getPillarById(task.tag);
    const starCount = { 1: 1, 1.5: 2, 2: 3 }[task.xpMultiplier || 1] || 1;
    const stars     = '<span class="diff-stars">' + '★'.repeat(starCount) + '</span>';
    const goal      = task.goalId ? (getGoalById(task.goalId)?.title || '') : '';
    display.innerHTML = `
      <div class="task-display-content">
        <span class="task-tag-badge" style="background:${pillar.color}22;color:${pillar.color};border:1px solid ${pillar.color}44">${pillar.icon} ${pillar.name}</span>
        ${escHtml(task.text)}
        ${goal ? `<span class="task-goal-crumb">▸ ${escHtml(goal)}</span>` : ''}
        ${stars}
      </div>`;

    startBtn.disabled = false;
    sessionContext.taskId = task.id;
    sessionContext.difficultyMultiplier = task.xpMultiplier || 1.0;

    // Objective progress bar
    const prog = _objectiveProgress(task);
    const progRow  = $('objective-progress-row');
    const progFill = $('objective-progress-fill');
    const progLbl  = $('objective-progress-label');
    if (prog && progRow) {
      progRow.classList.remove('hidden');
      if (progFill) progFill.style.width = prog.pct + '%';
      if (progLbl)  progLbl.textContent = `${prog.pct}% · ${prog.label}`;
    } else if (progRow) {
      progRow.classList.add('hidden');
    }

    // Estimated XP for a session on this task
    const xpEst = $('objective-xp-est');
    if (xpEst) xpEst.textContent = `⚡ EST +${_estimateXP(task)} XP`;

    // highlight the selected quest (if the list is rendered)
    const questList = $('quest-list');
    if (questList) {
      questList.querySelectorAll('.quest-item').forEach(q => {
        q.classList.toggle('selected', q.dataset.taskId === task.id);
      });
    }
  }

  // ── Today's Quests — pending task queue with tap-to-set-objective ──
  function renderQuestList() {
    const list = $('quest-list');
    if (!list) return;
    const tasks   = state.tasks || [];
    const pending = tasks.filter(t => !t.completed);
    const done    = tasks.length - pending.length;

    // header progress "2/5 done"
    const progress = $('quest-progress');
    if (progress) progress.textContent = (done > 0) ? `${done}/${tasks.length} done` : '';

    const currentId = sessionContext.taskId;

    // ── Empty states ──
    if (!tasks.length) {
      const hasGoals = (state.goals || []).length > 0;
      if (hasGoals) {
        list.innerHTML = `
          <div class="quest-empty">
            <span class="quest-empty-text">NO QUESTS YET</span>
            <span class="quest-empty-sub">Tap + ADD QUEST to forge one.</span>
          </div>`;
      } else {
        // first-run funnel → PLAN mode
        list.innerHTML = `
          <div class="quest-empty">
            <span class="quest-empty-text">FORGE YOUR FIRST GOAL</span>
            <span class="quest-empty-sub">Goals → Tasks → Calendar</span>
            <button id="btn-empty-to-plan" class="btn-primary btn-empty-cta">OPEN PLAN MODE ▶</button>
          </div>`;
        const cta = $('btn-empty-to-plan');
        if (cta) cta.addEventListener('click', () => {
          showView('plan');
          renderPlanMode();
          openPlanTab('objectives');
        });
      }
      return;
    }

    // ── Quest rows — pending first, done struck-through at the bottom ──
    const doneTasks = tasks.filter(t => t.completed);
    list.innerHTML = [...pending, ...doneTasks].map(t => {
      const pillar    = getPillarById(t.tag);
      const starCount = { 1: 1, 1.5: 2, 2: 3 }[t.xpMultiplier || 1] || 1;
      const stars     = '★'.repeat(starCount);
      const goal      = t.goalId ? (getGoalById(t.goalId)?.title || '') : '';
      return `
        <button class="quest-item ${t.id === currentId ? 'selected' : ''} ${t.completed ? 'is-done' : ''}" data-task-id="${t.id}">
          <span class="quest-dot" style="background:${pillar.color};box-shadow:0 0 6px ${pillar.color}"></span>
          <span class="quest-text">${escHtml(t.text)}</span>
          ${goal ? `<span class="quest-goal">▸ ${escHtml(goal)}</span>` : ''}
          <span class="quest-stars" style="color:${pillar.color}">${stars}</span>
          <span class="quest-xp">${t.completed ? '✓' : `+${_estimateXP(t)} XP`}</span>
        </button>`;
    }).join('');

    list.querySelectorAll('.quest-item').forEach(item => {
      item.addEventListener('click', () => {
        const t = state.tasks.find(x => x.id === item.dataset.taskId);
        if (!t || t.completed) return;
        renderCurrentTask(t); // also re-highlights + sets sessionContext
        Sound.click();
        flashElement(item, 'Objective set');
      });
    });
  }

  // ══════════════════════════════════════════
  // TASK MANAGEMENT
  // ══════════════════════════════════════════
  let selectedDifficulty = 1.0;
  // _selectedPillar already declared above

  function addTask() {
    const input = $('input-task');
    const text  = input.value.trim();
    if (!text) {
      showToast('TYPE A QUEST FIRST', 'error');
      input.focus();
      return;
    }

    const tag = _selectedPillar || 'other';

    // Quick-add lands in the UNSCHEDULED inventory. It is NOT auto-committed
    // to a time — the user decides "when" deliberately, on the calendar.
    const task = Object.assign(Storage.taskDefaults(), {
      id:             Storage.uuid(),
      text,
      tag,
      completed:      false,
      xpMultiplier:   selectedDifficulty,
      createdAt:      new Date().toISOString(),
      completedAt:    null
    });

    state.tasks.push(task);
    saveState();

    input.value = '';
    renderDashboard();
    Sound.taskAdded();
    showToast('QUEST ADDED ✓', 'success');
  }

  function deleteTask(id) {
    state.tasks = state.tasks.filter(t => t.id !== id);
    saveState();
    renderTaskList();
    renderDashboard();
    _refreshPlanPanels();
  }

  function markTaskComplete(id) {
    const task = state.tasks.find(t => t.id === id);
    if (task) {
      task.completed   = true;
      task.completedAt = new Date().toISOString();
      saveState();
    }
  }

  // Re-render Plan Mode whenever tasks change elsewhere (queue, dashboard,
  // mid-session drawer). Plan Mode owns its own repaint logic.
  function _refreshPlanPanels() {
    if (window.Plan) Plan.refresh();
  }

  function getPillarById(id) {
    return (state.pillars || []).find(p => p.id === id) || { name: (id||'OTHER').toUpperCase(), color: '#888880', icon: '◎' };
  }

  function getGoalById(id) {
    return (state.goals || []).find(g => g.id === id) || null;
  }

  // Pillar chips — kept at outer scope so Plan Mode can call it
  function renderPillarChips() {
    const row = $('pillar-chips-row');
    if (!row) return;
    const pillars = state.pillars || [];
    // Ensure selected pillar still exists
    const exists = pillars.some(p => p.id === _selectedPillar);
    if (!exists) _selectedPillar = (pillars[0] && pillars[0].id) || 'other';
    const selected = _selectedPillar;
    row.innerHTML = pillars.map(p => `
      <div class="pillar-chip ${p.id === selected ? 'selected' : ''}"
           data-pillar="${p.id}"
           style="--pillar-color:${p.color}">
        <span class="pillar-chip-dot"></span>
        ${p.name}
      </div>`).join('');
    row.querySelectorAll('.pillar-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        _selectedPillar = chip.dataset.pillar;
        renderPillarChips();
      });
    });
  }

  function renderTaskList(target) {
    // completed tasks go to bottom
    const list = $(target || 'task-list');
    const tasks = state.tasks;

    // Keep the quick-add goal picker in sync with current goals.
    const goalSel = $('tq-goal');
    if (goalSel) {
      const prev = goalSel.value;
      const goals = (state.goals || []).filter(g => g.status !== 'archived');
      goalSel.innerHTML = `<option value="">— no goal —</option>` +
        goals.map(g => `<option value="${g.id}">${escHtml(g.title)}</option>`).join('');
      if (prev && goals.some(g => g.id === prev)) goalSel.value = prev;
    }

    // "12 TASKS · 5 UNSCHEDULED · ~6h 15m"
    const sub = $('tasks-sub');
    if (sub) {
      const pending = tasks.filter(t => !t.completed);
      const unsched = pending.filter(t => !t.scheduledStart);
      const mins = unsched.reduce((a, t) => a + (t.estimatedMinutes || 0), 0);
      const h = Math.floor(mins / 60), m = mins % 60;
      const pretty = h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
      sub.textContent = pending.length
        ? `${pending.length} OPEN · ${unsched.length} UNSCHEDULED${mins ? ' · ~' + pretty : ''}`
        : '';
    }

    if (!tasks.length) {
      list.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text-dim);font-family:var(--font-mono);font-size:12px;letter-spacing:2px;">NO TASKS YET</div>`;
      return;
    }

    // Show incomplete first, then done
    const sorted = [
      ...tasks.filter(t => !t.completed).sort((a,b) => getPillarPriority(a.tag) - getPillarPriority(b.tag)),
      ...tasks.filter(t => t.completed)
    ];

    list.innerHTML = sorted.map(task => {
      const isActive = task.id === sessionContext.taskId;
      const xp = Math.round(100 * task.xpMultiplier);
      const diffLabel = task.xpMultiplier === 2 ? 'HARD' : task.xpMultiplier === 1.5 ? 'MED' : 'EASY';
      const pillar = getPillarById(task.tag);
      return `
        <div class="task-item ${task.completed ? 'is-done' : ''} ${isActive ? 'is-active' : ''}"
             data-id="${task.id}">
          <div class="task-item-check" ${!task.completed ? `data-complete="${task.id}"` : ''}>${task.completed ? '✓' : ''}</div>
          <div class="task-item-text">${escHtml(task.text)}</div>
          <div class="task-item-meta">
            <span class="task-tag-badge" style="background:${pillar.color}22;color:${pillar.color};border:1px solid ${pillar.color}44">${pillar.icon} ${pillar.name}</span>
            <span class="task-item-xp">${diffLabel} · ${xp}XP</span>
          </div>
          <button class="task-delete-btn" data-delete="${task.id}">✕</button>
        </div>`;
    }).join('');

    // Bind delete buttons (all tasks — completed or not, no XP reversal)
    list.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const task = state.tasks.find(t => t.id === btn.dataset.delete);
        if (task && task.completed) {
          forgeConfirm('Remove this completed task?', () => deleteTask(btn.dataset.delete));
        } else {
          deleteTask(btn.dataset.delete);
        }
      });
    });

    // Bind check/complete buttons
    list.querySelectorAll('[data-complete]').forEach(check => {
      check.addEventListener('click', e => {
        e.stopPropagation();
        markTaskComplete(check.dataset.complete);
        renderTaskList(target);
        renderDashboard();
        Sound.xpGain();
      });
    });

    // Tap task to set as active
    list.querySelectorAll('.task-item:not(.is-done)').forEach(item => {
      item.addEventListener('click', () => {
        const task = state.tasks.find(t => t.id === item.dataset.id);
        if (task) {
          sessionContext.taskId = task.id;
          sessionContext.difficultyMultiplier = task.xpMultiplier;
          renderTaskList();
          renderDashboard();
        }
      });
    });
  }

  // ══════════════════════════════════════════
  // SESSION FLOW
  // ══════════════════════════════════════════

  // Step 1: Open intention screen
  function openIntention() {
    const task = state.tasks.find(t => t.id === sessionContext.taskId);
    if (!task) return;

    // Pre-fill the declaration with the task — sharpen it, don't retype it
    $('input-intention').value = task.text;

    // Always reset sessionMinutes so previous session's pick doesn't bleed in
    const currentMins = state.settings.workMinutes;
    sessionContext.sessionMinutes = currentMins;

    // Sync timer picker UI to current settings
    const presets = [25, 50, 90];
    document.querySelectorAll('.session-preset-btn').forEach(btn => {
      const mins = parseInt(btn.dataset.mins);
      btn.classList.toggle('active', mins === currentMins);
    });
    if (!presets.includes(currentMins)) {
      $('input-custom-mins').value = currentMins;
    } else {
      $('input-custom-mins').value = '';
    }

    // Render selected task + close switcher
    renderIntentionTask();
    closeSwitcher();

    // The goal comes from the task — never re-picked on this screen
    sessionContext.goalId = task.goalId || null;

    showView('intention');
    setTimeout(() => $('input-intention').focus(), 300);
  }

  // ── Render the selected task on the intention screen ──
  function renderIntentionTask() {
    const task = state.tasks.find(t => t.id === sessionContext.taskId);
    if (!task) return;
    const badge = $('intention-task-badge');
    const tag = (task.tag || 'other').toLowerCase();
    const pillar = getPillarById(tag);
    badge.textContent = `${pillar.icon} ${pillar.name}`;
    badge.className   = 'task-tag-badge';
    badge.style.cssText = `background:${pillar.color}22;color:${pillar.color};border:1px solid ${pillar.color}44`;
    $('intention-task-name').textContent = task.text;

    // Goal breadcrumb — context, not a selector
    const crumb = $('intention-goal-crumb');
    if (crumb) {
      const goal = task.goalId ? getGoalById(task.goalId) : null;
      crumb.textContent   = goal ? `▸ ${goal.title}` : '';
      crumb.style.display = goal ? '' : 'none';
    }
  }

  // ── Open/close the task switcher dropdown ──
  function openSwitcher() {
    const switcher = $('task-switcher');
    const incompleteTasks = state.tasks.filter(t => !t.completed);

    if (!incompleteTasks.length) {
      switcher.innerHTML = `<div class="task-switcher-empty">NO OTHER TASKS</div>`;
    } else {
      switcher.innerHTML = incompleteTasks
        .sort((a, b) => getPillarPriority(a.tag) - getPillarPriority(b.tag))
        .map(t => {
          const pl = getPillarById(t.tag);
          return `
          <div class="task-switcher-item ${t.id === sessionContext.taskId ? 'is-selected' : ''}"
               data-task-id="${t.id}">
            <span class="task-tag-badge" style="background:${pl.color}22;color:${pl.color};border:1px solid ${pl.color}44">${pl.icon} ${pl.name}</span>
            ${escHtml(t.text)}
          </div>`;
        })
        .join('');

      // Tap to select
      switcher.querySelectorAll('.task-switcher-item').forEach(item => {
        item.addEventListener('click', () => {
          const selected = state.tasks.find(t => t.id === item.dataset.taskId);
          if (!selected) return;
          sessionContext.taskId             = selected.id;
          sessionContext.difficultyMultiplier = selected.xpMultiplier || 1.0;
          renderIntentionTask();
          closeSwitcher();
          Sound.click();
        });
      });
    }

    switcher.classList.remove('hidden');
    $('btn-switch-task').classList.add('open');
  }

  function closeSwitcher() {
    $('task-switcher').classList.add('hidden');
    $('btn-switch-task').classList.remove('open');
  }

  // Step 2: Lock in intention → "✓ INTENTION LOCKED" stamp → session
  function startSession() {
    const raw = $('input-intention').value.trim();
    if (!raw) {
      $('input-intention').focus();
      $('input-intention').placeholder = 'required — be specific';
      return;
    }

    // Store the full declaration — "I will" is locked, so echo it
    const cleaned = raw.replace(/^i\s+will\s*/i, '');
    sessionContext.intention  = 'I will ' + cleaned;
    sessionContext.startTime  = new Date().toISOString();
    // goalId set in openIntention (from the task)

    // The commitment stamp — one beat, then straight into the session
    const confirm = $('btn-intention-confirm');
    const cancel  = $('btn-intention-cancel');
    const stamp   = $('intention-locked-stamp');
    stamp.classList.remove('hidden');
    confirm.disabled = true;
    cancel.disabled  = true;
    Sound.sessionStart();

    setTimeout(() => {
      stamp.classList.add('hidden');
      confirm.disabled = false;
      cancel.disabled  = false;
      // Guard: if the user hit back during the stamp, don't launch
      if (document.querySelector('.view.active') !== $('view-intention')) return;
      launchSession();
    }, 500);
  }

  // Step 2b: flip to the focus screen and start the wall-clock timer
  function launchSession() {
    const intention = sessionContext.intention;
    const task = state.tasks.find(t => t.id === sessionContext.taskId);

    $('session-task-label').textContent        = task ? task.text : '—';
    $('session-intention-display').textContent = intention;
    $('session-mode-label').textContent        = 'FOCUS';

    // Make sure hold overlay is hidden when session starts
    $('hold-overlay').classList.add('hidden');
    $('session-controls').classList.remove('hidden');

    showView('session');

    // Use the session-level minutes (set by picker, not global settings)
    Timer.startFocus(
      sessionContext.sessionMinutes || state.settings.workMinutes,
      onTimerTick,
      onSessionComplete
    );
  }

  // Step 3: Timer tick → update ring + display
  function onTimerTick(remain, total) {
    const { mm, ss } = Timer.format(remain);
    $('timer-minutes').textContent = mm;
    $('timer-seconds').textContent = ss;

    // SVG ring
    const offset = Timer.ringOffset(remain, total);
    $('timer-progress-ring').style.strokeDashoffset = offset;

    // Subtle tick every 60 seconds as presence reminder
    if (remain > 0 && remain % 60 === 0) Sound.tick();
  }

  // Step 4: Timer completes → show reward
  function onSessionComplete() {
    completeSession(true);
  }

  // ══════════════════════════════════════════
  // MID-SESSION PLAN DRAWER
  // ══════════════════════════════════════════

  let _drawerDifficulty = 1.0;
  let _drawerPillar = null;

  function openPlanDrawer() {
    // Auto-hold the timer while planning
    if (Timer.isRunning()) {
      Timer.hold((holdRemain) => {
        const { mm, ss } = Timer.format(holdRemain);
        $('hold-countdown').textContent = `${mm}:${ss}`;
        if (holdRemain <= 0) {
          $('hold-overlay').classList.add('hidden');
          $('session-controls').classList.remove('hidden');
        }
      });
      // Don't show hold overlay — drawer takes over the screen
    }

    // Reset drawer state
    _drawerDifficulty = 1.0;
    _drawerPillar = (state.pillars && state.pillars[0]) ? state.pillars[0].id : 'other';
    $('drawer-task-input').value = '';

    // Render pillar chips
    _renderDrawerPillarChips();

    // Render goal dropdown filtered to selected pillar
    _renderDrawerGoalSelect();

    // Reset difficulty buttons
    document.querySelectorAll('.drawer-diff-btn').forEach(btn => {
      btn.classList.toggle('active', parseFloat(btn.dataset.mult) === 1.0);
    });

    $('plan-drawer').classList.remove('hidden');
    setTimeout(() => $('drawer-task-input').focus(), 120);
  }

  function closePlanDrawer() {
    $('plan-drawer').classList.add('hidden');

    // Resume timer if it was held by us (hold overlay is NOT showing)
    if (Timer.isHeld() && $('hold-overlay').classList.contains('hidden')) {
      Timer.resume();
    }
  }

  function _renderDrawerPillarChips() {
    const row = $('drawer-pillar-chips');
    const pillars = state.pillars || [];
    if (!pillars.length) {
      row.innerHTML = `<span style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);letter-spacing:2px;">NO PILLARS — ADD ONE IN PLAN MODE</span>`;
      _drawerPillar = 'other';
      return;
    }
    // Ensure selected pillar still exists
    if (!pillars.some(p => p.id === _drawerPillar)) {
      _drawerPillar = pillars[0].id;
    }
    row.innerHTML = pillars.map(p => `
      <div class="pillar-chip ${p.id === _drawerPillar ? 'selected' : ''}"
           data-pillar="${p.id}"
           style="--pillar-color:${p.color}">
        <span class="pillar-chip-dot"></span>${p.name}
      </div>`).join('');
    row.querySelectorAll('.pillar-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        _drawerPillar = chip.dataset.pillar;
        _renderDrawerPillarChips();
        _renderDrawerGoalSelect();
      });
    });
  }

  function _renderDrawerGoalSelect() {
    const sel = $('drawer-goal-select');
    const goals = (state.goals || []).filter(g =>
      g.status !== 'done' && g.pillarId === _drawerPillar
    );
    sel.innerHTML = `<option value="">— no goal —</option>` +
      goals.map(g => `<option value="${g.id}">${g.title}</option>`).join('');
  }

  function addTaskFromDrawer() {
    const text = $('drawer-task-input').value.trim();
    if (!text) {
      $('drawer-task-input').focus();
      $('drawer-task-input').placeholder = 'type a task first...';
      return;
    }

    const goalId = $('drawer-goal-select').value || null;

    // Captured mid-session → goes to UNSCHEDULED. You are focusing right
    // now; deciding *when* to do this can wait until you next plan.
    const task = Object.assign(Storage.taskDefaults(), {
      id:           Storage.uuid(),
      text,
      tag:          _drawerPillar || 'other',
      goalId:       goalId || null,
      completed:    false,
      xpMultiplier: _drawerDifficulty,
      createdAt:    new Date().toISOString(),
      completedAt:  null
    });

    state.tasks.push(task);
    saveState();
    Sound.taskAdded();
    showToast('TASK QUEUED ✓', 'success');
    closePlanDrawer();
  }

  // Step 5: Manual complete or abandon
  function completeSession(completed) {
    Timer.stop();

    if (!completed) {
      // Abandoned — go back to dashboard, no XP
      Sound.abandon();
      showView('dashboard');
      renderDashboard();
      return;
    }

    // Calculate XP based on ACTUAL time worked, not planned session length.
    // If user completes early (20min of a 50min session), they earn 20min XP.
    // If timer ran to zero naturally, elapsed = full session = correct.
    const elapsedSecs    = Timer.getElapsedSecs();
    const actualMinutes  = Math.max(1, Math.floor(elapsedSecs / 60));

    const xpResult = XP.calculateSessionXP(
      sessionContext.difficultyMultiplier,
      state.user.streak.current,
      actualMinutes,
      state.user.level
    );

    // Apply XP + level up
    const { updatedUser, levelsGained, newLevel, rankChanged, newRank } = XP.applyXP(state.user, xpResult.total);

    // Update streak
    const prevFreezes = updatedUser.streak.freezesAvailable || 0;
    const newStreak   = XP.updateStreak(updatedUser.streak, Storage.todayStr());
    const freezeAwarded = (newStreak.freezesAvailable > prevFreezes);
    updatedUser.streak = newStreak;
    updatedUser.totalSessions += 1;

    // Add coins
    updatedUser.coins = (updatedUser.coins || 0) + xpResult.coinsEarned;

    // NOTE: Task is NOT auto-marked complete here.
    // User decides on reward screen: "Task Done" or "Continue Task"

    // Update today counter
    state.today.sessionsCompleted += 1;

    // Log session
    state.sessions.push({
      id:        Storage.uuid(),
      taskId:    sessionContext.taskId,
      intention: sessionContext.intention,
      startTime: sessionContext.startTime,
      endTime:   new Date().toISOString(),
      completed: true,
      xpEarned:  xpResult.total,
      coinsEarned: xpResult.coinsEarned
    });

    // Persist
    state.user = updatedUser;
    saveState();

    // Show reward screen
    showReward(xpResult, levelsGained, newLevel, rankChanged, newRank, newStreak, freezeAwarded);
  }

  // ══════════════════════════════════════════
  // REWARD SCREEN
  // ══════════════════════════════════════════
  function showReward(xpResult, levelsGained, newLevel, rankChanged, newRank, newStreak, freezeAwarded) {
    // ── Reset reward UI state — critical fix for reused view ──
    $('task-bonus-display').classList.add('hidden');
    $('task-decision').classList.add('hidden');
    $('levelup-banner').classList.add('hidden');
    $('reward-bonus-label').classList.add('hidden');
    $('reward-coins-earned').classList.add('hidden');
    $('reward-freeze-award').classList.add('hidden');
    $('reward-stats').classList.add('hidden');
    const decisionBtns = document.querySelectorAll('#task-decision button');
    decisionBtns.forEach(b => b.disabled = true);

    // Beat 0 — the task I did (data was already written in completeSession)
    renderRewardTask(state.tasks.find(t => t.id === sessionContext.taskId));

    // Stage the numbers (hidden until their beat)
    $('reward-xp').textContent          = '0';
    $('reward-streak').textContent      = newStreak.current;
    $('reward-total').textContent       = state.user.totalSessions;
    $('reward-coins-total').textContent = state.user.coins || 0;
    if (xpResult.coinsEarned > 0) $('reward-coins').textContent = xpResult.coinsEarned;
    if (xpResult.bonusTriggered) $('reward-bonus-label').textContent = `⚡ FOCUS BONUS +${xpResult.bonus} XP`;

    // Stage the level-up ceremony
    const hadLevelUp = (levelsGained > 0 || rankChanged);
    if (hadLevelUp) {
      const oldRank = XP.getRank(Math.max(1, newLevel - levelsGained));
      const lu = _themeLevelUpText(newLevel, oldRank, newRank, rankChanged);
      $('levelup-head').textContent    = lu.head;
      $('levelup-num').textContent     = lu.num;
      $('levelup-rankline').textContent = lu.sub;
    }

    showView('reward');
    Sound.sessionComplete(); // Beat 0 — "I did THIS"

    // ── The beats ──
    // Beat 1 (0.45s): XP counts up + chime
    setTimeout(() => {
      countUp($('reward-xp'), xpResult.total, 900);
      Sound.xpGain();
    }, 450);

    // Beat 1b (0.95s): FOCUS BONUS chip — the surprise
    if (xpResult.bonusTriggered) {
      setTimeout(() => {
        $('reward-bonus-label').classList.remove('hidden');
        Sound.focusBonus();
      }, 950);
    }

    // Beat 2 (1.45s): coins + streak slide in — the proof
    setTimeout(() => {
      if (xpResult.coinsEarned > 0) $('reward-coins-earned').classList.remove('hidden');
      $('reward-stats').classList.remove('hidden');
      Sound.click();
    }, 1450);

    // Beat 3 (~2.15s): LEVEL UP ceremony — fanfare + particles + identity
    if (hadLevelUp || freezeAwarded) {
      setTimeout(() => {
        if (freezeAwarded && !hadLevelUp) {
          $('reward-freeze-award').classList.remove('hidden');
          Sound.levelUp();
        }
        if (hadLevelUp) {
          $('levelup-banner').classList.remove('hidden');
          burstParticles(14, $('levelup-banner'));
          Sound.levelUp();
        }
      }, 2150);
    }

    // Beat 4 (after ceremony): the decision fades in
    const decisionAt = (hadLevelUp || freezeAwarded) ? 3700 : 2600;
    setTimeout(() => {
      $('task-decision').classList.remove('hidden');
      decisionBtns.forEach(b => b.disabled = false);
    }, decisionAt);
  }

  // ── Beat 0 helper — "I did THIS" ──
  function renderRewardTask(task) {
    const display = $('reward-task-display');
    if (!display) return;
    if (!task) { display.style.display = 'none'; return; }
    display.style.display = '';
    const pillar = getPillarById(task.tag);
    const badge = $('reward-task-badge');
    badge.textContent = `${pillar.icon} ${pillar.name}`;
    badge.className   = 'task-tag-badge';
    badge.style.cssText = `background:${pillar.color}22;color:${pillar.color};border:1px solid ${pillar.color}44`;
    $('reward-task-name').textContent = task.text;
  }

  // ── Beat 1 helper — XP count-up (requestAnimationFrame) ──
  function countUp(el, target, duration) {
    if (!el) return;
    const start = performance.now();
    const from  = 0;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      el.textContent = Math.round(from + (target - from) * eased);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ── Beat 3 helper — particle burst (reuses the xp-particle motif) ──
  function burstParticles(count, origin) {
    const rect = origin ? origin.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 2 };
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      p.className = 'xp-particle';
      p.textContent = Math.random() > 0.5 ? '★' : '⚡';
      const ang = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * 90;
      p.style.left = (cx + Math.cos(ang) * dist) + 'px';
      p.style.top  = (cy + Math.sin(ang) * dist) + 'px';
      p.style.fontSize = (14 + Math.random() * 16) + 'px';
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 1600);
    }
  }

  // ── Beat 3 helper — theme-flavored level-up line ──
  function _themeLevelUpText(newLevel, oldRank, newRank, rankChanged) {
    const theme = state.user.activeTheme || 'forge';
    const tr = THEME_RANKS[theme] || {};
    const oldRN = rankChanged && oldRank ? (tr[oldRank] || oldRank) : '';
    const newRN = rankChanged && newRank ? (tr[newRank] || newRank) : '';

    if (theme === 'anime') {
      const bounty = Math.pow(newLevel, 2) * 1000000;
      return {
        head: 'BOUNTY INCREASED',
        num:  '฿ ' + bounty.toLocaleString(),
        sub:  rankChanged ? `${oldRN} ▸ ${newRN}` : ''
      };
    }
    if (theme === 'forge') {
      return {
        head: 'FORGED',
        num:  'LVL ' + newLevel,
        sub:  rankChanged ? `${oldRN} ▸ ${newRN}` : ''
      };
    }
    return {
      head: 'LEVEL UP!',
      num:  'LVL ' + newLevel,
      sub:  rankChanged ? `${oldRN} ▸ ${newRN}` : ''
    };
  }

  // ══════════════════════════════════════════
  // BREAK
  // ══════════════════════════════════════════
  function startBreak() {
    $('break-tip').textContent = XP.randomBreakTip();
    showView('break');
    Sound.breakStart();

    Timer.startBreak(
      state.settings.breakMinutes,
      (remain) => {
        const { mm, ss } = Timer.format(remain);
        $('break-minutes').textContent = mm;
        $('break-seconds').textContent = ss;
      },
      () => {
        Sound.breakEnd();
        showView('dashboard');
        renderDashboard();
      }
    );
  }

  // ══════════════════════════════════════════
  // SETTINGS
  // ══════════════════════════════════════════

  // Temporary settings state (not saved until user hits SAVE)
  let _tempSettings = {
    work:  50,
    brk:   10,
    sound: true
  };

  // ══════════════════════════════════════════
  // THEME ENGINE
  // ══════════════════════════════════════════

  // All available themes — single source of truth
  // Theme-specific rank title overrides
  const ANIME_RANKS = {
    'INITIATE':    'CABIN BOY',
    'APPRENTICE':  'SAILOR',
    'OPERATOR':    'PIRATE',
    'SPECIALIST':  'SUPER ROOKIE',
    'VETERAN':     'CAPTAIN',
    'ELITE':       'WARLORD',
    'COMMANDER':   'EMPEROR',
    'LEGEND':      'PIRATE KING'
  };

  const HEISENBERG_RANKS = {
    'INITIATE':    'SMALL-TIME',
    'APPRENTICE':  'MR. WHITE',
    'OPERATOR':    'HEISENBERG',
    'SPECIALIST':  'THE COOK',
    'VETERAN':     'DANGER',
    'ELITE':       'EMPIRE',
    'COMMANDER':   'I AM THE ONE',
    'LEGEND':      'SAY MY NAME'
  };

  const HACKER_RANKS = {
    'INITIATE':    'GUEST',
    'APPRENTICE':  'USER',
    'OPERATOR':    'SUDO',
    'SPECIALIST':  'ROOT',
    'VETERAN':     'KERNEL',
    'ELITE':       'DAEMON',
    'COMMANDER':   'GHOST',
    'LEGEND':      'GOD MODE'
  };

  const VOID_RANKS = {
    'INITIATE':    'HOLLOW',
    'APPRENTICE':  'SHADOW',
    'OPERATOR':    'WRAITH',
    'SPECIALIST':  'VOID',
    'VETERAN':     'ABYSS',
    'ELITE':       'NULL',
    'COMMANDER':   'OBLIVION',
    'LEGEND':      'NOTHING'
  };

  const VENOM_RANKS = {
    'INITIATE':    'DORMANT',
    'APPRENTICE':  'INFECTED',
    'OPERATOR':    'TOXIC',
    'SPECIALIST':  'VENOMOUS',
    'VETERAN':     'LETHAL',
    'ELITE':       'SYMBIOTE',
    'COMMANDER':   'CARNAGE',
    'LEGEND':      'VENOM'
  };

  const MINECRAFT_RANKS = {
    'INITIATE':    'DIRT',
    'APPRENTICE':  'STONE',
    'OPERATOR':    'IRON',
    'SPECIALIST':  'GOLD',
    'VETERAN':     'DIAMOND',
    'ELITE':       'NETHERITE',
    'COMMANDER':   'ENDERDRAGON',
    'LEGEND':      'STEVE'
  };

  const THEME_RANKS = {
    anime:       ANIME_RANKS,
    heisenberg:  HEISENBERG_RANKS,
    hacker:      HACKER_RANKS,
    void:        VOID_RANKS,
    venom:       VENOM_RANKS,
    minecraft:   MINECRAFT_RANKS
  };

  const THEMES = [
    {
      id: 'forge',
      name: 'FORGE',
      price: 0,
      free: true,
      previewClass: 'preview-forge',
      barClass: 'forge-bar',
      accentClass: 'preview-accent-forge',
      lineClass: '',
      desc: 'Industrial dark. The default.'
    },
    {
      id: 'venom',
      name: 'VENOM',
      price: 0,
      free: true,
      previewClass: 'preview-venom',
      barClass: 'venom-bar',
      accentClass: 'preview-accent-venom',
      lineClass: '',
      desc: 'Toxic green. Same darkness, different fire.'
    },
    {
      id: 'hacker',
      name: 'HACKER',
      price: 350,
      free: false,
      previewClass: 'preview-hacker',
      barClass: 'hacker-bar',
      accentClass: 'preview-accent-hacker',
      lineClass: 'hacker-line',
      desc: 'Full terminal. Green on black. Scanlines.'
    },
    {
      id: 'heisenberg',
      name: 'HEISENBERG',
      price: 350,
      free: false,
      previewClass: 'preview-heisenberg',
      barClass: 'heisenberg-bar',
      accentClass: 'preview-accent-heisenberg',
      lineClass: 'heisenberg-line',
      desc: 'Say my name. Cook blue. Desert gold.'
    },
    {
      id: 'void',
      name: 'VOID',
      price: 350,
      free: false,
      previewClass: 'preview-void',
      barClass: 'void-bar',
      accentClass: 'preview-accent-void',
      lineClass: 'void-line',
      desc: 'Pure black. Blood red. Absolute silence.'
    },
    {
      id: 'minecraft',
      name: 'MINECRAFT',
      price: 500,
      free: false,
      previewClass: 'preview-minecraft',
      barClass: 'minecraft-bar',
      accentClass: 'preview-accent-minecraft',
      lineClass: 'minecraft-line',
      desc: 'Pixelated. Blocky. Grass-green everything.'
    },
    {
      id: 'anime',
      name: 'ANIME',
      price: 500,
      free: false,
      previewClass: 'preview-anime',
      barClass: 'anime-bar',
      accentClass: 'preview-accent-anime',
      lineClass: 'anime-line',
      desc: 'Grand Line. Sun gold. Pirate ranks.'
    }
  ];

  function applyTheme(themeId) {
    const valid = THEMES.find(t => t.id === themeId);
    document.body.setAttribute('data-theme', valid ? themeId : 'forge');
    // Refresh rank label immediately for anime rank names
    if (state && state.user) {
      const rankEl = $('display-rank');
      if (rankEl) {
        const baseRank = state.user.rank || 'INITIATE';
        const tr = THEME_RANKS[themeId];
        const title = (tr && tr[baseRank]) ? tr[baseRank] : baseRank;
        rankEl.textContent = `LVL ${state.user.level || 1} · ${title}`;
      }
    }
  }

  // ══════════════════════════════════════════
  // PLAN MODE  (bridge → plan.js / calendar.js)
  // ══════════════════════════════════════════
  //
  // The planning model is:  PILLARS → GOALS → TASKS → CALENDAR
  //
  //   Pillars  = WHERE  (areas of life)
  //   Goals    = WHY    (outcomes with deadlines)
  //   Tasks    = WHAT   (actions that move a goal forward)
  //   Calendar = WHEN   (the commitment layer)
  //
  // The old "Week 1..N" containers, the separate THIS WEEK kanban and the
  // duplicated TASKS tab are gone — they were three competing
  // representations of the same work. Real implementation lives in
  // plan.js (Objectives + Goal Detail) and calendar.js (the time grid),
  // so this god file does not grow.

  const PILLAR_COLORS = [
    '#e85d04', '#4caf7d', '#7b9de8', '#e040fb',
    '#f0c040', '#ff5252', '#00e676', '#40c4ff',
    '#ff9800', '#b39ddb'
  ];

  const PILLAR_ICONS = ['◎','📚','🎮','💻','🎨','🏋️','💰','🎵','📝','🌍','🔬','⚡','🎯','🚀','📖','🧠'];

  // Shared context handed to the plan modules. They read/write live state
  // through these helpers rather than importing app.js internals.
  function _planContext() {
    return {
      getState:      () => state,
      save:          saveState,
      getPillarById,
      getGoalById,
      escHtml,
      showToast,
      forgeConfirm,
      sound:         Sound,
      onTasksChanged: () => {
        renderDashboard();
        if ($('task-list')) renderTaskList();
      },
      PILLAR_COLORS,
      PILLAR_ICONS,
      editPillar: (idx) => {
        renderPillarForm(idx);
        $('pillar-form').classList.remove('hidden');
        $('btn-add-pillar').classList.add('hidden');
      }
    };
  }

  function renderPlanMode() {
    if (window.Plan) Plan.render(_planContext());
  }

  // Deep-link helper — used by the dashboard empty state and the rail.
  function openPlanTab(tab) {
    if (window.Plan) Plan.showTab(tab, _planContext());
  }

  // ── Pillar editor (pillars are KEPT; only their role changed — they now
  //    organise goals instead of acting as a planning hierarchy) ──
  let _editingPillarIdx = null;
  let _selectedColor    = PILLAR_COLORS[0];
  let _selectedIcon     = '◎';

  function renderPillarForm(editIdx) {
    _editingPillarIdx = editIdx;
    const pillar = editIdx !== null ? state.pillars[editIdx] : null;
    _selectedColor = pillar ? pillar.color : PILLAR_COLORS[0];
    const nameInput = $('pillar-name-input');
    if (nameInput) nameInput.value = pillar ? pillar.name : '';

    const swatches = $('pillar-color-swatches');
    if (swatches) {
      swatches.innerHTML = PILLAR_COLORS.map(c => `
        <div class="color-swatch ${c === _selectedColor ? 'selected' : ''}"
             style="background:${c}" data-color="${c}"></div>`).join('');
      swatches.querySelectorAll('.color-swatch').forEach(s => {
        s.addEventListener('click', () => {
          _selectedColor = s.dataset.color;
          swatches.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('selected'));
          s.classList.add('selected');
        });
      });
    }

    _selectedIcon = pillar ? pillar.icon : PILLAR_ICONS[0];
    const iconRow = $('pillar-icon-swatches');
    if (iconRow) {
      iconRow.innerHTML = PILLAR_ICONS.map(ic => `
        <div class="icon-swatch ${ic === _selectedIcon ? 'selected' : ''}" data-icon="${ic}">${ic}</div>`).join('');
      iconRow.querySelectorAll('.icon-swatch').forEach(s => {
        s.addEventListener('click', () => {
          _selectedIcon = s.dataset.icon;
          iconRow.querySelectorAll('.icon-swatch').forEach(x => x.classList.remove('selected'));
          s.classList.add('selected');
        });
      });
    }
  }



  // ══════════════════════════════════════════
  // SHOP / ARMORY
  // ══════════════════════════════════════════

  // ── Custom confirm dialog (replaces browser confirm()) ──
  function forgeConfirm(message, onConfirm) {
    const backdrop = $('forge-confirm-backdrop');
    $('forge-confirm-msg').textContent = message;
    backdrop.classList.remove('hidden');

    const ok     = $('forge-confirm-ok');
    const cancel = $('forge-confirm-cancel');

    function cleanup() {
      backdrop.classList.add('hidden');
      ok.removeEventListener('click', handleOk);
      cancel.removeEventListener('click', handleCancel);
    }
    function handleOk()     { Sound.click(); cleanup(); onConfirm(); }
    function handleCancel() { Sound.click(); cleanup(); }

    ok.addEventListener('click', handleOk);
    cancel.addEventListener('click', handleCancel);
  }

  function renderShop() {
    const coins    = state.user.coins || 0;
    const unlocked = state.user.unlockedThemes || ['forge', 'venom'];
    const active   = state.user.activeTheme   || 'forge';

    $('shop-coins-val').textContent = coins;
    $('shop-active-name').textContent = (THEMES.find(t => t.id === active) || THEMES[0]).name;

    // ── Render theme cards ──
    const grid = $('shop-themes-grid');
    grid.innerHTML = THEMES.map(theme => {
      const isActive   = theme.id === active;
      const isUnlocked = unlocked.includes(theme.id);
      const canAfford  = coins >= theme.price;

      let statusText, statusClass;
      if (isActive)        { statusText = '● ACTIVE';  statusClass = 'status-active'; }
      else if (isUnlocked) { statusText = '✓ OWNED';   statusClass = 'status-free'; }
      else if (theme.free) { statusText = 'FREE';       statusClass = 'status-free'; }
      else                 { statusText = `◎ ${theme.price}`; statusClass = canAfford ? 'status-price' : 'status-locked'; }

      return `
        <div class="shop-theme-card ${isActive ? 'is-active' : ''} ${!isUnlocked && !theme.free ? 'is-locked' : ''}"
             data-theme-id="${theme.id}">
          <div class="theme-preview ${theme.previewClass}">
            <div class="preview-bar ${theme.barClass}"></div>
            <div class="preview-line ${theme.lineClass}"></div>
            <div class="preview-dots">
              <div class="preview-dot ${theme.accentClass}"></div>
              <div class="preview-dot preview-dot-dim"></div>
              <div class="preview-dot preview-dot-dim"></div>
            </div>
            ${!isUnlocked && !theme.free ? '<div class="theme-lock-overlay">🔒</div>' : ''}
          </div>
          <div class="theme-card-footer">
            <span class="theme-card-name">${theme.name}</span>
            <span class="theme-card-status ${statusClass}">${statusText}</span>
          </div>
        </div>`;
    }).join('');

    // Bind theme card clicks
    grid.querySelectorAll('.shop-theme-card').forEach(card => {
      card.addEventListener('click', () => {
        const themeId = card.dataset.themeId;
        const theme   = THEMES.find(t => t.id === themeId);
        if (!theme) return;

        const isUnlocked = (state.user.unlockedThemes || []).includes(themeId);

        if (isUnlocked || theme.free) {
          // Equip it
          if (!state.user.unlockedThemes.includes(themeId)) {
            state.user.unlockedThemes.push(themeId);
          }
          state.user.activeTheme = themeId;
          applyTheme(themeId);
          saveState();
          Sound.click();
          renderShop();
          _showShopToast(`${theme.name} EQUIPPED`);
        } else {
          // Try to purchase
          const coins = state.user.coins || 0;
          if (coins < theme.price) {
            _showShopToast('NOT ENOUGH COINS');
            return;
          }
          forgeConfirm(`Buy ${theme.name} for ◎ ${theme.price}?`, () => {
            state.user.coins -= theme.price;
            if (!state.user.unlockedThemes) state.user.unlockedThemes = ['forge', 'venom'];
            state.user.unlockedThemes.push(themeId);
            state.user.activeTheme = themeId;
            applyTheme(themeId);
            saveState();
            Sound.levelUp();
            renderShop();
            renderDashboard();
            _showShopToast(`${theme.name} UNLOCKED`);
          });
        }
      });
    });

    // ── Render consumables ──
    const list   = $('shop-consumables-list');
    const freezes = state.user.streak.freezesAvailable || 0;
    const maxFreeze = 2;
    const freezePrice = 150;
    const canAffordFreeze = coins >= freezePrice;
    const atMax = freezes >= maxFreeze;

    list.innerHTML = `
      <div class="shop-consumable-card ${atMax || !canAffordFreeze ? 'cant-afford' : ''}"
           id="btn-buy-freeze">
        <div class="consumable-icon">🧊</div>
        <div class="consumable-info">
          <div class="consumable-name">STREAK FREEZE</div>
          <div class="consumable-desc">Protects your streak if you miss a day. Max 2.</div>
        </div>
        <div class="consumable-right">
          <div class="consumable-price">◎ ${freezePrice}</div>
          <div class="consumable-owned">OWNED: ${freezes}/${maxFreeze}</div>
        </div>
      </div>`;

    $('btn-buy-freeze').addEventListener('click', () => {
      if (atMax) { _showShopToast('MAX FREEZES REACHED'); return; }
      const coins = state.user.coins || 0;
      if (coins < freezePrice) { _showShopToast('NOT ENOUGH COINS'); return; }
      forgeConfirm(`Buy Streak Freeze for ◎ ${freezePrice}?`, () => {
        state.user.coins -= freezePrice;
        state.user.streak.freezesAvailable = (state.user.streak.freezesAvailable || 0) + 1;
        saveState();
        Sound.xpGain();
        renderShop();
        renderDashboard();
        _showShopToast('STREAK FREEZE ACQUIRED');
      });
    });
  }

  let _toastTimer = null;
  function _showShopToast(msg) {
    const toast = $('shop-toast');
    toast.textContent = msg;
    toast.classList.add('visible');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => toast.classList.remove('visible'), 2000);
  }

  // ══════════════════════════════════════════
  // WEEKLY SUMMARY
  // ══════════════════════════════════════════

  // Get ISO week string 'YYYY-WNN' for a given date
  function _weekStr(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    const wn = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    return `${d.getFullYear()}-W${String(wn).padStart(2,'0')}`;
  }

  // Should we show the summary today?
  function _shouldShowSummary() {
    // Dev override — set localStorage.__forgeSummaryTest = '1' in console then refresh
    if (localStorage.getItem('__forgeSummaryTest') === '1') {
      localStorage.removeItem('__forgeSummaryTest'); // auto-clear after one use
      return true;
    }

    const today     = new Date();
    const todayDow  = today.getDay(); // 0=Sun
    const summaryDow = state.settings.summaryDay ?? 0;
    if (todayDow !== summaryDow) return false;

    // Check if we already showed this week's summary
    const thisWeek = _weekStr(today);
    if (state.settings.lastSummaryWeek === thisWeek) return false;

    // Only show if there were sessions last week
    const lastWeekSessions = _getLastWeekSessions();
    return lastWeekSessions.length > 0;
  }

  function _markSummaryShown() {
    state.settings.lastSummaryWeek = _weekStr(new Date());
    saveState();
  }

  // Get sessions from the previous calendar week (Mon–Sun)
  function _getLastWeekSessions() {
    const today = new Date();
    today.setHours(0,0,0,0);
    // Find last Monday
    const dow = today.getDay();
    const daysToLastMon = dow === 0 ? 6 : dow - 1;
    const lastMon = new Date(today);
    lastMon.setDate(today.getDate() - daysToLastMon - 7);
    const lastSun = new Date(lastMon);
    lastSun.setDate(lastMon.getDate() + 6);
    lastSun.setHours(23,59,59,999);

    return state.sessions.filter(s => {
      if (!s.startTime) return false;
      const d = new Date(s.startTime);
      return d >= lastMon && d <= lastSun;
    });
  }

  function renderWeeklySummary() {
    // In dev test mode, use this week's sessions so there's actual data to show
    let sessions = _getLastWeekSessions();
    if (!sessions.length) sessions = state.sessions.slice(-20); // fallback: last 20
    const today    = new Date();

    // Week label
    const lastMon = new Date(today);
    const dow = today.getDay();
    lastMon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1) - 7);
    const lastSun = new Date(lastMon);
    lastSun.setDate(lastMon.getDate() + 6);

    const wn = _weekStr(lastMon).split('-W')[1];
    $('summary-week-label').textContent =
      `WEEK ${wn} · ${lastMon.toLocaleString('en',{month:'short'}).toUpperCase()} ${lastMon.getDate()} – ${lastSun.toLocaleString('en',{month:'short'}).toUpperCase()} ${lastSun.getDate()}`;

    // Total XP
    const totalXP = sessions.reduce((s,x) => s + (x.xpEarned||0), 0);
    $('summary-hero-xp').textContent = totalXP.toLocaleString();

    // Sessions
    $('sum-sessions').textContent = sessions.length;

    // Hours
    let totalMins = 0;
    sessions.forEach(s => {
      if (s.startTime && s.endTime) {
        totalMins += Math.max(0, Math.round((new Date(s.endTime) - new Date(s.startTime)) / 60000));
      }
    });
    $('sum-hours').textContent = (totalMins / 60).toFixed(1);

    // Tasks completed this week
    const completedTaskIds = new Set(
      sessions.filter(s => s.taskId).map(s => s.taskId)
    );
    const tasksCompleted = state.tasks.filter(t =>
      t.completed && t.completedAt &&
      new Date(t.completedAt) >= lastMon &&
      new Date(t.completedAt) <= lastSun
    ).length;
    $('sum-tasks').textContent = tasksCompleted;

    // Streak
    $('sum-streak').textContent = state.user.streak.current;

    // Best day
    const xpByDay = {};
    sessions.forEach(s => {
      if (!s.startTime) return;
      const ds = _localDateStr(new Date(s.startTime));
      xpByDay[ds] = (xpByDay[ds] || 0) + (s.xpEarned || 0);
    });

    let bestDay = null, bestXP = 0;
    for (const [ds, xp] of Object.entries(xpByDay)) {
      if (xp > bestXP) { bestXP = xp; bestDay = ds; }
    }

    if (bestDay) {
      const bd = new Date(bestDay + 'T12:00:00');
      $('sum-best-day-name').textContent = bd.toLocaleDateString('en',{weekday:'long'}).toUpperCase();
      $('sum-best-day-xp').textContent   = `${bestXP.toLocaleString()} XP`;
      $('summary-best-day-block').classList.remove('hidden');
    } else {
      $('summary-best-day-block').classList.add('hidden');
    }

    // Motivational quote based on performance
    const quotes = [
      sessions.length >= 20 ? 'ELITE OUTPUT. THE FORGE IS HOT.' : null,
      sessions.length >= 10 ? 'SOLID WEEK. KEEP THE FIRE BURNING.' : null,
      sessions.length >= 5  ? 'YOU SHOWED UP. THAT IS EVERYTHING.' : null,
      'EVERY SESSION IS A BRICK. KEEP BUILDING.'
    ].filter(Boolean);
    $('summary-quote').textContent = quotes[0];
  }

  // ══════════════════════════════════════════
  // HISTORY VIEW
  // ══════════════════════════════════════════

  // Track which day is selected in history (dateStr 'YYYY-MM-DD')
  let _historySelectedDay = null;

  function renderHistory() {
    const todayStr = Storage.todayStr();
    if (!_historySelectedDay) _historySelectedDay = todayStr;

    _buildHeatmap(todayStr);
    _renderHistoryStats();
    _renderDayLog(_historySelectedDay);
  }

  // ── Build 16-week heatmap ──
  function _buildHeatmap(todayStr) {
    const grid    = $('heatmap-grid');
    const monthEl = $('heatmap-months');

    // Build a map of dateStr → total XP for all logged sessions
    const xpByDay = {};
    for (const s of state.sessions) {
      if (!s.startTime) continue;
      const d  = new Date(s.startTime);
      const ds = _localDateStr(d);
      xpByDay[ds] = (xpByDay[ds] || 0) + (s.xpEarned || 0);
    }

    // XP intensity thresholds → level 0-4
    function xpLevel(xp) {
      if (!xp || xp === 0) return 0;
      if (xp < 100)        return 1;
      if (xp < 300)        return 2;
      if (xp < 600)        return 3;
      return 4;
    }

    // Start from 16 weeks ago, aligned to Monday
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find most recent Monday on or before (today - 15 weeks)
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 15 * 7);
    // Align to Monday (getDay: 0=Sun,1=Mon...6=Sat)
    const dow = startDate.getDay();
    const daysToMon = dow === 0 ? -6 : 1 - dow;
    startDate.setDate(startDate.getDate() + daysToMon);

    // Total days = 16 weeks = 112 cells
    const totalDays = 16 * 7;

    // Build cells
    const cells    = [];
    const months   = {}; // colIndex → month label
    let   colIndex = 0;

    for (let i = 0; i < totalDays; i++) {
      const date  = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      const ds    = _localDateStr(date);
      const level = xpLevel(xpByDay[ds]);
      const isToday = ds === todayStr;
      const isFuture = date > today;
      const dayOfWeek = date.getDay(); // 0=Sun

      // Track month labels — show at first cell of each month in row 0 (Monday)
      if (dayOfWeek === 1 || i === 0) {
        const monthName = date.toLocaleString('en', { month: 'short' }).toUpperCase();
        const currentCol = Math.floor(i / 7);
        if (currentCol === 0 || date.getDate() <= 7) {
          months[currentCol] = { label: monthName, col: currentCol };
        }
      }

      cells.push({
        ds,
        level: isFuture ? 0 : level,
        isToday,
        isFuture,
        xp: xpByDay[ds] || 0
      });
    }

    // Render grid
    grid.innerHTML = cells.map(c => {
      const classes = [
        'hm-cell',
        c.isToday ? 'is-today' : '',
        c.ds === _historySelectedDay ? 'selected' : ''
      ].filter(Boolean).join(' ');
      return `<div class="${classes}" data-date="${c.ds}" data-level="${c.level}" title="${c.ds} · ${c.xp} XP"></div>`;
    }).join('');

    // Render month labels
    const gridWidth = grid.offsetWidth || 300;
    const colWidth  = (gridWidth / 16); // approx per column
    monthEl.innerHTML = '';
    const seenMonths = new Set();
    cells.forEach((c, i) => {
      if (i % 7 !== 0) return; // only first cell of each column
      const col = i / 7;
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      const mo = date.toLocaleString('en', { month: 'short' }).toUpperCase();
      if (!seenMonths.has(mo)) {
        seenMonths.add(mo);
        const span = document.createElement('span');
        span.className = 'heatmap-month-label';
        span.textContent = mo;
        // Position as percentage of 16 columns
        span.style.left = `${(col / 16) * 100}%`;
        monthEl.appendChild(span);
      }
    });

    // Bind cell clicks
    grid.querySelectorAll('.hm-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        grid.querySelectorAll('.hm-cell').forEach(c => c.classList.remove('selected'));
        cell.classList.add('selected');
        _historySelectedDay = cell.dataset.date;
        _renderDayLog(_historySelectedDay);
      });
    });
  }

  // ── All-time stats strip ──
  function _renderHistoryStats() {
    let totalXP       = 0;
    let totalMins     = 0;
    let bestDayXP     = 0;
    const xpByDay     = {};

    for (const s of state.sessions) {
      totalXP  += s.xpEarned || 0;
      // Derive duration from startTime/endTime
      if (s.startTime && s.endTime) {
        const mins = Math.round((new Date(s.endTime) - new Date(s.startTime)) / 60000);
        totalMins += Math.max(0, mins);
      }
      if (s.startTime) {
        const ds = _localDateStr(new Date(s.startTime));
        xpByDay[ds] = (xpByDay[ds] || 0) + (s.xpEarned || 0);
      }
    }

    for (const xp of Object.values(xpByDay)) {
      if (xp > bestDayXP) bestDayXP = xp;
    }

    const totalHours = (totalMins / 60).toFixed(1);

    $('hist-total-hours').textContent    = totalHours;
    $('hist-total-sessions').textContent = state.sessions.length;
    $('hist-total-xp').textContent       = totalXP.toLocaleString();
    $('hist-best-day').textContent       = bestDayXP.toLocaleString();
  }

  // ── Session log for selected day ──
  function _renderDayLog(dateStr) {
    const labelEl = $('history-day-label');
    const xpEl    = $('history-day-xp');
    const listEl  = $('history-session-list');

    // Format label
    const d       = new Date(dateStr + 'T12:00:00');
    const todayStr = Storage.todayStr();
    const yest     = new Date();
    yest.setDate(yest.getDate() - 1);
    const yestStr  = _localDateStr(yest);

    let label;
    if (dateStr === todayStr) label = 'TODAY';
    else if (dateStr === yestStr) label = 'YESTERDAY';
    else label = d.toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase();

    labelEl.textContent = label;

    // Filter sessions for this day
    const daySessions = state.sessions.filter(s => {
      if (!s.startTime) return false;
      return _localDateStr(new Date(s.startTime)) === dateStr;
    }).sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    // Total XP for day
    const dayXP = daySessions.reduce((sum, s) => sum + (s.xpEarned || 0), 0);
    xpEl.textContent = dayXP > 0 ? `+${dayXP} XP` : '';

    if (!daySessions.length) {
      listEl.innerHTML = `<div class="history-empty">No sessions recorded for this day.</div>`;
      return;
    }

    listEl.innerHTML = daySessions.map(s => {
      // Task name
      const task     = state.tasks.find(t => t.id === s.taskId);
      const taskName = task ? task.text : (s.intention || 'SESSION');

      // Duration
      let durStr = '—';
      if (s.startTime && s.endTime) {
        const mins = Math.round((new Date(s.endTime) - new Date(s.startTime)) / 60000);
        durStr = mins >= 60
          ? `${Math.floor(mins/60)}h ${mins%60}m`
          : `${mins}m`;
      }

      // Time of day
      const timeStr = s.startTime
        ? new Date(s.startTime).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
        : '';

      return `
        <div class="hist-session-card">
          <div class="hist-session-task">${escHtml(taskName.toUpperCase())}</div>
          <div class="hist-session-xp">+${s.xpEarned || 0}</div>
          <div class="hist-session-meta">${durStr}</div>
          <div class="hist-session-time">${timeStr}</div>
        </div>`;
    }).join('');
  }

  // ── Local date string (YYYY-MM-DD) from a Date object ──
  // Uses local time, not UTC — same logic as storage.js todayStr()
  function _localDateStr(date) {
    const y  = date.getFullYear();
    const m  = String(date.getMonth() + 1).padStart(2, '0');
    const d  = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function renderSettings() {
    // Sync summary day picker to saved setting
    const savedDay = state.settings.summaryDay ?? 0;
    document.querySelectorAll('.summary-day-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.day) === savedDay);
    });

    _tempSettings.work  = state.settings.workMinutes;
    _tempSettings.brk   = state.settings.breakMinutes;
    _tempSettings.sound = state.settings.soundEnabled !== false;

    $('display-work-minutes').textContent  = _tempSettings.work;
    $('display-break-minutes').textContent = _tempSettings.brk;
    $('config-work').textContent           = state.settings.workMinutes;
    $('config-break').textContent          = state.settings.breakMinutes;

    updateSoundToggleUI();
    syncActivePreset();
  }

  function updateSoundToggleUI() {
    const btn = $('btn-sound-toggle');
    const lbl = $('sound-toggle-label');
    if (_tempSettings.sound) {
      btn.classList.remove('off');
      lbl.textContent = 'ON';
    } else {
      btn.classList.add('off');
      lbl.textContent = 'OFF';
    }
  }

  function syncActivePreset() {
    const presets = [
      { work: 25, brk: 5 },
      { work: 50, brk: 10 },
      { work: 90, brk: 20 },
    ];
    document.querySelectorAll('.preset-btn').forEach((btn, i) => {
      const match = presets[i].work === _tempSettings.work && presets[i].brk === _tempSettings.brk;
      btn.classList.toggle('active', match);
    });
  }

  // ══════════════════════════════════════════
  // EVENTS
  // ══════════════════════════════════════════
  function bindEvents() {

    // ── ONBOARDING / AUTH ──
    const gBtn = $('btn-google-signin');
    if (gBtn) gBtn.addEventListener('click', async () => {
      gBtn.disabled = true;
      $('auth-loading').classList.remove('hidden');
      const errEl = $('google-signin-error');
      if (errEl) errEl.classList.add('hidden');

      const result = await FB.signInWithGoogle();

      if (!result.ok && !result.pending) {
        $('auth-loading').classList.add('hidden');
        gBtn.disabled = false;
        showAuthLoading(false);
        if (errEl) {
          errEl.textContent = result.error || 'Sign-in failed.';
          errEl.classList.remove('hidden');
        }
      }
    });

    // Offline mode buttons (new)
    const offBtn = $('btn-offline-enter');
    if (offBtn) offBtn.addEventListener('click', () => {
      Sound.click();
      enterOfflineMode();
    });
    const skipBtn = $('btn-skip-auth');
    if (skipBtn) skipBtn.addEventListener('click', () => {
      Sound.click();
      enterOfflineMode();
    });
    const offlineNameInput = $('input-offline-name');
    const offlineStartBtn = $('btn-offline-start');
    if (offlineNameInput && offlineStartBtn) {
      offlineStartBtn.addEventListener('click', () => {
        const v = offlineNameInput.value.trim();
        Sound.click();
        enterOfflineMode(v || 'OPERATIVE');
      });
      offlineNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const v = offlineNameInput.value.trim();
          enterOfflineMode(v || 'OPERATIVE');
        }
      });
    }

    // ── DASHBOARD ──
    $('btn-start-session').addEventListener('click', openIntention);
    // ── NAV DRAWER ──
    function openDrawer() {
      Sound.click();
      $('nav-drawer').classList.add('open');
      $('drawer-backdrop').classList.remove('hidden');
      requestAnimationFrame(() => $('drawer-backdrop').classList.add('visible'));
    }

    function closeDrawer() {
      $('nav-drawer').classList.remove('open');
      $('drawer-backdrop').classList.remove('visible');
      setTimeout(() => $('drawer-backdrop').classList.add('hidden'), 250);
    }

    // ── MODE SWITCHER ──
    function switchToForge() {
      // Update both switchers (dashboard + plan view)
      ['mode-forge', 'plan-mode-forge'].forEach(id => $$(id) && $$(id).classList.add('active'));
      ['mode-plan',  'plan-mode-plan' ].forEach(id => $$(id) && $$(id).classList.remove('active'));
      setRailNav('dashboard');
      showView('dashboard');
      renderDashboard();
    }
    function switchToPlan() {
      ['mode-plan',  'plan-mode-plan' ].forEach(id => $$(id) && $$(id).classList.add('active'));
      ['mode-forge', 'plan-mode-forge'].forEach(id => $$(id) && $$(id).classList.remove('active'));
      setRailNav('plan');
      renderPlanMode();
      showView('plan');
    }
    // $$ = safe getElementById (no throw if missing)
    function $$(id) { return document.getElementById(id); }

    $('mode-forge').addEventListener('click', switchToForge);
    $('mode-plan').addEventListener('click', switchToPlan);
    $('plan-mode-forge') && $('plan-mode-forge').addEventListener('click', switchToForge);
    $('plan-mode-plan')  && $('plan-mode-plan').addEventListener('click', switchToPlan);

    $('btn-open-drawer').addEventListener('click', openDrawer);
    $('btn-close-drawer').addEventListener('click', closeDrawer);
    $('drawer-backdrop').addEventListener('click', closeDrawer);

    $('drawer-tasks').addEventListener('click', () => {
      closeDrawer();
      setTimeout(() => { renderTaskList(); showView('tasks'); }, 200);
    });

    $('drawer-history').addEventListener('click', () => {
      closeDrawer();
      setTimeout(() => { renderHistory(); showView('history'); }, 200);
    });

    $('drawer-shop').addEventListener('click', () => {
      closeDrawer();
      setTimeout(() => { renderShop(); showView('shop'); }, 200);
    });

    $('drawer-settings').addEventListener('click', () => {
      closeDrawer();
      setTimeout(() => { renderSettings(); renderAccountInfo(); showView('settings'); }, 200);
    });

    // PLAN reachable from drawer on mobile (top-bar mode-switcher moved to rail)
    $('drawer-plan') && $('drawer-plan').addEventListener('click', () => {
      closeDrawer();
      setTimeout(() => switchToPlan(), 200);
    });

    // ── RAIL NAV (desktop sidebar) ──
    // Highlights the active rail item; function-declaration-hoisted so switchTo* can call it.
    function setRailNav(view) {
      const map = {
        dashboard: 'mode-forge', plan: 'mode-plan',
        tasks: 'rail-tasks', history: 'rail-history',
        shop: 'rail-shop', settings: 'rail-settings'
      };
      const activeId = map[view];
      ['mode-forge','mode-plan','rail-tasks','rail-history','rail-shop','rail-settings']
        .forEach(id => {
          const el = document.getElementById(id);
          if (el) el.classList.toggle('active', id === activeId);
        });
    }

    $('rail-tasks') && $('rail-tasks').addEventListener('click', () => {
      renderTaskList(); showView('tasks'); setRailNav('tasks');
    });
    $('rail-history') && $('rail-history').addEventListener('click', () => {
      renderHistory(); showView('history'); setRailNav('history');
    });
    $('rail-shop') && $('rail-shop').addEventListener('click', () => {
      renderShop(); showView('shop'); setRailNav('shop');
    });
    $('rail-settings') && $('rail-settings').addEventListener('click', () => {
      renderSettings(); renderAccountInfo(); showView('settings'); setRailNav('settings');
    });

    // ── COLLAPSIBLE RAIL (desktop sidebar) ──
    $('btn-toggle-rail') && $('btn-toggle-rail').addEventListener('click', toggleRail);

    // Keep old btn-open-tasks as fallback (no longer in UI but safe to keep)
    $('btn-open-tasks') && $('btn-open-tasks').addEventListener('click', () => {
      renderTaskList();
      showView('tasks');
    });

    // Track selected pillar for task add (outer renderPillarChips now exists)
    _selectedPillar = (state.pillars && state.pillars[0]) ? state.pillars[0].id : 'other';
    renderPillarChips();

    $('btn-add-task').addEventListener('click', addTask);
    $('input-task').addEventListener('keydown', e => {
      if (e.key === 'Enter') addTask();
    });

    // Quick-add collapse toggle
    $('btn-toggle-quick-add').addEventListener('click', () => {
      const form   = $('quick-add-form');
      const toggle = $('btn-toggle-quick-add');
      const hidden = form.classList.toggle('hidden');
      toggle.textContent = hidden ? '+ ADD QUEST' : '− COLLAPSE';
      if (!hidden) $('input-task').focus();
    });

    // Difficulty buttons
    document.querySelectorAll('.diff-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedDifficulty = parseFloat(btn.dataset.diff);
      });
    });

    // ── INTENTION ──
    // ── INTENTION — session timer picker ──
    document.querySelectorAll('.session-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.session-preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        sessionContext.sessionMinutes = parseInt(btn.dataset.mins);
        $('input-custom-mins').value = '';
        Sound.click();
      });
    });

    $('input-custom-mins').addEventListener('input', () => {
      const val = parseInt($('input-custom-mins').value);
      if (val >= 5 && val <= 180) {
        sessionContext.sessionMinutes = val;
        document.querySelectorAll('.session-preset-btn').forEach(b => b.classList.remove('active'));
      }
    });

    $('btn-switch-task').addEventListener('click', () => {
      const switcher = $('task-switcher');
      if (switcher.classList.contains('hidden')) {
        openSwitcher();
      } else {
        closeSwitcher();
      }
    });

    $('btn-intention-confirm').addEventListener('click', startSession);
    $('btn-intention-cancel').addEventListener('click', () => {
      closeSwitcher();
      showView('dashboard');
    });

    $('input-intention').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        startSession();
      }
    });

    // ── SESSION ──
    $('btn-complete-session').addEventListener('click', () => {
      completeSession(true);
    });

    $('btn-hold-session').addEventListener('click', () => {
      Sound.click();
      Timer.hold((holdRemain) => {
        const { mm, ss } = Timer.format(holdRemain);
        $('hold-countdown').textContent = `${mm}:${ss}`;
        // Auto-dismiss overlay when hold timer expires
        if (holdRemain <= 0) {
          $('hold-overlay').classList.add('hidden');
          $('session-controls').classList.remove('hidden');
        }
      });
      $('hold-overlay').classList.remove('hidden');
      $('session-controls').classList.add('hidden');
    });

    $('btn-resume-session').addEventListener('click', () => {
      Sound.click();
      Timer.resume();
      $('hold-overlay').classList.add('hidden');
      $('session-controls').classList.remove('hidden');
    });

    $('btn-abandon-session').addEventListener('click', () => {
      forgeConfirm('Abandon this session? No XP will be earned.', () => {
        completeSession(false);
      });
    });

    // ── MID-SESSION PLAN DRAWER ──
    $('btn-open-plan-drawer').addEventListener('click', () => {
      Sound.click();
      openPlanDrawer();
    });

    $('btn-close-plan-drawer').addEventListener('click', () => {
      Sound.click();
      closePlanDrawer();
    });

    $('plan-drawer-backdrop').addEventListener('click', () => {
      closePlanDrawer();
    });

    $('btn-drawer-add-task').addEventListener('click', () => {
      addTaskFromDrawer();
    });

    $('drawer-task-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addTaskFromDrawer();
    });

    // Difficulty pill selection inside drawer
    document.querySelectorAll('.drawer-diff-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _drawerDifficulty = parseFloat(btn.dataset.mult);
        document.querySelectorAll('.drawer-diff-btn').forEach(b =>
          b.classList.toggle('active', b === btn)
        );
      });
    });

    // ── REWARD — task decision ──
    $('btn-task-done').addEventListener('click', () => {
      const task = state.tasks.find(t => t.id === sessionContext.taskId);
      if (!task) { startBreak(); return; }

      // Calculate and apply task completion bonus XP
      const taskXP = XP.calculateTaskXP(task.xpMultiplier || 1.0);
      const { updatedUser } = XP.applyXP(state.user, taskXP);
      state.user = updatedUser;

      // Mark task complete
      markTaskComplete(sessionContext.taskId);

      // Show the bonus XP on reward screen before going to break
      $('task-bonus-xp-val').textContent = taskXP;
      $('task-bonus-display').classList.remove('hidden');
      $('task-decision').classList.add('hidden');

      Sound.xpGain();
      saveState();
      renderDashboard();

      // Short pause so user sees the bonus, then go to break
      setTimeout(() => {
        $('task-bonus-display').classList.add('hidden');
        $('task-decision').classList.remove('hidden');
        startBreak();
      }, 1500);
    });

    $('btn-task-continue').addEventListener('click', () => {
      // Keep task active, go to break, come back to same task
      startBreak();
    });

    // ── BREAK ──
    $('btn-skip-break').addEventListener('click', () => {
      Timer.stop();
      showView('dashboard');
      renderDashboard();
    });

    // ── TASK LIST ──
    $('btn-tasks-back').addEventListener('click', () => {
      showView('dashboard');
      renderDashboard();
    });

    // ── TASK QUEUE QUICK-ADD ──
    // The queue is the task INVENTORY, so it must be possible to add work
    // here without first drilling into a goal.
    function _tqAdd() {
      const input = $('tq-input');
      const text  = input.value.trim();
      if (!text) { input.focus(); return; }

      const goalId = $('tq-goal').value || null;
      const goal   = goalId ? getGoalById(goalId) : null;

      state.tasks.push(Object.assign(Storage.taskDefaults(), {
        id:               Storage.uuid(),
        text,
        tag:              goal ? goal.pillarId : (_selectedPillar || 'other'),
        goalId:           goalId,
        estimatedMinutes: Math.max(5, parseInt($('tq-mins').value, 10) || 60),
        completed:        false,
        xpMultiplier:     1.0,
        createdAt:        new Date().toISOString(),
        completedAt:      null
      }));

      saveState();
      input.value = '';
      input.focus();
      Sound.taskAdded();
      showToast('TASK QUEUED ✓', 'success');
      renderTaskList();
      renderDashboard();
      _refreshPlanPanels();
    }

    $('tq-add-btn').addEventListener('click', _tqAdd);
    $('tq-input').addEventListener('keydown', e => { if (e.key === 'Enter') _tqAdd(); });

    // ── SETTINGS ──
    // ── PLAN MODE ──
    // Two surfaces only: OBJECTIVES and CALENDAR. Everything else that
    // used to live here (pillar tab, goals tab, THIS WEEK board, TASKS
    // duplicate, week form, mobile move sheet) was removed with the
    // artificial-week model.
    if (window.Plan) Plan.bind(_planContext());

    $('btn-settings-back').addEventListener('click', () => {
      showView('dashboard');
      renderDashboard();
    });

    // ── PLAN MODE FORM ──
    $('btn-add-pillar').addEventListener('click', () => {
      renderPillarForm(null);
      $('pillar-form').classList.remove('hidden');
      $('btn-add-pillar').classList.add('hidden');
    });

    $('btn-pillar-cancel').addEventListener('click', () => {
      $('pillar-form').classList.add('hidden');
      $('btn-add-pillar').classList.remove('hidden');
    });

    $('btn-pillar-save').addEventListener('click', () => {
      const name = $('pillar-name-input').value.trim().toUpperCase();
      if (!name) { _showShopToast('ENTER A NAME'); return; }
      if (!state.pillars) state.pillars = [];

      if (_editingPillarIdx !== null) {
        // Edit existing
        state.pillars[_editingPillarIdx].name  = name;
        state.pillars[_editingPillarIdx].color = _selectedColor;
        state.pillars[_editingPillarIdx].icon  = _selectedIcon;
      } else {
        // Add new
        const id = name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now();
        state.pillars.push({ id, name, color: _selectedColor, icon: _selectedIcon });
      }
      saveState();
      $('pillar-form').classList.add('hidden');
      $('btn-add-pillar').classList.remove('hidden');
      renderPlanMode();
      renderPillarChips();
      Sound.click();
    });

    $('btn-shop-back').addEventListener('click', () => {
      Sound.click();
      showView('dashboard');
      renderDashboard();
    });

    $('btn-history-back').addEventListener('click', () => {
      Sound.click();
      showView('dashboard');
    });

    $('btn-summary-dismiss').addEventListener('click', () => {
      Sound.click();
      showView('dashboard');
      renderDashboard();
    });

    // Summary day picker
    document.querySelectorAll('.summary-day-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.summary-day-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.settings.summaryDay = parseInt(btn.dataset.day);
      });
    });

    $('btn-settings-save').addEventListener('click', () => {
      Sound.click();
      state.settings.workMinutes  = _tempSettings.work;
      state.settings.breakMinutes = _tempSettings.brk;
      Sound.setEnabled(_tempSettings.sound);
      state.settings.soundEnabled = _tempSettings.sound;
      saveState();
      // Update active config display immediately
      $('config-work').textContent  = state.settings.workMinutes;
      $('config-break').textContent = state.settings.breakMinutes;
      flashElement($('btn-settings-save'), '✓ SAVED');
    });

    // Preset buttons
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        Sound.click();
        _tempSettings.work = parseInt(btn.dataset.work);
        _tempSettings.brk  = parseInt(btn.dataset.break);
        $('display-work-minutes').textContent  = _tempSettings.work;
        $('display-break-minutes').textContent = _tempSettings.brk;
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // +/- buttons for work time
    $('btn-work-minus').addEventListener('click', () => {
      if (_tempSettings.work > 5) {
        _tempSettings.work -= 5;
        $('display-work-minutes').textContent = _tempSettings.work;
        Sound.click();
        syncActivePreset();
      }
    });
    $('btn-work-plus').addEventListener('click', () => {
      if (_tempSettings.work < 180) {
        _tempSettings.work += 5;
        $('display-work-minutes').textContent = _tempSettings.work;
        Sound.click();
        syncActivePreset();
      }
    });

    // +/- buttons for break time
    $('btn-break-minus').addEventListener('click', () => {
      if (_tempSettings.brk > 1) {
        _tempSettings.brk -= 1;
        $('display-break-minutes').textContent = _tempSettings.brk;
        Sound.click();
        syncActivePreset();
      }
    });
    $('btn-break-plus').addEventListener('click', () => {
      if (_tempSettings.brk < 60) {
        _tempSettings.brk += 1;
        $('display-break-minutes').textContent = _tempSettings.brk;
        Sound.click();
        syncActivePreset();
      }
    });

    // Sound toggle
    $('btn-sound-toggle').addEventListener('click', () => {
      _tempSettings.sound = !_tempSettings.sound;
      updateSoundToggleUI();
      if (_tempSettings.sound) Sound.click();
    });

    // Test sound
    $('btn-test-sound').addEventListener('click', () => {
      Sound.setEnabled(true);
      Sound.sessionComplete();
    });

    // ── ACCOUNT MANAGEMENT ──

    // Change name
    $('btn-change-name').addEventListener('click', async () => {
      const newName = $('input-change-name').value.trim();
      if (!newName) return;
      state.user.name = newName;
      await saveState();
      $('input-change-name').value = '';
      renderDashboard();
      renderAccountInfo();
      flashElement($('btn-change-name'), '✓ SAVED');
      Sound.click();
    });

    // Reset all data
    $('btn-reset-data').addEventListener('click', async () => {
      const confirmed = confirm('RESET ALL DATA?\n\nThis wipes your XP, levels, tasks and streak. Cannot be undone.');
      if (!confirmed) return;
      state = Storage.defaultState();
      await FB.deleteUserData();
      Storage.save(state);
      renderDashboard();
      renderAccountInfo();
      showView('dashboard');
      Sound.abandon();
    });

    // Sign out
    $('btn-signout').addEventListener('click', async () => {
      Timer.stop();
      await FB.signOut();
      state = Storage.defaultState();
      Storage.save(state);
      // onAuthStateChanged fires → shows login screen
    });

    // ── Streak risk check every minute ──
    setInterval(() => {
      if (views.dashboard.classList.contains('active')) {
        const chip = $('streak-chip');
        if (XP.isStreakAtRisk(state.user.streak)) {
          chip.classList.add('at-risk');
        } else {
          chip.classList.remove('at-risk');
        }
      }
    }, 60000);
  }

  // ══════════════════════════════════════════
  // UTILS
  // ══════════════════════════════════════════
  function escHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  let _toastTimer2 = null;
  function showToast(msg, type = '', duration = 2000) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = 'toast' + (type ? ' ' + type : '');
    void toast.offsetWidth; // restart the transition
    toast.classList.add('visible');
    if (_toastTimer2) clearTimeout(_toastTimer2);
    _toastTimer2 = setTimeout(() => toast.classList.remove('visible'), duration);
  }

  function flashElement(el, text) {
    if (!el) return;
    // overlay a flash label WITHOUT destroying the element's real content
    el.querySelector('.flash-label')?.remove();
    el.classList.add('flash-host'); // position: relative so the overlay anchors here
    const flash = document.createElement('span');
    flash.className = 'flash-label';
    flash.textContent = text;
    el.appendChild(flash);
    requestAnimationFrame(() => flash.classList.add('show'));
    setTimeout(() => {
      flash.classList.remove('show');
      setTimeout(() => {
        flash.remove();
        el.classList.remove('flash-host');
      }, 300);
    }, 1200);
  }

  function renderAccountInfo() {
    const user = FB.getCurrentUser();
    $('account-name-display').textContent  = state.user.name || '—';
    $('account-email-display').textContent = user ? user.email : '—';
    $('account-sync-status').textContent   = FB.isSignedIn() ? '● LIVE' : '○ OFFLINE';
  }

  // ══════════════════════════════════════════
  // BOOT
  // ══════════════════════════════════════════
  document.addEventListener('DOMContentLoaded', init);

})();
