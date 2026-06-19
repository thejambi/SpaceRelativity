// relativity.js
// Special-relativistic optics for a moving observer.
//
// Conventions used throughout:
//   beta  = |v| / c               (speed as a fraction of light speed)
//   gamma = 1 / sqrt(1 - beta^2)  (Lorentz factor)
//   fwd   = unit velocity direction (the observer always thrusts along its nose)
//   mu    = cos(angle between fwd and the lab-frame direction TO a star)
//
// Aberration (how the apparent direction to a source shifts forward):
//   cos(theta') = (cos theta + beta) / (1 + beta cos theta)
//   -> stars crowd toward the direction of motion.
//
// Relativistic Doppler factor for a source at lab-frame angle mu:
//   D = gamma * (1 + beta * mu)
//   D > 1 ahead  -> blueshift,  D < 1 behind -> redshift.
//   Observed color temperature scales ~ T * D (Wien's law).
//   Bolometric beaming (headlight effect): brightness ~ D^3.

export const C_CAP = 0.9999995; // we never let real physics reach exactly c

export function lorentz(beta) {
  return 1 / Math.sqrt(1 - beta * beta);
}

// Aberrate a lab-frame unit direction `dir` (toward a star) given motion
// along unit `fwd` at speed `beta`. Returns the apparent unit direction.
// Pure-JS twin of the GLSL version below — used for HTML landmark labels.
export function aberrateDir(dir, fwd, beta, out) {
  const mu = dir.x * fwd.x + dir.y * fwd.y + dir.z * fwd.z;
  const mup = (mu + beta) / (1 + beta * mu);
  // perpendicular component of dir relative to fwd
  let px = dir.x - mu * fwd.x;
  let py = dir.y - mu * fwd.y;
  let pz = dir.z - mu * fwd.z;
  const pl = Math.hypot(px, py, pz);
  if (pl < 1e-6) {
    out.set(fwd.x, fwd.y, fwd.z);
    return out;
  }
  const s = Math.sqrt(Math.max(0, 1 - mup * mup)) / pl;
  out.set(mup * fwd.x + px * s, mup * fwd.y + py * s, mup * fwd.z + pz * s);
  return out;
}

export function dopplerFactor(mu, beta, gamma) {
  return gamma * (1 + beta * mu);
}

// ----------------------------------------------------------------------------
// GLSL shaders for the star / galaxy point layers.
// Three.js automatically provides: position (attribute), projectionMatrix,
// viewMatrix, cameraPosition. The observer (camera) sits at uShipPos.
// ----------------------------------------------------------------------------

export const STAR_VERT = /* glsl */ `
  precision highp float;

  uniform vec3  uShipPos;   // observer world position
  uniform vec3  uForward;   // unit velocity / thrust direction
  uniform float uBeta;      // speed as fraction of c
  uniform float uGamma;     // Lorentz factor
  uniform float uCell;      // wrap-around cell size (creates an endless field)
  uniform float uSizeMul;   // base point size multiplier for this layer
  uniform float uScale;     // perspective size scale
  uniform float uPixelRatio;
  uniform float uWarp;      // 0 = sublight, >0 = stylized FTL warp
  uniform float uFxAberration;
  uniform float uFxDoppler;
  uniform float uFxBeaming;

  attribute float aTemp;    // blackbody temperature (K)
  attribute float aBright;  // base brightness 0..1
  attribute float aSize;    // base size jitter

  varying vec3  vColor;
  varying float vAlpha;

  // Blackbody color from temperature (Tanner Helland approximation).
  vec3 blackbody(float t) {
    t = clamp(t, 1000.0, 40000.0) / 100.0;
    float r, g, b;
    if (t <= 66.0) { r = 255.0; }
    else { r = 329.698727446 * pow(t - 60.0, -0.1332047592); }
    if (t <= 66.0) { g = 99.4708025861 * log(t) - 161.1195681661; }
    else { g = 288.1221695283 * pow(t - 60.0, -0.0755148492); }
    if (t >= 66.0) { b = 255.0; }
    else if (t <= 19.0) { b = 0.0; }
    else { b = 138.5177312231 * log(t - 10.0) - 305.0447927307; }
    return clamp(vec3(r, g, b) / 255.0, 0.0, 1.0);
  }

  void main() {
    // Endless field: wrap each star into the cell centered on the observer.
    vec3 p = position - uShipPos;
    p = p - uCell * floor(p / uCell + 0.5);

    float dist = length(p);
    vec3 dir = p / max(dist, 1e-4);

    float mu = dot(dir, uForward);

    // --- Aberration -------------------------------------------------------
    float beta = mix(0.0, uBeta, uFxAberration);
    float mup = (mu + beta) / (1.0 + beta * mu);
    vec3 perp = dir - mu * uForward;
    float perpLen = length(perp);
    vec3 dirp = uForward;
    if (perpLen > 1e-6) {
      dirp = mup * uForward + sqrt(max(0.0, 1.0 - mup * mup)) * (perp / perpLen);
    }
    // Warp mode: collapse everything toward the nose even harder.
    if (uWarp > 0.0) {
      dirp = normalize(mix(dirp, uForward, clamp(uWarp * 0.55, 0.0, 0.95)));
    }

    vec3 apparent = uShipPos + dirp * dist;
    gl_Position = projectionMatrix * viewMatrix * vec4(apparent, 1.0);

    // --- Doppler color & beaming -----------------------------------------
    float D = uGamma * (1.0 + uBeta * mu);
    D = max(D, 0.02);
    float Dcol = mix(1.0, D, uFxDoppler);
    vColor = blackbody(aTemp * Dcol);

    float beam = mix(1.0, pow(D, 3.0), uFxBeaming);

    // distance fade keeps the endless field from looking like a solid wall
    float fade = smoothstep(uCell * 0.5, uCell * 0.12, dist);
    vAlpha = clamp(aBright * fade * beam, 0.0, 1.0);
    if (uWarp > 0.0) vAlpha = min(1.0, vAlpha + uWarp * 0.15 * fade);

    float sz = aSize * uSizeMul * (uScale / max(dist, 1.0)) * (0.6 + 0.4 * sqrt(beam));
    gl_PointSize = clamp(sz * uPixelRatio, 0.6, 64.0);
  }
`;

export const STAR_FRAG = /* glsl */ `
  precision highp float;
  varying vec3  vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    // soft round star with a hot core
    float core = smoothstep(0.5, 0.0, d);
    float glow = pow(core, 2.5);
    vec3 col = mix(vColor, vec3(1.0), glow * 0.6);
    gl_FragColor = vec4(col, core * vAlpha);
  }
`;
