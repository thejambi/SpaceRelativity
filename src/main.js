// main.js — Relativistic flight through a procedural universe.
import * as THREE from "three";
import {
  C_CAP, lorentz, aberrateDir, STAR_VERT, STAR_FRAG,
} from "./relativity.js";

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setClearColor(0x000206, 1);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 100000);

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

// simulation scale: how many sim-years pass per real second at full effects
const TIME_SCALE = 0.6;

// throttle (0..1) -> beta, with a cubic curve giving fine control near c
function throttleToBeta(t) {
  t = Math.max(0, Math.min(1, t));
  return Math.min(1 - Math.pow(1 - t, 3), C_CAP);
}

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
  return { points, uniforms };
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

const nearStars = makeStarLayer({
  count: 9000, cell: 70,
  tempFn: stellarTemp,
  brightFn: () => 0.35 + Math.random() * 0.65,
  sizeMul: 2.4, scale: 26,
});

// distant galaxies: a sparse, dim, large-cell layer for cosmic depth
const galaxies = makeStarLayer({
  count: 700, cell: 900,
  tempFn: () => 3500 + Math.random() * 4500,
  brightFn: () => 0.12 + Math.random() * 0.4,
  sizeMul: 9.0, scale: 60,
});

const layers = [nearStars, galaxies];

// ---------------------------------------------------------------------------
// Named landmarks (HTML labels that obey aberration too)
// ---------------------------------------------------------------------------
const landmarkDefs = [
  { name: "Sol", pos: new THREE.Vector3(0, 0, -28) },
  { name: "Alpha Centauri", pos: new THREE.Vector3(14, -6, -40) },
  { name: "Sirius", pos: new THREE.Vector3(-22, 10, -55) },
  { name: "Galactic Core / Sgr A*", pos: new THREE.Vector3(60, -20, -420) },
  { name: "Orion Nebula", pos: new THREE.Vector3(-90, 30, -260) },
  { name: "Andromeda (M31)", pos: new THREE.Vector3(120, 80, -780) },
];
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

const titleEl = document.getElementById("title");

// Pointer Lock is a nice-to-have for desktop, but it's blocked in sandboxed
// preview iframes and can reject/throw there. Never let it break startup.
function safeRequestLock() {
  try {
    const p = renderer.domElement.requestPointerLock?.();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (_) { /* pointer lock unavailable (sandboxed iframe) — fine */ }
}

function start() {
  if (started) return;
  started = true;
  titleEl.classList.add("hidden");
  setTimeout(() => (titleEl.style.display = "none"), 700);
  // Make sure an embedded iframe actually grabs keyboard focus.
  try { window.focus(); } catch (_) {}
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
});
window.addEventListener("keyup", (e) => keys.delete(e.code));

// Mouse steering — works as a plain click-drag (no pointer lock required).
let dragging = false;
renderer.domElement.addEventListener("mousedown", () => {
  if (!started) { start(); return; }
  dragging = true;
});
window.addEventListener("mouseup", () => (dragging = false));
window.addEventListener("mousemove", (e) => {
  if (!started) return;
  const active = pointerLocked || dragging;
  if (!active) return;
  const dx = e.movementX || 0;
  const dy = e.movementY || 0;
  input.yaw -= dx * 0.0018;
  input.pitch -= dy * 0.0018;
});
document.addEventListener("pointerlockchange", () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
});
function togglePointerLock() {
  if (pointerLocked) document.exitPointerLock();
  else safeRequestLock();
}

function toggleUI() {
  uiHidden = !uiHidden;
  document.getElementById("hud").style.display = uiHidden ? "none" : "block";
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
}
function toggleFTL() {
  ship.ftl = !ship.ftl;
  flash(ship.ftl ? 0.5 : 0.2);
}

// effects toggles (number keys 1-4)
const fx = { aberration: 1, doppler: 1, beaming: 1, contraction: 1 };
window.addEventListener("keydown", (e) => {
  if (e.code === "Digit1") fx.aberration ^= 1;
  if (e.code === "Digit2") fx.doppler ^= 1;
  if (e.code === "Digit3") fx.beaming ^= 1;
  if (e.code === "Digit4") fx.contraction ^= 1;
});

// ---------------------------------------------------------------------------
// HUD elements
// ---------------------------------------------------------------------------
const el = (id) => document.getElementById(id);
const hud = {
  pct: el("s-pct"), beta: el("s-beta"), gamma: el("s-gamma"),
  ptime: el("s-ptime"), ctime: el("s-ctime"), dilation: el("s-dilation"),
  dist: el("s-dist"), head: el("s-head"),
  throttleFill: el("throttleFill"), throttlePct: el("throttlePct"),
  statsPanel: el("stats"),
  fxAberr: el("fx-aberr"), fxDoppler: el("fx-doppler"),
  fxBeam: el("fx-beam"), fxContract: el("fx-contract"),
};

const flashEl = document.getElementById("flash");
let flashAmt = 0;
function flash(a) { flashAmt = Math.max(flashAmt, a); }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const _fwd = new THREE.Vector3();
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
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (started) update(dt);
  render();
  requestAnimationFrame(frame);
}

function update(dt) {
  // --- throttle from keyboard ---
  const fine = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 0.25 : 1;
  const rate = 0.55 * fine;
  if (keys.has("KeyW") || keys.has("ArrowUp")) ship.throttle += rate * dt;
  if (keys.has("KeyS") || keys.has("ArrowDown")) ship.throttle -= rate * dt;
  if (keys.has("Space")) ship.throttle = 0;
  const maxThrottle = ship.ftl ? 1.6 : 1.0;
  ship.throttle = Math.max(0, Math.min(maxThrottle, ship.throttle));

  // --- steering ---
  const kYaw = (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) -
               (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0);
  const kRoll = (keys.has("KeyE") ? 1 : 0) - (keys.has("KeyQ") ? 1 : 0);
  input.yaw += kYaw * 1.1 * dt;
  input.roll += kRoll * 1.6 * dt;

  // apply rotations in ship-local space, then decay the impulse
  _q.setFromAxisAngle(_up.set(0, 1, 0), input.yaw);
  ship.quat.multiply(_q);
  _q.setFromAxisAngle(_right.set(1, 0, 0), input.pitch);
  ship.quat.multiply(_q);
  _q.setFromAxisAngle(_dir.set(0, 0, -1), input.roll);
  ship.quat.multiply(_q);
  ship.quat.normalize();
  input.yaw *= Math.pow(0.0001, dt);
  input.pitch *= Math.pow(0.0001, dt);
  input.roll *= Math.pow(0.0001, dt);

  // --- speed easing ---
  const targetBeta = throttleToBeta(Math.min(1, ship.throttle));
  ship.beta += (targetBeta - ship.beta) * Math.min(1, dt * 2.5);
  const gamma = lorentz(ship.beta);

  // FTL warp demand beyond throttle 1.0
  const warpDemand = ship.ftl ? Math.max(0, ship.throttle - 1.0) / 0.6 : 0;
  ship.warp += (warpDemand - ship.warp) * Math.min(1, dt * 2);

  // --- integrate motion (sim units: ly & years, c = 1) ---
  shipForward(_fwd);
  const effSpeed = ship.beta + ship.warp * 6.0; // warp adds superluminal travel
  const ds = effSpeed * TIME_SCALE * dt;        // ly this frame
  ship.pos.addScaledVector(_fwd, ds);
  ship.distance += ds;

  const dCoord = TIME_SCALE * dt;               // universe years
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

  // --- camera follows ship ---
  camera.position.copy(ship.pos);
  camera.quaternion.copy(ship.quat);
  // length contraction along the line of sight: squeeze FOV slightly so the
  // forward view "compresses" as the universe flattens in the motion direction.
  const baseFov = 72;
  const contraction = fx.contraction ? 1 / gamma : 1;
  camera.fov = baseFov * (0.7 + 0.3 * contraction) - ship.warp * 8;
  camera.updateProjectionMatrix();

  updateHUD(gamma);
  updateLandmarks();

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
}

function updateLandmarks() {
  const gamma = lorentz(ship.beta);
  for (const lm of landmarkDefs) {
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
    lm.el.style.left = x + "px";
    lm.el.style.top = y + "px";
    lm.dEl.textContent = dist > 1000
      ? (dist / 1000).toFixed(1) + " kly"
      : dist.toFixed(0) + " ly";
  }
}

function render() {
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  for (const l of layers) l.uniforms.uPixelRatio.value = renderer.getPixelRatio();
});

requestAnimationFrame(frame);
