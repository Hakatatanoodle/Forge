// ═══════════════════════════════════════════════════════
// tests.repository.js — characterization tests for repository.js
//
// This is the exact seam that caused a real production bug: cloud state
// loaded via the old FB.loadState() + deepMerge() path skipped
// Storage.migrate() entirely, while the local Storage.load() path ran it
// correctly. Two different behaviors for the same "give me the state"
// request. These tests pin down the contract so that class of bug can't
// silently come back during future refactors (per Phase 0 of the
// architecture migration — see FORGE_Architectural_Change_Proposal).
//
// Runs in Node only (mocks FB — the real firebase.js needs the actual
// Firebase SDK global, which doesn't exist outside the browser).
// ═══════════════════════════════════════════════════════

(() => {
  const assert = (cond, msg) => {
    if (!cond) throw new Error('ASSERT FAIL: ' + msg);
  };
  const log = (...args) => console.log('[REPO TEST]', ...args);

  if (typeof require === 'undefined') {
    console.warn('tests.repository.js: Node-only, skipping in browser.');
    return;
  }

  const fs = require('fs');

  // Mock localStorage
  global.localStorage = {
    _s: {},
    getItem(k)  { return this._s[k] || null; },
    setItem(k,v){ this._s[k] = v; },
    removeItem(k){ delete this._s[k]; }
  };

  // Load the real storage.js (Repository must use the real migration logic)
  let sCode = fs.readFileSync('./storage.js', 'utf8').replace('const Storage', 'global.Storage');
  eval(sCode);
  const Storage = global.Storage;

  async function run() {
    log('Starting repository tests...');

    // ── Mock FB — swap behavior per test via closures ──
    let mockCloudState  = null;   // what FB.loadState() returns as .state
    let mockCloudExists = false;  // whether FB has a doc at all
    let savedToCloud    = null;   // capture what FB.saveState() was called with
    let deletedCloud     = false;

    global.FB = {
      async loadState() {
        if (!mockCloudExists) return { ok: true, state: null };
        return { ok: true, state: mockCloudState };
      },
      async saveState(state) {
        savedToCloud = state;
        return { ok: true };
      },
      async deleteUserData() {
        deletedCloud = true;
        return { ok: true };
      },
      isSignedIn() { return true; }
    };

    // Load repository.js AFTER Storage + FB mocks are in place
    let rCode = fs.readFileSync('./repository.js', 'utf8').replace('const Repository', 'global.Repository');
    eval(rCode);
    const Repository = global.Repository;

    // ── TEST 1: signed out → local state, fully migrated ──
    localStorage._s = {}; // clean slate
    {
      const { state, source } = await Repository.loadState({ signedIn: false });
      assert(source === 'local', 'guest load source is local');
      assert(state.schemaVersion === Storage.SCHEMA_VERSION, 'guest load is migrated');
      assert(state.weeks === undefined, 'guest load has legacy weeks field removed by migration');
      log('✓ loadState signedIn=false returns migrated local state');
    }

    // ── TEST 2: signed in, cloud HAS data → cloud state, fully migrated ──
    // This is the exact regression test for the original bug: cloud data
    // saved under an OLD schema (pre-v12, still has `weeks`, no
    // `schemaVersion`) must come back migrated, not raw.
    {
      mockCloudExists = true;
      mockCloudState = {
        user: { name: 'OLD USER', xp: 500, level: 2 },
        tasks: [{ id: 't1', text: 'legacy task', weekId: 'w1', day: 2 }],
        weeks: [{ id: 'w1' }],
        goals: [],
        pillars: [{ id: 'academics', name: 'Academics', color: '#fff' }]
        // no schemaVersion — simulates data saved before migrations existed
      };
      const { state, source } = await Repository.loadState({ signedIn: true });
      assert(source === 'cloud', 'returning cloud user source is cloud');
      assert(state.schemaVersion === Storage.SCHEMA_VERSION, 'cloud load is migrated to current schema');
      assert(state.weeks === undefined, 'cloud load has legacy weeks field removed by migration');
      assert(state.tasks[0].weekId === undefined, 'cloud load strips legacy task.weekId via migration');
      assert(state.user.name === 'OLD USER', 'cloud load preserves real user data through migration');
      log('✓ loadState signedIn=true with cloud data returns MIGRATED cloud state (regression test for original bug)');
    }

    // ── TEST 3: signed in, cloud EMPTY (first sign-in) → falls back to local ──
    {
      mockCloudExists = false;
      localStorage._s = {}; // clean slate — brand new guest→cloud transition
      const { state, source } = await Repository.loadState({ signedIn: true });
      assert(source === 'local', 'first-time cloud sign-in falls back to local source');
      assert(state.schemaVersion === Storage.SCHEMA_VERSION, 'first-time cloud sign-in fallback is still migrated');
      log('✓ loadState signedIn=true with no cloud doc falls back to migrated local state');
    }

    // ── TEST 4: saveState signedIn=false skips cloud entirely ──
    {
      savedToCloud = null;
      const fresh = Storage.defaultState();
      await Repository.saveState(fresh, { signedIn: false });
      assert(savedToCloud === null, 'saveState signedIn=false never touches FB.saveState');
      const raw = JSON.parse(localStorage.getItem('forge_state'));
      assert(raw.schemaVersion === Storage.SCHEMA_VERSION, 'saveState signedIn=false writes to localStorage');
      log('✓ saveState signedIn=false writes local only');
    }

    // ── TEST 5: saveState signedIn=true writes BOTH local and cloud ──
    {
      savedToCloud = null;
      const fresh = Storage.defaultState();
      fresh.user.name = 'CLOUD SAVE TEST';
      await Repository.saveState(fresh, { signedIn: true });
      assert(savedToCloud !== null, 'saveState signedIn=true calls FB.saveState');
      assert(savedToCloud.user.name === 'CLOUD SAVE TEST', 'saveState signedIn=true passes the real state to FB');
      const raw = JSON.parse(localStorage.getItem('forge_state'));
      assert(raw.user.name === 'CLOUD SAVE TEST', 'saveState signedIn=true ALSO writes local');
      log('✓ saveState signedIn=true writes both local and cloud');
    }

    // ── TEST 6: clearState({alsoCloud:false}) — sign-out, cloud untouched ──
    {
      deletedCloud = false;
      const result = await Repository.clearState({ alsoCloud: false });
      assert(deletedCloud === false, 'clearState alsoCloud=false never deletes cloud data');
      assert(result.schemaVersion === Storage.SCHEMA_VERSION, 'clearState returns a fresh valid state');
      const raw = JSON.parse(localStorage.getItem('forge_state'));
      assert(raw.user.name === '', 'clearState alsoCloud=false resets local state');
      log('✓ clearState alsoCloud=false (sign-out) resets local only, cloud untouched');
    }

    // ── TEST 7: clearState({alsoCloud:true}) — full account reset ──
    {
      deletedCloud = false;
      await Repository.clearState({ alsoCloud: true });
      assert(deletedCloud === true, 'clearState alsoCloud=true DOES delete cloud data');
      log('✓ clearState alsoCloud=true (account reset) also deletes cloud data');
    }

    log('All repository tests passed ✅ — persistence boundary is consistent');
  }

  run().catch(e => { console.error(e); process.exit(1); });

})();
