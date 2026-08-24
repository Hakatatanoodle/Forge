// ═══════════════════════════════════════════════════════
// avatars.js — Avatar system
//
// 12 avatars in 3 unlock tiers, mirroring the reference design:
//   - default:     free, everyone starts with these (2)
//   - coins:       purchased in the Armory with coins (4)
//   - achievement: auto-unlocked by reaching Gold on a specific
//                  achievement family, or Gold on enough families (4)
//
// IMAGES: each avatar points at a real file path under avatars/. Until
// that file exists, the UI falls back to a plain initials/icon circle
// (see the `onerror` handling in app.js's renderAvatarImg helper) — so
// the whole system is fully functional today, and dropping in real
// portrait art later requires ZERO code changes, just the image files
// with matching names.
//
// Reuses the achievement system directly (Achievements.computeProgress)
// rather than tracking a second, competing notion of "gold reached" —
// consistent with the project's reuse-over-duplication direction.
// ═══════════════════════════════════════════════════════

const Avatars = (() => {

  const AVATAR_DEFS = [
    // ── DEFAULT — free, everyone starts with these ──
    { id: 'operative', name: 'OPERATIVE', tier: 'default', cost: 0,
      img: 'avatars/operative.png' },
    { id: 'forgeborn', name: 'FORGEBORN', tier: 'default', cost: 0,
      img: 'avatars/forgeborn.png' },

    // ── COINS — buy with coins from the Armory ──
    { id: 'vanguard', name: 'VANGUARD', tier: 'coins', cost: 300,
      img: 'avatars/vanguard.png' },
    { id: 'reaper', name: 'REAPER', tier: 'coins', cost: 750,
      img: 'avatars/reaper.png' },
    { id: 'engineer', name: 'ENGINEER', tier: 'coins', cost: 1500,
      img: 'avatars/engineer.png' },
    { id: 'warlord', name: 'WARLORD', tier: 'coins', cost: 3000,
      img: 'avatars/warlord.png' },

    // ── ACHIEVEMENT — unlock automatically by earning achievements ──
    { id: 'ironborn', name: 'IRONBORN', tier: 'achievement',
      requirement: { type: 'family_gold', family: 'iron_streak' },
      requirementLabel: 'Gold Iron Streak',
      img: 'avatars/ironborn.png' },
    { id: 'deepwalker', name: 'DEEPWALKER', tier: 'achievement',
      requirement: { type: 'family_gold', family: 'deep_forge' },
      requirementLabel: 'Gold Deep Forge',
      img: 'avatars/deepwalker.png' },
    { id: 'commander', name: 'COMMANDER', tier: 'achievement',
      requirement: { type: 'family_gold', family: 'week_commander' },
      requirementLabel: 'Gold Week Commander',
      img: 'avatars/commander.png' },
    { id: 'forge_master', name: 'FORGE MASTER', tier: 'achievement',
      requirement: { type: 'gold_count', count: 5 },
      requirementLabel: 'Gold on 5 families',
      img: 'avatars/forge_master.png' }
  ];

  function getDef(avatarId) {
    return AVATAR_DEFS.find(a => a.id === avatarId) || null;
  }

  function isOwned(state, avatarId) {
    const av = getDef(avatarId);
    if (!av) return false;
    if (av.tier === 'default') return true;
    return (state.user.unlockedAvatars || []).includes(avatarId);
  }

  // ── PURCHASE (coins tier only) ──
  function purchase(state, avatarId) {
    const av = getDef(avatarId);
    if (!av || av.tier !== 'coins') return { ok: false, reason: 'not purchasable' };
    if (isOwned(state, avatarId)) return { ok: false, reason: 'already owned' };
    if ((state.user.coins || 0) < av.cost) return { ok: false, reason: 'insufficient coins' };

    state.user.coins -= av.cost;
    state.user.unlockedAvatars = state.user.unlockedAvatars || [];
    state.user.unlockedAvatars.push(avatarId);
    return { ok: true, avatar: av };
  }

  // ── AUTO-UNLOCK CHECK (achievement tier) ──
  // Call after achievements are recomputed (i.e. right alongside
  // Achievements.detectNewUnlocks — see app.js checkAchievements()).
  // Returns any achievement-tier avatars newly unlocked this call, for
  // the caller to toast/notify. No coin cost — these are earned, not
  // bought. Same permanence principle as achievements: once unlocked,
  // never re-locked, and calling this again with no new qualifying
  // progress returns nothing further.
  function checkAutoUnlocks(state) {
    if (typeof window === 'undefined' || !window.Achievements) return [];
    const progress = Achievements.computeProgress(state);
    state.user.unlockedAvatars = state.user.unlockedAvatars || [];
    const newly = [];

    AVATAR_DEFS.filter(a => a.tier === 'achievement').forEach(av => {
      if (state.user.unlockedAvatars.includes(av.id)) return;

      let qualifies = false;
      if (av.requirement.type === 'family_gold') {
        const fam = progress.find(p => p.id === av.requirement.family);
        qualifies = !!(fam && fam.unlockedTiers.includes('gold'));
      } else if (av.requirement.type === 'gold_count') {
        const goldFamilies = progress.filter(p => p.unlockedTiers.includes('gold')).length;
        qualifies = goldFamilies >= av.requirement.count;
      }

      if (qualifies) {
        state.user.unlockedAvatars.push(av.id);
        newly.push(av);
      }
    });

    return newly;
  }

  // ── SELECT (make an owned avatar active) ──
  function selectAvatar(state, avatarId) {
    if (!isOwned(state, avatarId)) return false;
    state.user.avatar = avatarId;
    return true;
  }

  function getActiveAvatar(state) {
    const id = state.user.avatar || 'operative';
    return getDef(id) || AVATAR_DEFS[0];
  }

  // ── DISPLAY DATA for the gallery UI ──
  // Returns every avatar with its live owned/locked/active/progress
  // status, grouped in definition order (default → coins → achievement).
  function listWithStatus(state) {
    const activeId = (state.user.avatar) || 'operative';
    let goldFamiliesCount = null; // computed lazily, only if needed
    return AVATAR_DEFS.map(av => {
      const owned = isOwned(state, av.id);
      let progressLabel = null;
      if (av.tier === 'achievement' && !owned && typeof window !== 'undefined' && window.Achievements) {
        const progress = Achievements.computeProgress(state);
        if (av.requirement.type === 'family_gold') {
          const fam = progress.find(p => p.id === av.requirement.family);
          progressLabel = fam ? `${fam.value} / ${fam.tiers.find(t=>t.tier==='gold').threshold} ${fam.unit}` : null;
        } else if (av.requirement.type === 'gold_count') {
          if (goldFamiliesCount === null) {
            goldFamiliesCount = progress.filter(p => p.unlockedTiers.includes('gold')).length;
          }
          progressLabel = `${goldFamiliesCount} / ${av.requirement.count} families`;
        }
      }
      return Object.assign({}, av, {
        owned,
        active: av.id === activeId,
        progressLabel
      });
    });
  }

  return {
    AVATAR_DEFS,
    getDef,
    isOwned,
    purchase,
    checkAutoUnlocks,
    selectAvatar,
    getActiveAvatar,
    listWithStatus
  };

})();

// Expose for classic-script consumers (app.js, tests read window.Avatars).
if (typeof window !== 'undefined') window.Avatars = Avatars;
