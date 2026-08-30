// ═══════════════════════════════════════════════════════
// sessionRuntime.js — Active Session Runtime (Phase 0)
//
// The problem this solves: Timer state lives in memory. A refresh, a tab
// close, or navigating to village.html destroyed it, and with it every
// minute the person had actually focused. That made a second page
// impossible to add without silently punishing people for clicking a
// link.
//
// The rule this encodes:
//   • Leaving the app (refresh / close / tab kill) is RUNNING AWAY.
//     It abandons the session — but mercifully: credit is granted up to
//     the LAST SAVED CHECKPOINT, never the full live elapsed time.
//   • Moving between index.html and village.html via an in-app button is
//     NOT running away. The button issues a short-lived transfer token;
//     the receiving page consumes it and resumes the session intact.
//
// Design constraints, deliberately:
//   • ZERO DOM, ZERO Firebase, ZERO app-state knowledge. Same shape as
//     achievements.js / avatars.js / leaderboard.js — a pure module both
//     pages can load and tests can drive without a browser.
//   • Its own localStorage keys, NOT part of `forge_state`. A heartbeat
//     every 15s inside the synced state document would mean a Firestore
//     write every 15s per user, for data that is worthless the moment
//     the session ends. This record is local-only, on purpose.
//   • Injectable clock (_setClock) so the elapsed/checkpoint math is
//     testable without sleeping in real time.
//
// It does NOT grant rewards. Abandon detection PARKS the abandoned
// record in a pending slot and app.js drains it through the one real
// reward pipeline — same reasoning as repository.js: one code path means
// the credit rules cannot quietly diverge between two pages.
// ═══════════════════════════════════════════════════════

const SessionRuntime = (() => {

  // ── STORAGE KEYS (local-only — never synced to Firestore) ──
  const ACTIVE_KEY   = 'FORGE_ACTIVE_SESSION_V1';
  const TRANSFER_KEY = 'FORGE_SESSION_TRANSFER_TOKEN_V1';
  const PENDING_KEY  = 'FORGE_PENDING_ABANDON_V1';

  // The mercy boundary. Every HEARTBEAT_MS the focused elapsed time is
  // written to disk; anything focused after the last write is forfeit if
  // the person runs away. 15s sits in the middle of the 10–20s band —
  // tight enough that the loss never feels arbitrary, loose enough that
  // it is one tiny localStorage write per 15s and nothing more.
  const HEARTBEAT_MS = 15000;

  // A page hop takes milliseconds. 10s is generous enough to survive a
  // slow load and short enough that a stale token can't be replayed
  // later to launder an abandon into a resume.
  const TRANSFER_TTL_MS = 10000;

  // ── INJECTABLE CLOCK (tests only) ──
  let _clock = () => Date.now();
  function _setClock(fn) { _clock = (typeof fn === 'function') ? fn : (() => Date.now()); }
  function now() { return _clock(); }

  // ── RAW localStorage IO ──
  // Never throws. A quota error or a private-browsing lockout must not
  // take down a running session; worst case the person loses checkpoint
  // granularity, which is a degraded experience, not a broken one.
  function _read(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function _write(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) {}
  }
  function _remove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }

  function _uuid() {
    return 'sess-' + Math.random().toString(36).slice(2, 10) + '-' + now().toString(36);
  }

  function _at(ms) { return (typeof ms === 'number') ? ms : now(); }

  // ── START ──
  // Called the instant the focus timer starts. Everything village.html
  // needs to render its timer strip is denormalised into this record
  // (taskLabel, intention) so that page never has to load, migrate, or
  // reason about the full app state just to show a countdown.
  function start(opts) {
    const o = opts || {};
    const t = now();
    const rec = {
      sessionId:              _uuid(),
      taskId:                 o.taskId || null,
      goalId:                 o.goalId || null,
      taskLabel:              o.taskLabel || '',
      intention:              o.intention || '',
      difficultyMultiplier:   (typeof o.difficultyMultiplier === 'number') ? o.difficultyMultiplier : 1.0,
      plannedDurationMs:      Math.max(0, Math.round((o.plannedMinutes || 0) * 60000)),
      // ISO start time, kept so an abandoned session can be logged into
      // state.sessions with the same startTime shape as a completed one.
      startedAtISO:           o.startedAtISO || null,
      startedAtMs:            t,
      status:                 'running',
      // Focused-time accounting. `focusedBeforeSegmentMs` banks the
      // focused ms of every segment that has already ended; the live
      // segment is measured from `segmentStartedAtMs`. Pause time is
      // excluded BY CONSTRUCTION rather than subtracted afterwards —
      // there is no clock running to subtract from while paused.
      segmentStartedAtMs:     t,
      focusedBeforeSegmentMs: 0,
      pauseAccumMs:           0,
      pausedAtMs:             null,
      // The mercy boundary itself.
      checkpointElapsedMs:    0,
      lastHeartbeatAtMs:      t
    };
    _write(ACTIVE_KEY, rec);
    return rec;
  }

  // ── READ / CLEAR ──
  function read() { return _read(ACTIVE_KEY); }
  function clear() { _remove(ACTIVE_KEY); _remove(TRANSFER_KEY); }

  // ── LIVE ELAPSED (pure) ──
  // Focused ms right now, pause time excluded. Clamped to the planned
  // duration so a session that overran while the tab was backgrounded
  // can never award more than it promised.
  function liveElapsedMs(rec, atMs) {
    if (!rec) return 0;
    const t = _at(atMs);
    let ms = rec.focusedBeforeSegmentMs || 0;
    if (rec.status === 'running' && typeof rec.segmentStartedAtMs === 'number') {
      ms += Math.max(0, t - rec.segmentStartedAtMs);
    }
    const planned = rec.plannedDurationMs || 0;
    if (planned > 0) ms = Math.min(ms, planned);
    return ms;
  }

  function remainingMs(rec, atMs) {
    if (!rec) return 0;
    return Math.max(0, (rec.plannedDurationMs || 0) - liveElapsedMs(rec, atMs));
  }

  // ── CHECKPOINT READERS (pure) ──
  function checkpointElapsedMs(rec) {
    return (rec && rec.checkpointElapsedMs) ? rec.checkpointElapsedMs : 0;
  }

  // Whole banked minutes. Deliberately NOT Math.max(1, ...) — the
  // completed-session path floors at one minute because finishing
  // something always deserves credit, but mercy for running away must
  // not become a loophole where 4 seconds of "focus" pays a minute.
  // Under a full banked minute, an abandon pays nothing.
  function checkpointMinutes(rec) {
    return Math.floor(checkpointElapsedMs(rec) / 60000);
  }

  // ── HEARTBEAT ──
  // The only thing that moves the mercy boundary forward.
  function heartbeat(atMs) {
    const rec = read();
    if (!rec) return null;
    const t = _at(atMs);
    rec.checkpointElapsedMs = liveElapsedMs(rec, t);
    rec.lastHeartbeatAtMs   = t;
    _write(ACTIVE_KEY, rec);
    return rec;
  }

  // ── PAUSE (HOLD) ──
  // Banks the live segment and stops the clock. Pausing is itself a
  // checkpoint: you keep every focused second up to the moment you hit
  // HOLD, even if you then run away without another heartbeat.
  function pause(atMs) {
    const rec = read();
    if (!rec || rec.status !== 'running') return rec;
    const t = _at(atMs);
    rec.focusedBeforeSegmentMs = liveElapsedMs(rec, t);
    rec.segmentStartedAtMs     = null;
    rec.pausedAtMs             = t;
    rec.status                 = 'paused';
    rec.checkpointElapsedMs    = rec.focusedBeforeSegmentMs;
    rec.lastHeartbeatAtMs      = t;
    _write(ACTIVE_KEY, rec);
    return rec;
  }

  // ── RESUME ──
  // Fresh wall-clock anchor for the new segment. pauseAccumMs is kept for
  // diagnostics only — the focused-time math never reads it, because
  // paused time was never counted in the first place.
  function resume(atMs) {
    const rec = read();
    if (!rec || rec.status !== 'paused') return rec;
    const t = _at(atMs);
    if (typeof rec.pausedAtMs === 'number') {
      rec.pauseAccumMs = (rec.pauseAccumMs || 0) + Math.max(0, t - rec.pausedAtMs);
    }
    rec.pausedAtMs         = null;
    rec.segmentStartedAtMs = t;
    rec.status             = 'running';
    _write(ACTIVE_KEY, rec);
    return rec;
  }

  // ── ISSUE TRANSFER TOKEN ──
  // The "this navigation is sanctioned" stamp. Written immediately before
  // location.assign(); the destination page consumes it on load.
  // Heartbeats on the way out so the hop itself can never cost time.
  function issueTransferToken(fromPage, toPage, atMs) {
    const rec = read();
    if (!rec) return null;
    const t = _at(atMs);
    heartbeat(t);
    const token = {
      sessionId:  rec.sessionId,
      issuedAtMs: t,
      fromPage:   fromPage || '',
      toPage:     toPage   || '',
      ttlMs:      TRANSFER_TTL_MS
    };
    _write(TRANSFER_KEY, token);
    return token;
  }

  function readTransferToken() { return _read(TRANSFER_KEY); }

  // ── CONSUME TRANSFER TOKEN ──
  // SINGLE USE, ALWAYS. The token is deleted whether or not it validated.
  // Leaving a used token behind would make the NEXT refresh look like a
  // sanctioned hop, which is precisely the abandon this whole mechanism
  // exists to catch.
  function consumeTransferToken(atMs) {
    const token = _read(TRANSFER_KEY);
    _remove(TRANSFER_KEY);
    if (!token) return { valid: false, reason: 'missing', token: null, sessionId: null };
    const t   = _at(atMs);
    const ttl = (typeof token.ttlMs === 'number') ? token.ttlMs : TRANSFER_TTL_MS;
    const age = t - (token.issuedAtMs || 0);
    // age < 0 means a clock jumped backwards; refuse rather than trust it.
    if (age < 0 || age > ttl) {
      return { valid: false, reason: 'expired', token, sessionId: token.sessionId || null };
    }
    return { valid: true, reason: 'ok', token, sessionId: token.sessionId || null };
  }

  // ── RESOLVE ON LOAD ──
  // Run this once, early, on EVERY page that can host a session. It is
  // the single place that decides "was that a sanctioned hop, or did you
  // run away?" — and it must run before anything else gets a chance to
  // touch the record.
  //
  //   no active record                → { kind: 'none' }
  //   active record + valid token     → { kind: 'resume',    session }
  //   active record, token missing /
  //   expired / for another session   → { kind: 'abandoned', session }
  //
  // On abandon the record is MOVED to the pending slot and the active key
  // is dropped in the same breath. That ordering is deliberate: it makes
  // double-crediting structurally impossible. If the caller then crashes
  // before paying out, the person loses the credit — strictly the better
  // failure, because the alternative pays the same checkpoint out twice
  // on every subsequent reload.
  function resolveOnLoad(atMs) {
    const t     = _at(atMs);
    const rec   = read();
    const token = consumeTransferToken(t);   // single-use, always cleared

    if (!rec) return { kind: 'none', session: null };

    if (token.valid && token.sessionId === rec.sessionId) {
      return { kind: 'resume', session: rec, token: token.token };
    }

    const parked = Object.assign({}, rec, {
      abandonedAtMs: t,
      abandonReason: token.token ? token.reason : 'no-transfer-token',
      // THE MERCY RULE, in one line: credit is the last saved checkpoint,
      // never liveElapsedMs(). Everything focused since the last
      // heartbeat is forfeit — that is the cost of running away.
      creditedElapsedMs: checkpointElapsedMs(rec)
    });
    _write(PENDING_KEY, parked);
    _remove(ACTIVE_KEY);
    return { kind: 'abandoned', session: parked };
  }

  // ── PENDING ABANDON QUEUE (capacity: one) ──
  // Written by resolveOnLoad, drained by app.js once real app state is
  // loaded and migrated. village.html can detect one and bounce back to
  // index.html rather than duplicating the reward pipeline.
  function readPendingAbandon()  { return _read(PENDING_KEY); }
  function clearPendingAbandon() { _remove(PENDING_KEY); }

  return {
    // lifecycle
    start, read, clear, pause, resume, heartbeat,
    // pure math
    liveElapsedMs, remainingMs, checkpointElapsedMs, checkpointMinutes,
    // page transfer
    issueTransferToken, consumeTransferToken, readTransferToken,
    // load-time resolution
    resolveOnLoad, readPendingAbandon, clearPendingAbandon,
    // constants + test seam
    HEARTBEAT_MS, TRANSFER_TTL_MS,
    ACTIVE_KEY, TRANSFER_KEY, PENDING_KEY,
    _setClock, now
  };

})();

// Expose for classic-script consumers (app.js / villagePage.js / tests).
// `const SessionRuntime` above is a global lexical binding, not a window
// property — same reason storage.js and timer.js do this.
if (typeof window !== 'undefined') window.SessionRuntime = SessionRuntime;
