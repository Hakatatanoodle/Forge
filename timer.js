// ═══════════════════════════════════════════════════════
// timer.js — Session timer engine
// Handles countdown, SVG ring progress, break timer.
// Decoupled from UI — fires callbacks on events.
//
// Wall-clock based: immune to browser tab throttling.
// Supports HOLD: pauses at exact remaining seconds,
// resumes with a fresh wall-clock anchor.
// ═══════════════════════════════════════════════════════

const Timer = (() => {

  // Internal state
  let _interval      = null;
  let _totalSecs     = 0;     // total seconds for THIS segment (resets on resume)
  let _fullTotalSecs = 0;     // original total for ring calculation
  let _startTime     = null;  // wall-clock anchor
  let _isRunning     = false;
  let _isHeld        = false;
  let _remainAtHold  = 0;     // seconds remaining when hold was pressed
  let _mode          = 'focus'; // 'focus' | 'break'

  // Hold timer
  let _holdInterval  = null;
  let _holdRemain    = 0;
  let _onHoldTick    = null; // (holdRemainSecs) => void
  const HOLD_MAX     = 5 * 60; // 5 minutes max hold

  // Callbacks
  let _onTick      = null; // (remainSecs, totalSecs) => void
  let _onComplete  = null; // () => void

  // SVG ring constants
  const RING_CIRCUMFERENCE = 2 * Math.PI * 88;

  // ── START FOCUS SESSION ──
  function startFocus(minutes, onTick, onComplete) {
    _mode          = 'focus';
    _totalSecs     = minutes * 60;
    _fullTotalSecs = _totalSecs;
    _onTick        = onTick;
    _onComplete    = onComplete;
    _isHeld        = false;
    _run();
  }

  // ── START BREAK ──
  function startBreak(minutes, onTick, onComplete) {
    _mode          = 'break';
    _totalSecs     = minutes * 60;
    _fullTotalSecs = _totalSecs;
    _onTick        = onTick;
    _onComplete    = onComplete;
    _isHeld        = false;
    _run();
  }

  // ── HOLD — freeze at current remaining seconds ──
  function hold(onHoldTick) {
    if (!_isRunning || _isHeld) return;

    // Capture exact remaining seconds right now
    const elapsedSecs = Math.floor((Date.now() - _startTime) / 1000);
    _remainAtHold = Math.max(0, _totalSecs - elapsedSecs);

    _isHeld    = true;
    _isRunning = false;
    _onHoldTick = onHoldTick;
    _clearMainInterval();

    // Start hold countdown
    _holdRemain = HOLD_MAX;
    if (_onHoldTick) _onHoldTick(_holdRemain);

    _holdInterval = setInterval(() => {
      _holdRemain--;
      if (_onHoldTick) _onHoldTick(_holdRemain);
      if (_holdRemain <= 0) {
        // Auto-resume when hold expires
        resume();
      }
    }, 1000);
  }

  // ── RESUME — restart from where hold left off ──
  function resume() {
    if (!_isHeld) return;
    _clearHoldInterval();
    _isHeld    = false;
    // Resume with remaining seconds as new total — fresh wall-clock anchor
    _totalSecs = _remainAtHold;
    _run();
  }

  // ── INTERNAL RUN ──
  function _run() {
    _isRunning = true;
    _startTime = Date.now();
    _clearMainInterval();

    // Fire immediately for instant display
    if (_onTick) _onTick(_totalSecs, _fullTotalSecs);

    _interval = setInterval(() => {
      const elapsedSecs = Math.floor((Date.now() - _startTime) / 1000);
      const remainSecs  = Math.max(0, _totalSecs - elapsedSecs);

      if (_onTick) _onTick(remainSecs, _fullTotalSecs);

      if (remainSecs <= 0) {
        _clearMainInterval();
        _isRunning = false;
        if (_onComplete) _onComplete();
      }
    }, 500);
  }

  // ── STOP (abandon) ──
  function stop() {
    _clearMainInterval();
    _clearHoldInterval();
    _isRunning = false;
    _isHeld    = false;
  }

  function _clearMainInterval() {
    if (_interval) { clearInterval(_interval); _interval = null; }
  }

  function _clearHoldInterval() {
    if (_holdInterval) { clearInterval(_holdInterval); _holdInterval = null; }
  }

  // ── FORMAT: seconds → { mm, ss } ──
  function format(totalSecs) {
    const s  = Math.max(0, totalSecs);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return { mm, ss };
  }

  // ── RING OFFSET ──
  function ringOffset(remainSecs, totalSecs) {
    if (totalSecs === 0) return 0;
    const progress = remainSecs / totalSecs;
    return RING_CIRCUMFERENCE * (1 - progress);
  }

  function isRunning() { return _isRunning; }
  function isHeld()    { return _isHeld; }
  function getMode()   { return _mode; }

  // ── GET ACTUAL ELAPSED SECONDS ──
  // Used by completeSession to calculate XP based on real time worked,
  // not the planned session length. Accounts for hold time correctly —
  // hold time is excluded because _totalSecs is reduced on resume.
  function getElapsedSecs() {
    if (_isHeld) {
      // On hold — elapsed = planned - remaining at hold
      return _fullTotalSecs - _remainAtHold;
    }
    if (_startTime === null) return 0;
    const elapsed = Math.floor((Date.now() - _startTime) / 1000);
    // Add time already consumed before any resume
    const alreadyUsed = _fullTotalSecs - _totalSecs;
    return Math.min(alreadyUsed + elapsed, _fullTotalSecs);
  }

  return {
    startFocus, startBreak,
    hold, resume, stop,
    format, ringOffset,
    isRunning, isHeld, getMode,
    getElapsedSecs,
    RING_CIRCUMFERENCE
  };

})();
