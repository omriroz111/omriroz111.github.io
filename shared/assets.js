// Loads the Blender-made GLB models once, fixes their materials for real-time use,
// and gives cheap clones plus a merge helper that collapses static scenery into few draw calls.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import * as TX from './textures.js';

const draco = new DRACOLoader();
draco.setDecoderPath('/vendor/three/addons/libs/draco/gltf/');
draco.setDecoderConfig({ type: 'wasm' });
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);
const MODEL_VERSION = 6;   // bump after rebuilding the models so browsers fetch the new files
export const models = {};

// ---------------------------------------------------------------- printed labels (canvas)
function labelTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.direction = 'rtl';
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;                 // the GLB's UVs already follow glTF's top-left origin
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
let _can, _bottle, _speck;
function canLabel() {
  // the design repeats three times round the can, so the name always faces the viewer
  return _can || (_can = labelTexture(1536, 256, (g, w, h) => {
    for (let k = 0; k < 3; k++) {
      const x0 = k * w / 3, cw = w / 3;
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#0d6b3c'); gr.addColorStop(0.5, '#0a8a4a'); gr.addColorStop(1, '#064424');
      g.fillStyle = gr; g.fillRect(x0, 0, cw, h);
      g.fillStyle = '#ffd60a'; g.fillRect(x0, h * 0.62, cw, h * 0.07);
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(x0, h * 0.71, cw, h * 0.018);
      g.textAlign = 'center'; g.fillStyle = '#ffffff';
      g.font = '700 128px Karantina, Assistant, Arial';
      g.fillText('בירה', x0 + cw / 2, h * 0.56);
      g.font = '800 30px Assistant, Arial'; g.fillStyle = '#ffe9a0';
      g.fillText('5% אלכוהול · 330 מ״ל', x0 + cw / 2, h * 0.88);
    }
  }));
}
function bottleLabel() {
  // printed paper: cream stock, a deep red band with the name, fine gold rules, small print;
  // repeated three times round the bottle so the name is never cut by the seam
  return _bottle || (_bottle = labelTexture(1536, 256, (g, w, h) => {
    g.fillStyle = '#efe4c8'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2200; i++) {               // paper fibre
      g.fillStyle = `rgba(120,100,60,${Math.random() * 0.06})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 1);
    }
    g.fillStyle = '#8f1018'; g.fillRect(0, h * 0.3, w, h * 0.42);
    g.fillStyle = '#c99a3c';
    g.fillRect(0, h * 0.27, w, 4); g.fillRect(0, h * 0.74, w, 4); g.fillRect(0, 8, w, 3); g.fillRect(0, h - 11, w, 3);
    g.textAlign = 'center';
    for (let k = 0; k < 3; k++) {
      const cx = w * (k + 0.5) / 3;
      g.fillStyle = '#fff3d6'; g.font = '700 104px Karantina, Assistant, Arial';
      g.fillText('בירה', cx, h * 0.64);
      g.fillStyle = '#5a3a14'; g.font = '800 26px Assistant, Arial';
      g.fillText('לאגר בהירה', cx, h * 0.22);
      g.fillText('5% אלכוהול · 330 מ״ל', cx, h * 0.9);
    }
  }));
}
function speckle() {
  // glazed stoneware: warm off-white with fine iron speckles
  return _speck || (_speck = labelTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#f1ebe0'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) {
      const r = Math.random() * 1.6 + 0.4;
      g.fillStyle = `rgba(${70 + Math.random() * 40},${50 + Math.random() * 30},${30 + Math.random() * 20},${0.35 + Math.random() * 0.5})`;
      g.beginPath(); g.arc(Math.random() * w, Math.random() * h, r, 0, Math.PI * 2); g.fill();
    }
  }));
}

// ---------------------------------------------------------------- materials
function physical(m, extra = {}) {
  const p = new THREE.MeshPhysicalMaterial({
    name: m.name, color: m.color, map: m.map || null, roughness: m.roughness, metalness: m.metalness,
    emissive: m.emissive, emissiveIntensity: m.emissiveIntensity, side: m.side,
    transparent: m.transparent, opacity: m.opacity, vertexColors: m.vertexColors,
  });
  Object.assign(p, extra);
  return p;
}

/** double-sided foliage keeps its outward (crown) normals on the back of each card too */
function keepNormals(m) {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>',
      '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\n  normal *= faceDirection;\n#endif');
  };
  m.customProgramCacheKey = () => 'keepNormals';
}

function foliage(m0, map) {
  const m = new THREE.MeshStandardMaterial({ name: m0.name, map, color: m0.color, roughness: 0.8, metalness: 0,
    alphaTest: 0.45, side: THREE.DoubleSide, envMapIntensity: 0.4 });
  keepNormals(m);
  m.userData.keepOwn = true;     // merged scenery keeps this material (and its UVs) as its own bucket
  return m;
}

function surface(m0, t, extra = {}) {
  m0.map = t.map; m0.bumpMap = t.bump; m0.bumpScale = t.bumpScale;
  Object.assign(m0, extra);
  m0.needsUpdate = true;
  return m0;
}

const fixed = new Map();
function fixMaterial(m0) {
  if (fixed.has(m0.uuid)) return fixed.get(m0.uuid);
  const n = m0.name || '';
  let m = m0;
  // clear glass on a dark stage: almost no body colour, just crisp reflections and edges
  const glassClear = { transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.24, roughness: 0.03, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.6, specularIntensity: 1, ior: 1.5 };
  switch (n) {
    case 'Paint': case 'PaintWhite': m = physical(m0, { metalness: 0.15, roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.06, envMapIntensity: 0.95 }); break;
    case 'Alloy': m = physical(m0, { envMapIntensity: 1.4, roughness: 0.28, clearcoat: 0.4 }); break;
    case 'LampChrome': m = physical(m0, { envMapIntensity: 1.8, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03 }); break;
    case 'TailLens': case 'FogLens': m = physical(m0, { clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.4 }); break;
    case 'PlateYellow': m = physical(m0, { map: TX.plate(), color: new THREE.Color('#ffffff'), roughness: 0.45, clearcoat: 0.3 }); break;
    case 'PoliceText': m = new THREE.MeshStandardMaterial({ name: n, map: TX.policeText(), transparent: true, depthWrite: false,
      roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 }); break;
    case 'LeafCard': m = foliage(m0, TX.leaves()); break;
    case 'PalmFrond': m = foliage(m0, TX.frond(false)); m.color.set('#ffffff'); break;
    case 'PalmFrondDry': m = foliage(m0, TX.frond(true)); m.color.set('#ffffff'); break;
    case 'Bark': surface(m0, TX.bark()); break;
    case 'WallStone': case 'StoneDark': surface(m0, TX.stone()); break;
    case 'WallCream': case 'WallWhite': surface(m0, TX.plaster()); break;
    case 'RoofTile': case 'RoofTileDark': surface(m0, TX.roof()); break;
    case 'Skin': m = physical(m0, { roughness: 0.55, sheen: 0.15, sheenRoughness: 0.6, sheenColor: new THREE.Color('#ffb59a'), envMapIntensity: 0.45 }); break;
    case 'Iris': case 'EyeWhite': case 'Nail': m = physical(m0, { clearcoat: 1, clearcoatRoughness: 0.05 }); break;
    case 'GlassTint': m = physical(m0, { color: new THREE.Color('#070a10'), metalness: 0.2, roughness: 0.03, clearcoat: 1, envMapIntensity: 2.2, transparent: false }); break;
    case 'GlassClear': m = physical(m0, { ...glassClear, color: new THREE.Color('#1c2026') }); break;
    case 'GlassBrown': m = physical(m0, { color: new THREE.Color('#4a1a04'), roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.4, transparent: true, opacity: 0.9 }); break;
    case 'Beer': m = physical(m0, { color: new THREE.Color('#b8650a'), emissive: new THREE.Color('#5a2600'), emissiveIntensity: 0.35,
      transparent: true, opacity: 0.93, roughness: 0.08, clearcoat: 0.8 }); break;
    case 'Wine': m = physical(m0, { color: new THREE.Color('#5a0014'), transparent: true, opacity: 0.93, roughness: 0.06, clearcoat: 1, envMapIntensity: 1.6 }); break;
    case 'Spirit': m = physical(m0, { color: new THREE.Color('#a4560c'), emissive: new THREE.Color('#4a2200'), emissiveIntensity: 0.3,
      transparent: true, opacity: 0.9, roughness: 0.05, clearcoat: 1 }); break;
    case 'Chrome': case 'Alu': case 'MirrorFace': m = physical(m0, { envMapIntensity: 1.5, roughness: n === 'Alu' ? 0.26 : 0.08 }); break;
    case 'Gold': case 'Brass': case 'CanTop': m = physical(m0, { envMapIntensity: 1.5, roughness: 0.22, side: THREE.DoubleSide }); break;
    case 'MugGlaze': {
      const sp = speckle();
      sp.wrapT = THREE.RepeatWrapping; sp.repeat.set(2.7, 1);     // wrap-around UVs: 27 cm round, 10 cm tall
      m = physical(m0, { map: sp, color: new THREE.Color('#ffffff'), clearcoat: 1, clearcoatRoughness: 0.06, roughness: 0.35, side: THREE.DoubleSide });
      break;
    }
    case 'Cream': m = physical(m0, { clearcoat: 0.7, clearcoatRoughness: 0.1, side: THREE.DoubleSide }); break;
    case 'PianoBlack': m = physical(m0, { clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.3 }); break;
    case 'CanLabel': m = physical(m0, { map: canLabel(), color: new THREE.Color('#ffffff'), metalness: 0.6, roughness: 0.3, clearcoat: 0.6, side: THREE.DoubleSide, envMapIntensity: 1.3 }); break;
    case 'BottleLabel': m = physical(m0, { map: bottleLabel(), color: new THREE.Color('#ffffff'), metalness: 0, roughness: 0.55, side: THREE.DoubleSide }); break;
    case 'Tire': m0.roughness = 0.88; break;
    case 'SoftTouch': case 'Leather': case 'TanLeather':
      Object.assign(m0, { envMapIntensity: 0.35, bumpMap: TX.grain(), bumpScale: n === 'SoftTouch' ? 0.15 : 0.3 }); break;
    case 'Fabric': Object.assign(m0, { envMapIntensity: 0.3, bumpMap: TX.weave(), bumpScale: 0.2 }); break;
    default: break;
  }
  if (n.includes('Leaf') && !m.map) m.side = THREE.DoubleSide;
  if (m.emissive && m.emissiveIntensity > 0 && (m.emissive.r + m.emissive.g + m.emissive.b) > 0) {
    m.userData.baseEmissive = m.emissiveIntensity;
  }
  fixed.set(m0.uuid, m);
  return m;
}

export async function loadModels(names, onProgress) {
  let done = 0;
  await Promise.all(names.map(async (n) => {
    const g = await loader.loadAsync(`/assets/models/${n}.glb?v=${MODEL_VERSION}`);
    g.scene.traverse((o) => {
      if (o.isMesh) {
        o.material = fixMaterial(o.material);
        o.matrixAutoUpdate = true;
      }
    });
    models[n] = g.scene;
    done++;
    onProgress && onProgress(done / names.length);
  }));
}

/** clone shares geometry and materials, so it is cheap */
export function inst(name) {
  const o = models[name].clone(true);
  return o;
}

export function find(root, name) {
  let hit = null;
  root.traverse((o) => { if (!hit && o.name === name) hit = o; });
  return hit;
}

/** every mesh under root whose material is named `matName` gets one shared recoloured copy */
const paintCache = new Map();
export function recolor(root, matName, hex) {
  root.traverse((o) => {
    if (!o.isMesh || o.material.name !== matName) return;
    const key = matName + hex;
    if (!paintCache.has(key)) {
      const m = o.material.clone();
      m.color.set(hex);
      paintCache.set(key, m);
    }
    o.material = paintCache.get(key);
  });
}

/** gives root its own copies of the named materials (for blinking lights on one car) */
export function ownMaterials(root, names) {
  const map = {};
  root.traverse((o) => {
    if (!o.isMesh || !names.includes(o.material.name)) return;
    const n = o.material.name;
    if (!map[n]) map[n] = o.material.clone();
    o.material = map[n];
  });
  return map;
}

// shared materials for vertex-coloured scenery: opaque materials collapse into a few draw calls by
// surface kind (plain, stone, plaster, roof tiles, bark, glass, car paint), glowing ones into one more
// (weak GPUs care far more about draw calls than triangles). Textured kinds keep their metre UVs.
const SOLID = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.05, name: 'MergedSolid' });
const GLOW = new THREE.MeshBasicMaterial({ vertexColors: true, name: 'MergedGlow' });
let KINDS = null;
function kinds() {
  if (KINDS) return KINDS;
  const tx = (t, rough) => new THREE.MeshStandardMaterial({ vertexColors: true, map: t.map, bumpMap: t.bump,
    bumpScale: t.bumpScale, roughness: rough, metalness: 0 });
  KINDS = {
    stone: tx(TX.stone(), 0.9), plaster: tx(TX.plaster(), 0.92), roof: tx(TX.roof(), 0.75), bark: tx(TX.bark(), 0.95),
    glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.06, metalness: 0.7, envMapIntensity: 1.3, name: 'MergedGlass' }),
    paint: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.15, clearcoat: 0.8,
      clearcoatRoughness: 0.06, envMapIntensity: 0.95, name: 'MergedPaint' }),
  };
  return KINDS;
}
function kindOf(n) {
  if (n === 'WallStone' || n === 'StoneDark') return 'stone';
  if (n === 'WallCream' || n === 'WallWhite') return 'plaster';
  if (n.startsWith('RoofTile')) return 'roof';
  if (n === 'Bark') return 'bark';
  if (n === 'WinDark' || n === 'GlassTint' || n === 'MirrorFace') return 'glass';
  if (n === 'Paint' || n === 'PaintWhite') return 'paint';
  return null;
}
const _c = new THREE.Color();

function paint(g, color) {
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

/** collapse every mesh under root into as few meshes as possible (static scenery only) */
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  const m4 = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(m4.multiplyMatrices(inv, o.matrixWorld));
    const m = o.material;
    let target = m;
    let keepUV = !!m.userData.keepOwn;
    if (!m.transparent && m.isMeshStandardMaterial && !m.userData.keepOwn) {
      const glows = m.emissive && m.emissiveIntensity > 0 && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.05;
      const kind = kindOf(m.name);
      if (glows) { _c.copy(m.emissive).multiplyScalar(Math.min(m.emissiveIntensity, 3)); target = GLOW; }
      else {
        _c.copy(m.color);
        if (m.name === 'PlateYellow') _c.set('#e0b000');      // its printed texture does not survive merging
        target = kind ? kinds()[kind] : SOLID;
        keepUV = !!(kind && target.map);
      }
      paint(g, _c);
    }
    for (const k of Object.keys(g.attributes)) {
      if (k !== 'position' && k !== 'normal' && k !== 'color' && !(keepUV && k === 'uv')) g.deleteAttribute(k);
    }
    if (keepUV && !g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    const key = target.uuid;
    if (!buckets.has(key)) buckets.set(key, { m: target, gs: [] });
    buckets.get(key).gs.push(g);
  });
  const out = new THREE.Group();
  for (const { m, gs } of buckets.values()) {
    const indexed = gs.every((g) => g.index);
    const list = indexed ? gs : gs.map((g) => (g.index ? g.toNonIndexed() : g));
    const merged = mergeGeometries(list, false);
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, m);
    mesh.matrixAutoUpdate = false;
    out.add(mesh);
  }
  return out;
}
