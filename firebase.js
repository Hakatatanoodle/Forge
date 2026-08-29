// ═══════════════════════════════════════════════════════
// firebase.js — Firebase sync layer
// Auth: Google sign-in only (one tap, no typing)
// Session: persists permanently — no re-login on reopen
// Sync: Firestore with offline persistence
// ═══════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey: "AIzaSyDjh5v_TNjmOGIRDTO2GOG8mIZ9V0cLbJA",
  authDomain: "forge-8e1b2.firebaseapp.com",
  projectId: "forge-8e1b2",
  storageBucket: "forge-8e1b2.firebasestorage.app",
  messagingSenderId: "419899426693",
  appId: "1:419899426693:web:ad0409f01e01722fe826ec"
};

const FB = (() => {

  let _auth = null;
  let _db   = null;
  let _currentUser = null;
  let _onAuthChange = null;

  // ── INIT ──
  function init(onAuthChange) {
    _onAuthChange = onAuthChange;

    try {
      firebase.initializeApp(firebaseConfig);
      _auth = firebase.auth();
      _db   = firebase.firestore();

      // PERSISTENCE: LOCAL = session survives browser close/reopen
      _auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).then(async () => {

        // On mobile, after Google redirect, capture the result FIRST
        // before setting up the auth state listener
        try {
          await _auth.getRedirectResult();
        } catch(e) {
          console.warn('FORGE: Redirect result error', e.message);
        }

        // Now listen for auth state — fires immediately with user if signed in
        _auth.onAuthStateChanged(user => {
          _currentUser = user;
          if (_onAuthChange) _onAuthChange(user);
        });
      });

      // Offline Firestore cache
      _db.enablePersistence({ synchronizeTabs: false })
        .catch(err => console.warn('FORGE: Firestore persistence:', err.code));

    } catch(e) {
      console.error('FORGE: Firebase init failed', e);
    }
  }

  // ── GOOGLE SIGN IN ──
  // Popup on desktop, redirect on mobile
  async function signInWithGoogle() {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });

      const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);

      if (isMobile) {
        await _auth.signInWithRedirect(provider);
        return { ok: true, pending: true };
      } else {
        const result = await _auth.signInWithPopup(provider);
        return { ok: true, user: result.user };
      }
    } catch(e) {
      if (e.code === 'auth/popup-closed-by-user') {
        return { ok: false, error: 'Sign-in cancelled.' };
      }
      if (e.code === 'auth/popup-blocked') {
        return { ok: false, error: 'Popup was blocked by your browser. Allow popups for this site and try again.' };
      }
      // Surface the real Firebase error code/message rather than a
      // generic one — this is the only way to actually diagnose auth
      // config issues (unauthorized domain, provider not enabled, etc).
      console.error('FORGE: Google sign-in failed', e.code, e.message);
      return { ok: false, error: `Sign-in failed: ${e.code || e.message || 'unknown error'}` };
    }
  }

  // ── HANDLE REDIRECT RESULT (mobile, called on page load) ──
  async function handleRedirectResult() {
    try {
      const result = await _auth.getRedirectResult();
      return result.user ? { ok: true, user: result.user } : { ok: false };
    } catch(e) {
      return { ok: false, error: e.message };
    }
  }

  // ── SIGN OUT ──
  async function signOut() {
    try { await _auth.signOut(); return { ok: true }; }
    catch(e) { return { ok: false }; }
  }

  // ── FIRESTORE: SAVE ──
  async function saveState(state) {
    if (!_currentUser) return { ok: false };
    try {
      await _db.collection('users').doc(_currentUser.uid).set({
        state: JSON.stringify(state),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return { ok: true };
    } catch(e) {
      console.warn('FORGE: Cloud save failed (offline?)', e.message);
      return { ok: false };
    }
  }

  // ── FIRESTORE: LOAD ──
  async function loadState() {
    if (!_currentUser) return { ok: false };
    try {
      const doc = await _db.collection('users').doc(_currentUser.uid).get();
      if (!doc.exists) return { ok: true, state: null };
      return { ok: true, state: JSON.parse(doc.data().state) };
    } catch(e) {
      console.warn('FORGE: Cloud load failed (offline?)', e.message);
      return { ok: false };
    }
  }

  // ── FIRESTORE: DELETE ──
  async function deleteUserData() {
    if (!_currentUser) return { ok: false };
    try {
      await _db.collection('users').doc(_currentUser.uid).delete();
      return { ok: true };
    } catch(e) { return { ok: false }; }
  }

  // ── LEADERBOARD: SYNC OWN ENTRY ──
  // Writes to a SEPARATE, small public collection — never the private
  // users/{uid} document. See leaderboard.js header for the full
  // reasoning on what is and isn't exposed here.
  async function syncLeaderboardEntry(entry) {
    if (!_currentUser) return { ok: false };
    try {
      await _db.collection('leaderboard').doc(_currentUser.uid).set({
        ...entry,
        uid: _currentUser.uid, // always trust our own auth uid, not whatever was passed in
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return { ok: true };
    } catch(e) {
      console.warn('FORGE: Leaderboard sync failed (offline, or rules rejected it)', e.message);
      return { ok: false };
    }
  }

  // ── LEADERBOARD: FETCH TOP ENTRIES ──
  // metricField must be one of leaderboard.js's METRICS[].field values
  // ('level' | 'streak' | 'totalHours'). Single-field orderBy() queries
  // don't require a composite index in Firestore, so this works with
  // zero extra console setup.
  async function getLeaderboard(metricField, limitCount) {
    try {
      const snap = await _db.collection('leaderboard')
        .orderBy(metricField, 'desc')
        .limit(limitCount || 50)
        .get();
      const rows = [];
      snap.forEach(doc => rows.push(doc.data()));
      return { ok: true, rows };
    } catch(e) {
      console.warn('FORGE: Leaderboard fetch failed', e.message);
      return { ok: false, rows: [] };
    }
  }

  function getCurrentUser() { return _currentUser; }
  function isSignedIn()     { return !!_currentUser; }

  return {
    init, signInWithGoogle, handleRedirectResult,
    signOut, saveState, loadState, deleteUserData,
    syncLeaderboardEntry, getLeaderboard,
    getCurrentUser, isSignedIn
  };

})();
