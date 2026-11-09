// Dresses the Blender cockpit for real-time: the digital cluster (speed, BAC, score), the centre
// touchscreen with a scrolling navigation map, and a rear-view mirror that really shows the road
// behind (a small second camera rendered into a texture).
import * as THREE from 'three';
import { find } from './assets.js';

function canvasTex(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;               // quad UVs come from the GLB (top-left origin)
  tex.anisotropy = 8;
  return { c, g: c.getContext('2d'), tex };
}

function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }

export function dressCockpit(ck, { mirror = true } = {}) {
  // ---------------------------------------------------------------- cluster
  const cl = canvasTex(1024, 248);
  find(ck, 'cluster').material = new THREE.MeshBasicMaterial({ map: cl.tex, toneMapped: false });
  let last = '';
  function drawCluster({ kmh = 50, bac = 0, score = null, total = 19 } = {}) {
    const key = `${kmh}|${bac.toFixed(2)}|${score}`;
    if (key === last) return;
    last = key;
    const { g } = cl, W = 1024, H = 248;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0a1020'); bg.addColorStop(1, '#03060d');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // speed bar
    const f = Math.min(1, kmh / 120);
    rr(g, 40, 176, 380, 16, 8); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fill();
    rr(g, 40, 176, 380 * f, 16, 8); g.fillStyle = '#ffd60a'; g.fill();
    g.direction = 'ltr'; g.textAlign = 'left'; g.fillStyle = '#ffffff';
    g.font = '700 150px Karantina, Assistant, Arial';
    g.fillText(String(kmh), 40, 160);
    const sw = g.measureText(String(kmh)).width;
    g.font = '700 34px Assistant, Arial'; g.fillStyle = '#9fb0d0';
    g.fillText('km/h', 40 + sw + 16, 160);
    // centre: lane graphic
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(470, 210); g.lineTo(500, 40); g.moveTo(560, 210); g.lineTo(530, 40); g.stroke();
    g.setLineDash([16, 14]); g.beginPath(); g.moveTo(515, 210); g.lineTo(515, 40); g.stroke(); g.setLineDash([]);
    // right: BAC (and score in the game)
    const drunk = bac > 0.0001;
    g.textAlign = 'right';
    g.font = '700 34px Assistant, Arial'; g.fillStyle = '#9fb0d0';
    g.fillText('BAC', 984, 64);
    g.font = '700 120px Karantina, Assistant, Arial'; g.fillStyle = drunk ? '#ff4b4b' : '#3ee08f';
    g.fillText(bac.toFixed(2) + '%', 984, 180);
    if (score !== null) {
      g.textAlign = 'left'; g.font = '700 34px Assistant, Arial'; g.fillStyle = '#9fb0d0';
      g.fillText('SCORE', 620, 64);
      g.font = '700 110px Karantina, Assistant, Arial'; g.fillStyle = '#ffd60a';
      g.fillText(`${score}/${total}`, 620, 176);
    }
    cl.tex.needsUpdate = true;
  }
  drawCluster();

  // ---------------------------------------------------------------- navigation screen
  const md = find(ck, 'media');
  const map = { c: document.createElement('canvas') };
  map.c.width = 512; map.c.height = 576;
  map.g = map.c.getContext('2d');
  {
    const { g } = map, W = 512, H = 576;
    g.fillStyle = '#0d1424'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#121c31';
    for (let y = 0; y < H; y += 96) for (const x of [24, 300]) { rr(g, x, y + 14, 188, 68, 8); g.fill(); }
    g.strokeStyle = '#2a3654'; g.lineWidth = 14;
    for (let y = 0; y < H; y += 96) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.strokeStyle = '#3a4a70'; g.lineWidth = 34;
    g.beginPath(); g.moveTo(256, 0); g.lineTo(256, H); g.stroke();
    g.strokeStyle = '#ffd60a'; g.lineWidth = 14;
    g.beginPath(); g.moveTo(256, 0); g.lineTo(256, H); g.stroke();
  }
  const nav = canvasTex(512, 288);
  if (md) md.material = new THREE.MeshBasicMaterial({ map: nav.tex, toneMapped: false });
  let mapY = 0;
  const mapImg = map.c;
  function drawNav(dz) {
    mapY = (mapY + dz * 6) % 576;
    const { g } = nav, W = 512, H = 288;
    g.drawImage(mapImg, 0, mapY - 576, W, 576);
    g.drawImage(mapImg, 0, mapY, W, 576);
    // car arrow
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(256, 196); g.lineTo(234, 248); g.lineTo(256, 236); g.lineTo(278, 248); g.closePath(); g.fill();
    // top bar
    g.fillStyle = 'rgba(5,8,16,0.88)'; g.fillRect(0, 0, W, 54);
    g.direction = 'rtl'; g.textAlign = 'right'; g.fillStyle = '#ffffff'; g.font = '800 28px Assistant, Arial';
    g.fillText('הביתה · בנסיעה זהירה', W - 20, 37);
    g.direction = 'ltr'; g.textAlign = 'left'; g.fillStyle = '#ffd60a'; g.font = '700 34px Karantina, Assistant, Arial';
    g.fillText('12 min', 20, 40);
    nav.tex.needsUpdate = true;
  }
  drawNav(0);

  // ---------------------------------------------------------------- rear-view mirror
  let mirrorPass = null;
  const mr = find(ck, 'mirror');
  if (mirror && mr) {
    const rt = new THREE.WebGLRenderTarget(384, 96, { samples: 2 });
    rt.texture.center.set(0.5, 0.5);
    rt.texture.rotation = Math.PI;           // flips both ways: GLB UV origin + mirror image
    mr.material = new THREE.MeshBasicMaterial({ map: rt.texture, color: '#c8ccd4' });
    const cam = new THREE.PerspectiveCamera(22, 4, 0.2, 400);
    let frame = 0;
    mirrorPass = (renderer, scene, eye, hide = []) => {
      if ((frame++ & 1) === 1) return;       // every other frame is plenty
      cam.position.set(eye.x, eye.y + 0.05, eye.z - 0.4);
      cam.lookAt(eye.x, eye.y - 0.25, eye.z + 40);
      const vis = hide.map((o) => o.visible);
      hide.forEach((o) => { o.visible = false; });
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      renderer.setRenderTarget(prev);
      hide.forEach((o, i) => { o.visible = vis[i]; });
    };
  }

  return { drawCluster, drawNav, mirrorPass };
}
