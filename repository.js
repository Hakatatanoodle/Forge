// ═══════════════════════════════════════════════════════
// repository.js — persistence boundary (Phase 0 of the
// architecture migration — see FORGE_Architectural_Change_Proposal)
//
// Single source of truth for READING and WRITING app state, hiding
// whether it comes from localStorage, Firestore, or a merge of both.
//
// Why this exists: before this module, app.js had three different
// code paths that loaded state — the initial boot read, the signed-in
// cloud path, and the offline/guest path — and they didn't all run the
// same migration step. That's exactly how a real bug shipped: cloud
// state loaded via FB.loadState() + Storage.deepMerge() skipped
// Storage.migrate() entirely, while the local path ran it correctly.
// Every load now goes through this one function, so that class of bug
// is structurally impossible going forward.
//
// This module owns NO UI, NO DOM, NO app-level decisions (like "is this
// user's name already set"). It only answers three questions:
//   - what is the current state?          → loadState()
//   - persist this state                  → saveState()
//   - wipe state (logout / account reset) → clearState()
// ═══════════════════════════════════════════════════════

const Repository = (() => {

  // ── LOAD ──
  // Always returns a fully migrated, schema-complete state object,
  // regardless of where it came from.
  //
  //   signedIn=true,  cloud has a doc   → cloud state (migrated), source: 'cloud'
  //   signedIn=true,  cloud empty/fails → local state (migrated), source: 'local'
  //   signedIn=false                    → local state (migrated), source: 'local'
  //
  // 'local' as a source when signedIn=true means "no cloud document yet" —
  // e.g. the very first time this Google account has signed in. The
  // caller (app.js) uses that signal to decide whether this looks like a
  // brand-new cloud user (worth naming from their Google profile).
  async function loadState({ signedIn }) {
    if (signedIn) {
      const result = await FB.loadState();
      if (result.ok && result.state) {
        // Capture the RAW version BEFORE merging — deepMerge would
        // otherwise silently backfill a missing schemaVersion from
        // defaultState()'s current one, making migrate() think stale
        // cloud data is already current and skip every migration step.
        const rawFrom = result.state.schemaVersion || 0;
        const base = Storage.defaultState();
        return {
          state:  Storage.migrate(Storage.deepMerge(base, result.state), rawFrom),
          source: 'cloud'
        };
      }
      // Signed in, but no cloud doc yet — fall through to local.
      // Storage.load() already runs deepMerge + migrate internally.
    }
    return { state: Storage.load(), source: 'local' };
  }

  // ── SAVE ──
  // Always writes local (the offline source of truth). Also writes to
  // Firestore when signed in — best-effort, never throws, never blocks
  // the local write on a network failure.
  async function saveState(state, { signedIn }) {
    Storage.save(state);
    if (signedIn) {
      await FB.saveState(state);
    }
  }

  // ── CLEAR ──
  // Resets to a fresh default state and saves it locally. Optionally
  // also deletes the user's Firestore document (full account reset,
  // NOT the same as signing out — signing out should leave cloud data
  // untouched so the user can sign back in later and pick up where
  // they left off).
  async function clearState({ alsoCloud } = {}) {
    if (alsoCloud) {
      await FB.deleteUserData();
    }
    const fresh = Storage.defaultState();
    Storage.save(fresh);
    return fresh;
  }

  return { loadState, saveState, clearState };

})();

// Expose for classic-script consumers (app.js reads window.Repository).
if (typeof window !== 'undefined') window.Repository = Repository;
