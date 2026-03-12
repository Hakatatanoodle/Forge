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
  }

  // ══════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════
  function init() {
    bindEvents();
    // NOTE: checkDayReset() is NOT called here — it runs inside
    // onAuthStateChanged AFTER cloud state loads. Calling it here
    // would reset today's counter against local state, which then
    // gets overwritten by Firestore, throwing the reset away.
    FB.init(onAuthStateChanged);
  }

  // ── Called by Firebase when auth state is known ──
  async function onAuthStateChanged(user) {
    if (!user) {
      showView('onboarding');
      return;
    }

    showAuthLoading(true);

    const result = await FB.loadState();

    if (result.ok && result.state) {
      // Returning user — load their cloud data
      const base = Storage.defaultState();
      state = Storage.deepMerge(base, result.state);
      // checkDayReset runs HERE — after cloud state is loaded.
      // Running it before this point means Firestore overwrites
      // the reset and today's counter never actually clears.
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
      await saveState();
    }

    Sound.setEnabled(state.settings.soundEnabled !== false);
    // Migrate old hardcoded tags → pillar ids
    const TAG_MIGRATE = { finals: 'academics', game: 'gamedev', urgent: 'academics' };
    state.tasks.forEach(t => { if (TAG_MIGRATE[t.tag]) t.tag = TAG_MIGRATE[t.tag]; });
    saveState();
    applyTheme(state.user.activeTheme || 'forge');
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

  function showAuthLoading(show) {
    const loading = $('auth-loading');
    const btn     = $('btn-google-signin');
    if (!loading || !btn) return;
    if (show) {
      loading.classList.remove('hidden');
      btn.classList.add('hidden');
    } else {
      loading.classList.add('hidden');
      btn.classList.remove('hidden');
      btn.disabled = false;
    }
  }

  // ── Save locally AND to cloud ──
  async function saveState() {
    Storage.save(state);
    await FB.saveState(state);
  }
  function checkDayReset() {
    const today = Storage.todayStr();

    // ── ONE-TIME MIGRATION ──
    // Old code used toISOString() (UTC) to save lastActiveDate.
    // New code uses local date. For Nepal (UTC+5:45) these can differ —
    // the saved date may be one day behind the real local date.
    // If lastActiveDate equals yesterday-in-UTC (i.e. today in local),
    // we correct it forward so the streak comparison works properly.
    // This block only fires once — after correction the dates will match.
    const streak = state.user.streak;
    if (streak.lastActiveDate) {
      const utcToday = new Date().toISOString().split('T')[0];
      // If saved date matches UTC today but local today is different,
      // the date was saved under old UTC logic — correct it to local.
      if (streak.lastActiveDate === utcToday && utcToday !== today) {
        state.user.streak.lastActiveDate = today;
      }
    }

    if (state.today.date !== today) {
      state.today = { date: today, sessionsCompleted: 0 };
      saveState();
    }
  }

  // ══════════════════════════════════════════
  // RENDER DASHBOARD
  // ══════════════════════════════════════════
  function renderDashboard() {
    const { user, tasks, today } = state;

    // User info
    const activeTheme = state.user.activeTheme || 'forge';
    const themeRanks = THEME_RANKS[activeTheme];
    $('display-rank').textContent = (themeRanks && themeRanks[user.rank])
      ? themeRanks[user.rank]
      : user.rank;
    $('display-name').textContent  = user.name.toUpperCase();
    $('display-level').textContent = user.level;

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

    // Active goal indicator — show most urgent active goal
    const indicator = $('sprint-indicator');
    if (indicator) {
      const activeGoals = (state.goals || []).filter(g => g.status === 'active');
      if (activeGoals.length) {
        // Pick the one with nearest deadline
        const sorted = activeGoals.slice().sort((a,b) => {
          if (!a.deadline) return 1;
          if (!b.deadline) return -1;
          return new Date(a.deadline) - new Date(b.deadline);
        });
        const g = sorted[0];
        const goalTasks = (state.tasks || []).filter(t => t.goalId === g.id);
        const done  = goalTasks.filter(t => t.completed).length;
        const total = goalTasks.length;
        $('sprint-indicator-text').textContent = g.title.length > 45 ? g.title.substring(0,45)+'…' : g.title;
        $('sprint-indicator-progress').textContent = total ? `${done}/${total} tasks` : 'No tasks yet';
        indicator.classList.remove('hidden');
      } else {
        indicator.classList.add('hidden');
      }
    }

    // Coins
    $('display-coins').textContent = user.coins || 0;

    // Stats
    $('stat-sessions').textContent       = user.totalSessions;
    $('stat-today').textContent          = today.sessionsCompleted;
    $('stat-streak-longest').textContent = user.streak.longest;

    // Current task (first incomplete, prioritizing urgent > finals > game > other)
    const nextTask = getNextTask(tasks);
    renderCurrentTask(nextTask);
  }

  // ── Priority sort: urgent > finals > game > other ──
  // Pillar priority — derived from state.pillars order
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
      return;
    }

    const pillar = getPillarById(task.tag);
    display.innerHTML = `
      <div class="task-display-content">
        <span class="task-tag-badge" style="background:${pillar.color}22;color:${pillar.color};border:1px solid ${pillar.color}44">${pillar.icon} ${pillar.name}</span>
        ${escHtml(task.text)}
      </div>`;

    startBtn.disabled = false;
    sessionContext.taskId = task.id;
    sessionContext.difficultyMultiplier = task.xpMultiplier || 1.0;
  }

  // ══════════════════════════════════════════
  // TASK MANAGEMENT
  // ══════════════════════════════════════════
  let selectedDifficulty = 1.0;
  let _selectedPillar = 'other'; // set properly after state loads

  function addTask() {
    const input = $('input-task');
    const text  = input.value.trim();
    if (!text) return;

    const tag = _selectedPillar || 'other';

    const task = {
      id:             Storage.uuid(),
      text,
      tag,
      goalId:         null,
      weekId:         null,
      completed:      false,
      xpMultiplier:   selectedDifficulty,
      createdAt:      new Date().toISOString(),
      completedAt:    null
    };

    state.tasks.push(task);
    saveState();

    input.value = '';
    renderDashboard();
    Sound.taskAdded();
    flashElement($('btn-add-task'), 'Task added!');
  }

  function deleteTask(id) {
    state.tasks = state.tasks.filter(t => t.id !== id);
    saveState();
    renderTaskList();
    renderDashboard();
  }

  function markTaskComplete(id) {
    const task = state.tasks.find(t => t.id === id);
    if (task) {
      task.completed   = true;
      task.completedAt = new Date().toISOString();
      saveState();
    }
  }

  function getPillarById(id) {
    return (state.pillars || []).find(p => p.id === id) || { name: id.toUpperCase(), color: '#888880', icon: '◎' };
  }

  function renderTaskList() {
    const list = $('task-list');
    const tasks = state.tasks;

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
        renderTaskList();
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

    $('input-intention').value = '';

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

    // Reset and render goal selector
    sessionContext.goalId = null;
    _renderGoalSelector(task ? task.tag : null);

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
        .map(t => `
          <div class="task-switcher-item ${t.id === sessionContext.taskId ? 'is-selected' : ''}"
               data-task-id="${t.id}">
            <span class="task-tag-badge ${t.tag}">${t.tag.toUpperCase()}</span>
            ${escHtml(t.text)}
          </div>`)
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

  // Step 2: Lock in intention → start session
  function startSession() {
    const intention = $('input-intention').value.trim();
    if (!intention) {
      $('input-intention').focus();
      $('input-intention').placeholder = 'This is required. Be specific.';
      return;
    }

    sessionContext.intention  = intention;
    sessionContext.startTime  = new Date().toISOString();
    // goalId already set by _renderGoalSelector selection

    const task = state.tasks.find(t => t.id === sessionContext.taskId);

    $('session-task-label').textContent        = task ? task.text : '—';
    $('session-intention-display').textContent = intention;
    $('session-mode-label').textContent        = 'FOCUS';

    // Make sure hold overlay is hidden when session starts
    $('hold-overlay').classList.add('hidden');
    $('session-controls').classList.remove('hidden');

    showView('session');
    Sound.sessionStart();

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
    const newStreak = XP.updateStreak(updatedUser.streak, Storage.todayStr());
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
    showReward(xpResult, levelsGained, newLevel, rankChanged, newRank, newStreak);
  }

  // ══════════════════════════════════════════
  // REWARD SCREEN
  // ══════════════════════════════════════════
  function showReward(xpResult, levelsGained, newLevel, rankChanged, newRank, newStreak) {
    $('reward-xp').textContent         = xpResult.total;
    $('reward-streak').textContent     = newStreak.current;
    $('reward-total').textContent      = state.user.totalSessions;
    $('reward-coins-total').textContent = state.user.coins || 0;

    // Coins earned
    if (xpResult.coinsEarned > 0) {
      $('reward-coins').textContent = xpResult.coinsEarned;
      $('reward-coins-earned').classList.remove('hidden');
    } else {
      $('reward-coins-earned').classList.add('hidden');
    }

    // Bonus label
    const bonusEl = $('reward-bonus-label');
    if (xpResult.bonusTriggered) {
      bonusEl.textContent = `⚡ FOCUS BONUS +${xpResult.bonus} XP`;
      bonusEl.classList.remove('hidden');
    } else {
      bonusEl.classList.add('hidden');
    }

    // Level up
    const levelupEl = $('levelup-banner');
    if (levelsGained > 0) {
      $('levelup-new-level').textContent = newLevel;
      levelupEl.classList.remove('hidden');
    } else {
      levelupEl.classList.add('hidden');
    }

    // Rank change
    const rankEl = $('reward-rank-change');
    if (rankChanged) {
      rankEl.textContent = `▲ RANK UP → ${newRank}`;
      rankEl.classList.remove('hidden');
    } else {
      rankEl.classList.add('hidden');
    }

    showView('reward');

    // Play sounds after view transition
    setTimeout(() => {
      if (levelsGained > 0) {
        Sound.levelUp();
      } else if (xpResult.bonusTriggered) {
        Sound.focusBonus();
      } else {
        Sound.sessionComplete();
      }
      // XP blip slightly after
      setTimeout(() => Sound.xpGain(), 300);
    }, 150);
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
    'INITIATE':    'ACADEMY',
    'APPRENTICE':  'GENIN',
    'OPERATOR':    'CHUNIN',
    'SPECIALIST':  'JONIN',
    'VETERAN':     'ANBU',
    'ELITE':       'KAGE',
    'COMMANDER':   'HOKAGE',
    'LEGEND':      'LEGEND'
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
      desc: 'Deep navy. Neon pink. Shinobi ranks.'
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
        rankEl.textContent = (tr && tr[baseRank]) ? tr[baseRank] : baseRank;
      }
    }
  }

  // ══════════════════════════════════════════
  // PLAN MODE
  // ══════════════════════════════════════════

  const PILLAR_COLORS = [
    '#e85d04', '#4caf7d', '#7b9de8', '#e040fb',
    '#f0c040', '#ff5252', '#00e676', '#40c4ff',
    '#ff9800', '#b39ddb'
  ];

  // ── Goal selector for intention screen ──
  function _renderGoalSelector(pillarId) {
    const el = $('intention-goal-selector');
    if (!el) return;
    const goals = (state.goals || []).filter(g => g.status === 'active');
    if (!goals.length) {
      el.innerHTML = `<span class="goal-selector-empty">No active goals — add some in PLAN MODE</span>`;
      return;
    }
    const sorted = [
      ...goals.filter(g => g.pillarId === pillarId),
      ...goals.filter(g => g.pillarId !== pillarId)
    ];
    el.innerHTML = `
      <div class="goal-selector-none ${!sessionContext.goalId ? 'selected' : ''}" id="goal-sel-none">NONE</div>
      ${sorted.map(g => {
        const pillar = getPillarById(g.pillarId);
        return `<div class="goal-selector-chip ${sessionContext.goalId === g.id ? 'selected' : ''}"
                     data-goal-id="${g.id}" style="--pillar-color:${pillar.color}">
                  ${pillar.icon} ${escHtml(g.title)}
                </div>`;
      }).join('')}`;
    el.querySelectorAll('.goal-selector-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        sessionContext.goalId = chip.dataset.goalId;
        _renderGoalSelector(pillarId);
      });
    });
    el.querySelector('#goal-sel-none').addEventListener('click', () => {
      sessionContext.goalId = null;
      _renderGoalSelector(pillarId);
    });
  }

  // ── Plan mode state ──
  let _activePillarId  = null;
  let _activeGoalId    = null;
  let _editingGoalId   = null;
  let _editingGoalWeekCount = 4;
  let _goalBeingMoved  = null; // task id being moved (mobile)

  function renderPlanMode() {
    showPlanView('pillars');
    renderPillarList();
    renderPillarForm(null);
  }

  function showPlanView(view) {
    ['pillars','goals','weeks','warroom'].forEach(v => {
      const el = $(`plan-view-${v}`);
      if (el) el.classList.toggle('hidden', v !== view);
    });
    const onPillarsTab = ['pillars','goals','weeks'].includes(view);
    $('plan-tab-pillars').classList.toggle('active', onPillarsTab);
    $('plan-tab-warroom').classList.toggle('active', view === 'warroom');
  }

  function openPillarGoals(pillarId) {
    _activePillarId = pillarId;
    const pillar = getPillarById(pillarId);
    $('goals-pillar-icon').textContent = pillar.icon;
    $('goals-pillar-name').textContent = pillar.name;
    $('goal-form').classList.add('hidden');
    $('btn-add-goal').classList.remove('hidden');
    renderGoalsList();
    showPlanView('goals');
  }

  // ── GOALS ──
  function renderGoalsList() {
    const list  = $('plan-goals-list');
    const goals = (state.goals || []).filter(g => g.pillarId === _activePillarId && g.status !== 'archived');
    if (!goals.length) {
      list.innerHTML = `<div class="plan-empty-state">No goals yet.<br/>Add one below.</div>`;
      return;
    }
    list.innerHTML = goals.map(goal => {
      const pillar   = getPillarById(goal.pillarId);
      const daysLeft = _daysUntil(goal.deadline);
      const isOverdue = daysLeft < 0;
      const tasks    = (state.tasks || []).filter(t => t.goalId === goal.id);
      const done     = tasks.filter(t => t.completed).length;
      const total    = tasks.length;
      const progress = total > 0 ? Math.min(100, Math.round(done/total*100)) : null;

      let deadlineLabel = '';
      if (goal.deadline) {
        if (isOverdue)          deadlineLabel = `<span class="goal-overdue">${Math.abs(daysLeft)}d OVERDUE</span>`;
        else if (daysLeft <= 7) deadlineLabel = `<span class="goal-urgent">${daysLeft}d LEFT</span>`;
        else                    deadlineLabel = `<span class="goal-weeks">${_weeksUntil(goal.deadline)}w LEFT</span>`;
      }

      return `
        <div class="plan-goal-card ${isOverdue ? 'is-overdue' : ''} ${goal.status === 'completed' ? 'is-completed' : ''}"
             data-goal-id="${goal.id}" style="--pillar-color:${pillar.color}">
          <div class="goal-card-top">
            <div class="goal-card-title">${escHtml(goal.title)}</div>
            <div class="goal-card-actions">
              <button class="pillar-action-btn open-weeks-btn" data-id="${goal.id}">PLAN →</button>
              <button class="pillar-action-btn edit-goal" data-id="${goal.id}">EDIT</button>
              ${goal.status !== 'completed'
                ? `<button class="pillar-action-btn complete-goal" data-id="${goal.id}">✓</button>`
                : `<span class="goal-done-badge">DONE</span>`}
              <button class="pillar-action-btn delete delete-goal" data-id="${goal.id}">✕</button>
            </div>
          </div>
          <div class="goal-card-meta">
            ${deadlineLabel}
            <span class="goal-sessions-count">◎ ${done}/${total} tasks</span>
          </div>
          ${progress !== null ? `
          <div class="goal-progress-bar">
            <div class="goal-progress-fill" style="width:${progress}%;background:${pillar.color}"></div>
          </div>` : ''}
        </div>`;
    }).join('');

    list.querySelectorAll('.open-weeks-btn').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); openGoalWeeks(btn.dataset.id); });
    });
    list.querySelectorAll('.edit-goal').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); openGoalForm(btn.dataset.id); });
    });
    list.querySelectorAll('.complete-goal').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        forgeConfirm('Mark goal as complete?', () => {
          const g = state.goals.find(g => g.id === btn.dataset.id);
          if (g) { g.status = 'completed'; saveState(); renderGoalsList(); Sound.levelUp(); }
        });
      });
    });
    list.querySelectorAll('.delete-goal').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        forgeConfirm('Delete this goal?', () => {
          state.goals = state.goals.filter(g => g.id !== btn.dataset.id);
          saveState(); renderGoalsList();
        });
      });
    });
  }

  function openGoalForm(editId) {
    _editingGoalId = editId || null;
    const goal = editId ? state.goals.find(g => g.id === editId) : null;
    $('goal-title-input').value    = goal ? goal.title : '';
    $('goal-deadline-input').value = goal ? (goal.deadline || '') : '';
    _editingGoalWeekCount = goal ? (goal.weekCount || 4) : 4;
    _updateWeekCountDisplay();
    $('goal-form').classList.remove('hidden');
    $('btn-add-goal').classList.add('hidden');
    $('goal-title-input').focus();
  }

  function _updateWeekCountDisplay() {
    $('goal-week-count-display').textContent = `${_editingGoalWeekCount} week${_editingGoalWeekCount !== 1 ? 's' : ''}`;
  }

  function _weeksUntil(dateStr) {
    if (!dateStr) return '?';
    const diff = new Date(dateStr) - new Date();
    return Math.max(0, Math.ceil(diff / (7*24*60*60*1000)));
  }

  function _daysUntil(dateStr) {
    if (!dateStr) return 999;
    const today = new Date(); today.setHours(0,0,0,0);
    const d = new Date(dateStr); d.setHours(0,0,0,0);
    return Math.round((d - today) / (24*60*60*1000));
  }

  // ── WEEKS VIEW ──
  function openGoalWeeks(goalId) {
    _activeGoalId = goalId;
    const goal  = state.goals.find(g => g.id === goalId);
    if (!goal) return;
    $('weeks-goal-title').textContent = goal.title;
    renderWeeksView();
    showPlanView('weeks');
  }

  function renderWeeksView() {
    const goal    = state.goals.find(g => g.id === _activeGoalId);
    if (!goal) return;
    const pillar  = getPillarById(goal.pillarId);
    const weeks   = (state.weeks || []).filter(w => w.goalId === _activeGoalId)
                      .sort((a,b) => a.number - b.number);
    const allTasks = (state.tasks || []).filter(t => t.goalId === _activeGoalId);
    const unassigned = allTasks.filter(t => !t.weekId);

    // Progress pill
    const done  = allTasks.filter(t => t.completed).length;
    const total = allTasks.length;
    $('weeks-goal-progress').textContent = total ? `${done}/${total}` : '';
    $('weeks-goal-progress').style.cssText = total
      ? `background:${pillar.color}22;color:${pillar.color};border:1px solid ${pillar.color}44`
      : '';

    const isMobile = window.innerWidth < 768 || navigator.maxTouchPoints > 0;
    const container = $('weeks-content');

    // Render week columns
    let html = `<div class="weeks-columns">`;

    weeks.forEach(week => {
      const weekTasks = allTasks.filter(t => t.weekId === week.id);
      const wDone = weekTasks.filter(t => t.completed).length;
      html += `
        <div class="week-column ${isMobile ? '' : 'desktop-drop-zone'}" data-week-id="${week.id}"
             id="week-col-${week.id}">
          <div class="week-col-header" style="--pillar-color:${pillar.color}">
            <span class="week-col-label">${escHtml(week.label)}</span>
            <span class="week-col-count">${wDone}/${weekTasks.length}</span>
            <button class="week-delete-btn" data-week-id="${week.id}">✕</button>
          </div>
          <div class="week-tasks-list" id="week-tasks-${week.id}">
            ${renderWeekTasks(weekTasks, week.id, pillar, isMobile)}
          </div>
          <div class="week-add-task-row">
            <input type="text" class="week-task-input text-input" data-week-id="${week.id}"
                   placeholder="Add task..." maxlength="80" />
            <button class="week-task-add-btn" data-week-id="${week.id}">+</button>
          </div>
          ${!isMobile ? `<div class="drop-indicator hidden" id="drop-${week.id}">DROP HERE</div>` : ''}
        </div>`;
    });

    // Unassigned column
    html += `
      <div class="week-column unassigned-col ${isMobile ? '' : 'desktop-drop-zone'}" data-week-id="unassigned"
           id="week-col-unassigned">
        <div class="week-col-header">
          <span class="week-col-label">UNASSIGNED</span>
          <span class="week-col-count">${unassigned.length}</span>
        </div>
        <div class="week-tasks-list" id="week-tasks-unassigned">
          ${renderWeekTasks(unassigned, 'unassigned', pillar, isMobile)}
        </div>
        ${!isMobile ? `<div class="drop-indicator hidden" id="drop-unassigned">DROP HERE</div>` : ''}
      </div>`;

    html += `</div>
      <button class="plan-add-pillar-btn" id="btn-add-week">+ ADD WEEK</button>`;

    container.innerHTML = html;
    _bindWeeksEvents(isMobile, pillar);
  }

  function renderWeekTasks(tasks, weekId, pillar, isMobile) {
    if (!tasks.length) return `<div class="week-empty">No tasks</div>`;
    return tasks.map(task => `
      <div class="week-task-item ${task.completed ? 'is-done' : ''}"
           data-task-id="${task.id}"
           ${!isMobile ? 'draggable="true"' : ''}>
        ${!isMobile ? `<span class="drag-handle">⠿</span>` : ''}
        <span class="week-task-check ${task.completed ? 'checked' : ''}"
              data-task-id="${task.id}">
          ${task.completed ? '✓' : '○'}
        </span>
        <span class="week-task-text">${escHtml(task.text)}</span>
        <div class="week-task-actions">
          ${isMobile ? `<button class="week-task-move-btn" data-task-id="${task.id}" data-week-id="${weekId}">⇄</button>` : ''}
          <button class="week-task-del-btn" data-task-id="${task.id}">✕</button>
        </div>
      </div>`).join('');
  }

  function _bindWeeksEvents(isMobile, pillar) {
    const goal = state.goals.find(g => g.id === _activeGoalId);

    // Add week button
    $('btn-add-week').addEventListener('click', () => {
      const weeks = (state.weeks || []).filter(w => w.goalId === _activeGoalId);
      const num   = weeks.length + 1;
      if (!state.weeks) state.weeks = [];
      state.weeks.push({ id: Storage.uuid(), goalId: _activeGoalId, number: num, label: `WEEK ${num}` });
      saveState(); renderWeeksView();
    });

    // Delete week buttons
    document.querySelectorAll('.week-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        forgeConfirm('Delete this week? Tasks become unassigned.', () => {
          const wid = btn.dataset.weekId;
          state.tasks.filter(t => t.weekId === wid).forEach(t => t.weekId = null);
          state.weeks = (state.weeks || []).filter(w => w.id !== wid);
          saveState(); renderWeeksView();
        });
      });
    });

    // Add task per week
    document.querySelectorAll('.week-task-add-btn').forEach(btn => {
      btn.addEventListener('click', () => _addPlanTask(btn.dataset.weekId));
    });
    document.querySelectorAll('.week-task-input').forEach(input => {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') _addPlanTask(input.dataset.weekId);
      });
    });

    // Check off tasks
    document.querySelectorAll('.week-task-check').forEach(btn => {
      btn.addEventListener('click', () => {
        const task = state.tasks.find(t => t.id === btn.dataset.taskId);
        if (!task) return;
        if (!task.completed) {
          task.completed = true;
          task.completedAt = new Date().toISOString();
          Sound.taskDone();
        } else {
          task.completed = false;
          task.completedAt = null;
        }
        saveState();
        renderWeeksView();
        renderDashboard();
      });
    });

    // Delete tasks
    document.querySelectorAll('.week-task-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.tasks = state.tasks.filter(t => t.id !== btn.dataset.taskId);
        saveState(); renderWeeksView(); renderDashboard();
      });
    });

    // ── MOBILE: move sheet ──
    if (isMobile) {
      document.querySelectorAll('.week-task-move-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          openMoveSheet(btn.dataset.taskId);
        });
      });
    }

    // ── DESKTOP: drag and drop ──
    if (!isMobile) {
      let dragTaskId = null;

      document.querySelectorAll('.week-task-item[draggable]').forEach(item => {
        item.addEventListener('dragstart', e => {
          dragTaskId = item.dataset.taskId;
          item.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
        });
        item.addEventListener('dragend', () => {
          item.classList.remove('dragging');
          document.querySelectorAll('.drop-indicator').forEach(d => d.classList.add('hidden'));
          document.querySelectorAll('.week-column').forEach(c => c.classList.remove('drag-over'));
        });
      });

      document.querySelectorAll('.desktop-drop-zone').forEach(zone => {
        zone.addEventListener('dragover', e => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          zone.classList.add('drag-over');
          const ind = $(`drop-${zone.dataset.weekId}`);
          if (ind) ind.classList.remove('hidden');
        });
        zone.addEventListener('dragleave', () => {
          zone.classList.remove('drag-over');
          const ind = $(`drop-${zone.dataset.weekId}`);
          if (ind) ind.classList.add('hidden');
        });
        zone.addEventListener('drop', e => {
          e.preventDefault();
          zone.classList.remove('drag-over');
          const ind = $(`drop-${zone.dataset.weekId}`);
          if (ind) ind.classList.add('hidden');
          if (!dragTaskId) return;
          _moveTask(dragTaskId, zone.dataset.weekId);
          dragTaskId = null;
        });
      });
    }
  }

  function _addPlanTask(weekId) {
    const input = weekId === 'unassigned'
      ? document.querySelector('.week-task-input[data-week-id="unassigned"]')
      : document.querySelector(`.week-task-input[data-week-id="${weekId}"]`);
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    const goal  = state.goals.find(g => g.id === _activeGoalId);
    const task  = {
      id:           Storage.uuid(),
      text,
      tag:          goal ? goal.pillarId : 'other',
      goalId:       _activeGoalId,
      weekId:       weekId === 'unassigned' ? null : weekId,
      completed:    false,
      xpMultiplier: 1.0,
      createdAt:    new Date().toISOString(),
      completedAt:  null
    };
    state.tasks.push(task);
    saveState();
    input.value = '';
    renderWeeksView();
    renderDashboard();
    Sound.taskAdded();
  }

  function _moveTask(taskId, weekId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    task.weekId = weekId === 'unassigned' ? null : weekId;
    saveState();
    renderWeeksView();
    Sound.click();
  }

  function openMoveSheet(taskId) {
    _goalBeingMoved = taskId;
    const weeks = (state.weeks || []).filter(w => w.goalId === _activeGoalId)
                    .sort((a,b) => a.number - b.number);
    const task  = state.tasks.find(t => t.id === taskId);
    const opts  = $('move-task-options');
    opts.innerHTML = [
      ...weeks.map(w => `<button class="move-opt-btn" data-week-id="${w.id}">${w.label}</button>`),
      `<button class="move-opt-btn ${!task?.weekId ? 'active' : ''}" data-week-id="unassigned">UNASSIGNED</button>`
    ].join('');
    opts.querySelectorAll('.move-opt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _moveTask(taskId, btn.dataset.weekId);
        closeMoveSheet();
      });
    });
    $('move-task-modal').classList.remove('hidden');
  }

  function closeMoveSheet() {
    $('move-task-modal').classList.add('hidden');
    _goalBeingMoved = null;
  }

  // ── WAR ROOM ──
  function renderWarRoom() {
    const container = $('warroom-content');
    const pillars   = state.pillars || [];
    const goals     = state.goals   || [];
    const tasks     = state.tasks   || [];
    const weeks     = state.weeks   || [];

    if (!pillars.length) {
      container.innerHTML = `<div class="plan-empty-state">No pillars yet.</div>`;
      return;
    }

    container.innerHTML = pillars.map(pillar => {
      const pillarGoals = goals.filter(g => g.pillarId === pillar.id && g.status === 'active');
      const goalsHTML = pillarGoals.length ? pillarGoals.map(goal => {
        const daysLeft  = _daysUntil(goal.deadline);
        const isOverdue = daysLeft < 0;
        const goalTasks = tasks.filter(t => t.goalId === goal.id);
        const done      = goalTasks.filter(t => t.completed).length;
        const total     = goalTasks.length;
        const progress  = total > 0 ? Math.min(100, Math.round(done/total*100)) : null;
        const goalWeeks = weeks.filter(w => w.goalId === goal.id).sort((a,b) => a.number - b.number);

        let deadlineLabel = '';
        if (goal.deadline) {
          if (isOverdue)          deadlineLabel = `<span class="goal-overdue">${Math.abs(daysLeft)}d OVERDUE</span>`;
          else if (daysLeft <= 7) deadlineLabel = `<span class="goal-urgent">${daysLeft}d LEFT</span>`;
          else                    deadlineLabel = `<span class="goal-weeks">${_weeksUntil(goal.deadline)}w LEFT</span>`;
        }

        // Week breakdown
        const weeksHTML = goalWeeks.map(w => {
          const wTasks = goalTasks.filter(t => t.weekId === w.id);
          const wDone  = wTasks.filter(t => t.completed).length;
          return `<div class="wr-week-row">
            <span class="wr-week-label">${w.label}</span>
            <span class="wr-week-count ${wDone === wTasks.length && wTasks.length > 0 ? 'target-hit' : ''}">${wDone}/${wTasks.length}</span>
          </div>`;
        }).join('');

        return `
          <div class="wr-goal-row ${isOverdue ? 'is-overdue' : ''}" data-goal-id="${goal.id}"
               style="--pillar-color:${pillar.color}">
            <div class="wr-goal-top">
              <span class="wr-goal-title">${escHtml(goal.title)}</span>
              <div class="wr-goal-meta">
                ${deadlineLabel}
                ${total > 0 ? `<span class="goal-sessions-count">◎ ${done}/${total}</span>` : ''}
              </div>
            </div>
            ${progress !== null ? `
            <div class="goal-progress-bar" style="margin-bottom:6px">
              <div class="goal-progress-fill" style="width:${progress}%;background:${pillar.color}"></div>
            </div>` : ''}
            ${weeksHTML}
          </div>`;
      }).join('') : `<div class="wr-no-goals">No active goals</div>`;

      return `
        <div class="wr-pillar-block" style="--pillar-color:${pillar.color}">
          <div class="wr-pillar-header">
            <span class="wr-pillar-icon">${pillar.icon}</span>
            <span class="wr-pillar-name">${pillar.name}</span>
            <span class="wr-pillar-count">${pillarGoals.length} goal${pillarGoals.length !== 1 ? 's' : ''}</span>
          </div>
          <div class="wr-goals-list">${goalsHTML}</div>
        </div>`;
    }).join('');

    // Tap goal row → open weeks view
    container.querySelectorAll('.wr-goal-row').forEach(row => {
      row.addEventListener('click', () => {
        const goal = goals.find(g => g.id === row.dataset.goalId);
        if (!goal) return;
        _activePillarId = goal.pillarId;
        openGoalWeeks(goal.id);
      });
    });
  }

  let _editingPillarIdx = null;
  let _selectedColor = PILLAR_COLORS[0];
  let _selectedIcon = '◎';

  function renderPillarForm(editIdx) {
    _editingPillarIdx = editIdx;
    const pillar = editIdx !== null ? state.pillars[editIdx] : null;
    _selectedColor = pillar ? pillar.color : PILLAR_COLORS[0];
    if (editIdx !== null && pillar) {
      $('pillar-name-input').value = pillar.name;
    } else {
      $('pillar-name-input').value = '';
    }
    const swatches = $('pillar-color-swatches');
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

    // Icon picker
    const PILLAR_ICONS = ['◎','📚','🎮','💻','🎨','🏋️','💰','🎵','📝','🌍','🔬','⚡','🎯','🚀','📖','🧠'];
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

    // ── ONBOARDING / AUTH — Google only ──
    $('btn-google-signin').addEventListener('click', async () => {
      $('btn-google-signin').disabled = true;
      $('auth-loading').classList.remove('hidden');
      $('google-signin-error').classList.add('hidden');

      const result = await FB.signInWithGoogle();

      if (!result.ok && !result.pending) {
        $('auth-loading').classList.add('hidden');
        $('btn-google-signin').disabled = false;
        const errEl = $('google-signin-error');
        errEl.textContent = result.error || 'Sign-in failed.';
        errEl.classList.remove('hidden');
      }
      // If ok or pending (mobile redirect), onAuthStateChanged handles the rest
    });

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
      showView('dashboard');
      renderDashboard();
    }
    function switchToPlan() {
      ['mode-plan',  'plan-mode-plan' ].forEach(id => $$(id) && $$(id).classList.add('active'));
      ['mode-forge', 'plan-mode-forge'].forEach(id => $$(id) && $$(id).classList.remove('active'));
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

    // Keep old btn-open-tasks as fallback (no longer in UI but safe to keep)
    $('btn-open-tasks') && $('btn-open-tasks').addEventListener('click', () => {
      renderTaskList();
      showView('tasks');
    });

    // ── PILLAR CHIPS ──
    function renderPillarChips() {
      const row = $('pillar-chips-row');
      if (!row) return;
      const pillars = state.pillars || [];
      const selected = _selectedPillar || (pillars[0] && pillars[0].id) || 'other';
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

    // Track selected pillar for task add
    _selectedPillar = (state.pillars && state.pillars[0]) ? state.pillars[0].id : 'other';
    renderPillarChips();

    $('btn-add-task').addEventListener('click', addTask);
    $('input-task').addEventListener('keydown', e => {
      if (e.key === 'Enter') addTask();
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

    // ── SETTINGS ──
    // ── PLAN TABS ──
    $('plan-tab-pillars').addEventListener('click', () => {
      Sound.click();
      showPlanView('pillars');
      renderPillarList();
    });

    $('plan-tab-warroom').addEventListener('click', () => {
      Sound.click();
      renderWarRoom();
      showPlanView('warroom');
    });

    // ── PLAN BACK BUTTONS ──
    $('btn-goals-back').addEventListener('click', () => {
      Sound.click();
      showPlanView('pillars');
      renderPillarList();
    });

    $('btn-weeks-back').addEventListener('click', () => {
      Sound.click();
      showPlanView('goals');
      renderGoalsList();
    });

    // ── GOAL FORM ──
    $('btn-add-goal').addEventListener('click', () => openGoalForm(null));

    $('btn-goal-cancel').addEventListener('click', () => {
      $('goal-form').classList.add('hidden');
      $('btn-add-goal').classList.remove('hidden');
      _editingGoalId = null;
    });

    // Week count stepper
    document.querySelectorAll('.week-count-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _editingGoalWeekCount = Math.max(1, Math.min(52, _editingGoalWeekCount + parseInt(btn.dataset.delta)));
        _updateWeekCountDisplay();
      });
    });

    $('btn-goal-save').addEventListener('click', () => {
      const title    = $('goal-title-input').value.trim();
      const deadline = $('goal-deadline-input').value;

      if (!title) { _showShopToast('ENTER A TITLE'); return; }

      if (_editingGoalId) {
        const g = state.goals.find(g => g.id === _editingGoalId);
        if (g) { g.title = title; g.deadline = deadline; g.weekCount = _editingGoalWeekCount; }
      } else {
        if (!state.goals) state.goals = [];
        const newGoalId = Storage.uuid();
        state.goals.push({
          id:        newGoalId,
          pillarId:  _activePillarId,
          title,
          deadline,
          weekCount: _editingGoalWeekCount,
          createdAt: new Date().toISOString(),
          status:    'active'
        });
        // Auto-generate weeks
        if (!state.weeks) state.weeks = [];
        for (let i = 1; i <= _editingGoalWeekCount; i++) {
          state.weeks.push({ id: Storage.uuid(), goalId: newGoalId, number: i, label: `WEEK ${i}` });
        }
      }

      saveState();
      Sound.click();
      $('goal-form').classList.add('hidden');
      $('btn-add-goal').classList.remove('hidden');
      _editingGoalId = null;
      renderGoalsList();
    });

    // ── MOVE TASK MODAL (mobile) ──
    $('move-task-backdrop').addEventListener('click', closeMoveSheet);

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
      renderPillarList();
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

  function flashElement(el, text) {
    const orig = el.textContent;
    el.textContent = text;
    setTimeout(() => { el.textContent = orig; }, 1200);
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
