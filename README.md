# Relativistic Flight

Fly through a procedural universe at a fraction of light speed (and beyond) and
watch special relativity reshape the sky in real time. Runs entirely in the
browser with WebGL — no build step.

![effects](docs/screenshot.png)

## Run it

ES modules need to be served over http, not opened as a `file://`. From this
folder run any static server:

```bash
python3 -m http.server 8080
# or:  npx serve .
```

Then open <http://localhost:8080>.

## Controls

| Input | Action |
| --- | --- |
| **Mouse** (drag or locked) | steer — pitch & yaw |
| **W / S** | throttle up / down |
| **Q / E** | roll |
| **Shift** | turbo thrust (fine control is the default) |
| **Space** | full stop |
| **F** | engage / disengage FTL warp |
| **V** | cycle preset speeds (rest → 0.5c → 0.9c → 0.99c → 0.9999c → rest) |
| **B** (hold) | look astern — swing the view 180° to see the redshift |
| **Tab** | cycle trip-computer destination |
| **T** | toggle time frame (pilot ↔ universe pacing) |
| **Z** | screensaver mode · **M** mute · **1–5** toggle individual effects |
| **R** | reset · **H** hide UI · **C** lock/release mouse |

The stats panel has **stars** (density) and **brightness** sliders — crank the
density and ease the brightness down for a dense, streaming "starfield
screensaver" feel.

Throttle uses a cubic curve so the top of the bar gives you fine control in the
last fractions of a percent below *c* — where the interesting physics lives.

## The physics

All effects use the standard special-relativity formulas, with the observer
modeled as always thrusting along its nose (velocity ∥ view direction). `β = v/c`,
`γ = 1/√(1−β²)`.

- **Relativistic aberration** — the apparent direction to each star bends toward
  your direction of motion: `cos θ′ = (cos θ + β)/(1 + β cos θ)`. Stars crowd
  into a shrinking disc ahead and thin out behind.
- **Relativistic Doppler shift** — light from ahead is blueshifted, behind it is
  redshifted. The Doppler factor `D = γ(1 + β·µ)` rescales each star's blackbody
  temperature (`T → T·D`), so colors slide blue/red with viewing angle.
- **Relativistic beaming** (the *headlight effect*) — forward sources brighten by
  `~D³` while rearward ones fade out, concentrating light into the forward cone.
- **Time dilation** — your ship clock advances by `dτ = dt/γ`; the HUD shows it
  falling behind the universe clock as `γ` climbs.
- **Length contraction** — the forward view compresses by `1/γ` as the universe
  flattens along your direction of travel.
- **CMB hotspot** — the 2.725 K cosmic microwave background fills the sky; your
  motion Doppler-shifts it to `T·γ(1+β·µ)`, so a forward "hotspot" blueshifts up
  out of the microwave band — a deep-red glow that whitens as you approach `c`,
  while the rear sky redshifts to black. (Honestly this needs ~0.999999c to enter
  the visible; it's nudged a little earlier here so it's reachable.)
- **G-force** — the HUD's *thrust* readout shows proper acceleration, the force a
  pilot would actually feel. Linear thrust contributes `γ³·dv/dt`; **turning**
  contributes the centripetal term `γ²·v·ω`. Both diverge toward `c` (why light
  speed is unreachable), pegging at 99 g, and drive a camera buffet, FOV punch and
  tunnel-vision veil. Coasting straight is weightless (0 g). Crucially, **roll is
  free** — it spins about the velocity axis, so it has no centripetal term — while
  **yaw/pitch go heavy and grey you out** as you try to bend your trajectory near
  `c`. A `γ`-based turn-rate limiter also makes steering sluggish at speed, a nod
  to the fact that you physically cannot whip your heading around at relativistic
  velocity without being pulped.

Most of this happens per-star in a GLSL shader (`src/relativity.js`) so thousands
of stars transform every frame. The named landmark labels run the same aberration
math in JS so they track their stars.

**Look astern** (hold **B**) swings the *view* 180° without changing your
velocity, so the rear hemisphere — redshifted, and starved of light by beaming —
swings into frame: dim, sparse, and deep red, the exact opposite of the brilliant
blue crowding ahead.

The **trip computer** turns the abstract physics into a gut-punch: pick a
destination and it reports the journey in universe time (`d/βc`) versus the proper
time you'd age aboard (`÷γ`) — e.g. *215 ly in 79 days of ship time* near `c`.

### Time frame (`T`)

How fast the field flies past depends on *whose clock* paces the motion:

- **Pilot frame** (default) — your ship clock ticks at a steady rate, so length
  contraction makes you cover `β·γ` light-years per year of *your* time. The field
  rushes past faster and faster as `γ` climbs (with a soft cap so extreme `γ` is
  thrilling, not a strobe). This is the traveler's real experience — the "cross
  the galaxy in a lifetime" effect.
- **Universe frame** — paced by coordinate time, so the field passes at `∝ β` and
  saturates at `c`: what a stationary outside observer would clock you moving at.

Either way the HUD stays consistent: `distance = β · universe-time` and
`ship-time = universe-time / γ`.

### Faster than light

Press **F** to unlock the throttle past `c`. This is **deliberately
non-physical** — real relativity diverges at `β = 1` — so FTL is rendered as a
stylized warp that collapses the starfield into the forward singularity. The HUD
turns red and reports speed as a multiple of `c`.

The forward view is rendered through an **ACES filmic tone-mapping** pass, so the
intense forward star-pile and CMB hotspot roll off smoothly into a bright,
structured core instead of clipping to flat white.

### What's *not* physical

The transformations above — aberration, Doppler/temperature shift, time dilation,
and the two G-force terms — are the genuine special-relativity formulas. But this
is a flat-spacetime *special*-relativity toy, so plenty is simplified, stylized,
or simply absent:

**Deliberate presentation tweaks**

- **Length contraction is shown as an FOV squeeze — which isn't how it would
  actually look.** Light-travel-time delays make a fast object appear *rotated*,
  not flattened (the Terrell–Penrose effect). The aberration already does the
  legitimate visual warping; the FOV squeeze is just an evocative stand-in.
- **CMB hotspot** glows well below its true ~0.999999c threshold so it's reachable.
- **Beaming** uses `D³`; the bolometric point-source result is closer to `D⁴`, and
  a small brightness floor keeps rearward stars visible as dim red points instead
  of vanishing as hard as they really would.
- The `βγ` **pacing** has a soft cap, the **G-meter** is scaled and clamped at 99 g,
  and **FTL** is non-physical (above).

**Genuine omissions**

- **No light-travel-time / retardation.** Stars are transformed at their *current*
  positions, not where they were when their light left — so the real Terrell
  rotation never appears.
- **No spectral band-shifting.** Extreme blueshift should push optical stars into
  the UV (vanishing) and pull formerly-infrared sources into view; we just recolor
  and clamp the blackbody, so the forward field never changes population.
- **No gravity / general relativity at all** — no gravitational lensing, no
  gravitational time dilation, no black holes. Pure special relativity in flat
  spacetime.
- **Non-Newtonian flight.** Your velocity always follows your nose. In real space,
  rotating your ship doesn't change your trajectory — you'd keep coasting the old
  way until you burned laterally (at enormous fuel cost).
- **Compressed, fictional geography.** The starfield wraps infinitely (the same
  stars recur) and beacon distances are tiny vs. reality. Galaxies are flat
  sprites, stars have no proper motion, and — of course — there's no sound in space.

## Touch / mobile

The simulator is touch-friendly: **drag the field** to steer, **slide the thrust
bar** to set speed, and **tap the field** to show/hide the panels. Tap individual
rows in the *relativistic effects* panel to toggle each effect, and tap the trip
computer to cycle its destination. The layout reflows for narrow screens.

## Layout

- `index.html` — HUD, controls overlay, import map.
- `src/relativity.js` — physics helpers + the star / galaxy / CMB GLSL shaders.
- `src/textures.js` — procedural galaxy & nebula sprite atlas.
- `src/audio.js` — procedural Web Audio engine.
- `src/main.js` — scene, starfield, ship dynamics, input, HUD, post-processing.

Star positions, galaxies and navigation beacons are procedurally generated — the
stellar temperature mix is roughly realistic (lots of cool red dwarfs, a few hot
blue giants), but the geography is fictional and the scale is compressed, so the
beacon names are invented catalog designations / proper names (regenerated each
session) rather than real stars at misleading distances.
