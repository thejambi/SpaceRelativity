// audio.js — fully procedural flight audio via the Web Audio API (no assets).
//
// Layers, all driven by speed/throttle:
//   * a low engine drone (two detuned oscillators through a moving low-pass)
//   * a sub-bass rumble
//   * filtered noise "slipstream" that rises with speed
// Plus a warp-engage sweep. Everything ramps smoothly to avoid clicks.

export function createAudio() {
  let ctx = null;
  let master, engineGain, subOsc, osc1, osc2, lp, noiseGain, noiseFilter;
  let started = false, muted = false;

  function init() {
    if (started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    started = true;

    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // --- engine drone ---
    lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 220;
    lp.Q.value = 6;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    lp.connect(engineGain);
    engineGain.connect(master);

    osc1 = ctx.createOscillator();
    osc1.type = "sawtooth";
    osc1.frequency.value = 60;
    osc2 = ctx.createOscillator();
    osc2.type = "sawtooth";
    osc2.frequency.value = 60 * 1.005; // slight detune for movement
    osc1.connect(lp); osc2.connect(lp);
    osc1.start(); osc2.start();

    // --- sub rumble ---
    subOsc = ctx.createOscillator();
    subOsc.type = "sine";
    subOsc.frequency.value = 34;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.0;
    subOsc.connect(subGain); subGain.connect(master);
    subOsc.start();
    subOsc._gain = subGain;

    // --- slipstream noise ---
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf; noise.loop = true;
    noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 400;
    noiseFilter.Q.value = 0.7;
    noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noise.connect(noiseFilter); noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start();

    // fade master in
    master.gain.setTargetAtTime(muted ? 0 : 0.28, ctx.currentTime, 0.4);
  }

  function update(beta, throttle, warp, accel = 0) {
    if (!started || !ctx) return;
    const t = ctx.currentTime;
    const sp = Math.min(1, beta);
    const g = Math.min(1, accel); // felt-acceleration intensity 0..1
    // engine pitch climbs with speed; gain follows throttle, surges under thrust
    const f = 48 + sp * 180 + warp * 120;
    osc1.frequency.setTargetAtTime(f, t, 0.15);
    osc2.frequency.setTargetAtTime(f * 1.006, t, 0.15);
    lp.frequency.setTargetAtTime(180 + sp * 2200 + warp * 1800 + g * 900, t, 0.12);
    engineGain.gain.setTargetAtTime(0.04 + throttle * 0.13 + g * 0.06, t, 0.1);

    subOsc._gain.gain.setTargetAtTime(0.05 + sp * 0.16 + g * 0.12, t, 0.15);
    subOsc.frequency.setTargetAtTime(30 + sp * 22, t, 0.3);

    // slipstream rushes harder during hard burns (thrust rumble)
    noiseFilter.frequency.setTargetAtTime(300 + sp * 3500, t, 0.25);
    noiseGain.gain.setTargetAtTime(sp * sp * 0.10 + warp * 0.06 + g * 0.08, t, 0.12);
  }

  // descending->ascending sweep on warp engage
  function warpSweep(up = true) {
    if (!started || !ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(up ? 120 : 900, t);
    o.frequency.exponentialRampToValueAtTime(up ? 1400 : 90, t + 1.1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 1.3);
  }

  function setMuted(m) {
    muted = m;
    if (started && ctx) master.gain.setTargetAtTime(m ? 0 : 0.28, ctx.currentTime, 0.2);
  }
  function toggleMute() { setMuted(!muted); return muted; }

  return { init, update, warpSweep, setMuted, toggleMute, isMuted: () => muted };
}
