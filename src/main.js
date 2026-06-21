// main.js — Relativistic flight through a procedural universe.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import {
  C_CAP, lorentz, aberrateDir,
  STAR_VERT, STAR_FRAG, GALAXY_VERT, GALAXY_FRAG, CMB_VERT, CMB_FRAG,
} from "./relativity.js";
import { makeGalaxyAtlas } from "./textures.js";
import { createAudio } from "./audio.js";

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setClearColor(0x000206, 1);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
// Filmic tone mapping rolls off the intense forward star-pile / CMB hotspot at
// extreme speed into a bright structured core instead of a flat white blob.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 100000);

// Post-processing chain. Bloom was removed (it squared off the bright hotspot);
// the OutputPass is kept so ACES tone mapping applies to the custom-shader
// layers and rolls off the forward hotspot instead of clipping to flat white.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new OutputPass());

// ---------------------------------------------------------------------------
// Ship state — a "magic flight" model: velocity always points along the nose.
// ---------------------------------------------------------------------------
const ship = {
  pos: new THREE.Vector3(0, 0, 0),
  quat: new THREE.Quaternion(),
  throttle: 0,        // 0..1 sublight, >1 = FTL warp demand
  beta: 0,            // actual speed fraction (eased toward target)
  shipTime: 0,        // proper time (years)
  coordTime: 0,       // universe/coordinate time (years)
  distance: 0,        // light-years travelled
  warp: 0,            // 0 sublight, ramps up in FTL mode
  ftl: false,
};

// Time pacing.
//  - "universe" frame: each real second = TIME_SCALE universe-years, so the
//    field passes at the coordinate rate (∝ β) and saturates at c.
//  - "pilot" frame (default): each real second = PROPER_RATE years of *your*
//    clock, so length contraction makes the field rush past at ∝ βγ. A soft cap
//    (GAMMA_CAP, tanh rolloff) keeps extreme γ thrilling rather than a strobe.
const TIME_SCALE = 0.6;     // universe-frame pacing
const PROPER_RATE = 0.5;    // pilot-frame pacing (ship-years per real second)
const GAMMA_CAP = 40;       // soft cap on the γ speed-up
let pilotPacing = true;     // start in the pilot's frame (the dramatic one)

// throttle (0..1) -> beta, with a cubic curve giving fine control near c
function throttleToBeta(t) {
  t = Math.max(0, Math.min(1, t));
  return Math.min(1 - Math.pow(1 - t, 3), C_CAP);
}
// inverse, so a target beta can be set on the throttle
function betaToThrottle(b) {
  return 1 - Math.cbrt(1 - Math.min(b, C_CAP));
}

// preset cruise speeds the [V] key cycles through (wraps back to rest)
const SPEED_PRESETS = [0, 0.14, 0.5, 0.9, 0.99, 0.9999];

// ---------------------------------------------------------------------------
// Star layers
// ---------------------------------------------------------------------------
function makeStarLayer({ count, cell, tempFn, brightFn, sizeMul, scale }) {
  const positions = new Float32Array(count * 3);
  const temps = new Float32Array(count);
  const brights = new Float32Array(count);
  const sizes = new Float32Array(count);
  const half = cell / 2;
  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = (Math.random() - 0.5) * cell;
    positions[i * 3 + 1] = (Math.random() - 0.5) * cell;
    positions[i * 3 + 2] = (Math.random() - 0.5) * cell;
    temps[i] = tempFn();
    brights[i] = brightFn();
    sizes[i] = 0.6 + Math.random() * 0.9;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aTemp", new THREE.BufferAttribute(temps, 1));
  geo.setAttribute("aBright", new THREE.BufferAttribute(brights, 1));
  geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  // Big bounding sphere so the layer is never frustum-culled (we move points
  // around the observer in the shader).
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), cell * 4);

  const uniforms = {
    uShipPos: { value: ship.pos },
    uForward: { value: new THREE.Vector3(0, 0, -1) },
    uBeta: { value: 0 },
    uGamma: { value: 1 },
    uCell: { value: cell },
    uSizeMul: { value: sizeMul },
    uScale: { value: scale },
    uPixelRatio: { value: renderer.getPixelRatio() },
    uWarp: { value: 0 },
    uFxAberration: { value: 1 },
    uFxDoppler: { value: 1 },
    uFxBeaming: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  // density (0..1) draws a fraction of the pool, so the field gets denser/
  // sparser live without rebuilding the buffers
  const setDensity = (d) => geo.setDrawRange(0, Math.floor(count * Math.max(0, Math.min(1, d))));
  return { points, uniforms, geo, maxCount: count, setDensity };
}

// realistic-ish stellar temperature distribution (lots of cool red dwarfs,
// a sprinkling of hot blue-white giants)
function stellarTemp() {
  const r = Math.random();
  if (r < 0.74) return 2600 + Math.random() * 1600;     // M / K dwarfs
  if (r < 0.92) return 4200 + Math.random() * 2200;     // G / F
  if (r < 0.985) return 6400 + Math.random() * 3600;    // A
  return 10000 + Math.random() * 18000;                 // B / O giants
}

// Generous pools; the density slider draws a fraction of each for a denser or
// sparser "streaming starfield" feel.
const nearStars = makeStarLayer({
  count: 28000, cell: 70,
  tempFn: stellarTemp,
  brightFn: () => 0.35 + Math.random() * 0.65,
  sizeMul: 2.4, scale: 26,
});

// Faint background star haze for cosmic depth between the galaxies.
const farStars = makeStarLayer({
  count: 7000, cell: 900,
  tempFn: () => 3200 + Math.random() * 4200,
  brightFn: () => 0.08 + Math.random() * 0.25,
  sizeMul: 3.5, scale: 70,
});

// Distant galaxies & nebulae: textured sprites that share the relativistic
// transform and get Doppler-tinted in the shader.
const galaxyAtlas = makeGalaxyAtlas(1024);

function makeGalaxyLayer({ count, cell, sizeMul, scale }) {
  const positions = new Float32Array(count * 3);
  const brights = new Float32Array(count);
  const sizes = new Float32Array(count);
  const tiles = new Float32Array(count);
  const angles = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = (Math.random() - 0.5) * cell;
    positions[i * 3 + 1] = (Math.random() - 0.5) * cell;
    positions[i * 3 + 2] = (Math.random() - 0.5) * cell;
    brights[i] = 0.55 + Math.random() * 0.45;
    // a few big showpieces, mostly modest ones
    sizes[i] = (Math.random() < 0.12 ? 2.6 : 1.0) * (0.7 + Math.random() * 0.8);
    tiles[i] = Math.floor(Math.random() * 4);
    angles[i] = Math.random() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aBright", new THREE.BufferAttribute(brights, 1));
  geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute("aTile", new THREE.BufferAttribute(tiles, 1));
  geo.setAttribute("aAngle", new THREE.BufferAttribute(angles, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), cell * 4);

  const uniforms = {
    uShipPos: { value: ship.pos },
    uForward: { value: new THREE.Vector3(0, 0, -1) },
    uBeta: { value: 0 }, uGamma: { value: 1 },
    uCell: { value: cell }, uSizeMul: { value: sizeMul },
    uScale: { value: scale }, uPixelRatio: { value: renderer.getPixelRatio() },
    uWarp: { value: 0 },
    uFxAberration: { value: 1 }, uFxDoppler: { value: 1 }, uFxBeaming: { value: 1 },
    uAtlas: { value: galaxyAtlas },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: GALAXY_VERT, fragmentShader: GALAXY_FRAG,
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  return { points, uniforms };
}

const galaxies = makeGalaxyLayer({ count: 260, cell: 1100, sizeMul: 220, scale: 90 });

const layers = [farStars, nearStars, galaxies];

// --- Field settings: star density & brightness ------------------------------
// Brightness drives the tone-mapping exposure (scales the whole image before
// the ACES curve) — far more responsive than scaling each star's alpha, which
// the tone-map shoulder mostly undid.
const fieldSettings = { density: 0.5, brightness: 0.85 };
function applyDensity(d) {
  fieldSettings.density = d;
  // Bias the single slider toward the near field: nearby stars fill in quickly
  // while the distant haze ramps in slowly, so cranking it up reads as depth
  // (more stars near than far) rather than a uniform wall.
  nearStars.setDensity(Math.pow(d, 0.7));
  farStars.setDensity(Math.pow(d, 1.9));
}
function applyBrightness(b) {
  fieldSettings.brightness = b;
  renderer.toneMappingExposure = b;
}
applyDensity(fieldSettings.density);
applyBrightness(fieldSettings.brightness);

// --- Cosmic Microwave Background skybox (forward hotspot at high speed) ------
const cmbUniforms = {
  uForward: { value: new THREE.Vector3(0, 0, -1) },
  uBeta: { value: 0 }, uGamma: { value: 1 }, uGain: { value: 0.5 },
};
const cmb = new THREE.Mesh(
  new THREE.SphereGeometry(9000, 48, 32),
  new THREE.ShaderMaterial({
    uniforms: cmbUniforms, vertexShader: CMB_VERT, fragmentShader: CMB_FRAG,
    side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending,
  })
);
cmb.frustumCulled = false;
cmb.renderOrder = -10; // draw behind the star layers
scene.add(cmb);

// ---------------------------------------------------------------------------
// Navigation beacons (HTML labels that obey aberration too).
// The geography is fictional and the scale is compressed, so real star names
// would mislead — these are procedurally generated catalog designations and
// invented proper names, regenerated each session.
// ---------------------------------------------------------------------------
const _LON = ["b", "c", "d", "g", "k", "l", "m", "n", "r", "s", "t", "v", "z",
              "th", "dr", "kr", "tr", "br", "st", "ph", "vel", "cor"]; // first onset (clusters ok)
const _LC = ["b", "d", "g", "k", "l", "m", "n", "r", "s", "t", "v", "z"]; // interior (single only)
const _LV = ["a", "e", "i", "o", "u"];           // interior vowels (clean)
const _LV1 = ["a", "e", "i", "o", "u", "ae", "ei", "ia", "au", "y"]; // first vowel (may be fancier)
const _LEND = ["n", "r", "s", "l", "x", "th", "is", "or", "yx"];
const _LCAT = ["HD", "HIP", "GJ", "LHS", "Wolf", "Ross", "Tycho", "Kepler", "PSR"];
const _pick = (a) => a[(Math.random() * a.length) | 0];

function beaconName() {
  if (Math.random() < 0.5) {                       // catalog designation
    return _pick(_LCAT) + " " + (1 + ((Math.random() * 88888) | 0));
  }
  let n = _pick(_LON) + _pick(_LV1);               // invented proper name (2–3 syllables)
  const extra = Math.random() < 0.6 ? 1 : 2;
  for (let i = 0; i < extra; i++) n += _pick(_LC) + _pick(_LV);
  if (Math.random() < 0.45) n += _pick(_LEND);
  n = n[0].toUpperCase() + n.slice(1);
  if (Math.random() < 0.25) n += " " + _pick(["Major", "Minor", "Prime", "A", "B", "II"]);
  return n;
}

const landmarkDefs = [];
for (let i = 0; i < 8; i++) {
  // generally forward (−z) so beacons greet you on load, with spread
  const dir = new THREE.Vector3(
    (Math.random() - 0.5) * 1.6,
    (Math.random() - 0.5) * 1.1,
    -(0.2 + Math.random() * 0.9)
  ).normalize();
  const dist = 25 + Math.pow(Math.random(), 1.6) * 950; // many near, a few far
  landmarkDefs.push({ name: beaconName(), pos: dir.multiplyScalar(dist) });
}
const labelsRoot = document.getElementById("labels");
for (const lm of landmarkDefs) {
  const el = document.createElement("div");
  el.className = "landmark";
  el.innerHTML = `<span class="dot"></span><span class="nm"></span><span class="d"></span>`;
  el.querySelector(".nm").textContent = lm.name;
  labelsRoot.appendChild(el);
  lm.el = el;
  lm.dEl = el.querySelector(".d");
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keys = new Set();
const input = { yaw: 0, pitch: 0, roll: 0 };
let pointerLocked = false;
let uiHidden = false;
let started = false;

// view + felt-dynamics state
const view = { lookYaw: 0 };               // 0 = forward, ±π = astern (eased)
const dyn = { prevBeta: 0, gForce: 0, shake: 0, fovKick: 0, veil: 0 }; // felt acceleration

const titleEl = document.getElementById("title");

// Pointer Lock is a nice-to-have for desktop, but it's blocked in sandboxed
// preview iframes and can reject/throw there. Never let it break startup.
function safeRequestLock() {
  try {
    const p = renderer.domElement.requestPointerLock?.();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (_) { /* pointer lock unavailable (sandboxed iframe) — fine */ }
}

const audio = createAudio();

function start() {
  if (started) return;
  started = true;
  document.body.classList.add("started"); // reveals the HUD (hidden under title)
  titleEl.classList.add("hidden");
  setTimeout(() => (titleEl.style.display = "none"), 700);
  // Make sure an embedded iframe actually grabs keyboard focus.
  try { window.focus(); } catch (_) {}
  audio.init(); // must be created from within a user gesture
  updateSoundIndicator();
}
// Start on the first interaction of ANY kind, captured before other handlers
// so nothing can swallow it. Works even if the iframe lacked keyboard focus.
window.addEventListener("pointerdown", () => start(), { capture: true });
titleEl.addEventListener("click", () => start());

window.addEventListener("keydown", (e) => {
  if (!started) { start(); return; }
  keys.add(e.code);
  if (e.code === "Space") e.preventDefault();
  if (e.code === "KeyH") toggleUI();
  if (e.code === "KeyR") resetShip();
  if (e.code === "KeyF") toggleFTL();
  if (e.code === "KeyC") togglePointerLock();
  if (e.code === "KeyM") { audio.toggleMute(); updateSoundIndicator(); }
  if (e.code === "KeyZ") toggleScreensaver();
  if (e.code === "KeyT") { pilotPacing = !pilotPacing; showToast(pilotPacing ? "pacing: pilot frame (γ)" : "pacing: universe frame"); }
  if (e.code === "KeyV") cycleSpeedPreset();
  if (e.code === "Tab") { e.preventDefault(); cycleTarget(1); }
});
window.addEventListener("keyup", (e) => keys.delete(e.code));

// Steering — drag the field (mouse or touch) to pan, or use pointer-lock
// mouse-look. A tap (negligible movement) toggles the HUD panels.
let dragging = false, dragId = null, lastX = 0, lastY = 0, dragMoved = 0, dragJustStarted = false;
renderer.domElement.addEventListener("pointerdown", (e) => {
  const wasStarted = started;
  if (!started) start();
  dragging = true; dragId = e.pointerId;
  lastX = e.clientX; lastY = e.clientY; dragMoved = 0;
  dragJustStarted = !wasStarted;
});
window.addEventListener("pointermove", (e) => {
  if (!started) return;
  let dx, dy;
  if (pointerLocked) {
    dx = e.movementX || 0; dy = e.movementY || 0;
  } else {
    if (!dragging || e.pointerId !== dragId) return;
    dx = e.clientX - lastX; dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
  }
  input.yaw -= dx * 0.0016;
  input.pitch -= dy * 0.0016;
  dragMoved += Math.abs(dx) + Math.abs(dy);
});
window.addEventListener("pointerup", (e) => {
  if (dragging && e.pointerId === dragId && !dragJustStarted && dragMoved < 9) toggleUI();
  if (e.pointerId === dragId) { dragging = false; dragId = null; }
});

// Throttle slider — drag the thrust bar (mouse or touch) to set speed directly.
const throttleBarEl = document.getElementById("throttleBar");
let throttleDrag = false;
function setThrottleFromPointer(clientY) {
  const r = throttleBarEl.getBoundingClientRect();
  ship.throttle = Math.max(0, Math.min(ship.ftl ? 1.6 : 1, 1 - (clientY - r.top) / r.height));
}
throttleBarEl.addEventListener("pointerdown", (e) => {
  if (!started) start();
  throttleDrag = true;
  try { throttleBarEl.setPointerCapture(e.pointerId); } catch (_) {}
  setThrottleFromPointer(e.clientY);
  e.preventDefault();
});
throttleBarEl.addEventListener("pointermove", (e) => { if (throttleDrag) setThrottleFromPointer(e.clientY); });
throttleBarEl.addEventListener("pointerup", () => { throttleDrag = false; });

// Tap the effect rows to toggle each relativistic effect (1–4 still work too).
const fxRows = { aberration: "fx-aberr", doppler: "fx-doppler", beaming: "fx-beam", contraction: "fx-contract", cmb: "fx-cmb" };
for (const [k, id] of Object.entries(fxRows)) {
  document.getElementById(id).addEventListener("click", () => { fx[k] ^= 1; });
}
document.querySelector("#effects .snd").addEventListener("click", () => { audio.toggleMute(); updateSoundIndicator(); });
// Tap the NAV panel to cycle the trip-computer destination.
document.getElementById("nav").addEventListener("click", () => cycleTarget(1));

// Field-settings sliders: star density & brightness.
const densityEl = document.getElementById("set-density");
const brightEl = document.getElementById("set-bright");
densityEl.value = fieldSettings.density;
brightEl.value = fieldSettings.brightness;
densityEl.addEventListener("input", () => applyDensity(parseFloat(densityEl.value)));
brightEl.addEventListener("input", () => applyBrightness(parseFloat(brightEl.value)));
document.addEventListener("pointerlockchange", () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
});
function togglePointerLock() {
  if (pointerLocked) document.exitPointerLock();
  else safeRequestLock();
}

function toggleUI() {
  uiHidden = !uiHidden;
  // CSS decides what hides: everything on desktop; on mobile the thrust bar
  // stays (faint) so touch users keep throttle control.
  document.body.classList.toggle("ui-hidden", uiHidden);
}
function resetShip() {
  ship.pos.set(0, 0, 0);
  ship.quat.identity();
  ship.throttle = 0;
  ship.beta = 0;
  ship.warp = 0;
  ship.ftl = false;
  ship.shipTime = 0;
  ship.coordTime = 0;
  ship.distance = 0;
  dyn.prevBeta = 0; dyn.gForce = 0; dyn.shake = 0; dyn.fovKick = 0;
}
function toggleFTL() {
  ship.ftl = !ship.ftl;
  flash(ship.ftl ? 0.5 : 0.2);
  audio.warpSweep(ship.ftl);
}

// Jump to the next preset speed above the current one; wrap past the top to 0.
function cycleSpeedPreset() {
  ship.ftl = false; ship.warp = 0;
  // compare against the throttle target (not the eased speed) so repeated
  // presses always advance even while the ship is still accelerating
  const current = throttleToBeta(ship.throttle);
  let next = SPEED_PRESETS.find((p) => p > current + 1e-4);
  if (next === undefined) next = 0;
  ship.throttle = betaToThrottle(next);
  flash(0.15);
  const pct = next === 0 ? "full stop"
    : next >= 0.999 ? "0.9999 c" : next + " c";
  showToast("→ " + pct);
}

let toastTimer = null;
function showToast(text) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = text;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 1100);
}

// set a slider's value and apply it together (keeps the thumb in sync)
function setBrightnessUI(b) {
  applyBrightness(b);
  const e = document.getElementById("set-bright"); if (e) e.value = b;
}
function setDensityUI(d) {
  applyDensity(d);
  const e = document.getElementById("set-density"); if (e) e.value = d;
}

// Screensaver mode: a calm, beaming-free drift with a dimmer, denser field.
// Toggles on/off, restoring your prior settings when you exit.
const SCREENSAVER = { brightness: 0.6, density: 0.75, beta: 0.5 };
let screensaverPrev = null;
function toggleScreensaver() {
  if (!screensaverPrev) {
    screensaverPrev = {
      beaming: fx.beaming, brightness: fieldSettings.brightness,
      density: fieldSettings.density, throttle: ship.throttle, ftl: ship.ftl,
    };
    fx.beaming = 0;
    setBrightnessUI(SCREENSAVER.brightness);
    setDensityUI(SCREENSAVER.density);
    ship.ftl = false; ship.warp = 0;
    ship.throttle = betaToThrottle(SCREENSAVER.beta);
    showToast("screensaver ✦");
  } else {
    fx.beaming = screensaverPrev.beaming;
    setBrightnessUI(screensaverPrev.brightness);
    setDensityUI(screensaverPrev.density);
    ship.ftl = screensaverPrev.ftl; ship.warp = 0;
    ship.throttle = screensaverPrev.throttle;
    screensaverPrev = null;
    showToast("screensaver off");
  }
}

function updateSoundIndicator() {
  const s = document.getElementById("sound-state");
  if (s) s.textContent = audio.isMuted() ? "muted" : "on";
}

// --- trip computer: proper-time vs universe-time to reach a destination ------
// default the trip computer to the farthest beacon — a nice long journey
let targetIndex = landmarkDefs.reduce(
  (best, lm, i, a) => (lm.pos.length() > a[best].pos.length() ? i : best), 0);
function cycleTarget(d) {
  targetIndex = (targetIndex + d + landmarkDefs.length) % landmarkDefs.length;
}
function fmtYears(y) {
  if (!isFinite(y)) return "∞";
  if (y >= 1e6) return (y / 1e6).toFixed(2) + " Myr";
  if (y >= 1e3) return (y / 1e3).toFixed(2) + " kyr";
  if (y >= 1) return y.toFixed(1) + " yr";
  return (y * 365.25).toFixed(0) + " d";
}
const nav = {
  name: () => document.getElementById("nav-name"),
  dist: () => document.getElementById("nav-dist"),
  uni: () => document.getElementById("nav-uni"),
  ship: () => document.getElementById("nav-ship"),
  note: () => document.getElementById("nav-note"),
};
function updateTripComputer(gamma) {
  const tgt = landmarkDefs[targetIndex];
  const dist = tgt.pos.distanceTo(ship.pos); // true (un-aberrated) distance, ly
  nav.name().textContent = tgt.name;
  nav.dist().textContent = dist > 1000
    ? (dist / 1000).toFixed(2) + " kly" : dist.toFixed(1) + " ly";

  const effC = ship.beta + ship.warp * 6.0; // c-multiples (warp is superluminal)
  if (effC <= 1e-4) {
    nav.uni().textContent = "—";
    nav.ship().textContent = "—";
    nav.note().textContent = "throttle up to compute ETA";
    return;
  }
  const tUniverse = dist / effC; // years (c = 1 ly/yr)
  if (ship.warp > 0.01) {
    nav.uni().textContent = fmtYears(tUniverse);
    nav.ship().textContent = fmtYears(tUniverse); // FTL: non-physical, no dilation
    nav.note().textContent = "FTL — non-physical, dilation undefined";
  } else {
    const tShip = tUniverse / gamma; // proper time aboard
    nav.uni().textContent = fmtYears(tUniverse);
    nav.ship().textContent = fmtYears(tShip);
    nav.note().textContent = `time dilation saves ${(1 - 1 / gamma) * 100 < 0.1
      ? "<0.1" : ((1 - 1 / gamma) * 100).toFixed(1)}% aboard`;
  }
}

// effects toggles (number keys 1-5)
const fx = { aberration: 1, doppler: 1, beaming: 1, contraction: 1, cmb: 1 };
window.addEventListener("keydown", (e) => {
  if (e.code === "Digit1") fx.aberration ^= 1;
  if (e.code === "Digit2") fx.doppler ^= 1;
  if (e.code === "Digit3") fx.beaming ^= 1;
  if (e.code === "Digit4") fx.contraction ^= 1;
  if (e.code === "Digit5") fx.cmb ^= 1;
});

// ---------------------------------------------------------------------------
// HUD elements
// ---------------------------------------------------------------------------
const el = (id) => document.getElementById(id);
const hud = {
  pct: el("s-pct"), beta: el("s-beta"), gamma: el("s-gamma"), gforce: el("s-gforce"),
  ptime: el("s-ptime"), ctime: el("s-ctime"), dilation: el("s-dilation"),
  dist: el("s-dist"), head: el("s-head"),
  throttleFill: el("throttleFill"), throttlePct: el("throttlePct"),
  statsPanel: el("stats"),
  fxAberr: el("fx-aberr"), fxDoppler: el("fx-doppler"),
  fxBeam: el("fx-beam"), fxContract: el("fx-contract"), fxCmb: el("fx-cmb"),
};

const flashEl = document.getElementById("flash");
const gveilEl = document.getElementById("gveil");
const viewmodeEl = document.getElementById("viewmode");
let flashAmt = 0;
function flash(a) { flashAmt = Math.max(flashAmt, a); }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const _fwd = new THREE.Vector3();
const _prevFwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _proj = new THREE.Vector3();
const _q = new THREE.Quaternion();

function shipForward(out) { return out.set(0, 0, -1).applyQuaternion(ship.quat); }

function fmt(n, d = 1) {
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}
function headingLabel(v) {
  const ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z);
  if (ax >= ay && ax >= az) return v.x >= 0 ? "+x" : "−x";
  if (ay >= ax && ay >= az) return v.y >= 0 ? "+y" : "−y";
  return v.z >= 0 ? "+z" : "−z";
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let last = performance.now();
let preStartRenders = 0;
let backdropDirty = true; // request a (re)paint of the static title backdrop
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (started) {
    update(dt);
    render();
  } else if (backdropDirty || preStartRenders < 3) {
    // Paint the static intro backdrop a few times (covers async texture upload),
    // then idle the GPU until the user engages — re-rendering a still frame every
    // tick is pure waste. (The rAF loop keeps spinning; only render() is skipped.)
    render();
    preStartRenders++;
    backdropDirty = false;
  }
  requestAnimationFrame(frame);
}

function update(dt) {
  // --- throttle from keyboard ---
  // Fine control is the default; hold Shift for a fast "turbo" burn.
  const turbo = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 4 : 1;
  const rate = 0.14 * turbo;
  if (keys.has("KeyW") || keys.has("ArrowUp")) ship.throttle += rate * dt;
  if (keys.has("KeyS") || keys.has("ArrowDown")) ship.throttle -= rate * dt;
  if (keys.has("Space")) ship.throttle = 0;
  const maxThrottle = ship.ftl ? 1.6 : 1.0;
  ship.throttle = Math.max(0, Math.min(maxThrottle, ship.throttle));

  // --- steering ---
  const kYaw = (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) -
               (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0);
  const kRoll = (keys.has("KeyE") ? 1 : 0) - (keys.has("KeyQ") ? 1 : 0);
  input.yaw += kYaw * 0.4 * dt;
  input.roll += kRoll * 0.6 * dt;

  // Turn-rate limiter: redirecting your velocity at speed means enormous
  // centripetal g, so yaw/pitch go heavy as gamma climbs (you physically can't
  // whip around near c). Roll is rotation about the velocity axis — no
  // centripetal force — so it stays free.
  shipForward(_prevFwd);
  const turnScale = 1 / (1 + (lorentz(ship.beta) - 1) * 0.6);
  _q.setFromAxisAngle(_up.set(0, 1, 0), input.yaw * turnScale);
  ship.quat.multiply(_q);
  _q.setFromAxisAngle(_right.set(1, 0, 0), input.pitch * turnScale);
  ship.quat.multiply(_q);
  _q.setFromAxisAngle(_dir.set(0, 0, -1), input.roll);
  ship.quat.multiply(_q);
  ship.quat.normalize();
  input.yaw *= Math.pow(0.0001, dt);
  input.pitch *= Math.pow(0.0001, dt);
  input.roll *= Math.pow(0.0001, dt);

  // how fast the heading (= velocity direction) actually swung this frame
  shipForward(_fwd);
  const omegaTurn = Math.acos(THREE.MathUtils.clamp(_prevFwd.dot(_fwd), -1, 1)) / Math.max(dt, 1e-4);

  // --- speed easing ---
  const targetBeta = throttleToBeta(Math.min(1, ship.throttle));
  ship.beta += (targetBeta - ship.beta) * Math.min(1, dt * 2.5);
  const gamma = lorentz(ship.beta);

  // FTL warp demand beyond throttle 1.0
  const warpDemand = ship.ftl ? Math.max(0, ship.throttle - 1.0) / 0.6 : 0;
  ship.warp += (warpDemand - ship.warp) * Math.min(1, dt * 2);

  // --- integrate motion (sim units: ly & years, c = 1) ---
  // dCoord = universe-time advanced this frame. In the pilot's frame we hold the
  // *ship* clock's rate steady, so the universe clock (and the distance you
  // cover) scale with γ — length contraction made real. The relationships
  // distance = β·coordTime and shipTime = coordTime/γ stay exact either way.
  shipForward(_fwd);
  const gPace = pilotPacing ? GAMMA_CAP * Math.tanh(gamma / GAMMA_CAP) : 1;
  const dCoord = (pilotPacing ? PROPER_RATE : TIME_SCALE) * gPace * dt;
  const effSpeed = ship.beta + ship.warp * 6.0; // warp adds superluminal travel
  const ds = effSpeed * dCoord;                 // ly this frame
  ship.pos.addScaledVector(_fwd, ds);
  ship.distance += ds;

  ship.coordTime += dCoord;
  ship.shipTime += dCoord / gamma;              // proper time runs slow

  // --- push uniforms ---
  for (const layer of layers) {
    const u = layer.uniforms;
    u.uForward.value.copy(_fwd);
    u.uBeta.value = ship.beta;
    u.uGamma.value = gamma;
    u.uWarp.value = ship.warp;
    u.uFxAberration.value = fx.aberration;
    u.uFxDoppler.value = fx.doppler;
    u.uFxBeaming.value = fx.beaming;
  }
  // CMB skybox tracks the observer and its Doppler-shifted hotspot;
  // fx.cmb is its own toggle (uGain 0 fully disables the layer)
  cmb.position.copy(ship.pos);
  cmbUniforms.uForward.value.copy(_fwd);
  cmbUniforms.uBeta.value = ship.beta;
  cmbUniforms.uGamma.value = gamma;
  cmbUniforms.uGain.value = fx.cmb ? 0.5 : 0;

  // --- felt acceleration (G-force) ---
  // Coordinate accel (bounded by throttle) drives the *visuals*; proper accel
  // gamma^3*dv/dt — what a pilot truly feels, diverging near c — drives the
  // displayed G number. Keeping them separate means the teaching-moment huge-G
  // readout doesn't black the screen out during the long approach to c.
  const coordAccel = (ship.beta - dyn.prevBeta) / Math.max(dt, 1e-4);
  dyn.prevBeta = ship.beta;
  const properAccel = coordAccel * Math.pow(gamma, 3);            // linear (thrust)
  // Centripetal proper acceleration from turning: a_perp = gamma^2 * v * omega.
  // Roll contributes nothing (it doesn't swing the heading), so this only sees
  // yaw/pitch — turning hard near c now slams the g-meter and greys you out.
  const turnProper = gamma * gamma * ship.beta * omegaTurn;
  const properTotal = Math.hypot(properAccel, turnProper);
  const surge = THREE.MathUtils.clamp(Math.abs(coordAccel) / 2.2, 0, 1);
  const turnSurge = THREE.MathUtils.clamp(turnProper / 22, 0, 1);
  const feltSurge = Math.max(surge, turnSurge);                  // 0..1 for visuals

  const targetG = Math.min(99, properTotal * 1.6);
  dyn.gForce += (targetG - dyn.gForce) * Math.min(1, dt * 6);

  // camera buffet: thrust/turn surge + a gentle high-speed interstellar buffet
  const targetShake = Math.min(0.02, feltSurge * 0.013 +
                                       ship.beta * ship.beta * 0.0012 + ship.warp * 0.004);
  dyn.shake += (targetShake - dyn.shake) * Math.min(1, dt * 8);
  // FOV punch: accelerating widens the view (surge forward), braking narrows it
  const targetKick = THREE.MathUtils.clamp(coordAccel * 4.0, -6, 8);
  dyn.fovKick += (targetKick - dyn.fovKick) * Math.min(1, dt * 5);
  // tunnel-vision veil — a vignette that deepens under heavy thrust or turning
  dyn.veil = Math.min(0.6, feltSurge * 0.55 + Math.pow(ship.beta, 6) * 0.12);

  // --- look astern (hold B): swing the *view* 180°, velocity unchanged, so the
  // redshifted, beaming-starved rear hemisphere swings into frame ---
  const targetYaw = keys.has("KeyB") ? Math.PI : 0;
  view.lookYaw += (targetYaw - view.lookYaw) * Math.min(1, dt * 5);

  // --- camera follows ship ---
  camera.position.copy(ship.pos);
  camera.quaternion.copy(ship.quat);
  if (view.lookYaw > 0.001) {
    _q.setFromAxisAngle(_up.set(0, 1, 0), view.lookYaw);
    camera.quaternion.multiply(_q);
  }
  // buffet jitter
  if (dyn.shake > 1e-5) {
    _q.setFromAxisAngle(
      _dir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
      dyn.shake * (Math.random() - 0.5) * 2);
    camera.quaternion.multiply(_q);
  }
  // length contraction along the line of sight: squeeze FOV slightly so the
  // forward view "compresses" as the universe flattens in the motion direction.
  const baseFov = 72;
  const contraction = fx.contraction ? 1 / gamma : 1;
  camera.fov = baseFov * (0.7 + 0.3 * contraction) - ship.warp * 8 + dyn.fovKick;
  camera.updateProjectionMatrix();

  updateHUD(gamma);
  updateLandmarks();
  updateTripComputer(gamma);
  audio.update(ship.beta, Math.min(1, ship.throttle), ship.warp, feltSurge);

  // g-force tunnel-vision veil
  gveilEl.style.opacity = dyn.veil.toFixed(3);
  // astern-view indicator
  viewmodeEl.classList.toggle("on", view.lookYaw > 0.4);

  // flash decay
  if (flashAmt > 0) {
    flashEl.style.opacity = flashAmt.toFixed(3);
    flashAmt = Math.max(0, flashAmt - dt * 1.6);
  }
}

function updateHUD(gamma) {
  const pctC = ship.beta * 100;
  if (ship.warp > 0.01) {
    const totalC = ship.beta + ship.warp * 6.0;
    hud.pct.textContent = fmt(totalC, 2) + " c";
    hud.statsPanel.classList.add("ftl");
  } else {
    hud.pct.textContent = (pctC >= 99.99 ? fmt(pctC, 4) : fmt(pctC, 3)) + " %c";
    hud.statsPanel.classList.remove("ftl");
  }
  hud.beta.textContent = ship.beta.toFixed(ship.beta > 0.999 ? 7 : 6);
  hud.gamma.textContent = gamma > 1000 ? gamma.toExponential(2) : fmt(gamma, 4);
  hud.gforce.textContent = (dyn.gForce >= 99 ? "99+" : fmt(dyn.gForce, 1)) + " g";
  hud.gforce.style.color = dyn.gForce > 9 ? "var(--warn)" : "var(--hud)";
  hud.ptime.textContent = fmt(ship.shipTime, 2) + " yr";
  hud.ctime.textContent = fmt(ship.coordTime, 2) + " yr";
  hud.dilation.textContent = (gamma > 1000 ? gamma.toExponential(2) : fmt(gamma, 2)) + "×";
  hud.dist.textContent = ship.distance > 1000
    ? fmt(ship.distance / 1000, 2) + " kly"
    : fmt(ship.distance, 1) + " ly";
  hud.head.textContent = headingLabel(shipForward(_dir));

  const tp = Math.min(1, ship.throttle) * 100;
  hud.throttleFill.style.height = tp + "%";
  hud.throttlePct.textContent = ship.warp > 0.01
    ? "WARP " + fmt(1 + ship.warp, 1)
    : Math.round(ship.throttle * 100) + "%";

  hud.fxAberr.className = fx.aberration ? "on" : "";
  hud.fxDoppler.className = fx.doppler ? "on" : "";
  hud.fxBeam.className = fx.beaming ? "on" : "";
  hud.fxContract.className = fx.contraction ? "on" : "";
  hud.fxCmb.className = fx.cmb ? "on" : "";
}

function updateLandmarks() {
  // Labels bunch together and clutter the view as aberration crowds everything
  // forward, so fade them out approaching light speed (gone by ~0.97c).
  const labelFade = 1 - THREE.MathUtils.smoothstep(ship.beta, 0.9, 0.97);
  for (const lm of landmarkDefs) {
    if (labelFade <= 0.001) { lm.el.style.display = "none"; continue; }
    _dir.copy(lm.pos).sub(ship.pos);
    const dist = _dir.length();
    if (dist < 1e-3) { lm.el.style.display = "none"; continue; }
    _dir.multiplyScalar(1 / dist);

    // aberrate the apparent direction, mirror of the shader
    const beta = fx.aberration ? ship.beta : 0;
    aberrateDir(_dir, _fwd, beta, _ab);
    _proj.copy(ship.pos).addScaledVector(_ab, dist);
    _proj.project(camera);

    if (_proj.z > 1 || _proj.z < -1) { lm.el.style.display = "none"; continue; }
    const x = (_proj.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-_proj.y * 0.5 + 0.5) * window.innerHeight;
    lm.el.style.display = "block";
    lm.el.style.opacity = labelFade.toFixed(3);
    lm.el.style.left = x + "px";
    lm.el.style.top = y + "px";
    lm.dEl.textContent = dist > 1000
      ? (dist / 1000).toFixed(1) + " kly"
      : dist.toFixed(0) + " ly";
  }
}

function render() {
  composer.render();
}

// ---------------------------------------------------------------------------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  for (const l of layers) l.uniforms.uPixelRatio.value = renderer.getPixelRatio();
  backdropDirty = true; // repaint the static backdrop at the new size if idle
});

requestAnimationFrame(frame);
