// "נוהגים בראש צלול": first-person driving. An obstacle appears, time slows down, a random question
// 1-19 is drawn and the player answers it. Right answer: the car swerves around it. Wrong answer: crash, the driver
// is thrown out of the car, and the run starts over.
import * as THREE from 'three';
import { makeRenderer, runLoop, clock, after, CAPTURE, Q, lerp, clamp, damp } from '/shared/engine.js';
import { loadModels, inst, find, ownMaterials, recolor } from '/shared/assets.js';
import { World, glowSprite, glowTexture, makeBeam, LANE_R, LANE_L, PARK_X } from '/shared/world.js';
import { Sfx } from '/shared/audio.js';
import { QUESTIONS, LETTERS } from './questions.js';
import { armRig } from '/shared/arms.js';
import { dressCockpit } from '/shared/cockpit.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const MODELS = ['car', 'car_lo', 'cockpit', 'driver', 'kid', 'pedestrian', 'dog', 'ball', 'scooter', 'cone', 'barrier', 'fallentree',
  'house_flat', 'house_roof', 'block', 'lamp', 'tree', 'bush', 'palm'];
const SOUNDS = ['engine', 'ambience', 'enginestart', 'skid', 'warning', 'heartbeat', 'slow', 'correct', 'wrong', 'whoosh',
  'boom', 'metal', 'glass', 'win', 'click'];
const TOTAL = QUESTIONS.length;
const KMH = 3.6;
const BASE_SPEED = 50 / KMH;
const TRIGGER_DIST = 13;
const CAR_COLORS = ['#1d3f8f', '#d8d8d8', '#2b2b2e', '#3d6b58', '#b8b2a2', '#6b2a8f'];

const canvas = $('#gl');
const renderer = makeRenderer(canvas, { exposure: 1.0 });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.03, 1200);
const sfx = new Sfx();
let world;

// ---------------------------------------------------------------- post: bloom + grade
// bloom makes lamps, headlights and the sunset glow; the grade pass drains colour, darkens the
// edges and splits RGB in slow motion and on impact
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.42, 0.5, 0.92);
composer.addPass(bloom);
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, sat: { value: 1 }, vig: { value: 0.35 }, ab: { value: 0 }, tint: { value: new THREE.Color(1, 1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float sat, vig, ab; uniform vec3 tint; varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5;
      vec2 o = c * ab * 0.03;
      vec3 col = vec3(texture2D(tDiffuse, vUv + o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - o).b);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, sat) * tint;
      col *= mix(1.0, smoothstep(0.85, 0.25, length(c * vec2(1.25, 1.0))), vig);
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(grade);
composer.addPass(new OutputPass());
const FX = { ab: 0 };

// ---------------------------------------------------------------- state
const G = {
  mode: 'loading',     // menu | drive | alert | pick | question | dodge | crashing | crash | over | win
  ts: 1,               // world time scale (slow motion)
  z: 0, x: LANE_R, xTarget: LANE_R, speed: BASE_SPEED,
  used: new Set(), score: 0,
  ob: null, nextSpawnZ: -9999, lock: false,
  shake: 0, camMode: 'cockpit', t: 0,
  steerIn: 0, typed: '', typedTimer: null, current: -1,
};
const keys = new Set();
let player, cockpit, wheel, wheelBase, arms = () => {}, screen, dash, cabinLight, carExt, headSpot, driver, shards, smoke = [];
let engine = null, ambience = null, heartTimer = null;
let typeBag = [];

// ---------------------------------------------------------------- helpers
function screenTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const g = c.getContext('2d');
  return { tex, redraw: (...a) => { draw(g, w, h, ...a); tex.needsUpdate = true; } };
}

function limbs(root) {
  const L = {};
  root.traverse((o) => { if (/^(arm|leg)_/.test(o.name)) L[o.name] = o; });
  return L;
}

function runPose(L, t, amt = 1, speed = 11) {
  const s = Math.sin(t * speed) * amt;
  if (L.leg_l) L.leg_l.rotation.x = s * 0.9;
  if (L.leg_r) L.leg_r.rotation.x = -s * 0.9;
  if (L.arm_l) L.arm_l.rotation.x = -s * 0.8;
  if (L.arm_r) L.arm_r.rotation.x = s * 0.8;
  if (L.leg_fl) { L.leg_fl.rotation.x = s * 0.7; L.leg_rr.rotation.x = s * 0.7; L.leg_fr.rotation.x = -s * 0.7; L.leg_rl.rotation.x = -s * 0.7; }
}

function freezePose(L) {
  if (L.leg_l) { L.leg_l.rotation.x = 0.1; L.leg_r.rotation.x = -0.1; }
  if (L.arm_l) { L.arm_l.rotation.set(2.5, 0, 0.35); L.arm_r.rotation.set(2.5, 0, -0.35); }
  if (L.leg_fl) { L.leg_fl.rotation.x = 0; L.leg_fr.rotation.x = 0; L.leg_rl.rotation.x = 0; L.leg_rr.rotation.x = 0; }
}

function parkedCar(x, z, color) {
  const c = inst('car_lo');
  recolor(c, 'Paint', color || CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)]);
  c.position.set(x, 0, z);
  scene.add(c);
  return c;
}

function crosswalk(z) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: '#e8e6de', roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
  for (let k = -5; k <= 4; k++) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 3.2), m);
    s.rotation.x = -Math.PI / 2;
    s.position.set(k * 1.1 + 0.55, 0.025, z);
    g.add(s);
  }
  scene.add(g);
  return g;
}

function warningTriangle(x, z) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: '#ff2a1a', emissive: '#ff2a1a', emissiveIntensity: 0.8 });
  for (let k = 0; k < 3; k++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.03), m);
    const a = (k * 2 * Math.PI) / 3;
    b.position.set(Math.sin(a) * 0.12, 0.3 + Math.cos(a) * 0.12, 0);
    b.rotation.z = -a + Math.PI / 2;
    g.add(b);
  }
  g.position.set(x, 0, z);
  scene.add(g);
  return g;
}

// ---------------------------------------------------------------- obstacles
// every obstacle ends up in the player's lane; `living` ones are never hit (the car swerves into a
// parked car instead), objects are hit head on.
const TYPES = {
  kid: {
    name: 'ילד רץ אחרי כדור לכביש!', dist: 50, living: true,
    setup(ob) {
      const s = ob.side;
      ob.extra.push(parkedCar(s * PARK_X, ob.z + 4.2), parkedCar(s * PARK_X, ob.z - 2.8));
      ob.crashTarget = ob.extra[0];
      ob.kid = inst('kid'); ob.kid.position.set(s * 5.4, 0.15, ob.z); ob.kid.rotation.y = s * Math.PI / 2;
      ob.L = limbs(ob.kid);
      ob.ball = inst('ball'); ob.ball.position.set(s * 4.7, 0, ob.z - 0.9);
      ob.root.add(ob.kid, ob.ball);
      ob.ballV = 0;
    },
    update(ob, dt) {
      const s = ob.side;
      if (ob.go) {
        ob.ballV = 4.2;
        ob.ball.position.x -= s * ob.ballV * dt;
        ob.ball.rotation.z += s * ob.ballV * dt / 0.12;
        if (ob.state === 'approach' || ob.state === 'leave') {
          // after a right answer the kid runs back to the pavement it came from (the car swerves the other way)
          const target = ob.state === 'leave' ? (ob.wrong ? -s * 7 : s * 7) : ob.lane;
          const dx = target - ob.kid.position.x;
          if (Math.abs(dx) > 0.05) {
            ob.kid.rotation.y = dx < 0 ? Math.PI / 2 : -Math.PI / 2;
            ob.kid.position.x += Math.sign(dx) * Math.min(Math.abs(dx), 3.4 * dt);
            ob.kid.position.y = Math.abs(ob.kid.position.x) > 5.5 ? 0.15 : 0;
            runPose(ob.L, ob.t, 1, 12);
          } else if (ob.state === 'approach') { ob.kid.rotation.y = Math.PI; freezePose(ob.L); }
        }
      }
    },
  },
  dog: {
    name: 'כלב חוצה את הכביש!', dist: 50, living: true,
    setup(ob) {
      const s = ob.side;
      ob.extra.push(parkedCar(s * PARK_X, ob.z + 4.0));
      ob.crashTarget = ob.extra[0];
      ob.dog = inst('dog'); ob.dog.position.set(-s * 6.6, 0.15, ob.z); ob.dog.rotation.y = -s * Math.PI / 2;
      ob.L = limbs(ob.dog);
      ob.root.add(ob.dog);
    },
    update(ob, dt) {
      const s = ob.side;
      if (!ob.go) return;
      if (ob.state === 'approach' || ob.state === 'leave') {
        const target = ob.state === 'leave' ? (ob.wrong ? -s * 7.5 : s * 7.5) : ob.lane;
        const dx = target - ob.dog.position.x;
        ob.dog.rotation.y = dx > 0 ? -Math.PI / 2 : Math.PI / 2;
        if (Math.abs(dx) > 0.05) {
          ob.dog.position.x += Math.sign(dx) * Math.min(Math.abs(dx), 6.5 * dt);
          ob.dog.position.y = Math.abs(ob.dog.position.x) > 5.5 ? 0.15 : Math.abs(Math.sin(ob.t * 14)) * 0.05;
          runPose(ob.L, ob.t, 1, 16);
        } else if (ob.state === 'approach') { ob.dog.rotation.y = Math.PI; freezePose(ob.L); }
      }
    },
  },
  pedestrian: {
    name: 'הולך רגל חוצה במעבר חצייה!', dist: 72, living: true,
    setup(ob) {
      const s = ob.side;
      ob.extra.push(crosswalk(ob.z), parkedCar(s * PARK_X, ob.z + 6));
      ob.crashTarget = ob.extra[1];
      ob.p = inst('pedestrian'); ob.p.position.set(s * 6.8, 0.15, ob.z); ob.p.rotation.y = s * Math.PI / 2;
      ob.L = limbs(ob.p);
      ob.root.add(ob.p);
      ob.go = true;
    },
    update(ob, dt) {
      const s = ob.side;
      if (ob.state === 'approach' || ob.state === 'leave') {
        const target = ob.state === 'leave' ? (ob.wrong ? -s * 7.5 : s * 7.5) : ob.lane;
        const dx = target - ob.p.position.x;
        const v = ob.state === 'leave' && ob.wrong ? 4 : 1.7;
        ob.p.rotation.y = dx < 0 ? Math.PI / 2 : -Math.PI / 2;
        if (Math.abs(dx) > 0.05) {
          ob.p.position.x += Math.sign(dx) * Math.min(Math.abs(dx), v * dt);
          ob.p.position.y = Math.abs(ob.p.position.x) > 5.5 ? 0.15 : 0;
          runPose(ob.L, ob.t, v > 2 ? 1 : 0.45, v > 2 ? 12 : 6);
        } else if (ob.state === 'approach') { ob.p.rotation.y = Math.PI; freezePose(ob.L); }
      }
    },
  },
  stalled: {
    name: 'רכב תקוע באמצע הנתיב!', dist: 78, living: false, half: 2.3,
    setup(ob) {
      ob.car = inst('car');
      recolor(ob.car, 'Paint', '#d6d6d6');
      ob.lights = ownMaterials(ob.car, ['Taillight', 'Headlight']);
      ob.car.position.set(ob.lane, 0, ob.z);
      ob.root.add(ob.car);
      ob.extra.push(warningTriangle(ob.lane + 0.3, ob.z + 9));
      ob.crashTarget = ob.car;
      ob.blink = [glowSprite('#ffab2a', 1.2, 0), glowSprite('#ffab2a', 1.2, 0)];
      ob.blink[0].position.set(-0.6, 0.8, 2.35); ob.blink[1].position.set(0.6, 0.8, 2.35);
      ob.car.add(...ob.blink);
    },
    update(ob) {
      const on = Math.floor(clock.now * 2.4) % 2 === 0;
      ob.lights.Taillight.emissiveIntensity = on ? 5 : 0.4;
      ob.lights.Headlight.emissiveIntensity = on ? 5 : 1;
      ob.blink.forEach((b) => { b.material.opacity = on ? 0.9 : 0; });
    },
  },
  pullout: {
    name: 'רכב יוצא מחנייה בלי להסתכל!', dist: 56, living: false, half: 2.3,
    setup(ob) {
      ob.car = inst('car');
      recolor(ob.car, 'Paint', '#1d3f8f');
      ob.car.position.set(ob.side * PARK_X, 0, ob.z);
      ob.root.add(ob.car);
      ob.crashTarget = ob.car;
      ob.k = 0;
      ob.sig = glowSprite('#ffab2a', 0.8, 0);
      ob.sig.position.set(-ob.side * 0.75, 0.75, -2.2);
      ob.car.add(ob.sig);
    },
    update(ob, dt) {
      if (!ob.go || ob.state !== 'approach') return;
      ob.k = Math.min(1, ob.k + dt / 1.5);
      const e = ob.k * ob.k * (3 - 2 * ob.k);
      ob.car.position.x = lerp(ob.side * PARK_X, ob.lane, e);
      ob.car.rotation.y = ob.side * Math.sin(ob.k * Math.PI) * 0.38;
      ob.car.position.z -= 2.2 * dt * (1 - ob.k * 0.6);
      ob.car.traverse((o) => { if (o.name.startsWith('wheel')) o.rotation.x -= 6 * dt; });
      ob.sig.material.opacity = Math.floor(clock.now * 3) % 2 ? 0.9 : 0;
      ob.z = ob.car.position.z;
    },
  },
  tree: {
    name: 'עץ נפל על הכביש!', dist: 78, living: false, half: 1.2, dodge: 1.5,
    setup(ob) {
      ob.tree = inst('fallentree');
      ob.tree.rotation.y = ob.side > 0 ? Math.PI : 0;
      ob.tree.position.set(ob.side * 2.95, 0, ob.z);
      ob.root.add(ob.tree);
      ob.crashTarget = ob.tree;
    },
    update() {},
  },
  barrier: {
    name: 'עבודות בכביש: מחסום!', dist: 78, living: false, half: 0.6,
    setup(ob) {
      ob.b = inst('barrier');
      ob.b.position.set(ob.lane, 0, ob.z);
      ob.b.rotation.y = Math.PI;              // stripes toward the driver
      ob.root.add(ob.b);
      ob.crashTarget = ob.b;
      ob.fl = ownMaterials(ob.b, ['Flash']).Flash;
      ob.glow = glowSprite('#ffa020', 1.6, 0);
      ob.glow.position.set(0.75, 1.15, 0);
      ob.b.add(ob.glow);
    },
    update(ob) {
      const on = Math.floor(clock.now * 3) % 2 === 0;
      if (ob.fl) ob.fl.emissiveIntensity = on ? 8 : 0.3;
      ob.glow.material.opacity = on ? 0.9 : 0;
    },
  },
  scooter: {
    name: 'קורקינט חשמלי נכנס לנתיב!', dist: 50, living: true,
    setup(ob) {
      const s = ob.side;
      ob.extra.push(parkedCar(s * PARK_X, ob.z - 5));
      ob.crashTarget = ob.extra[0];
      ob.sc = inst('scooter'); ob.sc.position.set(s * 3.5, 0, ob.z + 10);
      ob.root.add(ob.sc);
      ob.k = 0;
    },
    update(ob, dt) {
      const s = ob.side;
      const v = ob.state === 'approach' ? 5 : 6.5;
      ob.sc.position.z -= v * dt;
      if (ob.go && ob.state === 'approach') {
        ob.k = Math.min(1, ob.k + dt / 1.2);
        ob.sc.position.x = lerp(s * 3.5, ob.lane, ob.k * ob.k * (3 - 2 * ob.k));
        ob.sc.rotation.y = s * Math.sin(ob.k * Math.PI) * 0.4;
      }
      if (ob.state === 'leave') {
        const tx = ob.wrong ? -s * 0.3 : s * 3.5;
        ob.sc.position.x += (tx - ob.sc.position.x) * Math.min(1, dt * 1.5);
      }
      ob.z = ob.sc.position.z;
    },
  },
};

function nextType() {
  if (!typeBag.length) {
    typeBag = Object.keys(TYPES);
    for (let i = typeBag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [typeBag[i], typeBag[j]] = [typeBag[j], typeBag[i]]; }
  }
  return typeBag.pop();
}

function spawnObstacle(forceType) {
  const type = forceType || nextType();
  const T = TYPES[type];
  const lane = G.x < 0 ? LANE_L : LANE_R;
  const ob = {
    type, T, name: T.name, lane, side: Math.sign(lane), root: new THREE.Group(), extra: [],
    t: 0, state: 'approach', living: T.living, half: T.half || 0.4, go: false, wrong: false,
  };
  ob.z = G.z - 2.3 - Math.min(T.dist, 37);   // short approach: ~3 s from one obstacle to the next
  ob.dodgeX = -lane * (T.dodge || 1);
  T.setup(ob);
  scene.add(ob.root);
  G.ob = ob;
  G.lock = true;
  G.xTarget = lane;
  return ob;
}

function removeObstacle() {
  const ob = G.ob;
  if (!ob) return;
  scene.remove(ob.root);
  ob.extra.forEach((e) => scene.remove(e));
  G.ob = null;
}

function obDistance(ob) {
  return (G.z - 2.3) - (ob.z + ob.half);
}

// ---------------------------------------------------------------- HUD
function buildPips() {
  const p = $('#pips');
  p.innerHTML = '';
  for (let i = 0; i < TOTAL; i++) p.appendChild(document.createElement('i'));
}
function updateHud() {
  $('#score').textContent = G.score;
  $$('#pips i').forEach((el, i) => el.classList.toggle('ok', i < G.score));
  dash && dash.drawCluster({ kmh: Math.round(G.speed * KMH), bac: 0, score: G.score, total: TOTAL });
}
function toast(text, color = '#2fd47c') {
  const t = $('#toast');
  t.textContent = text;
  t.style.textShadow = `0 0 30px ${color}, 0 4px 20px rgba(0,0,0,.8)`;
  gsap.fromTo(t, { opacity: 0, y: 20, scale: 0.8 }, { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: 'back.out(2)' });
  gsap.to(t, { opacity: 0, y: -20, duration: 0.5, delay: 1.3 });
}
function flash(color, peak = 0.7, dur = 0.5) {
  const f = $('#flash');
  f.style.background = color;
  gsap.fromTo(f, { opacity: peak }, { opacity: 0, duration: dur, ease: 'power2.out' });
}

// ---------------------------------------------------------------- the obstacle moment
function trigger() {
  const ob = G.ob;
  G.mode = 'alert';
  ob.state = 'frozen';
  $('#hint').classList.add('gone');
  // make sure a crossing obstacle has reached the lane
  for (const k of ['kid', 'dog', 'p']) if (ob[k]) { gsap.to(ob[k].position, { x: ob.lane, y: 0, duration: 0.35 }); ob[k].rotation.y = Math.PI; freezePose(ob.L); }
  if (ob.car && ob.type === 'pullout') { gsap.to(ob.car.position, { x: ob.lane, duration: 0.35 }); gsap.to(ob.car.rotation, { y: 0, duration: 0.35 }); }
  if (ob.sc) gsap.to(ob.sc.position, { x: ob.lane, duration: 0.35 });
  sfx.play('skid', { vol: 0.75 });
  sfx.play('warning', { vol: 0.45 });
  sfx.play('slow', { vol: 0.55 });
  gsap.to(G, { ts: 0, duration: 0.8, ease: 'power2.out' });
  gsap.to('#vignette', { opacity: 1, duration: 0.5 });
  flash('#ff2a2a', 0.35, 0.6);
  gsap.fromTo(FX, { ab: 0.9 }, { ab: 0.25, duration: 0.9, ease: 'power2.out' });
  $('#alertText').textContent = ob.name;
  gsap.fromTo('#alert', { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(2.2)' });
  G.shake = 0.5;
  startHeart();
  after(1.0, openPicker);
}

function startHeart() {
  stopHeart();
  const beat = () => { sfx.play('heartbeat', { vol: 0.5 }); heartTimer = after(1.15, beat); };
  beat();
}
function stopHeart() { if (heartTimer) { heartTimer(); heartTimer = null; } }

// The player can't choose: the question is drawn at random. A highlight hops across the questions
// nobody has answered yet, slowing down like a lottery, and stops on the drawn one.
function openPicker() {
  G.mode = 'pick';
  const grid = $('#grid');
  grid.innerHTML = '';
  for (let n = 1; n <= TOTAL; n++) {
    const b = document.createElement('button');
    b.dataset.n = n;
    b.className = 'lg';
    b.tabIndex = -1;
    if (G.used.has(n)) { b.className = 'lg used'; b.innerHTML = `<svg class="i"><use href="#i-check"/></svg>`; }
    else b.textContent = n;
    grid.appendChild(b);
  }
  $('#picker').classList.add('on');
  gsap.fromTo('#picker .m-card', { opacity: 0, y: 40, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: 0.4, ease: 'power3.out' });
  gsap.fromTo('#grid button', { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.3, stagger: 0.015, ease: 'back.out(2)', delay: 0.1 });
  spinLottery();
}

function spinLottery() {
  const free = [];
  for (let n = 1; n <= TOTAL; n++) if (!G.used.has(n)) free.push(n);
  const target = free[Math.floor(Math.random() * free.length)];
  const token = (G.spin = (G.spin || 0) + 1);
  const hops = free.length > 1 ? 18 : 1;
  const seq = [];
  let last = -1;
  for (let i = 0; i < hops - 1; i++) {
    let n;
    do { n = free[Math.floor(Math.random() * free.length)]; } while (free.length > 1 && n === last);
    seq.push(n); last = n;
  }
  if (free.length > 1 && seq[seq.length - 1] === target) seq[seq.length - 1] = free.find((n) => n !== target);
  seq.push(target);
  const mark = (n) => $$('#grid button').forEach((b) => b.classList.toggle('hl', +b.dataset.n === n));
  let i = 0, t = 0.5;                       // first hop after the grid has popped in
  const hop = () => {
    if (G.spin !== token || G.mode !== 'pick') return;
    mark(seq[i]);
    sfx.play('click', { vol: 0.25 });
    if (i === seq.length - 1) {
      const b = $(`#grid button[data-n="${target}"]`);
      b.classList.add('drawn');
      gsap.fromTo(b, { scale: 1.1 }, { scale: 1.35, duration: 0.18, yoyo: true, repeat: 3, ease: 'power2.inOut' });
      after(1.0, () => { if (G.spin === token) choose(target); });
      return;
    }
    i++;
    after(0.05 + 0.22 * Math.pow(i / seq.length, 2.2), hop);   // fast at first, slowing to a stop
  };
  after(t, hop);
}

function choose(n) {
  if (G.mode !== 'pick' || G.used.has(n) || n < 1 || n > TOTAL) return;
  sfx.play('click', { vol: 0.4 });
  G.current = n;
  gsap.to('#picker .m-card', { opacity: 0, y: -30, duration: 0.25, onComplete: () => $('#picker').classList.remove('on') });
  after(0.22, () => openQuestion(n));
}

function openQuestion(n) {
  G.mode = 'question';
  const q = QUESTIONS[n - 1];
  $('#qNum').textContent = `שאלה ${n}`;
  $('#qObs').textContent = G.ob ? G.ob.name : '';
  $('#qText').textContent = q.q;
  const box = $('#answers');
  box.innerHTML = '';
  q.o.forEach((txt, i) => {
    const b = document.createElement('button');
    b.className = 'lg';
    b.innerHTML = `<span class="let">${LETTERS[i]}</span><span class="txt"></span>`;
    b.querySelector('.txt').textContent = txt;
    b.onclick = () => answer(i);
    box.appendChild(b);
  });
  $('#question').classList.add('on');
  gsap.fromTo('#question .m-card', { opacity: 0, y: 40, scale: 0.95 }, { opacity: 1, y: 0, scale: 1, duration: 0.4, ease: 'power3.out' });
  gsap.fromTo('#answers button', { opacity: 0, x: 30 }, { opacity: 1, x: 0, duration: 0.35, stagger: 0.07, delay: 0.15, ease: 'power2.out' });
}

function closeQuestion(delay) {
  gsap.to('#question .m-card', { opacity: 0, y: -30, duration: 0.3, delay, onComplete: () => $('#question').classList.remove('on') });
  gsap.to('#alert', { opacity: 0, scale: 0.8, duration: 0.3, delay });
  gsap.to('#vignette', { opacity: 0, duration: 0.6, delay });
}

function answer(i) {
  if (G.mode !== 'question') return;
  G.mode = 'resolve';
  const q = QUESTIONS[G.current - 1];
  const btns = $$('#answers button');
  btns.forEach((b) => { b.disabled = true; });
  stopHeart();
  const ok = i === q.a;
  G.used.add(G.current);
  if (ok) {
    btns[i].classList.add('right');
    btns.forEach((b, k) => { if (k !== i) b.classList.add('dim'); });
    sfx.play('correct', { vol: 0.8 });
    closeQuestion(0.9);
    after(1.05, resolveCorrect);
  } else {
    btns[i].classList.add('wrong');
    btns[q.a].classList.add('right');
    btns.forEach((b, k) => { if (k !== i && k !== q.a) b.classList.add('dim'); });
    sfx.play('wrong', { vol: 0.8 });
    closeQuestion(2.4);
    after(2.55, resolveWrong);
  }
}

function resolveCorrect() {
  const ob = G.ob;
  G.mode = 'dodge';
  G.score++;
  G.speed = Math.min(70 / KMH, G.speed + 2 / KMH);
  updateHud();
  toast('התחמקתם!');
  sfx.play('whoosh', { vol: 0.7 });
  sfx.play('skid', { vol: 0.35, rate: 1.2 });
  gsap.to(G, { ts: 1, duration: 0.5, ease: 'power2.in' });
  G.xTarget = ob.dodgeX;
  ob.state = 'leave';
  ob.passed = false;
}

function resolveWrong() {
  const ob = G.ob;
  G.mode = 'crashing';
  ob.wrong = true;
  ob.state = 'leave';
  sfx.play('skid', { vol: 0.9 });
  gsap.to(G, { ts: 1, duration: 0.35, ease: 'power2.in' });
  if (ob.living) G.xTarget = ob.side * 3.9;           // swerve toward the parked car, away from the person
  gsap.to(G, { speed: G.speed * 0.72, duration: 1.2 });
}

// ---------------------------------------------------------------- crash
function crash() {
  const ob = G.ob;
  G.mode = 'crash';
  if (engine) { engine.stop(0.1); engine = null; }
  sfx.play('boom', { vol: 1 });
  sfx.play('metal', { vol: 0.9 });
  sfx.play('glass', { vol: 0.9 });
  flash('#ffffff', 0.9, 0.7);
  gsap.fromTo(FX, { ab: 1.8 }, { ab: 0, duration: 1.6, ease: 'power2.out' });
  G.shake = 1.5;
  const side = ob.living ? ob.side : (Math.random() < 0.5 ? 1 : -1);
  // swap the cockpit for the full car
  cockpit.visible = false;
  carExt.visible = true;
  carExt.position.set(G.x, 0, G.z);
  carExt.rotation.set(0, (G.xTarget - G.x) * -0.25, 0);
  gsap.to(carExt.position, { z: G.z - 1.2, duration: 0.35, ease: 'power3.out' });
  gsap.to(carExt.rotation, { x: -0.14, duration: 0.12, yoyo: true, repeat: 1, ease: 'power2.out' });
  gsap.to(carExt.rotation, { y: carExt.rotation.y + side * 0.35, duration: 0.5, ease: 'power2.out' });
  const hit = ob.crashTarget;
  if (hit) {
    gsap.to(hit.position, { z: hit.position.z - 1.4, duration: 0.4, ease: 'power3.out' });
    gsap.to(hit.rotation, { y: hit.rotation.y + side * 0.3, duration: 0.5 });
    if (ob.type === 'barrier') {
      gsap.to(hit.position, { y: 1.2, z: hit.position.z - 5, duration: 0.6, ease: 'power2.out' });
      gsap.to(hit.rotation, { x: -2.5, duration: 0.6 });
      gsap.to(hit.position, { y: 0, duration: 0.4, delay: 0.6, ease: 'bounce.out' });
    }
  }
  // the driver flies out through the windshield
  driver.visible = true;
  driver.position.set(G.x - 0.37, 1.2, G.z - 0.9);
  driver.rotation.set(-0.3, 0, 0);
  driver.userData.v = new THREE.Vector3(side * -0.6 + (Math.random() - 0.5), 6.4, -G.speed * 0.9 - 2);
  driver.userData.w = new THREE.Vector3(-7.5, (Math.random() - 0.5) * 3, side * 2);
  driver.userData.bounces = 0;
  driver.userData.rest = false;
  driver.userData.t = 0;
  // glass shards
  const p = shards.geometry.attributes.position;
  shards.userData.v = [];
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, G.x - 0.3 + (Math.random() - 0.5) * 1.3, 1.15 + Math.random() * 0.35, G.z - 1.0);
    shards.userData.v.push(new THREE.Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 4, -G.speed * (0.4 + Math.random() * 0.6)));
  }
  p.needsUpdate = true;
  shards.visible = true;
  shards.material.opacity = 1;
  smoke.forEach((s, i) => {
    s.visible = true;
    s.position.set(G.x + (Math.random() - 0.5), 0.8 + Math.random() * 0.4, G.z - 2.4);
    s.scale.setScalar(0.5);
    s.material.opacity = 0.55;
    gsap.to(s.scale, { x: 4 + i, y: 4 + i, duration: 2.5, ease: 'power1.out' });
    gsap.to(s.material, { opacity: 0, duration: 2.5, ease: 'power1.in' });
    gsap.to(s.position, { y: s.position.y + 1.5, duration: 2.5 });
  });
  // cinematic camera from the front side, in slow motion
  G.camMode = 'crash';
  G.crashCam = new THREE.Vector3(G.x - side * 6.5, 2.6, G.z - 15);
  G.ts = 0.32;
  gsap.to(G, { ts: 1, duration: 0.8, delay: 1.5 });
  after(4.3, showOver);
}

function updateDriver(dt) {
  const d = driver;
  if (!d.visible) return;
  const u = d.userData;
  u.t += dt;
  if (u.rest) return;
  u.v.y -= 9.8 * dt;
  d.position.addScaledVector(u.v, dt);
  d.rotation.x += u.w.x * dt; d.rotation.y += u.w.y * dt; d.rotation.z += u.w.z * dt;
  const L = d.userData.L;
  const f = Math.min(1, u.v.length() / 4);
  if (L.arm_l) {
    L.arm_l.rotation.set(Math.sin(u.t * 13) * 1.4 * f + 1.2, 0, 0.9 + Math.sin(u.t * 9) * 0.5 * f);
    L.arm_r.rotation.set(-Math.sin(u.t * 13) * 1.4 * f + 1.2, 0, -0.9 - Math.sin(u.t * 9) * 0.5 * f);
    L.leg_l.rotation.set(Math.sin(u.t * 11) * 0.9 * f, 0, 0.25);
    L.leg_r.rotation.set(-Math.sin(u.t * 11) * 0.9 * f, 0, -0.25);
  }
  if (d.position.y < 0.22 && u.v.y < 0) {
    d.position.y = 0.22;
    u.bounces++;
    u.v.y *= -0.3;
    u.v.x *= 0.55; u.v.z *= 0.55;
    u.w.multiplyScalar(0.45);
    if (u.bounces >= 3 || Math.abs(u.v.y) < 0.7) {
      u.rest = true;
      gsap.to(d.rotation, { x: -Math.PI / 2, y: d.rotation.y, z: 0, duration: 0.4 });
      gsap.to(d.position, { y: 0.16, duration: 0.4 });
    }
  }
}

function updateShards(dt) {
  if (!shards.visible) return;
  const p = shards.geometry.attributes.position;
  const v = shards.userData.v;
  for (let i = 0; i < p.count; i++) {
    v[i].y -= 9.8 * dt;
    let x = p.getX(i) + v[i].x * dt, y = p.getY(i) + v[i].y * dt, z = p.getZ(i) + v[i].z * dt;
    if (y < 0.02) { y = 0.02; v[i].multiplyScalar(0.3); v[i].y = Math.abs(v[i].y) * 0.2; }
    p.setXYZ(i, x, y, z);
  }
  p.needsUpdate = true;
}

function showOver() {
  G.mode = 'over';
  $('#overScore').textContent = G.score;
  $('#over').classList.add('on');
  gsap.fromTo('#over .s-card > *', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: 'power2.out' });
}

function showWin() {
  G.mode = 'win';
  sfx.play('win', { vol: 0.9 });
  gsap.to(G, { speed: 0, duration: 2.5, ease: 'power2.out' });
  $('#win').classList.add('on');
  gsap.fromTo('#win .s-card > *', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: 'power2.out' });
}

// ---------------------------------------------------------------- run control
function resetRun() {
  removeObstacle();
  gsap.killTweensOf(G);
  G.used.clear();
  G.score = 0;
  G.speed = BASE_SPEED;
  G.ts = 1;
  G.x = G.xTarget = LANE_R;
  G.lock = false;
  G.camMode = 'cockpit';
  G.shake = 0;
  cockpit.visible = true;
  carExt.visible = false;
  driver.visible = false;
  shards.visible = false;
  smoke.forEach((s) => { s.visible = false; });
  ['#over', '#win', '#picker', '#question'].forEach((s) => $(s).classList.remove('on'));
  gsap.set(['#alert', '#vignette', '#toast'], { opacity: 0 });
  G.nextSpawnZ = G.z - BASE_SPEED * 1.5;
  updateHud();
}

function startGame() {
  if (G.mode !== 'menu' && G.mode !== 'over' && G.mode !== 'win') return;
  sfx.unlock();
  const first = G.mode === 'menu';
  resetRun();
  G.mode = 'drive';
  $('#menu').classList.remove('on');
  $('#hud').classList.add('on');
  sfx.play('enginestart', { vol: 0.75 });
  if (!engine) engine = sfx.play('engine', { vol: 0.42, loop: true, rate: 0.85 });
  if (!ambience) ambience = sfx.play('ambience', { vol: 0.22, loop: true });
  $('#hint').classList.remove('gone');
  after(first ? 7 : 4, () => $('#hint').classList.add('gone'));
}

// ---------------------------------------------------------------- input
function wireInput() {
  addEventListener('keydown', (e) => {
    sfx.unlock();
    const k = e.key;
    keys.add(k.toLowerCase());
    if (k === 'Escape' || k === 'p' || k === 'P' || k === 'ם') { setPaused(!clock.paused); return; }
    if (clock.paused) { if (k === 'Enter' || k === ' ') { e.preventDefault(); setPaused(false); } return; }
    if (k === 'f' || k === 'F' || k === 'כ') { toggleFull(); return; }
    if (k === 'm' || k === 'M' || k === 'צ') { toggleMute(); return; }
    if (G.mode === 'menu' || G.mode === 'over' || G.mode === 'win') {
      if (k === 'Enter' || k === ' ') { e.preventDefault(); startGame(); }
      return;
    }
    if (G.mode === 'pick') return;          // the question is drawn at random, nothing to press
    if (G.mode === 'question') {
      const map = { 1: 0, 2: 1, 3: 2, 4: 3, 'א': 0, 'ב': 1, 'ג': 2, 'ד': 3 };
      if (k in map) answer(map[k]);
    }
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());
  addEventListener('pointerdown', () => sfx.unlock());
  $('#gPause').onclick = () => setPaused(true);
  $('#resumeBtn').onclick = () => setPaused(false);
  addEventListener('blur', () => { if (G.mode !== 'menu' && G.mode !== 'over' && G.mode !== 'win' && !CAPTURE) setPaused(true); });
  $('#goBtn').onclick = startGame;
  $('#againBtn').onclick = startGame;
  $('#winBtn').onclick = startGame;
  $('#gFull').onclick = toggleFull;
  $('#gMute').onclick = toggleMute;
}
let mutedBeforePause = false;
function setPaused(on) {
  if (on === !!clock.paused) return;
  if (on && (G.mode === 'menu' || G.mode === 'over' || G.mode === 'win')) return;
  clock.paused = on;
  gsap.globalTimeline.paused(on);
  $('#pause').classList.toggle('on', on);
  if (on) { mutedBeforePause = sfx.muted; sfx.setMuted(true); }
  else sfx.setMuted(mutedBeforePause);
}
function toggleFull() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.();
}
function toggleMute() {
  sfx.setMuted(!sfx.muted);
  $('#gMute use').setAttribute('href', sfx.muted ? '#i-mute' : '#i-sound');
}

// ---------------------------------------------------------------- frame
function resize(w, h, pr) {
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  composer.setPixelRatio(pr);
  composer.setSize(w, h);
  bloom.resolution.set(w * pr * 0.5, h * pr * 0.5);
}

const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), lookTmp = new THREE.Vector3();
const DRIVING = new Set(['menu', 'drive', 'alert', 'pick', 'question', 'resolve', 'dodge', 'crashing', 'win']);

function update(dt) {
  G.t += dt;
  const gdt = dt * G.ts;

  // steering (locked while an obstacle is coming)
  if (G.mode === 'drive' && !G.lock) {
    // no manual steering: the car stays in its lane
    const lane = G.xTarget < 0 ? LANE_L : LANE_R;
    G.xTarget = damp(G.xTarget, lane, 0.6, gdt);
  }
  if (G.mode === 'menu') G.xTarget = LANE_R;

  if (DRIVING.has(G.mode)) {
    G.z -= G.speed * gdt;
    const k = G.mode === 'dodge' || G.mode === 'crashing' ? 3.4 : 4.5;
    G.x = damp(G.x, G.xTarget, k, gdt);
  }

  // obstacles
  if (G.mode === 'drive' && !G.ob && !G.noAuto && G.z <= G.nextSpawnZ && G.score < TOTAL) spawnObstacle();
  const ob = G.ob;
  if (ob) {
    ob.t += gdt;
    const d = obDistance(ob);
    if (!ob.go && d < (ob.type === 'pedestrian' ? 999 : 44)) ob.go = true;
    ob.T.update(ob, gdt);
    if (G.mode === 'drive' && ob.state === 'approach' && d <= TRIGGER_DIST) trigger();
    if (G.mode === 'dodge') {
      if (!ob.passed && G.z + 2.4 < ob.z - ob.half - 1) { ob.passed = true; G.xTarget = ob.lane; }
      if (ob.passed && Math.abs(G.x - ob.lane) < 0.15) {
        if (G.score >= TOTAL) { showWin(); }
        else { G.mode = 'drive'; G.lock = false; G.nextSpawnZ = G.z; }
      }
    }
    if (G.mode === 'crashing') {
      const tgt = ob.crashTarget;
      const tz = tgt.position.z + (ob.living ? 2.3 : ob.half);
      const lateral = Math.abs(G.x - tgt.position.x);
      if (G.z - 2.3 <= tz && lateral < 2.2) crash();
      else if (G.z - 2.3 < tz - 3) crash();
    }
    if ((G.mode === 'drive' || G.mode === 'win') && ob.passed && G.z < ob.z - 40) removeObstacle();
  }
  updateDriver(gdt);
  updateShards(gdt);

  // player car, wheel, headlight
  player.position.set(G.x, 0, G.z);
  const yaw = clamp((G.xTarget - G.x) * -0.07, -0.12, 0.12);
  cockpit.rotation.y = yaw;
  // body roll: the car leans out of the turn, the camera a little less
  const roll = clamp((G.xTarget - G.x) * 0.022, -0.045, 0.045);
  G.roll = damp(G.roll || 0, roll, 5, dt);
  cockpit.rotation.z = G.roll * 0.6;
  // capped so both hands stay on screen (they turn with the wheel)
  const steer = clamp((G.xTarget - G.x) * -0.8, -0.6, 0.6) + Math.sin(G.t * 1.7) * 0.02;
  wheel.quaternion.copy(wheelBase).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), steer));
  if (cockpit.visible) arms();
  headSpot.position.set(G.x, 0.8, G.z - 2.2);
  headSpot.target.position.set(G.x - yaw * 30, 0, G.z - 28);
  cabinLight.position.set(G.x - 0.25, 1.08, G.z - 0.05);
  if (engine) engine.setRate((0.75 + 0.35 * G.speed / (70 / KMH)) * (0.45 + 0.55 * G.ts));
  if (Math.floor(G.t * 4) !== Math.floor((G.t - dt) * 4)) dash.drawCluster({ kmh: Math.round(G.speed * KMH * G.ts), bac: 0, score: G.score, total: TOTAL });
  if ((G.frame = (G.frame || 0) + 1) % 3 === 0) dash.drawNav(G.speed * gdt * 3);

  // camera: speed vibration, a slight zoom-in while time is frozen, lean with the turn
  G.shake = Math.max(0, G.shake - dt * 1.4);
  const sh = G.shake * G.shake * 0.12;
  const kmh = G.speed * KMH;
  camera.fov = damp(camera.fov, 55 + (kmh - 50) * 0.12 - (1 - G.ts) * 7, 4, dt);
  camera.updateProjectionMatrix();
  if (G.camMode === 'cockpit') {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const ex = -0.37, ez = 0.42;
    const buzz = (Math.sin(G.t * 9) * 0.004 + Math.sin(G.t * 23.7) * 0.0015 * kmh / 50) * G.ts;
    camPos.set(G.x + ex * cy + ez * sy, 1.25 + buzz, G.z - ex * sy + ez * cy);
    camLook.set(G.x - 0.3 - yaw * 12, 1.06, G.z - 12);
    camera.position.copy(camPos);
    camera.position.x += (Math.random() - 0.5) * sh;
    camera.position.y += (Math.random() - 0.5) * sh;
    camera.lookAt(camLook);
    camera.rotateZ(G.roll);
    if (dash.mirrorPass) dash.mirrorPass(renderer, scene, camPos, [cockpit]);
  } else {
    camera.position.lerp(G.crashCam, 1 - Math.exp(-3 * dt));
    camera.position.x += (Math.random() - 0.5) * sh;
    camera.position.y += (Math.random() - 0.5) * sh;
    lookTmp.copy(driver.visible ? driver.position : carExt.position);
    lookTmp.y = Math.max(0.6, lookTmp.y);
    camLook.lerp(lookTmp, 1 - Math.exp(-5 * dt));
    camera.lookAt(camLook);
  }
  world.update(camera);
  // slow motion drains the colour and closes the edges; impacts split the RGB channels
  const slow = 1 - G.ts;
  grade.uniforms.sat.value = 1.08 - slow * 0.7;
  grade.uniforms.vig.value = 0.35 + slow * 0.45;
  grade.uniforms.ab.value = FX.ab + slow * 0.15;
  composer.render(dt);
}

// ---------------------------------------------------------------- boot
async function boot() {
  const fill = $('#loader .fill');
  await Promise.all(['700 64px Karantina', '800 64px Assistant', '600 30px Assistant'].map((f) => document.fonts.load(f).catch(() => {})));
  let mp = 0, sp = 0, sn = 0;
  const prog = () => { fill.style.width = `${Math.round((mp * 0.8 + sp * 0.2) * 100)}%`; };
  await Promise.all([
    loadModels(MODELS, (p) => { mp = p; prog(); }),
    sfx.load(SOUNDS, () => { sn++; sp = sn / SOUNDS.length; prog(); }),
  ]);
  world = new World(scene, renderer, { mode: 'evening', parked: true, seed: 11 });

  player = new THREE.Group();
  scene.add(player);
  cockpit = inst('cockpit');
  player.add(cockpit);
  wheel = find(cockpit, 'steering');
  wheelBase = wheel.quaternion.clone();
  arms = armRig(cockpit);
  dash = dressCockpit(cockpit);
  // a dim warm fill inside the cabin so the dashboard reads at dusk
  cabinLight = new THREE.PointLight('#ffd9b0', 0.55, 1.6, 1.5);
  scene.add(cabinLight);

  carExt = inst('car');
  carExt.visible = false;
  scene.add(carExt);
  headSpot = new THREE.SpotLight('#fff0d6', 110, 75, 0.45, 0.5, 1.1);
  scene.add(headSpot, headSpot.target);

  driver = new THREE.Group();
  const dm = inst('driver');
  dm.position.y = -0.95;
  driver.add(dm);
  driver.userData.L = limbs(dm);
  driver.visible = false;
  scene.add(driver);

  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(90 * 3), 3));
  shards = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#d8f0ff', size: 0.07, transparent: true, depthWrite: false }));
  shards.frustumCulled = false;
  shards.visible = false;
  scene.add(shards);
  for (let i = 0; i < 4; i++) {
    const s = glowSprite('#9a9aa6', 1, 0);
    s.material.blending = THREE.NormalBlending;
    s.visible = false;
    smoke.push(s);
    scene.add(s);
  }

  buildPips();
  updateHud();
  wireInput();
  runLoop({ renderer, update, resize });
  renderer.compile(scene, camera);
  G.mode = 'menu';
  $('#loader').classList.add('done');
  $('#menu').classList.add('on');
  window.__game = { G, startGame, choose, answer, spawnObstacle, trigger, scene, camera, renderer, questions: QUESTIONS };
  window.__ready = true;
  if (CAPTURE) { $('#loader').style.display = 'none'; }
}
boot();
