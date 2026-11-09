// Procedural surface textures, drawn on canvases at load time: nothing to download, and each one
// tiles seamlessly (noise wraps around, and shapes that cross an edge are drawn again on the far side).
// Surfaces from the Blender models carry UVs in metres, so `perMetre` sets how big a texture is in
// the world; glTF UVs start at the top-left, hence flipY = false for anything applied to a GLB.
import * as THREE from 'three';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(c, { srgb = true, metres = null, flipY = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.flipY = flipY;
  if (metres) t.repeat.set(1 / metres[0], 1 / metres[1]);
  return t;
}

/** tileable value noise in [0, 1]; cx, cy = cell size in px (must divide w and h) */
function vnoise(w, h, cx, cy, r) {
  const gx = Math.max(1, Math.round(w / cx)), gy = Math.max(1, Math.round(h / cy));
  const g = new Float32Array(gx * gy);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = (y / h) * gy, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
    const ya = (y0 % gy) * gx, yb = ((y0 + 1) % gy) * gx;
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * gx, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
      const xa = x0 % gx, xb = (x0 + 1) % gx;
      const a = g[ya + xa], b = g[ya + xb], c = g[yb + xa], d = g[yb + xb];
      out[y * w + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

function fbm(w, h, cells, r, aspect = 1) {
  const out = new Float32Array(w * h);
  let amp = 1, tot = 0;
  for (const c of cells) {
    const n = vnoise(w, h, c, c * aspect, r);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    tot += amp; amp *= 0.55;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

/** write a grey/colour field into a canvas: fn(i, x, y) -> [r, g, b] (0..255) */
function paint(c, fn) {
  const g = c.getContext('2d');
  const img = g.createImageData(c.width, c.height);
  const d = img.data;
  for (let y = 0, i = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++, i++) {
      const [r, gg, b, a = 255] = fn(i, x, y);
      d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = b; d[i * 4 + 3] = a;
    }
  }
  g.putImageData(img, 0, 0);
}

const cache = {};
const once = (k, f) => cache[k] || (cache[k] = f());
const clamp255 = (v) => Math.max(0, Math.min(255, v));

// ---------------------------------------------------------------- Jerusalem stone cladding
// courses of 30-50 cm, blocks of 45-90 cm, each block its own tone, chiselled face, recessed joints
export function stone() {
  return once('stone', () => {
    const W = 512, H = 512, M = 2.4, ppm = W / M, r = rng(11);
    const tone = new Float32Array(W * H).fill(1), hgt = new Float32Array(W * H);
    const chisel = fbm(W, H, [32, 16, 8, 4, 2], r);
    const blot = fbm(W, H, [128, 64], r);
    let y0 = 0;
    const rows = [];
    while (y0 < H - 1) {
      let hh = Math.round([0.3, 0.4, 0.5, 0.4][Math.floor(r() * 4)] * ppm);
      if (H - (y0 + hh) < 0.25 * ppm) hh = H - y0;
      rows.push([y0, Math.min(H, y0 + hh)]);
      y0 += hh;
    }
    for (const [ra, rb] of rows) {
      let x = Math.floor(r() * W);
      const start = x;
      while (x < start + W) {
        const len = Math.round((0.45 + r() * 0.45) * ppm);
        const xe = Math.min(start + W, x + len);
        const t = 0.86 + r() * 0.2, warm = (r() - 0.5) * 0.08;
        for (let yy = ra; yy < rb; yy++) {
          for (let xx = x; xx < xe; xx++) {
            const px = ((xx % W) + W) % W, i = yy * W + px;
            const e = Math.min(xx - x, xe - 1 - xx, yy - ra, rb - 1 - yy);   // distance to the block edge
            const joint = e < 2;
            const pillow = Math.min(1, e / 7);
            tone[i] = joint ? 0.78 : t * (0.9 + 0.1 * pillow) + warm;
            hgt[i] = joint ? 0 : 0.55 + 0.25 * pillow + 0.35 * (chisel[i] - 0.5);
          }
        }
        x = xe;
      }
    }
    const cm = canvas(W, H), cb = canvas(W, H);
    paint(cm, (i) => {
      const v = tone[i] * (0.92 + 0.16 * (chisel[i] - 0.5) + 0.1 * (blot[i] - 0.5));
      return [clamp255(255 * v * 1.02), clamp255(255 * v), clamp255(255 * v * 0.96)];
    });
    paint(cb, (i) => { const v = clamp255(hgt[i] * 255); return [v, v, v]; });
    return { map: tex(cm, { metres: [M, M] }), bump: tex(cb, { srgb: false, metres: [M, M] }), bumpScale: 2.2 };
  });
}

// ---------------------------------------------------------------- plaster: blotchy render, fine grain, rain streaks
export function plaster() {
  return once('plaster', () => {
    const W = 512, H = 512, M = 3, r = rng(23);
    const blot = fbm(W, H, [256, 128, 64], r), grain = fbm(W, H, [4, 2], r);
    const streak = vnoise(W, H, 8, 256, r);
    const cm = canvas(W, H), cb = canvas(W, H);
    paint(cm, (i) => {
      const v = 0.93 + 0.12 * (blot[i] - 0.5) + 0.07 * (grain[i] - 0.5) - 0.07 * Math.max(0, streak[i] - 0.6);
      return [clamp255(255 * v), clamp255(255 * v * 0.995), clamp255(255 * v * 0.98)];
    });
    paint(cb, (i) => { const v = clamp255(128 + 110 * (grain[i] - 0.5)); return [v, v, v]; });
    return { map: tex(cm, { metres: [M, M] }), bump: tex(cb, { srgb: false, metres: [M, M] }), bumpScale: 0.9 };
  });
}

// ---------------------------------------------------------------- terracotta roof tiles (Marseille style)
export function roof() {
  return once('roof', () => {
    const W = 256, H = 256, M = 1.0, r = rng(5);
    const n = fbm(W, H, [32, 8, 2], r);
    const cols = 4, rows = 4, tw = W / cols, th = H / rows;
    const jit = Array.from({ length: cols * rows }, () => 0.88 + r() * 0.2);
    const cm = canvas(W, H), cb = canvas(W, H);
    const field = new Float32Array(W * H), hgt = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const row = Math.floor(y / th), fy = (y % th) / th;       // fy 0 = top (up the slope), 1 = lower lip
      for (let x = 0; x < W; x++) {
        const col = Math.floor(x / tw), fx = (x % tw) / tw;
        const prof = Math.sin(Math.PI * fx);                      // rounded channel across each tile
        const lip = fy > 0.86 ? 0.55 : 1 - 0.18 * Math.pow(1 - fy, 3);   // shadow under the next row's lip
        const i = y * W + x;
        field[i] = jit[row * cols + col] * (0.72 + 0.28 * prof) * lip * (0.92 + 0.16 * (n[i] - 0.5));
        hgt[i] = 0.25 + 0.6 * prof * (fy > 0.86 ? 0.3 : 1) + 0.15 * fy;
      }
    }
    paint(cm, (i) => { const v = field[i]; return [clamp255(255 * v), clamp255(240 * v), clamp255(230 * v)]; });
    paint(cb, (i) => { const v = clamp255(hgt[i] * 255); return [v, v, v]; });
    return { map: tex(cm, { metres: [M, M] }), bump: tex(cb, { srgb: false, metres: [M, M] }), bumpScale: 3 };
  });
}

// ---------------------------------------------------------------- bark: long vertical fissures
export function bark() {
  return once('bark', () => {
    const W = 256, H = 512, MW = 0.5, MH = 1.0, r = rng(31);
    const fis = vnoise(W, H, 8, 128, r), fis2 = vnoise(W, H, 16, 64, r), fine = fbm(W, H, [8, 4, 2], r);
    const cm = canvas(W, H), cb = canvas(W, H);
    const hgt = new Float32Array(W * H);
    for (let i = 0; i < hgt.length; i++) {
      const f = Math.abs(fis[i] * 0.65 + fis2[i] * 0.35 - 0.5) * 2;   // ridges where the noise crosses its middle
      hgt[i] = Math.min(1, Math.pow(f, 0.6) * 0.8 + 0.25 * fine[i]);
    }
    paint(cm, (i) => { const v = 0.45 + 0.65 * hgt[i]; return [clamp255(255 * v), clamp255(250 * v), clamp255(240 * v)]; });
    paint(cb, (i) => { const v = clamp255(hgt[i] * 255); return [v, v, v]; });
    return { map: tex(cm, { metres: [MW, MH] }), bump: tex(cb, { srgb: false, metres: [MW, MH] }), bumpScale: 3.5 };
  });
}

// ---------------------------------------------------------------- leaf cluster card (alpha cut-out)
export function leaves() {
  return once('leaves', () => {
    const S = 256, r = rng(7), c = canvas(S, S), g = c.getContext('2d');
    const greens = [[47, 82, 30], [58, 98, 34], [72, 112, 40], [38, 70, 28], [88, 124, 48], [64, 90, 30]];
    // twigs first, then ~170 leaves, denser and darker in the middle
    g.strokeStyle = 'rgb(70,52,34)'; g.lineWidth = 2;
    for (let k = 0; k < 6; k++) {
      const a = r() * Math.PI * 2;
      g.beginPath(); g.moveTo(S / 2, S / 2); g.lineTo(S / 2 + Math.cos(a) * S * 0.38, S / 2 + Math.sin(a) * S * 0.38); g.stroke();
    }
    for (let k = 0; k < 170; k++) {
      const rad = Math.pow(r(), 0.7) * S * 0.42, a = r() * Math.PI * 2;
      const x = S / 2 + Math.cos(a) * rad, y = S / 2 + Math.sin(a) * rad;
      const L = 14 + r() * 14, Wd = L * (0.36 + r() * 0.12), rot = r() * Math.PI * 2;
      const [cr, cg, cb] = greens[Math.floor(r() * greens.length)];
      const sh = 0.75 + 0.4 * (rad / (S * 0.42)) + (r() - 0.5) * 0.15;
      g.save(); g.translate(x, y); g.rotate(rot);
      g.fillStyle = `rgb(${clamp255(cr * sh)},${clamp255(cg * sh)},${clamp255(cb * sh)})`;
      g.beginPath(); g.ellipse(0, 0, L / 2, Wd / 2, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = `rgba(20,35,12,0.35)`; g.lineWidth = 1;
      g.beginPath(); g.moveTo(-L / 2, 0); g.lineTo(L / 2, 0); g.stroke();
      g.restore();
    }
    return tex(c, { aniso: 4 });
  });
}

// ---------------------------------------------------------------- palm frond: rachis along u, leaflets out to both edges
export function frond(dry = false) {
  return once('frond' + dry, () => {
    const Wd = 512, Hd = 128, r = rng(dry ? 3 : 9), c = canvas(Wd, Hd), g = c.getContext('2d');
    const pal = dry ? [[150, 112, 64], [128, 92, 52], [168, 130, 78]] : [[52, 92, 34], [64, 106, 38], [44, 80, 30], [78, 118, 44]];
    for (let x = 18; x < Wd - 6; x += 7 + r() * 3) {
      for (const side of [-1, 1]) {
        const [cr, cg, cb] = pal[Math.floor(r() * pal.length)];
        const len = (Hd / 2 - 4) * (0.75 + r() * 0.25) * Math.min(1, x / 60);
        const tilt = 0.5 + r() * 0.2;                     // leaflets lean toward the tip
        g.strokeStyle = `rgb(${cr},${cg},${cb})`; g.lineCap = 'round';
        g.lineWidth = 4 + r() * 2;
        g.beginPath();
        g.moveTo(x, Hd / 2);
        g.quadraticCurveTo(x + len * tilt * 0.5, Hd / 2 + side * len * 0.6, x + len * tilt, Hd / 2 + side * len);
        g.stroke();
      }
    }
    g.strokeStyle = dry ? 'rgb(120,90,50)' : 'rgb(110,120,60)'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(0, Hd / 2); g.lineTo(Wd, Hd / 2); g.stroke();
    return tex(c, { aniso: 4 });
  });
}

// ---------------------------------------------------------------- leather grain, fabric weave (bump only)
export function grain() {
  return once('grain', () => {
    const S = 256, r = rng(41), n = fbm(S, S, [8, 4, 2], r), cb = canvas(S, S);
    const cells = vnoise(S, S, 4, 4, r);
    paint(cb, (i) => { const v = clamp255(255 * (0.55 * n[i] + 0.45 * Math.pow(cells[i], 1.5))); return [v, v, v]; });
    return tex(cb, { srgb: false, metres: [0.12, 0.12] });
  });
}

export function weave() {
  return once('weave', () => {
    const S = 128, cb = canvas(S, S), r = rng(43), n = fbm(S, S, [4, 2], r);
    paint(cb, (i, x, y) => {
      const u = Math.sin((x / S) * Math.PI * 32), v = Math.sin((y / S) * Math.PI * 32);
      const w = ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? u : v) * 0.5 + 0.5;
      const val = clamp255(255 * (0.7 * w + 0.3 * n[i]));
      return [val, val, val];
    });
    return tex(cb, { srgb: false, metres: [0.05, 0.05] });
  });
}

// ---------------------------------------------------------------- Israeli number plate, police lettering
export function plate() {
  return once('plate', () => {
    const c = canvas(520, 112), g = c.getContext('2d');
    g.fillStyle = '#f7c500'; g.fillRect(0, 0, 520, 112);
    g.strokeStyle = '#111'; g.lineWidth = 5; g.strokeRect(3, 3, 514, 106);
    g.fillStyle = '#1748b0'; g.fillRect(6, 6, 64, 100);
    g.fillStyle = '#fff'; g.font = '800 30px Assistant, Arial'; g.textAlign = 'center';
    g.fillText('IL', 38, 92);
    g.strokeStyle = '#fff'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(38, 22); g.lineTo(52, 46); g.lineTo(24, 46); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(38, 54); g.lineTo(24, 30); g.lineTo(52, 30); g.closePath(); g.stroke();
    g.fillStyle = '#111'; g.font = '700 86px Karantina, Assistant, Arial';
    g.fillText('45-821-63', 292, 88);
    return tex(c);
  });
}

export function policeText() {
  return once('police', () => {
    const c = canvas(1024, 170), g = c.getContext('2d');
    g.direction = 'rtl';
    g.fillStyle = '#0d3a8c'; g.textAlign = 'center';
    g.font = '700 168px Karantina, Assistant, Arial';
    g.fillText('משטרה', 512, 150);
    return tex(c);
  });
}

// ---------------------------------------------------------------- road surfaces (plane UVs, so flipY stays on)
export function asphalt(ROAD_HALF, LEN) {
  const W = 512, H = 1024, r = rng(17);
  const fine = fbm(W, H, [4, 2], r), patch = fbm(W, H, [128, 64, 32], r), ag = vnoise(W, H, 2, 2, r);
  const px = (x) => (x + ROAD_HALF) / (ROAD_HALF * 2) * W;
  const tracks = [-2.6, -0.9, 0.9, 2.6].map(px);
  const cm = canvas(W, H);
  paint(cm, (i, x) => {
    let wear = 0;
    for (const t of tracks) wear += Math.exp(-((x - t) ** 2) / 260);
    const v = 46 + 22 * (patch[i] - 0.5) + 18 * (fine[i] - 0.5) + (ag[i] > 0.93 ? 26 : 0) - wear * 7;
    return [clamp255(v), clamp255(v + 1), clamp255(v + 4)];
  });
  const g = cm.getContext('2d');
  // cracks and a couple of repair patches
  g.strokeStyle = 'rgba(12,12,14,0.65)'; g.lineWidth = 1.3;
  for (let k = 0; k < 16; k++) {
    let x = r() * W, y = r() * H;
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 12; s++) { x += (r() - 0.5) * 22; y += (r() - 0.3) * 26; g.lineTo(x, y); }
    g.stroke();
  }
  for (let k = 0; k < 3; k++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '20,20,22' : '70,70,72'},0.35)`;
    g.fillRect(r() * W * 0.8, r() * H, 40 + r() * 80, 60 + r() * 140);
  }
  // markings, worn by traffic
  const mark = (x0, y0, w, h) => {
    for (let y = y0; y < y0 + h; y += 2) {
      for (let x = x0; x < x0 + w; x += 2) {
        const i = Math.floor(y) * W + Math.floor(x);
        if (fine[i % (W * H)] > 0.32) { g.fillStyle = `rgba(236,232,220,${0.75 + 0.25 * fine[i % (W * H)]})`; g.fillRect(x, y, 2, 2); }
      }
    }
  };
  mark(W / 2 - 3, 0, 6, H * 3 / 8);
  mark(px(-3.5) - 2, 0, 4, H);
  mark(px(3.5) - 2, 0, 4, H);
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 0, 6, H); g.fillRect(W - 6, 0, 6, H);
  const t = tex(cm, { flipY: true, aniso: 12 });
  t.repeat.set(1, LEN / 8);
  const cb = canvas(256, 512);
  const fb = fbm(256, 512, [2, 1], r);
  paint(cb, (i) => { const v = clamp255(255 * fb[i]); return [v, v, v]; });
  const bump = tex(cb, { srgb: false, flipY: true });
  bump.repeat.set(4, LEN / 2);
  return { map: t, bump };
}

export function sidewalk(LEN) {
  // 40 cm grey concrete tiles with chamfered joints, per-tile tone, stains (3 m wide, 2 m period)
  const W = 384, H = 256, r = rng(19), tile = W / 7.5;
  const n = fbm(W, H, [32, 8, 2], r);
  const tones = Array.from({ length: 64 }, () => 0.9 + r() * 0.16);
  const cm = canvas(W, H), cb = canvas(W, H);
  const hg = new Float32Array(W * H);
  paint(cm, (i, x, y) => {
    const tx = Math.floor(x / tile), ty = Math.floor(y / tile);
    const fx = (x % tile) / tile, fy = (y % tile) / tile;
    const e = Math.min(fx, 1 - fx, fy, 1 - fy) * tile;
    hg[i] = e < 1.5 ? 0 : Math.min(1, e / 4);
    const v = (e < 1.5 ? 0.62 : tones[(tx * 7 + ty * 3) % 64]) * (0.9 + 0.2 * (n[i] - 0.5)) * 150;
    return [clamp255(v), clamp255(v * 0.98), clamp255(v * 0.95)];
  });
  paint(cb, (i) => { const v = clamp255(hg[i] * 200 + 40 * n[i]); return [v, v, v]; });
  const map = tex(cm, { flipY: true }), bump = tex(cb, { srgb: false, flipY: true });
  map.repeat.set(1, LEN / 2); bump.repeat.set(1, LEN / 2);
  return { map, bump };
}
