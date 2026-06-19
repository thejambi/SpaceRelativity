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
| **B** (hold) | look astern — swing the view 180° to see the redshift |
| **Tab** | cycle trip-computer destination |
| **M** | mute sound · **1–4** toggle individual effects |
| **R** | reset · **H** hide UI · **C** lock/release mouse |

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
- **G-force** — the HUD's *thrust* readout shows proper acceleration,
  `a = γ³·dv/dt`, the force a pilot would actually feel. It diverges as you push
  toward `c` (why light speed is unreachable), pegging at 99 g. A camera buffet,
  FOV punch and tunnel-vision veil sell the surge; coasting at constant speed is
  weightless (0 g), as it should be.

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

### Faster than light

Press **F** to unlock the throttle past `c`. This is **deliberately
non-physical** — real relativity diverges at `β = 1` — so FTL is rendered as a
stylized warp that collapses the starfield into the forward singularity. The HUD
turns red and reports speed as a multiple of `c`.

## Layout

- `index.html` — HUD, controls overlay, import map.
- `src/relativity.js` — physics helpers + the star/galaxy GLSL shaders.
- `src/main.js` — scene, procedural starfield, ship dynamics, input, HUD.

Star positions, galaxies and landmarks are procedurally generated examples — the
stellar temperature mix is roughly realistic (lots of cool red dwarfs, a few hot
blue giants) but positions are illustrative, not a catalog.
