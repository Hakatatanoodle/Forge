// ═══════════════════════════════════════════════════════
// sound.js — Audio engine using Web Audio API
// Zero external files. All sounds synthesized in-browser.
// Sounds are designed to be satisfying, not annoying.
// ═══════════════════════════════════════════════════════

const Sound = (() => {

  let _ctx = null;
  let _enabled = true;

  // Lazy-init AudioContext on first user gesture (browser requirement)
  function _getCtx() {
    if (!_ctx) {
      _ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume if suspended (happens on mobile after inactivity)
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
  }

  function setEnabled(val) { _enabled = val; }
  function isEnabled()     { return _enabled; }

  // ── CORE: play a synthesized tone ──
  // type: 'sine' | 'square' | 'sawtooth' | 'triangle'
  function _tone(freq, duration, type = 'sine', gain = 0.3, fadeOut = true) {
    if (!_enabled) return;
    try {
      const ctx = _getCtx();
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      gainNode.gain.setValueAtTime(gain, ctx.currentTime);
      if (fadeOut) {
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      }

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    } catch(e) {
      // Silently fail — sound is non-critical
    }
  }

  // ── CORE: noise burst (for clicks/impacts) ──
  function _noise(duration, gain = 0.1) {
    if (!_enabled) return;
    try {
      const ctx = _getCtx();
      const bufferSize = ctx.sampleRate * duration;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1);
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;

      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(gain, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

      source.connect(gainNode);
      gainNode.connect(ctx.destination);
      source.start();
    } catch(e) {}
  }

  // ══════════════════════════════════════════
  // NAMED SOUNDS
  // ══════════════════════════════════════════

  // SESSION START — rising two-tone chime. Signals "we're in."
  function sessionStart() {
    _tone(440, 0.12, 'sine', 0.25);
    setTimeout(() => _tone(660, 0.2, 'sine', 0.2), 120);
    setTimeout(() => _tone(880, 0.35, 'sine', 0.15), 260);
  }

  // TICK — subtle click every minute as a presence reminder
  // Very quiet, just enough to register subconsciously
  function tick() {
    _noise(0.04, 0.06);
  }

  // SESSION COMPLETE — triumphant ascending chord
  // This is the big payoff sound. Should feel earned.
  function sessionComplete() {
    const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
    notes.forEach((freq, i) => {
      setTimeout(() => _tone(freq, 0.5, 'sine', 0.2), i * 80);
    });
    // Bass thud underneath
    setTimeout(() => _tone(130, 0.4, 'triangle', 0.3), 0);
  }

  // XP GAIN — short upward blip. Feels like collecting a coin.
  function xpGain() {
    _tone(660, 0.08, 'square', 0.12);
    setTimeout(() => _tone(880, 0.12, 'square', 0.1), 60);
  }

  // LEVEL UP — dramatic multi-note fanfare
  function levelUp() {
    const seq = [523, 659, 784, 1047, 1319];
    seq.forEach((freq, i) => {
      setTimeout(() => {
        _tone(freq, 0.25, 'triangle', 0.25);
      }, i * 100);
    });
    setTimeout(() => _tone(1319, 0.6, 'sine', 0.3), 500);
  }

  // FOCUS BONUS — variable reward sound. Surprising, bright.
  function focusBonus() {
    _tone(1047, 0.08, 'square', 0.15);
    setTimeout(() => _tone(1319, 0.08, 'square', 0.15), 70);
    setTimeout(() => _tone(1568, 0.2,  'sine',   0.2),  140);
    // Sparkle noise
    setTimeout(() => _noise(0.15, 0.08), 150);
  }

  // BREAK START — soft descending exhale tone
  function breakStart() {
    _tone(660, 0.15, 'sine', 0.15);
    setTimeout(() => _tone(523, 0.2, 'sine', 0.12), 120);
    setTimeout(() => _tone(392, 0.4, 'sine', 0.08), 280);
  }

  // BREAK END — gentle rising tone, "back to work"
  function breakEnd() {
    _tone(392, 0.15, 'sine', 0.15);
    setTimeout(() => _tone(523, 0.2, 'sine', 0.15), 150);
    setTimeout(() => _tone(660, 0.3, 'sine', 0.2), 330);
  }

  // ABANDON — low, dull thud. Mild negative reinforcement.
  function abandon() {
    _tone(220, 0.08, 'sawtooth', 0.2);
    setTimeout(() => _tone(180, 0.3, 'sine', 0.15), 60);
  }

  // BUTTON CLICK — minimal tactile feedback
  function click() {
    _noise(0.03, 0.05);
  }

  // STREAK AT RISK — urgent triple pulse
  function streakWarning() {
    [0, 200, 400].forEach(delay => {
      setTimeout(() => _tone(440, 0.1, 'square', 0.15), delay);
    });
  }

  // WEEKLY SUMMARY — ceremonial unlock sound
  // Slow rising three-note chord, sustained shimmer on top.
  // Should feel like a vault opening, not a notification.
  // Deliberately slower and more spacious than other sounds.
  function weeklySummary() {
    // Deep foundation note
    _tone(130, 0.8, 'sine', 0.2);
    // Rising mid note after a beat
    setTimeout(() => _tone(392, 0.6, 'sine', 0.18), 200);
    // High resolution note
    setTimeout(() => _tone(784, 0.5, 'sine', 0.15), 450);
    // Shimmer on top — two quick high notes
    setTimeout(() => _tone(1047, 0.3, 'sine', 0.1), 700);
    setTimeout(() => _tone(1319, 0.8, 'sine', 0.12), 800);
    // Subtle noise shimmer for texture
    setTimeout(() => _noise(0.3, 0.04), 750);
  }

  // TASK ADDED — satisfying soft pop
  function taskAdded() {
    _tone(523, 0.06, 'sine', 0.15);
    setTimeout(() => _tone(659, 0.1, 'sine', 0.1), 50);
  }

  return {
    setEnabled,
    isEnabled,
    sessionStart,
    tick,
    sessionComplete,
    xpGain,
    levelUp,
    focusBonus,
    breakStart,
    breakEnd,
    abandon,
    click,
    streakWarning,
    taskAdded,
    weeklySummary
  };

})();
