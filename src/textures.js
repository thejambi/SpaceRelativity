// textures.js — procedural galaxy / nebula sprite atlas (no image assets).
// Builds a 2x2 atlas of distinct deep-sky objects drawn on a canvas:
//   tile 0: spiral galaxy   tile 1: barred spiral
//   tile 2: elliptical      tile 3: emission nebula
// Each object fades to black at its edge so it reads as a soft sprite under
// additive blending.
import * as THREE from "three";

function rnd(a, b) { return a + Math.random() * (b - a); }

function drawSpiral(ctx, ox, oy, s, { barred, arms, armHue }) {
  const cx = ox + s / 2, cy = oy + s / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rnd(0, Math.PI * 2));
  ctx.globalCompositeOperation = "lighter";

  // faint outer disk haze
  let disk = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.46);
  disk.addColorStop(0, "rgba(120,150,220,0.20)");
  disk.addColorStop(0.6, "rgba(70,90,160,0.10)");
  disk.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = disk;
  ctx.beginPath(); ctx.arc(0, 0, s * 0.46, 0, 7); ctx.fill();

  // spiral arms made of scattered young blue stars + dust
  const turns = 2.2;
  for (let a = 0; a < arms; a++) {
    const phase = (a / arms) * Math.PI * 2;
    for (let t = 0.05; t < 1; t += 0.0016) {
      const r = s * 0.46 * t;
      const barStretch = barred ? Math.max(0, 0.18 - t) * 6 : 0;
      const ang = phase + t * turns * Math.PI * 2 - barStretch;
      const scatter = (1 - t) * s * 0.05 + s * 0.012;
      const x = Math.cos(ang) * r + rnd(-scatter, scatter);
      const y = Math.sin(ang) * r + rnd(-scatter, scatter);
      const hue = armHue + rnd(-16, 16);
      const light = rnd(55, 85);
      const alpha = (1 - t) * 0.5 + 0.05;
      const rad = rnd(0.4, 1.8);
      ctx.fillStyle = `hsla(${hue},85%,${light}%,${alpha})`;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
    }
  }

  // bright central bulge
  let bulge = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.2);
  bulge.addColorStop(0, "rgba(255,252,235,1)");
  bulge.addColorStop(0.35, "rgba(255,228,170,0.85)");
  bulge.addColorStop(1, "rgba(255,190,110,0)");
  ctx.fillStyle = bulge;
  ctx.beginPath(); ctx.arc(0, 0, s * 0.2, 0, 7); ctx.fill();
  ctx.restore();
}

function drawElliptical(ctx, ox, oy, s) {
  const cx = ox + s / 2, cy = oy + s / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rnd(0, Math.PI));
  ctx.scale(1, rnd(0.55, 0.8));
  ctx.globalCompositeOperation = "lighter";
  let g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.45);
  g.addColorStop(0, "rgba(255,246,220,1)");
  g.addColorStop(0.25, "rgba(255,224,170,0.8)");
  g.addColorStop(0.6, "rgba(220,180,140,0.28)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, s * 0.45, 0, 7); ctx.fill();
  ctx.restore();
}

function drawNebula(ctx, ox, oy, s) {
  const cx = ox + s / 2, cy = oy + s / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalCompositeOperation = "lighter";
  const palettes = [
    [330, 80], [285, 70], [195, 75], [160, 65], // pinks, violets, teals
  ];
  for (let i = 0; i < 140; i++) {
    const ang = rnd(0, Math.PI * 2);
    const dist = Math.pow(Math.random(), 0.6) * s * 0.42;
    const x = Math.cos(ang) * dist;
    const y = Math.sin(ang) * dist * rnd(0.6, 1.0);
    const rad = rnd(s * 0.03, s * 0.14);
    const [hue, sat] = palettes[(Math.random() * palettes.length) | 0];
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `hsla(${hue},${sat}%,65%,0.10)`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
  }
  // a few embedded hot stars
  for (let i = 0; i < 18; i++) {
    const x = rnd(-s * 0.35, s * 0.35), y = rnd(-s * 0.3, s * 0.3);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rnd(2, 6));
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(1, "rgba(120,160,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill();
  }
  ctx.restore();
}

export function makeGalaxyAtlas(size = 1024) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  const s = size / 2;
  drawSpiral(ctx, 0, 0, s, { barred: false, arms: 2, armHue: 210 });
  drawSpiral(ctx, s, 0, s, { barred: true, arms: 2, armHue: 30 });
  drawElliptical(ctx, 0, s, s);
  drawNebula(ctx, s, s, s);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
