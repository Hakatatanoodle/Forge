// ═══════════════════════════════════════════════════════
// tests.sessionRuntime.js — characterization tests for sessionRuntime.js
//
// Runs in Node only (mocks localStorage; loads sessionRuntime.js directly,
// same pattern as tests.repository.js / tests.achievements.js).
//
// What these tests are really protecting:
//   • Focused-time math with pauses excluded BY CONSTRUCTION.
//   • The mercy boundary: an abandon pays the LAST CHECKPOINT, never the
//     live elapsed time. If someone ever "fixes" resolveOnLoad to use
//     liveElapsedMs, these tests must scream.
//   • The transfer token is single-use and TTL-bounded, so it cannot be
//     replayed to launder a refresh into a sanctioned page hop.
//   • Double-crediting is structurally impossible: parking the record and
//     dropping the active key happen together.
// ═══════════════════════════════════════════════════════

(() => {
  const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAIL: ' + msg); };
  const log = (...args) => console.log('[RUNTIME TEST]', ...args);

  if (typeof require === 'undefined') {
    console.warn('tests.sessionRuntime.js: Node-only, skipping in browser.');
    return;
  }

  const fs = require('fs');

  global.localStorage = {
    _s: {},
    getItem(k)   { return this._s[k] || null; },
    setItem(k,v) { this._s[k] = String(v); },
    removeItem(k){ delete this._s[k]; }
  };

  let rCode = fs.readFileSync('./sessionRuntime.js', 'utf8')
                .replace('const SessionRuntime', 'global.SessionRuntime');
  eval(rCode);
  const SR = global.SessionRuntime;

  // ── Deterministic clock ──
  // Every elapsed/checkpoint assertion below is exact because time only
  // moves when a test says so. No sleeps, no flake.
  const T0 = 1_700_000_000_000;
  let _t = T0;
  SR._setClock(() => _t);
  function at(ms) { _t = ms; return _t; }
  function advance(ms) { _t += ms; return _t; }

  function reset() {
    localStorage._s = {};
    _t = T0;
  }

  function startSession(opts) {
    return SR.start(Object.assign({
      taskId: 'task-1',
      goalId: 'goal-1',
      taskLabel: 'Write the compiler',
      intention: 'ship the parser',
      difficultyMultiplier: 1.5,
      plannedMinutes: 50,
      startedAtISO: '2026-08-30T09:00:00'
    }, opts || {}));
  }

  const MIN = 60000;

  function run() {
    log('Running…');

    // ══ 1. START ══
    {
      reset();
      const rec = startSession();
      assert(rec.sessionId && /^sess-/.test(rec.sessionId), 'start() mints a sessionId');
      assert(rec.status === 'running', 'a new session is running');
      assert(rec.plannedDurationMs === 50 * MIN, 'plannedMinutes → plannedDurationMs, got ' + rec.plannedDurationMs);
      assert(rec.focusedBeforeSegmentMs === 0, 'no banked focus at t=0');
      assert(rec.checkpointElapsedMs === 0, 'no checkpoint at t=0');
      assert(rec.segmentStartedAtMs === T0, 'segment anchored to now');
      assert(rec.difficultyMultiplier === 1.5, 'difficulty multiplier is denormalised into the record');
      assert(rec.taskLabel === 'Write the compiler', 'taskLabel denormalised so village.html needs no app state');

      const round = SR.read();
      assert(round && round.sessionId === rec.sessionId, 'the record survives a localStorage round-trip');
      log('✓ start() writes a complete, self-describing session record');
    }

    // ══ 2. LIVE ELAPSED — the basic clock ══
    {
      reset();
      startSession();
      assert(SR.liveElapsedMs(SR.read()) === 0, 'elapsed is 0 immediately');
      advance(90 * 1000);
      assert(SR.liveElapsedMs(SR.read()) === 90 * 1000, '90s of wall clock = 90s focused');
      assert(SR.remainingMs(SR.read()) === 50 * MIN - 90 * 1000, 'remaining = planned − elapsed');
      log('✓ liveElapsedMs tracks wall-clock time while running');
    }

    // ══ 3. PAUSE TIME IS EXCLUDED ══
    // The load-bearing one. Focus 60s, sit paused for 10 MINUTES, focus
    // another 30s. Anything other than 90s means hold time is being paid.
    {
      reset();
      startSession();
      advance(60 * 1000);
      SR.pause();
      const paused = SR.read();
      assert(paused.status === 'paused', 'pause() flips status');
      assert(paused.focusedBeforeSegmentMs === 60 * 1000, 'pause banks the live segment');
      assert(paused.segmentStartedAtMs === null, 'pause drops the wall-clock anchor — no clock left to run');

      advance(10 * MIN);   // a long look away
      assert(SR.liveElapsedMs(SR.read()) === 60 * 1000, 'elapsed does not move while paused, got ' + SR.liveElapsedMs(SR.read()));

      SR.resume();
      const resumed = SR.read();
      assert(resumed.status === 'running', 'resume() flips status back');
      assert(resumed.segmentStartedAtMs === _t, 'resume takes a FRESH wall-clock anchor');
      assert(resumed.pauseAccumMs === 10 * MIN, 'pause duration is recorded for diagnostics');

      advance(30 * 1000);
      assert(SR.liveElapsedMs(SR.read()) === 90 * 1000,
        'focused = 60s + 30s = 90s, the 10m hold excluded — got ' + SR.liveElapsedMs(SR.read()));
      assert(SR.remainingMs(SR.read()) === 50 * MIN - 90 * 1000, 'remaining ignores hold time too');
      log('✓ pause time is excluded by construction across multiple segments');
    }

    // ══ 4. MULTIPLE PAUSES ACCUMULATE CORRECTLY ══
    {
      reset();
      startSession();
      advance(5 * MIN);  SR.pause();  advance(2 * MIN);  SR.resume();
      advance(5 * MIN);  SR.pause();  advance(3 * MIN);  SR.resume();
      advance(5 * MIN);
      assert(SR.liveElapsedMs(SR.read()) === 15 * MIN,
        '3 × 5m focused across 2 holds = 15m, got ' + (SR.liveElapsedMs(SR.read()) / MIN) + 'm');
      assert(SR.read().pauseAccumMs === 5 * MIN, 'both holds summed into pauseAccumMs');
      log('✓ repeated hold/resume cycles never leak hold time into focused time');
    }

    // ══ 5. ELAPSED IS CLAMPED TO THE PLANNED DURATION ══
    // A backgrounded tab can come back hours later; it must not be able to
    // award more than the session promised.
    {
      reset();
      startSession({ plannedMinutes: 25 });
      advance(3 * 60 * MIN);
      assert(SR.liveElapsedMs(SR.read()) === 25 * MIN, 'elapsed clamps at planned duration, got ' + SR.liveElapsedMs(SR.read()));
      assert(SR.remainingMs(SR.read()) === 0, 'remaining floors at 0, never negative');
      log('✓ an overrunning session cannot award more than it planned');
    }

    // ══ 6. HEARTBEAT MOVES THE MERCY BOUNDARY ══
    {
      reset();
      startSession();
      advance(40 * 1000);
      assert(SR.checkpointElapsedMs(SR.read()) === 0, 'no checkpoint until a heartbeat fires');
      SR.heartbeat();
      assert(SR.checkpointElapsedMs(SR.read()) === 40 * 1000, 'heartbeat banks current elapsed');
      assert(SR.read().lastHeartbeatAtMs === _t, 'heartbeat stamps its own time');

      advance(20 * 1000);
      assert(SR.checkpointElapsedMs(SR.read()) === 40 * 1000, 'the checkpoint does NOT drift forward on its own');
      assert(SR.liveElapsedMs(SR.read()) === 60 * 1000, 'live elapsed keeps moving independently');
      log('✓ the checkpoint only advances when a heartbeat writes it');
    }

    // ══ 7. PAUSING IS ITSELF A CHECKPOINT ══
    // You hit HOLD, then your battery dies. You keep everything up to HOLD.
    {
      reset();
      startSession();
      advance(7 * MIN);
      SR.pause();
      assert(SR.checkpointElapsedMs(SR.read()) === 7 * MIN, 'pause() banks a checkpoint with no heartbeat needed');
      log('✓ pressing HOLD banks credit immediately');
    }

    // ══ 8. checkpointMinutes FLOORS — mercy is not a loophole ══
    {
      reset();
      startSession();
      advance(59 * 1000); SR.heartbeat();
      assert(SR.checkpointMinutes(SR.read()) === 0, '59s of focus pays 0 minutes, not 1');
      advance(1 * 1000);  SR.heartbeat();
      assert(SR.checkpointMinutes(SR.read()) === 1, '60s pays exactly 1 minute');
      advance(119 * 1000); SR.heartbeat();
      assert(SR.checkpointMinutes(SR.read()) === 2, '179s pays 2 minutes (floored)');
      assert(SR.checkpointMinutes(null) === 0, 'no record pays nothing');
      log('✓ abandon credit floors to whole banked minutes and never rounds up');
    }

    // ══ 9. TRANSFER TOKEN — issue / validate / TTL ══
    {
      reset();
      const rec = startSession();
      advance(30 * 1000);
      const token = SR.issueTransferToken('index', 'village');
      assert(token && token.sessionId === rec.sessionId, 'the token is bound to this exact session');
      assert(token.ttlMs === SR.TRANSFER_TTL_MS, 'the token carries its own TTL');
      assert(SR.checkpointElapsedMs(SR.read()) === 30 * 1000, 'issuing a token heartbeats first — the hop cannot cost time');

      advance(SR.TRANSFER_TTL_MS - 1);
      const ok = SR.consumeTransferToken();
      assert(ok.valid === true, 'a token consumed inside its TTL is valid');
      assert(ok.sessionId === rec.sessionId, 'consume reports which session it was for');
      log('✓ a fresh transfer token validates and pre-heartbeats');
    }

    // ══ 10. TOKEN IS SINGLE-USE, ALWAYS ══
    // If a used token lingered, the NEXT refresh would look sanctioned —
    // exactly the abandon this mechanism exists to catch.
    {
      reset();
      startSession();
      SR.issueTransferToken('index', 'village');
      const first  = SR.consumeTransferToken();
      const second = SR.consumeTransferToken();
      assert(first.valid === true, 'first consume validates');
      assert(second.valid === false && second.reason === 'missing', 'second consume finds nothing — the token was destroyed on read');
      assert(SR.readTransferToken() === null, 'no token left in storage');
      log('✓ transfer tokens are destroyed on read, valid or not');
    }

    // ══ 11. TOKEN EXPIRY AND CLOCK-SKEW REFUSAL ══
    {
      reset();
      startSession();
      SR.issueTransferToken('index', 'village');
      advance(SR.TRANSFER_TTL_MS + 1);
      const expired = SR.consumeTransferToken();
      assert(expired.valid === false && expired.reason === 'expired', 'a token past its TTL is expired, got ' + expired.reason);
      assert(SR.readTransferToken() === null, 'even an expired token is cleared');

      SR.issueTransferToken('index', 'village');
      const issuedAt = _t;
      at(issuedAt - 5000);   // clock jumped backwards
      const skewed = SR.consumeTransferToken();
      assert(skewed.valid === false && skewed.reason === 'expired', 'a negative token age is refused rather than trusted');
      log('✓ stale and backwards-clock tokens are refused');
    }

    // ══ 12. resolveOnLoad — NO SESSION ══
    {
      reset();
      const r = SR.resolveOnLoad();
      assert(r.kind === 'none', 'no active record resolves to none');
      assert(SR.readPendingAbandon() === null, 'and parks nothing');
      log('✓ a cold load with no session is a no-op');
    }

    // ══ 13. resolveOnLoad — SANCTIONED HOP ══
    {
      reset();
      const rec = startSession();
      advance(3 * MIN);
      SR.issueTransferToken('index', 'village');
      advance(400);                       // a realistic page load
      const r = SR.resolveOnLoad();
      assert(r.kind === 'resume', 'valid token + matching session = resume, got ' + r.kind);
      assert(r.session.sessionId === rec.sessionId, 'the same session comes back');
      assert(SR.read() !== null, 'the active record is left intact for the new page');
      assert(SR.readPendingAbandon() === null, 'nothing is parked for payout');
      assert(SR.liveElapsedMs(SR.read()) >= 3 * MIN, 'focused time carried across the hop');
      log('✓ an in-app page hop resumes the session intact');
    }

    // ══ 14. resolveOnLoad — RUNNING AWAY PAYS THE CHECKPOINT ══
    // The single most important assertion in this file.
    {
      reset();
      startSession();
      advance(90 * 1000);
      SR.heartbeat();                     // checkpoint = 90s
      advance(45 * 1000);                 // live = 135s, unbanked = 45s
      assert(SR.liveElapsedMs(SR.read()) === 135 * 1000, 'live elapsed is 135s before the refresh');

      const r = SR.resolveOnLoad();       // no token: a refresh, not a hop
      assert(r.kind === 'abandoned', 'no token = abandoned, got ' + r.kind);
      assert(r.session.abandonReason === 'no-transfer-token', 'the reason is recorded, got ' + r.session.abandonReason);
      assert(r.session.creditedElapsedMs === 90 * 1000,
        'credit is the LAST CHECKPOINT (90s), not live elapsed (135s) — got ' + r.session.creditedElapsedMs);
      assert(SR.read() === null, 'the active record is gone');
      const parked = SR.readPendingAbandon();
      assert(parked && parked.creditedElapsedMs === 90 * 1000, 'the parked record carries the credit for app.js to drain');
      assert(parked.taskId === 'task-1' && parked.difficultyMultiplier === 1.5,
        'the parked record carries everything the reward pipeline needs');
      log('✓ running away credits the last checkpoint and forfeits the rest');
    }

    // ══ 15. AN EXPIRED TOKEN IS STILL RUNNING AWAY ══
    {
      reset();
      startSession();
      advance(2 * MIN);
      SR.issueTransferToken('index', 'village');   // heartbeats → checkpoint 2m
      advance(SR.TRANSFER_TTL_MS + 5000);          // dawdled far too long
      const r = SR.resolveOnLoad();
      assert(r.kind === 'abandoned', 'an expired token cannot launder an abandon, got ' + r.kind);
      assert(r.session.abandonReason === 'expired', 'reason distinguishes expiry from a missing token');
      assert(r.session.creditedElapsedMs === 2 * MIN, 'credit is the checkpoint taken when the token was issued');
      log('✓ a stale token is treated as an abandon, not a resume');
    }

    // ══ 16. A TOKEN FOR A DIFFERENT SESSION IS REFUSED ══
    {
      reset();
      startSession();
      advance(MIN); SR.heartbeat();
      const stolen = { sessionId: 'sess-somebody-else', issuedAtMs: _t, fromPage: 'index', toPage: 'village', ttlMs: SR.TRANSFER_TTL_MS };
      localStorage.setItem(SR.TRANSFER_KEY, JSON.stringify(stolen));
      const r = SR.resolveOnLoad();
      assert(r.kind === 'abandoned', 'a token for another sessionId does not resume this one, got ' + r.kind);
      assert(r.session.creditedElapsedMs === MIN, 'still merciful — the checkpoint is paid');
      log('✓ a mismatched sessionId is refused even when the token is fresh');
    }

    // ══ 17. ABANDON WITH NOTHING BANKED PAYS NOTHING ══
    {
      reset();
      startSession();
      advance(12 * 1000);                 // never reached a heartbeat
      const r = SR.resolveOnLoad();
      assert(r.kind === 'abandoned', '12s then refresh is an abandon');
      assert(r.session.creditedElapsedMs === 0, 'nothing banked, nothing paid — got ' + r.session.creditedElapsedMs);
      assert(SR.checkpointMinutes(r.session) === 0, 'and it rounds to 0 minutes');
      log('✓ running away before the first checkpoint pays nothing');
    }

    // ══ 18. DOUBLE-CREDITING IS STRUCTURALLY IMPOSSIBLE ══
    {
      reset();
      startSession();
      advance(4 * MIN); SR.heartbeat();
      const first = SR.resolveOnLoad();
      assert(first.kind === 'abandoned', 'first load detects the abandon');

      const second = SR.resolveOnLoad();  // simulate a second reload before app.js drains
      assert(second.kind === 'none', 'the second load finds no active record — got ' + second.kind);
      const parked = SR.readPendingAbandon();
      assert(parked && parked.creditedElapsedMs === 4 * MIN, 'exactly ONE parked payout survives, still 4m');

      SR.clearPendingAbandon();
      assert(SR.readPendingAbandon() === null, 'draining the queue empties it');
      log('✓ one abandon can only ever be parked (and therefore paid) once');
    }

    // ══ 19. PAUSED SESSIONS SURVIVE A SANCTIONED HOP ══
    {
      reset();
      startSession();
      advance(6 * MIN);
      SR.pause();
      SR.issueTransferToken('index', 'village');
      advance(300);
      const r = SR.resolveOnLoad();
      assert(r.kind === 'resume', 'a held session hops just as well as a running one');
      assert(r.session.status === 'paused', 'and arrives still held');
      advance(9 * MIN);
      assert(SR.liveElapsedMs(SR.read()) === 6 * MIN, 'the clock stays frozen on the other page too');
      log('✓ HOLD survives navigation without leaking time');
    }

    // ══ 20. clear() WIPES BOTH KEYS ══
    {
      reset();
      startSession();
      SR.issueTransferToken('index', 'village');
      SR.clear();
      assert(SR.read() === null, 'clear() drops the active record');
      assert(SR.readTransferToken() === null, 'clear() drops any pending token too');
      log('✓ clear() leaves no session residue behind');
    }

    // ══ 21. CORRUPT / HOSTILE STORAGE DOES NOT THROW ══
    // A running session must not be taken down by unparseable JSON.
    {
      reset();
      localStorage.setItem(SR.ACTIVE_KEY, '{not json at all');
      assert(SR.read() === null, 'unparseable active record reads as null');
      const r = SR.resolveOnLoad();
      assert(r.kind === 'none', 'and resolves to none rather than throwing');

      localStorage.setItem(SR.TRANSFER_KEY, 'nope');
      assert(SR.consumeTransferToken().valid === false, 'unparseable token is simply invalid');

      assert(SR.liveElapsedMs(null) === 0, 'liveElapsedMs(null) is 0');
      assert(SR.remainingMs(null) === 0, 'remainingMs(null) is 0');
      assert(SR.checkpointElapsedMs(undefined) === 0, 'checkpointElapsedMs(undefined) is 0');
      assert(SR.heartbeat() === null, 'heartbeat with no session is a no-op');
      assert(SR.pause() == null, 'pause with no session is a no-op');
      assert(SR.resume() == null, 'resume with no session is a no-op');
      assert(SR.issueTransferToken('a', 'b') === null, 'no session means no token to issue');
      log('✓ corrupt storage and missing records degrade quietly');
    }

    // ══ 22. HEARTBEAT CADENCE SITS IN THE AGREED BAND ══
    {
      assert(SR.HEARTBEAT_MS >= 10000 && SR.HEARTBEAT_MS <= 20000,
        'checkpoint interval must stay in the 10–20s band, got ' + SR.HEARTBEAT_MS);
      assert(SR.TRANSFER_TTL_MS > 0 && SR.TRANSFER_TTL_MS <= 15000,
        'transfer TTL must stay short enough to be unreplayable, got ' + SR.TRANSFER_TTL_MS);
      log('✓ tuning constants are within the designed bounds');
    }

    // ══ 23. WORST-CASE FORFEIT IS BOUNDED BY THE HEARTBEAT ══
    // Simulating the real loop: a heartbeat every HEARTBEAT_MS. However
    // unlucky the timing, you can never lose more than one interval.
    {
      reset();
      startSession();
      let nextBeat = T0 + SR.HEARTBEAT_MS;
      // Deliberately NOT a whole multiple of the heartbeat — landing exactly
      // on a beat would make the forfeit 0ms and the assertion meaningless.
      const target = T0 + 10 * MIN + 7331;
      while (nextBeat <= target) { at(nextBeat); SR.heartbeat(); nextBeat += SR.HEARTBEAT_MS; }
      at(target);
      const live = SR.liveElapsedMs(SR.read());
      const r = SR.resolveOnLoad();
      const forfeited = live - r.session.creditedElapsedMs;
      assert(forfeited > 0, 'this scenario is meant to forfeit a partial window');
      assert(forfeited < SR.HEARTBEAT_MS, 'worst-case loss is under one heartbeat, got ' + forfeited + 'ms');
      log('✓ the mercy window is bounded by exactly one heartbeat (' + forfeited + 'ms lost here)');
    }

    // ══ 24. COSMETIC NAV HINT — independent of session state ══
    // This flag exists purely so the boot screen can skip its marketing/
    // sign-in splash for a routine village↔forge hop. It must work with
    // NO session running at all (that's the whole point — this is the
    // gap the session/abandon-scoped transfer token deliberately doesn't
    // cover), and it must never be readable as session/abandon state.
    {
      reset();
      // No session exists at all — issuing and consuming must still work.
      assert(SR.read() === null, 'sanity: no session exists for this test');
      SR.issueNavHint();
      assert(SR.consumeNavHint() === true, 'a fresh nav hint is valid even with zero session state');
      log('✓ nav hint works with no session running — this is its entire purpose');
    }

    {
      reset();
      assert(SR.consumeNavHint() === false, 'consuming with nothing issued is false, not a throw');
    }

    {
      reset();
      SR.issueNavHint();
      assert(SR.consumeNavHint() === true, 'first consume of a fresh hint succeeds');
      assert(SR.consumeNavHint() === false, 'second consume of the same hint fails — single use, like the transfer token');
      log('✓ nav hint is single-use, same discipline as the transfer token');
    }

    {
      reset();
      SR.issueNavHint();
      at(T0 + SR.NAV_HINT_TTL_MS + 1);
      assert(SR.consumeNavHint() === false, 'an expired nav hint is rejected, not silently accepted');
      log('✓ nav hint respects its own TTL — a stale hint from a long-abandoned tab does not count');
    }

    {
      // The nav hint and the session transfer token are stored under
      // different keys and must not interfere with each other.
      assert(SR.NAV_HINT_KEY !== SR.TRANSFER_KEY, 'nav hint uses a distinct storage key from the session transfer token');
      reset();
      startSession();
      SR.issueTransferToken('index', 'village');
      assert(SR.consumeNavHint() === false, 'issuing a transfer token does NOT also satisfy the nav hint — they are independent');
      log('✓ nav hint and session transfer token are fully independent mechanisms');
    }

    log('All session runtime tests passed ✅ — elapsed math, pause exclusion, checkpointing, token TTL/single-use, abandon credit, double-credit safety, and the cosmetic nav hint verified');
  }

  try { run(); } catch (e) { console.error(e); process.exit(1); }

})();
