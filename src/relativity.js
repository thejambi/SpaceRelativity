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
    // Forward beaming saturates to brilliant blue-white; the floor keeps
    // rearward, redshifted stars visible as dim red points instead of black.
    vAlpha = clamp(aBright * fade * (0.12 + 0.88 * beam), 0.0, 1.0);
    if (uWarp > 0.0) vAlpha = min(1.0, vAlpha + uWarp * 0.15 * fade);

    // Keep sprites tight — smaller caps mean far less additive overdraw when the
    // whole field crowds into the forward point at high speed.
    float sz = aSize * uSizeMul * (uScale / max(dist, 1.0)) * (0.85 + 0.15 * sqrt(beam));
    gl_PointSize = clamp(sz * uPixelRatio, 0.6, 16.0);
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
    // tight bright core with a small falloff; bloom does the rest
    float core = smoothstep(0.5, 0.05, d);
    float glow = pow(core, 3.0);
    vec3 col = mix(vColor, vec3(1.0), glow * 0.7);
    gl_FragColor = vec4(col, core * vAlpha);
  }
`;

// ----------------------------------------------------------------------------
// Galaxy / nebula layer: same relativistic transform, but each point samples a
// rotated tile from a procedural atlas and is tinted by its Doppler factor.
// ----------------------------------------------------------------------------

export const GALAXY_VERT = /* glsl */ `
  precision highp float;

  uniform vec3  uShipPos;
  uniform vec3  uForward;
  uniform float uBeta;
  uniform float uGamma;
  uniform float uCell;
  uniform float uSizeMul;
  uniform float uScale;
  uniform float uPixelRatio;
  uniform float uWarp;
  uniform float uFxAberration;
  uniform float uFxDoppler;
  uniform float uFxBeaming;

  attribute float aBright;
  attribute float aSize;
  attribute float aTile;   // which atlas cell (0..3)
  attribute float aAngle;  // sprite rotation

  varying float vTile;
  varying float vAngle;
  varying vec3  vTint;
  varying float vAlpha;

  void main() {
    vec3 p = position - uShipPos;
    p = p - uCell * floor(p / uCell + 0.5);
    float dist = length(p);
    vec3 dir = p / max(dist, 1e-4);
    float mu = dot(dir, uForward);

    float beta = mix(0.0, uBeta, uFxAberration);
    float mup = (mu + beta) / (1.0 + beta * mu);
    vec3 perp = dir - mu * uForward;
    float perpLen = length(perp);
    vec3 dirp = uForward;
    if (perpLen > 1e-6) {
      dirp = mup * uForward + sqrt(max(0.0, 1.0 - mup * mup)) * (perp / perpLen);
    }
    if (uWarp > 0.0) dirp = normalize(mix(dirp, uForward, clamp(uWarp * 0.55, 0.0, 0.95)));

    vec3 apparent = uShipPos + dirp * dist;
    gl_Position = projectionMatrix * viewMatrix * vec4(apparent, 1.0);

    float D = max(uGamma * (1.0 + uBeta * mu), 0.02);
    // Doppler tint: blueshift -> cooler/blue, redshift -> warmer/red.
    vec3 tint = vec3(pow(D, -0.6), 1.0, pow(D, 0.6));
    vTint = mix(vec3(1.0), clamp(tint, 0.25, 2.5), uFxDoppler);

    float beam = mix(1.0, pow(D, 3.0), uFxBeaming);
    float fade = smoothstep(uCell * 0.5, uCell * 0.1, dist);
    vAlpha = clamp(aBright * fade * (0.4 + 0.6 * beam), 0.0, 1.0);

    vTile = aTile;
    vAngle = aAngle;

    float sz = aSize * uSizeMul * (uScale / max(dist, 1.0));
    gl_PointSize = clamp(sz * uPixelRatio, 1.0, 280.0); // capped to limit huge-sprite fill
  }
`;

export const GALAXY_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uAtlas;
  varying float vTile;
  varying float vAngle;
  varying vec3  vTint;
  varying float vAlpha;
  void main() {
    // rotate the sprite coordinate around its center
    vec2 uv = gl_PointCoord - 0.5;
    float c = cos(vAngle), s = sin(vAngle);
    uv = mat2(c, -s, s, c) * uv + 0.5;
    uv = clamp(uv, 0.0, 1.0);
    // map into the 2x2 atlas cell
    float tx = mod(vTile, 2.0);
    float ty = floor(vTile / 2.0);
    vec2 atlasUv = (vec2(tx, ty) + uv) * 0.5;
    vec3 tex = texture2D(uAtlas, atlasUv).rgb;
    gl_FragColor = vec4(tex * vTint, vAlpha);
  }
`;

// ----------------------------------------------------------------------------
// Cosmic Microwave Background skybox.
// The 2.725 K CMB fills the whole sky; your motion Doppler-shifts it. Dead
// ahead the temperature climbs to 2.725*gamma(1+beta) — at extreme speed this
// rises into the visible as a bright forward "hotspot", while the rear redshifts
// to black. Beaming/aberration concentrate it into a tightening forward disc.
// ----------------------------------------------------------------------------

export const CMB_VERT = /* glsl */ `
  precision highp float;
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);           // sphere is centered on the observer
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const CMB_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3  uForward;
  uniform float uBeta;
  uniform float uGamma;
  uniform float uGain;
  varying vec3  vDir;

  vec3 blackbody(float t) {
    t = clamp(t, 1000.0, 40000.0) / 100.0;
    float r, g, b;
    if (t <= 66.0) { r = 255.0; } else { r = 329.698727446 * pow(t - 60.0, -0.1332047592); }
    if (t <= 66.0) { g = 99.4708025861 * log(t) - 161.1195681661; }
    else { g = 288.1221695283 * pow(t - 60.0, -0.0755148492); }
    if (t >= 66.0) { b = 255.0; }
    else if (t <= 19.0) { b = 0.0; }
    else { b = 138.5177312231 * log(t - 10.0) - 305.0447927307; }
    return clamp(vec3(r, g, b) / 255.0, 0.0, 1.0);
  }

  void main() {
    vec3 dir = normalize(vDir);
    float mu = dot(dir, uForward);
    float D = max(uGamma * (1.0 + uBeta * mu), 1e-4);
    float T = 2.725 * D;

    // forward concentration sharpens as you speed up (beaming + aberration)
    float fwd = clamp(mu * 0.5 + 0.5, 0.0, 1.0);
    float sharp = mix(2.0, 70.0, smoothstep(0.4, 1.0, uBeta));
    float conc = pow(fwd, sharp);

    // Visibility ramps with the blueshift factor (slightly exaggerated from the
    // true ~0.999999c threshold so the effect is reachable): a deep-red forward
    // glow by ~0.99c that whitens as the temperature climbs toward the cap.
    float vis = smoothstep(3.0, 50.0, D);
    float bright = uGain * conc * vis;

    vec3 col = blackbody(clamp(T, 1000.0, 25000.0));
    gl_FragColor = vec4(col * bright, 1.0);
  }
`;
