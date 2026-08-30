// ═══════════════════════════════════════════════════════
// villagePage.js — Controller for village.html (Phase 0 shell)
//
// This page is deliberately a READER. It:
//   • resolves the session runtime on load (sanctioned hop vs. run away),
//   • renders a live timer strip from the persisted session record,
//   • keeps heartbeating so checkpoints advance while you look around,
//   • issues a transfer token before any navigation it initiates.
//
// It does NOT:
//   • grant XP or coins — an abandon detected here is bounced to
//     index.html, where app.js drains the pending slot through the one
//     real reward pipeline (same rationale as repository.js),
//   • write app state — Storage.load() only, never Storage.save(),
//   • touch Firebase — no auth, no sync, works fully offline.
//
// Phase 1 hangs the actual village (village.js) off this shell and gates
// every interaction behind isViewOnly().
// ═══════════════════════════════════════════════════════

const VillagePage = (() => {

  const TICK_MS = 500;   // matches timer.js — smooth enough, cheap enough

  let _state        = null;
  let _tickInterval = null;
  let _heartbeat    = null;
  let _viewOnly     = false;
  let _navigating   = false;   // guards against double navigation on time-up

  function $(id) { return document.getElementById(id); }

  // ── LOCAL TOAST ──
  // Tiny standalone copy. Importing app.js for one function would drag in
  // Firebase, the calendar and 3,000 lines of god file.
  let _toastTimer = null;
  function showToast(msg, type = '', duration = 2200) {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (type ? ' ' + type : '');
    void el.offsetWidth;                  // restart the transition
    el.classList.add('visible');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('visible'), duration);
  }

  // ── THEME ──
  // Whatever was unlocked and selected in the Armory. app.js already
  // validated the id when it was saved, so this trusts the stored value
  // rather than duplicating the THEMES table.
  function applyTheme(state) {
    const theme = (state && state.user && state.user.activeTheme) || 'forge';
    document.body.setAttribute('data-theme', theme);
  }

  // ── STATS FOOTER (read-only mirror) ──
  function sessionFocusedMinutes(s) {
    if (typeof s.focusedMinutes === 'number') return s.focusedMinutes;
    if (s.startTime && s.endTime) {
      return Math.max(0, Math.round((new Date(s.endTime) - new Date(s.startTime)) / 60000));
    }
    return 0;
  }

  function renderStats(state) {
    const user = (state && state.user) || {};
    const totalMins = (state.sessions || [])
      .filter(s => s && s.completed)
      .reduce((sum, s) => sum + sessionFocusedMinutes(s), 0);

    const coinsEl = $('village-coins');
    const lvlEl   = $('village-level');
    const hrsEl   = $('village-hours');
    if (coinsEl) coinsEl.textContent = user.coins || 0;
    if (lvlEl)   lvlEl.textContent   = user.level || 1;
    if (hrsEl)   hrsEl.textContent   = (Math.round((totalMins / 60) * 10) / 10) + 'h';
  }

  // ── PLACEHOLDER LAND ──
  // Empty plots so the page reads as "land you will build on" rather than
  // an unfinished screen. Phase 1 replaces this wholesale.
  const PLOT_COLS = 5;
  const PLOT_ROWS = 4;

  function renderPlaceholderGrid() {
    const grid = $('village-grid-placeholder');
    if (!grid) return;
    grid.style.setProperty('--village-cols', String(PLOT_COLS));
    let html = '';
    for (let i = 0; i < PLOT_COLS * PLOT_ROWS; i++) {
      html += '<div class="village-plot" aria-hidden="true"></div>';
    }
    grid.innerHTML = html;
  }

  // ── TIMER STRIP ──
  function pad2(n) { return String(Math.max(0, n)).padStart(2, '0'); }

  function renderStrip(rec) {
    const strip = $('village-timer-strip');
    if (!strip) return;

    if (!rec) { strip.classList.add('hidden'); return; }
    strip.classList.remove('hidden');

    const remainMs   = SessionRuntime.remainingMs(rec);
    const remainSecs = Math.ceil(remainMs / 1000);
    const mins = $('village-strip-mins');
    const secs = $('village-strip-secs');
    if (mins) mins.textContent = pad2(Math.floor(remainSecs / 60));
    if (secs) secs.textContent = pad2(remainSecs % 60);

    const held  = rec.status === 'paused';
    const label = $('village-strip-label');
    if (label) label.textContent = held ? 'ON HOLD' : 'FOCUS';
    strip.classList.toggle('is-held', held);

    const taskEl = $('village-strip-task');
    if (taskEl) taskEl.textContent = rec.taskLabel || rec.intention || '—';
  }

  // ── VIEW-ONLY LOCK ──
  function setViewOnly(on) {
    _viewOnly = !!on;
    const lock = $('village-lock');
    if (lock) lock.classList.toggle('hidden', !on);
    document.body.classList.toggle('village-view-only', !!on);
    const note = $('village-subtitle');
    if (note && on) note.textContent = 'View only — a session is running';
  }

  function isViewOnly() { return _viewOnly; }

  // ── NAVIGATION (always token-stamped) ──
  // Every departure this page initiates is sanctioned. Anything else —
  // refresh, tab close, back button — is running away, and the checkpoint
  // rule in sessionRuntime.js handles it.
  function leaveTo(url) {
    if (_navigating) return;
    _navigating = true;
    _stopLoops();
    if (SessionRuntime.read()) {
      SessionRuntime.issueTransferToken('village', url.indexOf('village') === 0 ? 'village' : 'index');
    }
    window.location.assign(url);
  }

  function backToForge() { leaveTo('index.html'); }

  // ── LOOPS ──
  function _startLoops() {
    _stopLoops();
    _heartbeat = setInterval(() => { SessionRuntime.heartbeat(); }, SessionRuntime.HEARTBEAT_MS);
    _tickInterval = setInterval(_tick, TICK_MS);
    _tick();
  }

  function _stopLoops() {
    if (_heartbeat)    { clearInterval(_heartbeat);    _heartbeat = null; }
    if (_tickInterval) { clearInterval(_tickInterval); _tickInterval = null; }
  }

  function _tick() {
    const rec = SessionRuntime.read();

    // Session vanished (another tab finished or abandoned it). Drop the
    // strip and the lock rather than counting down against nothing.
    if (!rec) {
      _stopLoops();
      renderStrip(null);
      setViewOnly(false);
      return;
    }

    renderStrip(rec);

    // Time is up. The reward pipeline lives in app.js and nowhere else, so
    // hand the session back to index.html with a valid token — app.js
    // re-attaches the timer, sees zero remaining, and completes it.
    if (SessionRuntime.remainingMs(rec) <= 0) {
      _stopLoops();
      showToast('SESSION COMPLETE — RETURNING TO THE FORGE', 'success');
      setTimeout(() => leaveTo('index.html'), 600);
    }
  }

  // ── BOOT ──
  function init() {
    // FIRST, before anything can touch the record: was this a sanctioned
    // hop or did they run away? The token is single-use, so nothing may
    // run ahead of this.
    const boot = SessionRuntime.resolveOnLoad();

    // An abandon (or one parked earlier and never drained) must be paid
    // out by app.js. Bounce immediately — no render, no flicker.
    if (boot.kind === 'abandoned' || SessionRuntime.readPendingAbandon()) {
      window.location.replace('index.html');
      return;
    }

    _state = Storage.load();
    applyTheme(_state);
    renderStats(_state);
    renderPlaceholderGrid();

    const backBtn = $('btn-back-to-forge');
    if (backBtn) backBtn.addEventListener('click', backToForge);

    if (boot.kind === 'resume' && boot.session) {
      setViewOnly(true);
      _startLoops();
    } else {
      setViewOnly(false);
      renderStrip(null);
    }

    // Intervals are throttled in background tabs, so the checkpoint can
    // lag behind real focused time while the page is hidden. Catching up
    // the moment it becomes visible again costs one localStorage write and
    // buys back that lost mercy window.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && SessionRuntime.read()) {
        SessionRuntime.heartbeat();
        _tick();
      }
    });
  }

  return {
    init, isViewOnly, backToForge, showToast,
    // exposed for Phase 1 / tests
    renderStrip, renderStats, setViewOnly, _tick
  };

})();

if (typeof window !== 'undefined') window.VillagePage = VillagePage;

// Scripts sit at the end of <body>, so the DOM is already parsed. The
// readyState guard is only for the case where this file is loaded early
// (or by a test harness) — resolveOnLoad must not run against a
// half-built page.
if (typeof document !== 'undefined' && typeof window !== 'undefined' && !window.__FORGE_VILLAGE_NO_AUTOBOOT) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', VillagePage.init);
  } else {
    VillagePage.init();
  }
}
