// Sky, lights and an endless Israeli street built from the Blender models.
// Street tiles are merged per material and recycled around the camera, so the draw-call
// count stays flat no matter how far the camera travels.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { inst, mergeStatic, recolor } from './assets.js';
import * as TX from './textures.js';

export const ROAD_HALF = 5.5;      // road from x=-5.5 to 5.5 (two lanes + parking strips)
export const LANE_R = 1.75;        // centre of the right-hand lane (traffic goes toward -z)
export const LANE_L = -1.75;
export const PARK_X = 4.3;
export const WALK_IN = 5.5, WALK_OUT = 8.5;

const MODES = {
  night: {
    top: '#02040b', mid: '#0a1431', horizon: '#1c2a52', fog: '#141d3a', fogNear: 25, fogFar: 175,
    hemiSky: '#6f82c4', hemiGround: '#24180f', hemi: 0.62, sun: '#a9bcff', sunI: 0.55, sunPos: [-40, 60, 30],
    env: 0.22, stars: true, moon: true,
  },
  evening: {
    top: '#0e1840', mid: '#3d3f7e', horizon: '#ee8a5a', fog: '#6d5774', fogNear: 30, fogFar: 210,
    hemiSky: '#b8bcf0', hemiGround: '#3c2a1e', hemi: 1.35, sun: '#ffb27a', sunI: 1.1, sunPos: [-30, 18, -80],
    env: 0.5, stars: false, moon: false,
  },
};

// ---------------------------------------------------------------- textures
function canvasTex(w, h, draw, { repeat = [1, 1], aniso = 8 } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  return t;
}

function noise(g, w, h, base, spread, n, size = 2) {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = (Math.random() - 0.5) * spread;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    g.fillRect(Math.random() * w, Math.random() * h, size, size);
  }
}

let _glow;
export function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  _glow = new THREE.CanvasTexture(c);
  _glow.colorSpace = THREE.SRGBColorSpace;
  return _glow;
}

export function glowSprite(color, size, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  s.scale.set(size, size, 1);
  return s;
}

/** soft additive light cone pointing down -z from the origin */
export function makeBeam(length = 22, radius = 4.5, color = '#fff2d6', strength = 0.22) {
  const geo = new THREE.ConeGeometry(radius, length, 28, 1, true);
  geo.translate(0, -length / 2, 0);
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, strength: { value: strength }, len: { value: length } },
    vertexShader: `varying float vD; varying vec3 vN; varying vec3 vV;
      uniform float len;
      void main(){ vD = clamp(-position.z/len,0.0,1.0); vec4 mv = modelViewMatrix*vec4(position,1.0);
      vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 color; uniform float strength; varying float vD; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(abs(dot(vN, vV)), 1.3); float a = strength * pow(1.0 - vD, 1.7) * f;
      gl_FragColor = vec4(color * a, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 5;
  return m;
}

// ---------------------------------------------------------------- sky
function makeSky(p) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    uniforms: { top: { value: new THREE.Color(p.top) }, mid: { value: new THREE.Color(p.mid) }, hor: { value: new THREE.Color(p.horizon) } },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top, mid, hor; varying vec3 vP;
      void main(){ float h = vP.y; vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, h)); c = mix(c, top, smoothstep(0.18, 0.7, h));
      if (h < 0.0) c = hor; gl_FragColor = vec4(c,1.0);
      #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  return sky;
}

function makeStars() {
  const n = 900, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * Math.PI * 2, v = Math.acos(Math.random() * 0.92);
    pos[i * 3] = Math.sin(v) * Math.cos(u) * 800;
    pos[i * 3 + 1] = Math.cos(v) * 800 + 30;
    pos[i * 3 + 2] = Math.sin(v) * Math.sin(u) * 800;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color: '#dfe7ff', size: 1.7, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false }));
  p.frustumCulled = false;
  return p;
}

// ---------------------------------------------------------------- the world
export class World {
  constructor(scene, renderer, { mode = 'night', parked = false, seed = 3 } = {}) {
    const p = MODES[mode];
    this.p = p;
    this.scene = scene;
    scene.background = new THREE.Color(p.fog);
    scene.fog = new THREE.Fog(p.fog, p.fogNear, p.fogFar);
    // reflections come from this street's own sky (sunset or night) plus a few warm street-lamp
    // glints, so the car paint and glass mirror the real scene instead of a studio
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(makeSky(p));
    const ground = new THREE.Mesh(new THREE.CircleGeometry(800, 32), new THREE.MeshBasicMaterial({ color: '#16161a' }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -2;
    envScene.add(ground);
    const glint = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc27a').multiplyScalar(6), side: THREE.DoubleSide });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const q = new THREE.Mesh(new THREE.PlaneGeometry(40, 8), glint);
      q.position.set(Math.cos(a) * 300, 120, Math.sin(a) * 300);
      q.lookAt(0, 0, 0);
      envScene.add(q);
    }
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    scene.environmentIntensity = p.env * 1.6;

    this.hemi = new THREE.HemisphereLight(p.hemiSky, p.hemiGround, p.hemi);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(p.sun, p.sunI);
    this.sun.position.set(...p.sunPos);
    scene.add(this.sun, this.sun.target);

    this.sky = makeSky(p);
    scene.add(this.sky);
    if (p.stars) { this.stars = makeStars(); this.sky.add(this.stars); }
    if (p.moon) {
      const moon = glowSprite('#cfdcff', 90, 0.9);
      moon.position.set(-260, 330, -560);
      const disc = glowSprite('#ffffff', 26, 1);
      disc.position.copy(moon.position);
      moon.material.fog = false; disc.material.fog = false;
      this.sky.add(moon, disc);
    }
    this.street = new Street(scene, { parked, seed });
  }

  update(camera) {
    this.sky.position.copy(camera.position);
    this.street.update(camera.position.z);
  }
}

// ---------------------------------------------------------------- street
const CAR_COLORS = ['#1d3f8f', '#d8d8d8', '#2b2b2e', '#7a1414', '#3d6b58', '#b8b2a2'];

function rngFrom(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export class Street {
  constructor(scene, { parked, seed }) {
    this.L = 40;
    this.N = 8;
    this.offset = 0;
    this.scene = scene;
    this.rng = rngFrom(seed);
    this.parked = parked;
    this.ground = this.makeGround();
    scene.add(this.ground);
    this.tiles = [];
    for (let k = 0; k < this.N; k++) {
      const t = this.makeTile(k);
      t.userData.zv = 40 - k * this.L;
      scene.add(t);
      this.tiles.push(t);
    }
  }

  makeGround() {
    const g = new THREE.Group();
    const LEN = 480;
    // road: aggregate, patches, tyre wear, cracks and worn markings; texture period 8 m
    const asph = TX.asphalt(ROAD_HALF, LEN);
    const roadM = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, LEN), new THREE.MeshStandardMaterial({
      map: asph.map, bumpMap: asph.bump, bumpScale: 1.4, roughness: 0.9, metalness: 0 }));
    roadM.rotation.x = -Math.PI / 2;
    g.add(roadM);
    // sidewalk: 40 cm concrete tiles, period 2 m
    const sw = TX.sidewalk(LEN);
    const walk = sw.map;
    const curb = canvasTex(64, 128, (c, w, h) => {
      noise(c, w, h / 2, '#c42525', 0.2, 900, 2);           // red half, then white half
      c.fillStyle = '#e8e4da'; c.fillRect(0, h / 2, w, h / 2);
      for (let i = 0; i < 260; i++) {                       // chipped paint and grime
        c.fillStyle = `rgba(${90 + Math.random() * 40},${88 + Math.random() * 30},${84 + Math.random() * 20},${0.25 + Math.random() * 0.4})`;
        c.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 4, 1 + Math.random() * 3);
      }
    }, { repeat: [1, LEN / 2] });
    const yard = canvasTex(256, 256, (c, w, h) => {
      noise(c, w, h, '#3b3a26', 0.22, 9000, 3);
      for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(${40 + Math.random() * 30},${70 + Math.random() * 50},30,0.5)`; c.fillRect(Math.random() * w, Math.random() * h, 6, 6); }
    }, { repeat: [6, LEN / 8] });
    const walkMat = new THREE.MeshStandardMaterial({ map: walk, bumpMap: sw.bump, bumpScale: 1.5, roughness: 0.95 });
    const curbMat = new THREE.MeshStandardMaterial({ map: curb, roughness: 0.8 });
    const yardMat = new THREE.MeshStandardMaterial({ map: yard, roughness: 1 });
    for (const sx of [-1, 1]) {
      const top = new THREE.Mesh(new THREE.PlaneGeometry(WALK_OUT - WALK_IN, LEN), walkMat);
      top.rotation.x = -Math.PI / 2;
      top.position.set(sx * (WALK_IN + WALK_OUT) / 2, 0.15, 0);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.15, LEN), curbMat);
      face.rotation.set(0, sx * -Math.PI / 2, Math.PI / 2);
      face.rotation.order = 'YXZ';
      face.position.set(sx * WALK_IN, 0.075, 0);
      const yardM = new THREE.Mesh(new THREE.PlaneGeometry(60, LEN), yardMat);
      yardM.rotation.x = -Math.PI / 2;
      yardM.position.set(sx * (WALK_OUT + 30), 0.14, 0);
      g.add(top, face, yardM);
    }
    return g;
  }

  makeTile(k) {
    const r = this.rng;
    const t = new THREE.Group();
    const raw = new THREE.Group();
    const L = this.L;
    const pick = (a) => a[Math.floor(r() * a.length)];
    for (const sx of [-1, 1]) {
      // two houses per side
      const types = [pick(['house_flat', 'house_roof', 'block', 'house_flat']), pick(['house_roof', 'house_flat', 'block'])];
      types.forEach((type, i) => {
        const h = inst(type);
        const centre = type === 'block' ? 15.5 : type === 'house_flat' ? 16.4 : 15.9;
        h.position.set(sx * (centre + r() * 1.5), 0.12, -10 - i * 20 + (r() - 0.5) * 2);
        h.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
        raw.add(h);
      });
      // street lamp: right side at local z 0, left side at local z -20
      const lamp = inst('lamp');
      lamp.position.set(sx * 6.4, 0.15, sx > 0 ? 0 : -20);
      lamp.rotation.y = sx > 0 ? Math.PI : 0;
      raw.add(lamp);
      // palms on the sidewalk, away from the set spots (z = 30 mod 40 on the right)
      const palm = inst('palm');
      palm.position.set(sx * 7.7, 0.15, sx > 0 ? -20 : -2);
      palm.rotation.y = r() * 6;
      palm.scale.setScalar(0.9 + r() * 0.25);
      raw.add(palm);
      // yard trees and bushes between houses
      for (let j = 0; j < 3; j++) {
        const kind = pick(['tree', 'bush', 'tree', 'bush']);
        const o = inst(kind);
        o.position.set(sx * (9.6 + r() * 1.6), 0.14, -r() * L);
        o.rotation.y = r() * 6;
        o.scale.setScalar(kind === 'tree' ? 0.85 + r() * 0.35 : 0.8 + r() * 0.5);
        raw.add(o);
      }
      if (this.parked && r() < 0.6) {
        const c = inst('car_lo');
        recolor(c, 'Paint', pick(CAR_COLORS));
        c.position.set(sx * PARK_X, 0, -8 - r() * 24);
        c.rotation.y = sx > 0 ? 0 : Math.PI;
        raw.add(c);
      }
    }
    const merged = mergeStatic(raw);
    t.add(merged);
    // lamp light pools on the road and halos at the lamp heads
    const pools = [], halo = [];
    for (const sx of [-1, 1]) {
      const z = sx > 0 ? 0 : -20;
      const pg = new THREE.PlaneGeometry(10, 10);
      pg.rotateX(-Math.PI / 2);
      pg.translate(sx * 4.6, 0.04, z);
      pools.push(pg);
      halo.push(sx * 4.85, 5.95, z);
    }
    const poolGeo = mergeGeoms(pools);
    const pool = new THREE.Mesh(poolGeo, POOL_MAT());
    pool.renderOrder = 2;
    t.add(pool);
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(halo, 3));
    const pts = new THREE.Points(hg, HALO_MAT());
    t.add(pts);
    return t;
  }

  scroll(dz) { this.offset += dz; }

  update(camZ) {
    const cv = camZ - this.offset;
    const NL = this.N * this.L;
    for (const t of this.tiles) {
      while (t.userData.zv > cv + 100) t.userData.zv -= NL;
      while (t.userData.zv <= cv - (NL - 100)) t.userData.zv += NL;
      t.position.z = t.userData.zv + this.offset;
    }
    this.ground.position.z = Math.round(cv / 8) * 8 - 110 + this.offset;
  }
}

let _pool, _halo;
function POOL_MAT() {
  return _pool || (_pool = new THREE.MeshBasicMaterial({
    map: glowTexture(), color: '#ffae5a', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  }));
}
function HALO_MAT() {
  return _halo || (_halo = new THREE.PointsMaterial({
    map: glowTexture(), color: '#ffc47e', size: 3.4, sizeAttenuation: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
}
function mergeGeoms(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = [];
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    uv.set(g.attributes.uv.array, o * 2);
    for (const i of g.index.array) idx.push(i + o);
    o += g.attributes.position.count;
  }
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}
