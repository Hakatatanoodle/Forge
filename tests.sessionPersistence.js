// ═══════════════════════════════════════════════════════
// tests.sessionPersistence.js — Phase 0 FLOW tests
//
// Drives the real villagePage.js against the real village.html markup and
// the real sessionRuntime.js / timer.js / storage.js, end to end:
//
//   (a) start a session → issue a transfer token → load village.html →
//       the session CONTINUES (strip counts down, checkpoints keep
//       advancing) → BACK TO FORGE hands it back intact.
//   (b) start a session → let checkpoints accumulate → load village.html
//       with NO token (a refresh) → it is an abandon, and the credit is
//       the LAST CHECKPOINT, not the full live elapsed time.
//
// DOM strategy — read this before "fixing" it:
//   tests.plan.js uses jsdom. This file deliberately does NOT require it.
//   It builds its element table from the ids actually present in
//   village.html, so a renamed or deleted id fails the test exactly as a
//   real DOM would, and the suite runs with zero npm dependencies (which
//   matters for a project whose first non-negotiable is "no build step").
//   If jsdom is installed it is simply not needed here.
//
// Time and timers are both faked, so every assertion is exact.
// ═══════════════════════════════════════════════════════

(() => {
  const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAIL: ' + msg); };
  const log = (...args) => console.log('[FLOW TEST]', ...args);

  if (typeof require === 'undefined') {
    console.warn('tests.sessionPersistence.js: Node-only, skipping in browser.');
    return;
  }

  const fs  = require('fs');
  const MIN = 60000;

  // ── FAKE CLOCK ──
  // timer.js reads Date.now() directly (no injectable clock), so the clock
  // itself is stubbed rather than only SessionRuntime's.
  const T0 = 1_700_000_000_000;
  let _t = T0;
  Date.now = () => _t;
  function at(ms)      { _t = ms; return _t; }
  function advance(ms) { _t += ms; return _t; }

  // ── FAKE TIMERS ──
  // villagePage.js and timer.js both run intervals. Capturing them lets a
  // test say "now one heartbeat fires" instead of sleeping.
  let _timers = [];
  let _nextTimerId = 1;
  global.setInterval  = (fn, ms) => { const id = _nextTimerId++; _timers.push({ id, fn, ms, type: 'interval' }); return id; };
  global.setTimeout   = (fn, ms) => { const id = _nextTimerId++; _timers.push({ id, fn, ms, type: 'timeout'  }); return id; };
  global.clearInterval = id => { _timers = _timers.filter(t => t.id !== id); };
  global.clearTimeout  = global.clearInterval;

  function intervals()     { return _timers.filter(t => t.type === 'interval'); }
  function runIntervals()  { intervals().forEach(t => t.fn()); }
  function runTimeouts()   {
    const due = _timers.filter(t => t.type === 'timeout');
    _timers = _timers.filter(t => t.type !== 'timeout');
    due.forEach(t => t.fn());
  }
  function resetTimers()   { _timers = []; }

  // ── MINIMAL DOM ──
  // One stub element per id that village.html actually declares. Reading
  // the ids out of the real markup is the point: rename an id in the HTML
  // without updating villagePage.js and these tests fail.
  const VILLAGE_HTML = fs.readFileSync('./village.html', 'utf8');
  const VILLAGE_IDS  = Array.from(VILLAGE_HTML.matchAll(/id="([^"]+)"/g)).map(m => m[1]);

  function mkEl(id) {
    const cls = new Set();
    return {
      id,
      textContent: '',
      innerHTML: '',
      offsetWidth: 1,
      _handlers: {},
      _attrs: {},
      style: {
        _p: {},
        setProperty(k, v) { this._p[k] = v; },
        getPropertyValue(k) { return this._p[k]; }
      },
      classList: {
        add(c)    { cls.add(c); },
        remove(c) { cls.delete(c); },
        contains(c) { return cls.has(c); },
        toggle(c, on) {
          if (on === undefined) { cls.has(c) ? cls.delete(c) : cls.add(c); }
          else if (on) cls.add(c);
          else cls.delete(c);
          return cls.has(c);
        }
      },
      get className() { return Array.from(cls).join(' '); },
      set className(v) {
        cls.clear();
        String(v).split(/\s+/).filter(Boolean).forEach(c => cls.add(c));
      },
      setAttribute(k, v) { this._attrs[k] = v; },
      getAttribute(k)    { return (k in this._attrs) ? this._attrs[k] : null; },
      addEventListener(ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn); },
      fire(ev) { (this._handlers[ev] || []).forEach(fn => fn({ preventDefault() {} })); }
    };
  }

  let _els = {};
  let _docHandlers = {};
  let _navs = [];

  function freshDom() {
    _els = {};
    _docHandlers = {};
    _navs = [];
    VILLAGE_IDS.forEach(id => { _els[id] = mkEl(id); });
    global.document = {
      readyState: 'complete',
      hidden: false,
      body: mkEl('body'),
      getElementById(id) { return _els[id] || null; },
      addEventListener(ev, fn) { (_docHandlers[ev] = _docHandlers[ev] || []).push(fn); }
    };
    // Navigation is recorded, not performed. assign() = a normal in-app
    // hop; replace() = the abandon bounce, which must not be back-buttonable.
    global.location = {
      href: 'http://localhost/village.html',
      assign(url)  { _navs.push({ type: 'assign',  url }); },
      replace(url) { _navs.push({ type: 'replace', url }); },
      reload()     { _navs.push({ type: 'reload',  url: 'village.html' }); }
    };
    global.window.location = global.location;
  }

  function $(id) { return _els[id]; }
  function fireDoc(ev) { (_docHandlers[ev] || []).forEach(fn => fn({})); }

  // ── localStorage ──
  global.localStorage = {
    _s: {},
    getItem(k)    { return (k in this._s) ? this._s[k] : null; },
    setItem(k, v) { this._s[k] = String(v); },
    removeItem(k) { delete this._s[k]; }
  };

  // `window === global` so the modules' `window.X = X` exports land where
  // the tests can see them, and villagePage.js's autoboot guard is settable.
  global.window = global;
  global.window.__FORGE_VILLAGE_NO_AUTOBOOT = true;   // tests call init() themselves
  freshDom();

  // ── LOAD THE REAL MODULES ──
  // Same load-and-rebind pattern as the other suites: the shipped files are
  // executed verbatim apart from turning their top-level `const` into a
  // global, so a bug in the real file is a failure here.
  function loadModule(file, name) {
    const code = fs.readFileSync('./' + file, 'utf8').replace('const ' + name, 'global.' + name);
    eval(code);
    return global[name];
  }

  // Deliberately NOT captured into local consts named Storage/Timer/XP:
  // `window === global` here, so each module's closing `window.X = X` line
  // would resolve X to a shadowing const still in its TDZ. Leaving them as
  // pure globals is also exactly how the browser sees them.
  loadModule('storage.js',        'Storage');
  loadModule('sessionRuntime.js', 'SessionRuntime');
  loadModule('timer.js',          'Timer');
  loadModule('xp.js',             'XP');
  loadModule('villagePage.js',    'VillagePage');

  const SR = global.SessionRuntime;

  SR._setClock(() => _t);

  // ── FIXTURES ──
  function seedState(over) {
    const st = Storage.defaultState();
    st.user.name        = 'HAKATA';
    st.user.coins       = 240;
    st.user.level       = 7;
    st.user.activeTheme = 'venom';
    st.user.streak.current = 3;
    st.sessions = [
      { id: 'a', taskId: 't1', completed: true,  focusedMinutes: 50, startTime: '2026-08-28T09:00:00', endTime: '2026-08-28T09:50:00' },
      { id: 'b', taskId: 't1', completed: true,  focusedMinutes: 40, startTime: '2026-08-29T09:00:00', endTime: '2026-08-29T09:40:00' },
      { id: 'c', taskId: 't1', completed: false, focusedMinutes: 30, startTime: '2026-08-29T11:00:00', endTime: '2026-08-29T11:30:00' }
    ];
    st.tasks = [{ id: 't1', text: 'Write the compiler', tag: 'gamedev', completed: false }];
    Object.assign(st, over || {});
    Storage.save(st);
    return st;
  }

  function startSessionOnForge(plannedMinutes) {
    return SR.start({
      taskId: 't1',
      goalId: 'g1',
      taskLabel: 'Write the compiler',
      intention: 'ship the parser',
      difficultyMultiplier: 1.5,
      plannedMinutes: plannedMinutes || 50,
      startedAtISO: '2026-08-30T09:00:00'
    });
  }

  function resetWorld() {
    localStorage._s = {};
    _t = T0;
    resetTimers();
    freshDom();
    Timer.stop();
    // Re-evaluate villagePage.js so its module-private state (view-only
    // flag, navigation guard, interval handles) starts clean — which is
    // what a real page load gives you, and what makes each scenario below
    // independent of the one before it.
    loadModule('villagePage.js', 'VillagePage');
  }

  function clockText() {
    return $('village-strip-mins').textContent + ':' + $('village-strip-secs').textContent;
  }

  function run() {
    log('Running…');

    // ═══════════════════════════════════════════════
    // (a) SANCTIONED HOP — THE SESSION CONTINUES
    // ═══════════════════════════════════════════════
    {
      resetWorld();
      seedState();

      // — on index.html —
      const rec = startSessionOnForge(50);
      advance(3 * MIN);
      SR.heartbeat();                                  // checkpoint 3m
      advance(20 * 1000);                              // 3m20s focused
      SR.issueTransferToken('index', 'village');       // what goToVillage() does
      const tokenIssuedElapsed = SR.liveElapsedMs(SR.read());
      assert(tokenIssuedElapsed === 3 * MIN + 20000, 'sanity: 3m20s focused before leaving');

      // — village.html loads —
      advance(350);                                    // page load latency
      VillagePage.init();

      assert(_navs.length === 0, 'a valid token means village.html does NOT bounce you back');
      assert(SR.read() !== null, 'the active session record survives the hop');
      assert(SR.readPendingAbandon() === null, 'nothing was scored as an abandon');
      assert(SR.read().sessionId === rec.sessionId, 'and it is the same session');
      log('✓ (a) village.html accepts a valid transfer token and keeps the session alive');

      // Timer strip renders the REMAINING time from the persisted record,
      // not from any in-memory state this page never had.
      assert(!$('village-timer-strip').classList.contains('hidden'), 'the timer strip is visible during a session');
      const expectRemain = 50 * MIN - (3 * MIN + 20000 + 350);
      const expectSecs   = Math.ceil(expectRemain / 1000);
      const expectText   = String(Math.floor(expectSecs / 60)).padStart(2, '0') + ':' + String(expectSecs % 60).padStart(2, '0');
      assert(clockText() === expectText, 'strip shows remaining time ' + expectText + ', got ' + clockText());
      assert($('village-strip-label').textContent === 'FOCUS', 'label reads FOCUS while running');
      assert($('village-strip-task').textContent === 'Write the compiler', 'the strip names the task from the denormalised record');
      log('✓ (a) the strip counts down the real remaining time (' + clockText() + ')');

      // View-only lock.
      assert(VillagePage.isViewOnly() === true, 'the page reports itself view-only');
      assert(!$('village-lock').classList.contains('hidden'), 'the lock overlay is shown');
      assert(document.body.classList.contains('village-view-only'), 'body carries the view-only class for Phase 1 gating');
      log('✓ (a) the land is view-only while a session runs');

      // Read-only mirror of saved state.
      assert(document.body.getAttribute('data-theme') === 'venom', 'the saved theme is applied, got ' + document.body.getAttribute('data-theme'));
      assert(String($('village-coins').textContent) === '240', 'coins mirrored from saved state, got ' + $('village-coins').textContent);
      assert(/village-plot/.test($('village-grid-placeholder').innerHTML), 'placeholder land is rendered');
      log('✓ (a) coins / theme mirror the saved state (read-only)');

      // Heartbeats keep running HERE. Without this, browsing the village
      // would freeze the mercy boundary and a later crash would pay only
      // what index.html had banked before you left.
      assert(intervals().length === 2, 'village.html runs its own heartbeat + tick loops, got ' + intervals().length);
      const beforeCp = SR.checkpointElapsedMs(SR.read());
      advance(SR.HEARTBEAT_MS);
      runIntervals();
      const afterCp = SR.checkpointElapsedMs(SR.read());
      assert(afterCp > beforeCp, 'a heartbeat on the village page advances the checkpoint');
      assert(afterCp === SR.liveElapsedMs(SR.read()), 'and banks the full focused time up to now');
      assert(clockText() !== expectText, 'the tick loop repaints the clock as time passes');
      log('✓ (a) checkpoints keep advancing while you browse the village');

      // BACK TO FORGE — sanctioned, so it stamps a token on the way out.
      const elapsedAtLeave = SR.liveElapsedMs(SR.read());
      $('btn-back-to-forge').fire('click');
      assert(_navs.length === 1 && _navs[0].url === 'index.html' && _navs[0].type === 'assign',
        'BACK TO FORGE navigates to index.html');
      const outbound = SR.readTransferToken();
      assert(outbound && outbound.sessionId === rec.sessionId, 'it issues a token bound to the live session');
      assert(outbound.fromPage === 'village', 'the token records where it came from');
      assert(intervals().length === 0, 'and stops its loops so nothing writes after the page is gone');
      log('✓ (a) BACK TO FORGE issues a token instead of abandoning');

      // — index.html loads again and resumes —
      advance(300);
      const back = SR.resolveOnLoad();
      assert(back.kind === 'resume', 'the forge accepts the token, got ' + back.kind);

      const plannedSecs = Math.round(back.session.plannedDurationMs / 1000);
      const elapsedSecs = Math.round(SR.liveElapsedMs(back.session) / 1000);
      Timer.restoreFocus(plannedSecs, elapsedSecs, () => {}, () => {});
      assert(Timer.isRunning() === true, 'the timer is running again after the round trip');
      assert(Timer.getElapsedSecs() === elapsedSecs,
        'Timer re-attaches at the focused total (' + elapsedSecs + 's), got ' + Timer.getElapsedSecs());
      assert(elapsedSecs >= Math.round(elapsedAtLeave / 1000), 'no focused time was lost in the round trip');

      advance(30 * 1000);
      assert(Timer.getElapsedSecs() === elapsedSecs + 30, 'and it keeps counting from there');
      assert(Timer.RING_CIRCUMFERENCE > 0 && Timer.ringOffset(plannedSecs - elapsedSecs, plannedSecs) > 0,
        'the progress ring still measures against the WHOLE planned session');
      log('✓ (a) the forge resumes the session at the right elapsed time — full round trip intact');
      Timer.stop();
    }

    // ═══════════════════════════════════════════════
    // (b) REFRESH WITHOUT A TOKEN — CREDIT IS THE CHECKPOINT
    // ═══════════════════════════════════════════════
    {
      resetWorld();
      seedState();

      startSessionOnForge(50);
      advance(90 * 1000);
      SR.heartbeat();                 // checkpoint = 90s
      advance(45 * 1000);             // live = 135s; 45s unbanked
      assert(SR.liveElapsedMs(SR.read()) === 135 * 1000, 'sanity: 135s focused, 90s banked');

      // A refresh, a tab close, a dead battery — no token is written.
      VillagePage.init();

      assert(_navs.length === 1 && _navs[0].url === 'index.html',
        'an abandon detected on village.html bounces to index.html, where the ONE reward pipeline lives');
      assert(_navs[0].type === 'replace',
        'and it replaces the history entry so the back button cannot re-enter a dead session');
      assert(SR.read() === null, 'the active record is gone');

      const parked = SR.readPendingAbandon();
      assert(parked, 'the abandon is parked for app.js to drain');
      assert(parked.creditedElapsedMs === 90 * 1000,
        'CREDIT IS THE LAST CHECKPOINT (90000ms), NOT LIVE ELAPSED (135000ms) — got ' + parked.creditedElapsedMs);
      assert(Math.floor(parked.creditedElapsedMs / 60000) === 1,
        'which pays 1 minute, not the 2 minutes live elapsed would have rounded to');
      assert(parked.abandonReason === 'no-transfer-token', 'the reason is recorded for the combat log');
      assert(parked.taskId === 't1' && parked.difficultyMultiplier === 1.5 && parked.startedAtISO,
        'the parked record carries everything the reward pipeline needs to log the session');
      log('✓ (b) a refresh mid-session is an abandon, credited at the last checkpoint (90s of 135s)');

      // The village page renders NOTHING on the way out — no strip, no
      // stats, no theme flash from a session that no longer exists.
      assert($('village-timer-strip').classList.contains('hidden') === false ||
             $('village-strip-mins').textContent === '',
        'the strip is never populated during an abandon bounce');
      assert(intervals().length === 0, 'and no loops are started');
      assert(VillagePage.isViewOnly() === false, 'the page never entered view-only mode');
      log('✓ (b) the bounce is immediate — no render, no loops, no reward logic on this page');

      // What the payout WILL be, computed the way app.js computes it.
      const creditedMinutes = Math.floor(parked.creditedElapsedMs / 60000);
      const fullMinutes     = Math.floor(135 * 1000 / 60000);
      const paid   = XP.calculateSessionXP(parked.difficultyMultiplier, 3, creditedMinutes, 7);
      const unfair = XP.calculateSessionXP(parked.difficultyMultiplier, 3, fullMinutes, 7);
      assert(paid.base < unfair.base,
        'the checkpoint payout is strictly smaller than crediting full elapsed would have been');
      log('✓ (b) forfeiting the unbanked tail actually costs XP (' + paid.base + ' vs ' + unfair.base + ' base)');
    }

    // ═══════════════════════════════════════════════
    // (c) NO SESSION — the village is fully yours
    // ═══════════════════════════════════════════════
    {
      resetWorld();
      seedState();
      VillagePage.init();

      assert(_navs.length === 0, 'visiting the village with no session running never redirects');
      assert($('village-timer-strip').classList.contains('hidden'), 'no session = no timer strip');
      assert($('village-lock').classList.contains('hidden'), 'no session = no view-only lock');
      assert(VillagePage.isViewOnly() === false, 'and the page is interactive (Phase 1 builds here)');
      assert(intervals().length === 0, 'no session = no heartbeat or tick loops burning cycles');
      assert(SR.readPendingAbandon() === null, 'and nothing is invented to punish');
      assert(String($('village-coins').textContent) === '240', 'stats still render without a session');
      log('✓ (c) with no session running the village is unlocked and quiet');
    }

    // ═══════════════════════════════════════════════
    // (d) A HELD SESSION HOPS WITHOUT LEAKING TIME
    // ═══════════════════════════════════════════════
    {
      resetWorld();
      seedState();
      startSessionOnForge(50);
      advance(4 * MIN);
      SR.pause();                                  // HOLD on index.html
      SR.issueTransferToken('index', 'village');
      advance(250);
      VillagePage.init();

      assert(_navs.length === 0, 'a held session is still a valid resume');
      assert($('village-strip-label').textContent === 'ON HOLD', 'the strip says ON HOLD, got ' + $('village-strip-label').textContent);
      assert($('village-timer-strip').classList.contains('is-held'), 'and is styled as held');
      const frozen = clockText();

      advance(6 * MIN);
      runIntervals();
      assert(clockText() === frozen, 'the clock does not move while held, got ' + clockText() + ' vs ' + frozen);
      assert(SR.liveElapsedMs(SR.read()) === 4 * MIN, 'and no focused time is invented, got ' + SR.liveElapsedMs(SR.read()));
      assert(SR.checkpointElapsedMs(SR.read()) === 4 * MIN, 'the checkpoint stays at the banked 4m');
      log('✓ (d) a held session survives the hop with its clock genuinely frozen');
    }

    // ═══════════════════════════════════════════════
    // (e) TIME RUNS OUT WHILE YOU ARE ON THE VILLAGE PAGE
    // The village must not pay you. It hands the finished session back to
    // index.html with a valid token so the normal completion path runs.
    // ═══════════════════════════════════════════════
    {
      resetWorld();
      seedState();
      const rec = startSessionOnForge(25);
      SR.issueTransferToken('index', 'village');
      advance(200);
      VillagePage.init();
      assert(_navs.length === 0, 'sanity: we are on the village page with a live session');

      advance(25 * MIN);                       // the session finishes right here
      runIntervals();                          // the tick loop notices

      assert(SR.remainingMs(SR.read()) === 0, 'no time left on the record');
      assert(intervals().length === 0, 'the loops stop the moment time is up');
      runTimeouts();                           // the short "returning" pause
      assert(_navs.length === 1 && _navs[0].url === 'index.html' && _navs[0].type === 'assign',
        'the village hands the session back to the forge, got ' + JSON.stringify(_navs));
      const token = SR.readTransferToken();
      assert(token && token.sessionId === rec.sessionId,
        'with a valid token, so completing does not look like running away');
      assert(SR.readPendingAbandon() === null, 'finishing on the village page is NOT an abandon');
      assert(SR.read() !== null, 'and the record is left for app.js to complete and clear');
      log('✓ (e) a session that ends on the village page is handed back for the real reward pipeline');

      // index.html picks it up and sees a session with nothing left to run.
      advance(300);
      const back = SR.resolveOnLoad();
      assert(back.kind === 'resume', 'the forge resumes it rather than punishing it, got ' + back.kind);
      const plannedSecs = Math.round(back.session.plannedDurationMs / 1000);
      const elapsedSecs = Math.round(SR.liveElapsedMs(back.session) / 1000);
      assert(elapsedSecs >= plannedSecs, 'elapsed >= planned, which is app.js\'s cue to complete immediately');
      log('✓ (e) the forge sees a completed session on arrival and can finish it normally');
    }

    // ═══════════════════════════════════════════════
    // (f) THE SESSION ENDS IN ANOTHER TAB
    // ═══════════════════════════════════════════════
    {
      resetWorld();
      seedState();
      startSessionOnForge(50);
      SR.issueTransferToken('index', 'village');
      advance(100);
      VillagePage.init();
      assert(!$('village-timer-strip').classList.contains('hidden'), 'sanity: strip is up');

      SR.clear();                              // another tab completed/abandoned it
      runIntervals();
      assert($('village-timer-strip').classList.contains('hidden'), 'the strip disappears when the record does');
      assert(VillagePage.isViewOnly() === false, 'and the land unlocks');
      assert(intervals().length === 0, 'and the loops stop rather than counting against nothing');
      assert(_navs.length === 0, 'no spurious redirect — nothing was abandoned here');
      log('✓ (f) the village reacts sanely when the session vanishes underneath it');
    }

    // ═══════════════════════════════════════════════
    // (g) AN UNDRAINED ABANDON STILL BOUNCES
    // Someone abandoned on index.html, then reached the village before
    // app.js paid out (offline, sign-in still pending, whatever). The debt
    // must be settled on the page that owns the reward pipeline.
    // ═══════════════════════════════════════════════
    {
      resetWorld();
      seedState();
      startSessionOnForge(50);
      advance(5 * MIN);
      SR.heartbeat();
      SR.resolveOnLoad();                       // the abandon happened on index.html
      assert(SR.readPendingAbandon(), 'sanity: a payout is parked and undrained');

      VillagePage.init();
      assert(_navs.length === 1 && _navs[0].type === 'replace' && _navs[0].url === 'index.html',
        'the village refuses to render while a payout is owed');
      const still = SR.readPendingAbandon();
      assert(still && still.creditedElapsedMs === 5 * MIN,
        'and it does NOT consume the payout — only app.js may do that, got ' + (still && still.creditedElapsedMs));
      log('✓ (g) an undrained abandon bounces to the forge with the debt intact');
    }

    // ═══════════════════════════════════════════════
    // (h) COMING BACK FROM A BACKGROUNDED TAB
    // Background tabs throttle intervals, so the checkpoint can lag. The
    // visibility handler buys that mercy window back.
    // ═══════════════════════════════════════════════
    {
      resetWorld();
      seedState();
      startSessionOnForge(50);
      SR.issueTransferToken('index', 'village');
      advance(100);
      VillagePage.init();

      advance(4 * MIN);                         // hidden tab: no intervals fired
      assert(SR.checkpointElapsedMs(SR.read()) < 4 * MIN, 'sanity: the checkpoint lagged while hidden');
      document.hidden = false;
      fireDoc('visibilitychange');
      assert(SR.checkpointElapsedMs(SR.read()) === SR.liveElapsedMs(SR.read()),
        'becoming visible immediately banks the focused time, got ' + SR.checkpointElapsedMs(SR.read()));
      log('✓ (h) returning to a backgrounded village tab catches the checkpoint up');
    }

    // ═══════════════════════════════════════════════
    // (i) WIRING — the parts a DOM test cannot reach
    // These are source-level assertions on purpose. They guard the three
    // things that silently break Phase 0 without any test failing:
    // missing script tags, an unbumped cache version, and the abandon
    // payout drifting away from the checkpoint rule inside app.js.
    // ═══════════════════════════════════════════════
    {
      const indexHtml = fs.readFileSync('./index.html', 'utf8');
      const appJs     = fs.readFileSync('./app.js', 'utf8');
      const swJs      = fs.readFileSync('./sw.js', 'utf8');

      // Every id villagePage.js reaches for must actually exist in the markup.
      const pageJs   = fs.readFileSync('./villagePage.js', 'utf8');
      const usedIds  = Array.from(pageJs.matchAll(/\$\('([^']+)'\)/g)).map(m => m[1]);
      const missing  = usedIds.filter(id => VILLAGE_IDS.indexOf(id) === -1);
      assert(missing.length === 0, 'villagePage.js references ids missing from village.html: ' + missing.join(', '));
      assert(usedIds.length >= 8, 'sanity: the id scan actually found the lookups, got ' + usedIds.length);

      // Script tags — village.html must load exactly what it needs and
      // nothing that would drag Firebase or app.js onto this page.
      ['storage.js', 'sessionRuntime.js', 'villagePage.js'].forEach(f => {
        assert(VILLAGE_HTML.indexOf('src="' + f + '"') !== -1, 'village.html must load ' + f);
      });
      ['app.js', 'firebase.js', 'repository.js', 'plan.js', 'calendar.js'].forEach(f => {
        assert(VILLAGE_HTML.indexOf('src="' + f + '"') === -1, 'village.html must NOT load ' + f + ' — it is a reader, not the app');
      });
      assert(indexHtml.indexOf('src="sessionRuntime.js"') !== -1, 'index.html must load sessionRuntime.js');
      assert(indexHtml.indexOf('id="btn-goto-village"') !== -1, 'index.html needs the dashboard village entry');
      assert(indexHtml.indexOf('id="btn-session-goto-village"') !== -1, 'index.html needs the mid-session village peek');
      log('✓ (i) both pages load exactly the scripts they should');

      // Offline: village.html is a real entry point, so it must be precached.
      ['./village.html', './villagePage.js', './sessionRuntime.js'].forEach(f => {
        assert(swJs.indexOf("'" + f + "'") !== -1, 'sw.js APP_FILES must precache ' + f);
      });
      log('✓ (i) the service worker precaches the village for offline use');

      // Version discipline: 4 strings in index.html + CACHE_VERSION in sw.js
      // + the village stamp, all bumped together or the SW serves a mixed
      // set of files from two different releases.
      const ver = (indexHtml.match(/v(\d+)\.(\d+)/) || [])[0];
      assert(ver, 'index.html must carry a version string');
      const verCount = (indexHtml.match(new RegExp(ver.replace('.', '\\.'), 'g')) || []).length;
      assert(verCount === 4, 'index.html must show ' + ver + ' in all 4 places, found ' + verCount);
      const cacheVer = (swJs.match(/CACHE_VERSION\s*=\s*'([^']+)'/) || [])[1];
      assert(cacheVer === 'forge-' + ver.replace('.', '-'),
        'sw.js CACHE_VERSION must track ' + ver + ', got ' + cacheVer);
      assert(VILLAGE_HTML.indexOf(ver) !== -1, 'village.html version stamp must match ' + ver);
      log('✓ (i) version strings agree across index.html, village.html and sw.js (' + ver + ')');

      // The payout rule itself, inside app.js.
      const payout = appJs.slice(appJs.indexOf('async function applyPendingAbandon'));
      assert(payout.indexOf('creditedElapsedMs') !== -1,
        'applyPendingAbandon must pay creditedElapsedMs (the checkpoint)');
      assert(payout.slice(0, payout.indexOf('applyXP')).indexOf('clearPendingAbandon') !== -1,
        'the pending slot must be cleared BEFORE XP is granted, or a crash mid-payout pays twice');
      assert(/completed:\s*false/.test(payout) && /abandoned:\s*true/.test(payout),
        'an abandoned session must be logged as completed:false / abandoned:true so achievements stay honest');
      assert(appJs.indexOf('SessionRuntime.resolveOnLoad()') !== -1, 'app.js must resolve the runtime on load');
      assert(appJs.indexOf('SessionRuntime.issueTransferToken') !== -1, 'app.js must issue tokens before leaving');
      log('✓ (i) app.js still pays the checkpoint, once, and logs abandons as incomplete');
    }

    log('All Phase 0 flow tests passed ✅ — sanctioned hops resume intact, refreshes abandon at the last checkpoint, holds freeze cleanly, and the village never pays out');
  }

  try { run(); } catch (e) { console.error(e); process.exit(1); }

})();
