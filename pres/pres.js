// The presentation: eight 16:9 slides on one fixed background. Space / click = next slide.
// The transition is carried by the 3D models themselves: the outgoing model leaves (the car drives
// off, the bottle bursts, the bars sink...) and the incoming one arrives, while the text fades
// out and back in. All models share one full-stage WebGL canvas behind the text, so they can move
// anywhere on screen; each model is still framed inside its slide's .viz box (camera view offset).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { runLoop, after, CAPTURE, Q, clamp, damp } from '/shared/engine.js';
import { loadModels, inst, find, ownMaterials, recolor } from '/shared/assets.js';
import { World, glowSprite, glowTexture, LANE_R, LANE_L } from '/shared/world.js';
import { DrunkPass } from '/shared/drunk.js';
import { armRig } from '/shared/arms.js';
import { dressCockpit } from '/shared/cockpit.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const NOTES = [
  'שלום! אנחנו עמרי, אמה ואלין. הנושא שבחרנו הוא נהיגה בהשפעת אלכוהול.\nנדבר על מה האלכוהול עושה לגוף ולנהיגה, מה אומר החוק ואיך נמנעים, ובסוף נשחק במשחק שבנינו.',
  'האלכוהול מסווג כסם, ומכונה ״הסם הרטוב״. הוא חומר מדכא: הוא מאט את מערכת העצבים המרכזית.\nהוא נספג בקיבה ובמעי, עובר לזרם הדם ומשם לכל הגוף ולמוח.\nהכבד מפרק אותו לאט, בערך שעתיים לכל מנת משקה, ושום דבר לא מזרז את זה.',
  'מנת משקה אחת היא: פחית בירה של 330 מ״ל (5% אלכוהול), חצי כוס יין של 100 מ״ל (10.5%–15%), או כוסית של 30–40 מ״ל משקה חריף (40%–60%).\nלכולן השפעה דומה. בירה היא לא ״פחות אלכוהול״: פחית בירה משפיעה בערך כמו כוסית וויסקי.',
  'כבר מהמנה הראשונה כישורי הנהיגה נפגעים: זמן התגובה מתארך ב־10%–30%, קשה לאמוד מרחקים ומהירויות, והראייה היא החוש הראשון שנפגע.\nבמסך רואים איך נראה הכביש כשהריכוז עולה. ההדגמה רצה לבד, ואפשר גם להזיז את המחוון.',
  'הסיכוי להיות מעורבים בתאונה עולה פי 5 כבר אחרי מנה אחת.\nבגרף: בריכוז 0.16% הסיכון פי 8 לעומת 0.02%.\nרוב התאונות בגלל אלכוהול קורות בשעות החשכה, וצעירים בני 17–24 מעורבים בהן יותר.',
  'לנהג רגיל מותר עד 240 מיקרוגרם לליטר אוויר נשוף (50 מ״ג ל־100 מ״ל דם).\nלנהג חדש, לצעיר עד גיל 24 ולנהג ברכב ציבורי או כבד: רק 50 מיקרוגרם, כמעט אפס.\nבחשד סביר שוטר רשאי לדרוש בדיקת נשיפה, דם או שתן, והתוצאה היא ראיה בבית המשפט.\nהעונשים: פסילה לשנתיים לפחות, 10 נקודות, השבתת רכב ל־30 יום, ונהג חדש נשאר ״נהג חדש״ עוד שנתיים. סירוב לבדיקה: עד שנת מאסר או קנס של 10,000 ₪.',
  'מיתוסים: קפה ומקלחת קרה לא מפכחים, רק הזמן. בירה משפיעה כמו כל משקה. ״נחכה שעה״ זה לא מספיק: מנה אחת היא כשעתיים. ו״אני מרגיש בסדר״ זה בדיוק מה שהאלכוהול גורם להרגיש.\nהפתרון: נהג תורן שלא שותה, לא עולים עם נהג ששתה, ואומרים ״לא״.',
  'עכשיו משחק! מי מתנדב? לוחצים על ״כניסה למשחק״.\nנוהגים, ומול כל מכשול מוגרלת שאלה מ־1 עד 19 ועונים. טעות היא תאונה.\nתודה רבה!',
];
const BAC_TEXT = [
  [0.0, 'פיכח: הראייה והתגובות תקינות.'],
  [0.02, 'ירידה קלה בכושר השיפוט וקושי בחלוקת קשב.'],
  [0.05, 'גילוי מאוחר של הולכי רגל וקושי לשמור על הנתיב.'],
  [0.08, 'קשה לזהות סכנה וקשה לשלוט במהירות.'],
  [0.1, 'זמן התגובה מתארך מאוד וההיגוי קשה.'],
  [0.15, 'שליטה נמוכה מאוד ברכב: סכנת חיים.'],
];
const MODELS = ['car', 'policecar', 'cockpit', 'house_flat', 'house_roof', 'block', 'lamp', 'tree', 'bush', 'palm',
  'bottle', 'beerglass', 'wineglass', 'shot', 'can', 'mug', 'keys', 'breathalyzer'];
const W = 1920, H = 1080;

const slides = $$('.slide');
const N = slides.length;
const vizEls = slides.map((s) => $('.viz', s));
let stageScale = 1, quality = 1, t = 0, cur = -1, busy = null, started = false;
let bac = 0, demo = null;
const live = new Set();          // slides whose 3D is being drawn right now
const scenes = [];

// ---------------------------------------------------------------- renderers
function makeRenderer(c = document.createElement('canvas')) {
  const r = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: CAPTURE });
  r.setClearColor(0x000000, 0);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.05;
  const env = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
  return { c, r, env, drunk: null };
}
const MAIN = makeRenderer($('#gl'));   // every studio model, full stage
MAIN.r.autoClear = false;
MAIN.r.shadowMap.enabled = true;
MAIN.r.shadowMap.type = THREE.PCFSoftShadowMap;
const DRV = makeRenderer();            // the "screen" with the drunk-driving demo on slide 4

// ---------------------------------------------------------------- 3D helpers
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tx = new THREE.CanvasTexture(c);
  tx.colorSpace = THREE.SRGBColorSpace;
  return tx;
}
const shadowTex = canvasTexture(256, 256, (g) => {
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(0,0,0,0.65)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
});

function studio(envI = 0.85, shadow = 3) {
  const s = new THREE.Scene();
  s.environment = MAIN.env;
  s.environmentIntensity = envI;
  s.add(new THREE.HemisphereLight('#c9cfe8', '#1a1420', 0.45));
  const key = new THREE.DirectionalLight('#ffffff', 2.4); key.position.set(4, 7, 6); s.add(key, key.target);
  // soft real shadows from the key light ground every model on its stand
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  const c = key.shadow.camera;
  c.left = -shadow; c.right = shadow; c.top = shadow; c.bottom = -shadow; c.near = 0.5; c.far = 40;
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 5;
  const rimA = new THREE.DirectionalLight('#ffc94d', 2.6); rimA.position.set(-6, 3, -5); s.add(rimA);
  const rimB = new THREE.DirectionalLight('#6f7dff', 2.6); rimB.position.set(6, 2.5, -5); s.add(rimB);
  return s;
}
/** every opaque mesh under o casts a shadow */
function shade(o) {
  o.traverse((m) => { if (m.isMesh && !m.material.transparent) m.castShadow = true; });
  return o;
}

// fine concentric grooves for the glossy display stands
const grooveTex = canvasTexture(512, 512, (g, w) => {
  g.fillStyle = '#808080'; g.fillRect(0, 0, w, w);
  for (let r = 6; r < w / 2; r += 3) {
    g.strokeStyle = `rgba(${r % 2 ? 255 : 0},${r % 2 ? 255 : 0},${r % 2 ? 255 : 0},0.06)`;
    g.beginPath(); g.arc(w / 2, w / 2, r, 0, Math.PI * 2); g.stroke();
  }
});
grooveTex.colorSpace = THREE.NoColorSpace;

function turntable(r, h = 0.1) {
  const g = new THREE.Group();
  // the rim lights sit low behind the stand, so a normal glossy top turns into a grey mirror at this
  // grazing angle; a tiny specular keeps it dark with just a soft sheen
  const top = new THREE.MeshPhysicalMaterial({ color: '#0c0d16', metalness: 0.0, roughness: 0.5, roughnessMap: grooveTex,
    specularIntensity: 0.1, envMapIntensity: 0.06 });
  const side = new THREE.MeshPhysicalMaterial({ color: '#9aa0b0', metalness: 1, roughness: 0.3, envMapIntensity: 1.1 });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h * 0.8, 96), [side, top, side]);
  disc.position.y = h * 0.6;
  disc.receiveShadow = true;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.97, r * 0.9, h * 0.2, 96), new THREE.MeshStandardMaterial({ color: '#05060a', roughness: 0.6 }));
  base.position.y = h * 0.1;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.004, Math.max(0.004, r * 0.007), 8, 140),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd60a').multiplyScalar(1.6), toneMapped: false }));
  ring.rotation.x = Math.PI / 2; ring.position.y = h;
  const glow = new THREE.Mesh(new THREE.RingGeometry(r * 0.98, r * 1.4, 96),
    new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#ffc400', transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.004;
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(r * 1.5, r * 1.5), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.7, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = h + 0.003;
  g.add(base, disc, ring, glow, sh);
  g.userData.top = h;
  return g;
}

function labelSprite(text, { size = 0.32, color = '#ffffff', bg = 'rgba(8,12,26,0.88)', font = '800 64px Assistant, Arial' } = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 56, h = 100;
  c.width = w; c.height = h;
  g.font = font;
  g.fillStyle = bg;
  g.beginPath(); g.roundRect(2, 2, w - 4, h - 4, 26); g.fill();
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 3);
  const tx = new THREE.CanvasTexture(c);
  tx.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, transparent: true, depthWrite: false }));
  s.scale.set(size * w / h, size, 1);
  return s;
}

function lights(car, size = 1.3) {
  const out = [];
  for (const sx of [-1, 1]) {
    const h = glowSprite('#fff3da', size, 1); h.position.set(sx * 0.56, 0.66, -2.36);
    const tl = glowSprite('#ff2a1a', size * 0.45, 0.85); tl.position.set(sx * 0.58, 0.79, 2.32);
    car.add(h, tl);
    out.push(h);
  }
  return out;
}

function screenTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const tx = new THREE.CanvasTexture(c);
  tx.colorSpace = THREE.SRGBColorSpace;
  const g = c.getContext('2d');
  return { tex: tx, redraw: (...a) => { draw(g, w, h, ...a); tx.needsUpdate = true; } };
}

function wheelsOf(car) {
  const w = [];
  car.traverse((o) => { if (o.name.startsWith('wheel')) w.push(o); });
  return w;
}

/** remember an object's resting scale so pop-ins return to it */
const base = (o) => { o.userData.s0 = o.scale.x; return o; };
function popIn(tl, o, at, dur = 0.5) {
  const s0 = o.userData.s0 ?? 1;
  tl.fromTo(o.scale, { x: s0 * 0.001, y: s0 * 0.001, z: s0 * 0.001 }, { x: s0, y: s0, z: s0, duration: dur, ease: 'back.out(1.8)' }, at);
}
function popOut(tl, o, at, dur = 0.4) {
  const s0 = o.userData.s0 ?? 1;
  tl.to(o.scale, { x: s0 * 0.001, y: s0 * 0.001, z: s0 * 0.001, duration: dur, ease: 'back.in(1.8)' }, at);
}

// ---------------------------------------------------------------- screen <-> world for a scene
function camRight(s) {
  s.cam.updateMatrixWorld();
  return new THREE.Vector3().setFromMatrixColumn(s.cam.matrixWorld, 0).setY(0).normalize();
}
/** world length of `px` stage pixels at the depth of point `at` */
function pxToWorld(s, px, at) {
  const dist = s.cam.position.distanceTo(at);
  return px * (2 * dist * Math.tan(THREE.MathUtils.degToRad(s.cam.fov / 2))) / s.rect.h;
}
/** world point under stage pixel (sx, sy), on the camera-facing plane through `ref` */
function screenToWorld(s, sx, sy, ref) {
  s.cam.updateMatrixWorld();
  const p = new THREE.Vector3((sx / W) * 2 - 1, -((sy / H) * 2 - 1), 0.5).unproject(s.cam);
  const dir = p.sub(s.cam.position).normalize();
  const fwd = new THREE.Vector3();
  s.cam.getWorldDirection(fwd);
  const k = ref.clone().sub(s.cam.position).dot(fwd) / dir.dot(fwd);
  return s.cam.position.clone().addScaledVector(dir, k);
}
function vizCenter(i, fx = 0.5, fy = 0.5) {
  const v = vizEls[i];
  return [v.offsetLeft + v.offsetWidth * fx, v.offsetTop + v.offsetHeight * fy];
}
/** yaw that points a car model (front = -Z) along direction v */
const yawFor = (v) => Math.atan2(-v.x, -v.z);
const nearAngle = (a, ref) => a + Math.round((ref - a) / (Math.PI * 2)) * Math.PI * 2;
/** pixels from the model's box to just past the screen edge, in the direction it moves (d: +1 leftward) */
const offPx = (s, d) => (d > 0 ? s.rect.x + s.rect.w / 2 : W - (s.rect.x + s.rect.w / 2)) + 650;

// a car that drives in from beside the screen and parks, or drives away (used by the car slides)
function driveIn(tl, s, car, root, d, at, dur = 1.1) {
  if (car.parent !== root) root.add(car);
  car.position.set(0, car.userData.restY, 0);
  car.rotation.set(0, 0, 0);
  const right = camRight(s);
  const head = right.clone().multiplyScalar(-d);           // forward: toward the left of the screen
  s.ang = yawFor(head);
  s.spin = 0;
  root.rotation.y = s.ang;
  root.updateMatrixWorld(true);
  s.scene.attach(car);
  const rest = car.position.clone();
  const K = pxToWorld(s, offPx(s, -d) + 600, s.look);       // starts past the opposite screen edge
  car.position.addScaledVector(head, -K);
  s.wheelSpin = 34;
  tl.to(car.position, { x: rest.x, z: rest.z, duration: dur, ease: 'power3.out' }, at)
    .to(s, { wheelSpin: 0, duration: dur * 0.9, ease: 'power2.out' }, at + 0.1)
    .to(car.rotation, { x: -0.06, duration: 0.14, yoyo: true, repeat: 1, ease: 'sine.inOut' }, at + dur - 0.2)
    .call(() => { root.attach(car); }, null, at + dur)
    .to(s, { spin: 1, duration: 1.2 }, at + dur);
}
function driveOut(tl, s, car, d, at, dur = 0.8) {
  s.spin = 0;
  s.scene.attach(car);
  const head = camRight(s).multiplyScalar(-d);
  const yaw = nearAngle(yawFor(head), car.rotation.y);
  const K = pxToWorld(s, offPx(s, d) + 900, s.look);
  const to = car.position.clone().addScaledVector(head, K);
  tl.to(car.rotation, { y: yaw, duration: 0.3, ease: 'power2.inOut' }, at)
    .to(s, { wheelSpin: 40, duration: 0.3 }, at)
    .to(car.position, { x: to.x, z: to.z, duration: dur, ease: 'power2.in' }, at + 0.22)
    .to(car.rotation, { x: 0.06, duration: 0.15, yoyo: true, repeat: 1 }, at + 0.22);
}

// ---------------------------------------------------------------- scenes
const BUILD = {
  car(i) {
    const scene = studio(0.65, 3.6);
    const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 400);
    const look = new THREE.Vector3(0, 0.6, 0);
    cam.position.set(-8.8, 3.1, 10); cam.lookAt(look);
    const root = new THREE.Group();
    const tt = base(turntable(3.1));
    const car = shade(inst('car')); car.rotation.order = 'YXZ'; car.userData.restY = tt.userData.top; car.position.y = tt.userData.top;
    lights(car, 1.5);
    root.add(tt, car);
    scene.add(root);
    const wheels = wheelsOf(car);
    const s = { name: 'car', scene, cam, look, root, ang: 0.6, spin: 1, wheelSpin: 0 };
    s.update = (dt, tt2) => {
      s.ang += dt * 0.32 * s.spin;
      root.rotation.y = s.ang;
      wheels.forEach((w) => { w.rotation.x -= s.wheelSpin * dt; });
      cam.position.set(-8.8 + Math.sin(tt2 * 0.2) * 0.6, 3.1 + Math.sin(tt2 * 0.15) * 0.2, 10);
      cam.lookAt(look);
    };
    s.enter = (d) => {
      const tl = gsap.timeline();
      popIn(tl, tt, 0.3, 0.45);
      driveIn(tl, s, car, root, d, 0.15, 1.2);
      return tl;
    };
    s.exit = (d) => {
      const tl = gsap.timeline();
      driveOut(tl, s, car, 1, 0, 0.65);          // always leaves by the near (left) edge
      popOut(tl, tt, 0.12, 0.3);
      return tl;
    };
    return s;
  },

  bottle(i) {
    const scene = studio(1.0, 0.8);
    const cam = new THREE.PerspectiveCamera(24, 1, 0.05, 60);
    const look = new THREE.Vector3(0, 0.44, 0);
    cam.position.set(0, 1.0, 3.1); cam.lookAt(look);
    const root = new THREE.Group();
    const tt = base(turntable(0.62, 0.06));
    const y = tt.userData.top;
    const b = inst('bottle'); b.scale.setScalar(3.3); b.position.set(-0.16, y, 0.02);
    const g = inst('beerglass'); g.scale.setScalar(3.3); g.position.set(0.22, y, 0.12);
    const sh = inst('shot'); sh.scale.setScalar(3.3); sh.position.set(0.05, y, 0.38);
    const items = [b, g, sh].map(base).map(shade);
    root.add(tt, ...items);
    scene.add(root);
    const s = { name: 'bottle', scene, cam, look, root, spin: 1, boost: 0, ang: 0 };
    s.update = (dt) => {
      s.ang += dt * (0.4 * s.spin + s.boost);
      root.rotation.y = s.ang;
    };
    s.enter = (d) => {
      const tl = gsap.timeline();
      s.boost = 0;
      popIn(tl, tt, 0.3, 0.45);
      items.forEach((o, k) => {
        o.scale.setScalar(o.userData.s0);
        tl.fromTo(o.position, { y: y + 2.6 }, { y, duration: 0.85, ease: 'bounce.out' }, 0.32 + k * 0.12);
      });
      return tl;
    };
    s.exit = (d, to) => {
      const tl = gsap.timeline();
      if (to === 'drinks' && d > 0) {
        // spins up and bursts into the three drinks of the next slide
        tl.to(s, { boost: 16, duration: 0.45, ease: 'power2.in' }, 0);
        items.forEach((o) => { tl.to(o.position, { y: y + 0.35, duration: 0.45, ease: 'power2.in' }, 0); popOut(tl, o, 0.3, 0.25); });
        tl.fromTo('#fx .flash', { opacity: 0 }, { opacity: 0.12, duration: 0.06, yoyo: true, repeat: 1 }, 0.5);
      } else {
        items.forEach((o, k) => tl.to(o.position, { y: y + 2.6, duration: 0.5, ease: 'power2.in' }, k * 0.06));
      }
      popOut(tl, tt, 0.12, 0.3);
      return tl;
    };
    return s;
  },

  drinks(i) {
    const scene = studio(1.0, 3.2);
    const cam = new THREE.PerspectiveCamera(20, 1, 0.05, 60);
    const look = new THREE.Vector3(0, 0.5, 0);
    cam.position.set(0, 1.15, 5.2); cam.lookAt(look);
    const defs = [['can', 7.6], ['wineglass', 5.4], ['shot', 10.5]];
    const items = defs.map(([name, sc]) => {
      const g = new THREE.Group();
      const tt = base(turntable(0.5, 0.05));
      const it = shade(base(inst(name))); it.scale.setScalar(sc); it.userData.s0 = sc; it.position.y = tt.userData.top;
      g.add(tt, it);
      scene.add(g);
      return { g, tt, it, y: tt.userData.top };
    });
    const s = { name: 'drinks', scene, cam, look, items };
    s.fit = (r) => {
      // line the three drinks up with the three cards under the box (cards: right, middle, left)
      const dist = cam.position.distanceTo(look);
      const visW = 2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * (r.w / r.h);
      const off = visW * 0.345;
      items[0].g.position.x = off; items[1].g.position.x = 0; items[2].g.position.x = -off;
    };
    s.update = (dt, tt2) => { items.forEach((o, k) => { o.g.rotation.y = tt2 * 0.55 + k * 1.3; }); };
    s.enter = (d, from) => {
      const tl = gsap.timeline();
      items.forEach((o, k) => {
        popIn(tl, o.tt, 0.25 + k * 0.06, 0.45);
        if (o.it.parent !== o.g) o.g.add(o.it);
        o.it.position.set(0, o.y, 0); o.it.rotation.set(0, 0, 0);
        o.it.scale.setScalar(o.it.userData.s0);
        if (from === 'bottle' && d > 0) {
          // the drinks fly out of where the bottle burst
          const [bx, by] = vizCenter(1, 0.47, 0.52);
          o.g.updateMatrixWorld(true);
          scene.attach(o.it);
          const rest = o.it.position.clone();
          const start = screenToWorld(s, bx, by, rest);
          o.it.position.copy(start);
          o.it.scale.setScalar(o.it.userData.s0 * 0.25);
          const at = 0.05 + k * 0.07;
          tl.to(o.it.position, { x: rest.x, z: rest.z, duration: 0.85, ease: 'power2.out' }, at)
            .to(o.it.position, { y: rest.y + 0.9, duration: 0.42, ease: 'power2.out' }, at)
            .to(o.it.position, { y: rest.y, duration: 0.43, ease: 'bounce.out' }, at + 0.42)
            .to(o.it.scale, { x: o.it.userData.s0, y: o.it.userData.s0, z: o.it.userData.s0, duration: 0.6, ease: 'back.out(1.6)' }, at)
            .to(o.it.rotation, { y: Math.PI * 4, duration: 0.85, ease: 'power2.out' }, at)
            .call(() => { o.g.attach(o.it); }, null, at + 0.9);
        } else {
          tl.fromTo(o.it.position, { y: o.y + 3.2 }, { y: o.y, duration: 0.85, ease: 'bounce.out' }, 0.3 + k * 0.1);
        }
      });
      return tl;
    };
    s.exit = (d, to) => {
      const tl = gsap.timeline();
      items.forEach((o, k) => {
        if (to === 'drive' && d > 0) {
          // sucked into the driving screen of the next slide
          const [cx, cy] = vizCenter(3);
          o.g.updateMatrixWorld(true);
          scene.attach(o.it);
          const target = screenToWorld(s, cx, cy, o.it.position);
          tl.to(o.it.position, { x: target.x, y: target.y, z: target.z, duration: 0.6, ease: 'power2.in' }, k * 0.08)
            .to(o.it.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.6, ease: 'power2.in' }, k * 0.08)
            .to(o.it.rotation, { y: '+=6', duration: 0.6 }, k * 0.08);
        } else {
          popOut(tl, o.it, k * 0.06, 0.4);
        }
        popOut(tl, o.tt, 0.12 + k * 0.05, 0.3);
      });
      return tl;
    };
    return s;
  },

  drive(i) {
    const scene = new THREE.Scene();
    const world = new World(scene, DRV.r, { mode: 'night' });
    const cam = new THREE.PerspectiveCamera(54, 1, 0.03, 1200);
    const ck = inst('cockpit');
    ck.position.set(LANE_R, 0, 0);
    scene.add(ck);
    const wheel = find(ck, 'steering');
    const wheelBase = wheel.quaternion.clone();
    const arms = armRig(ck);
    const dash = dressCockpit(ck);
    const cabin = new THREE.PointLight('#ffd9b0', 0.5, 1.6, 1.5);
    scene.add(cabin);
    const oc = inst('car'); recolor(oc, 'Paint', '#d9d9d9'); oc.rotation.y = Math.PI; oc.position.set(LANE_L, 0, -150);
    for (const sx of [-1, 1]) { const h = glowSprite('#fff3da', 1.6, 1); h.position.set(sx * 0.56, 0.66, -2.36); oc.add(h); }
    scene.add(oc);
    const spot = new THREE.SpotLight('#fff0d6', 90, 70, 0.42, 0.55, 1.1);
    scene.add(spot, spot.target);
    DRV.drunk = new DrunkPass(DRV.r);
    vizEls[i].prepend(DRV.c);
    let amt = 0, lastB = -1;
    const box = vizEls[i];
    const s = { name: 'drive', scene, cam, drv: true };
    s.fit = () => {
      const w = box.offsetWidth, h = box.offsetHeight;
      const pr = clamp(stageScale * Math.min(window.devicePixelRatio || 1, 2) * quality, 0.35, 2);
      DRV.r.setPixelRatio(pr);
      DRV.r.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
      DRV.drunk.setSize(w, h, pr);
    };
    s.enter = () => {
      // switches on like an old TV
      const tl = gsap.timeline();
      tl.fromTo(box, { clipPath: 'inset(49.6% 50% 49.6% 50%)', opacity: 1 }, { clipPath: 'inset(49.6% 0% 49.6% 0%)', duration: 0.25, ease: 'power2.out' }, 0.35)
        .to(box, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.35, ease: 'power3.out' }, 0.6)
        .fromTo($('.tvflash', box), { opacity: 0.55 }, { opacity: 0, duration: 0.35, ease: 'power2.out' }, 0.6)
        .set(box, { clearProps: 'clipPath' }, 1.0);
      startDemo(1.3);
      return tl;
    };
    s.exit = () => {
      // ...and switches off
      if (demo) demo.kill();
      const tl = gsap.timeline();
      tl.set($('.tvflash', box), { opacity: 0.3 }, 0)
        .fromTo(box, { clipPath: 'inset(0% 0% 0% 0%)' }, { clipPath: 'inset(49.6% 0% 49.6% 0%)', duration: 0.22, ease: 'power2.in' }, 0)
        .to(box, { clipPath: 'inset(49.6% 50% 49.6% 50%)', duration: 0.18, ease: 'power2.in' }, 0.22)
        .to(box, { opacity: 0, duration: 0.12 }, 0.4)
        .set($('.tvflash', box), { opacity: 0 }, 0.55);
      return tl;
    };
    s.update = (dt, tt2) => {
      world.street.scroll(14 * dt);
      oc.position.z += 26 * dt;
      if (oc.position.z > 12) oc.position.z = -170 - Math.random() * 50;
      amt = damp(amt, bac / 0.15, 3, dt);
      const sway = Math.sin(tt2 * 0.55) * 0.55 * amt + Math.sin(tt2 * 1.7) * 0.06 * amt;
      ck.position.x = LANE_R + sway;
      ck.rotation.y = -Math.cos(tt2 * 0.55) * 0.05 * amt;
      const steer = -Math.cos(tt2 * 0.55) * 1.2 * amt + Math.sin(tt2 * 2.1) * 0.03;
      wheel.quaternion.copy(wheelBase).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), steer));
      arms();
      const bq = Math.round(bac * 100) / 100;
      if (bq !== lastB) { dash.drawCluster({ kmh: 50, bac: bq }); lastB = bq; }
      dash.drawNav(14 * dt);
      spot.position.set(ck.position.x, 0.75, -2.2);
      spot.target.position.set(ck.position.x + sway * 2, 0, -30);
      cabin.position.set(ck.position.x - 0.25, 1.08, -0.05);
      cam.position.set(LANE_R - 0.37 + sway, 1.29 + Math.sin(tt2 * 9) * 0.004, 0.3);
      cam.lookAt(LANE_R - 0.3 + sway * 1.6, 1.1, -12);
      world.update(cam);
      if (dash.mirrorPass) dash.mirrorPass(DRV.r, scene, cam.position, [ck]);
      DRV.drunk.render(scene, cam, amt, t);
    };
    return s;
  },

  bars(i) {
    const scene = studio(0.7, 3.4);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    const look = new THREE.Vector3(0, 1.05, 0);
    cam.position.set(-2.6, 2.7, 10.2); cam.lookAt(look);
    const plinth = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.12, 1.6), new THREE.MeshStandardMaterial({ color: '#0c0e16', metalness: 0.45, roughness: 0.42, envMapIntensity: 0.25 }));
    slab.position.y = 0.07; slab.receiveShadow = true;
    const edge = new THREE.Mesh(new THREE.BoxGeometry(5.26, 0.03, 1.66), new THREE.MeshBasicMaterial({ color: '#ffd60a', toneMapped: false }));
    edge.position.y = 0.015;
    plinth.add(slab, edge);
    scene.add(plinth);
    const data = [[0.02, 1, '×1'], [0.05, 1.5, '×1.5'], [0.10, 4, '×4'], [0.16, 8, '×8']];
    const xs = [1.8, 0.6, -0.6, -1.8];
    const cols = ['#ffe14d', '#ffc400', '#ff7a1a', '#ff3b3b'];
    const bars = data.map(([b, v, txt], k) => {
      const h = 0.27 * v;
      const geo = new THREE.BoxGeometry(0.78, h, 0.78); geo.translate(0, h / 2, 0);
      const bar = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: cols[k], emissive: cols[k], emissiveIntensity: 0.45, roughness: 0.3, metalness: 0.15 }));
      bar.position.set(xs[k], 0.12, 0); bar.castShadow = true;
      const top = labelSprite(txt, { size: 0.34, color: cols[k] });
      top.position.set(xs[k], 0.12 + h + 0.32, 0);
      const bot = labelSprite(b.toFixed(2) + '%', { size: 0.24, color: '#dfe5f2' });
      bot.position.set(xs[k], 0.32, 0.62);
      scene.add(bar, top, bot);
      return { bar, top, bot };
    });
    const s = { name: 'bars', scene, cam, look };
    s.update = (dt, tt2) => {
      // a squashed bar would still show its top face, so hide it until it grows
      bars.forEach((o) => { o.bar.visible = o.bar.scale.y > 0.03; });
      plinth.visible = plinth.scale.x > 0.03;
      cam.position.set(-2.6 + Math.sin(tt2 * 0.25) * 0.8, 2.7 + Math.sin(tt2 * 0.2) * 0.15, 10.2);
      cam.lookAt(look);
    };
    s.enter = () => {
      const tl = gsap.timeline();
      tl.fromTo(plinth.scale, { x: 0.001 }, { x: 1, duration: 0.45, ease: 'power3.out' }, 0);
      bars.forEach((o, k) => {
        tl.fromTo(o.bar.scale, { y: 0.001 }, { y: 1, duration: 0.8, ease: 'back.out(1.5)' }, 0.25 + k * 0.14)
          .fromTo([o.top.material, o.bot.material], { opacity: 0 }, { opacity: 1, duration: 0.35 }, 0.7 + k * 0.14);
      });
      return tl;
    };
    s.exit = () => {
      const tl = gsap.timeline();
      bars.forEach((o, k) => {
        tl.to([o.top.material, o.bot.material], { opacity: 0, duration: 0.2 }, 0)
          .to(o.bar.scale, { y: 0.001, duration: 0.34, ease: 'back.in(1.6)' }, 0.04 + k * 0.04);
      });
      tl.to(plinth.scale, { x: 0.001, duration: 0.35, ease: 'power3.in' }, 0.45);
      return tl;
    };
    return s;
  },

  police(i) {
    const scene = studio(0.65, 3.6);
    const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 400);
    const look = new THREE.Vector3(0, 0.9, 0);
    cam.position.set(-7.6, 3.1, 9.2); cam.lookAt(look);
    const root = new THREE.Group();
    const tt = base(turntable(3.0));
    const pc = shade(inst('policecar')); pc.rotation.order = 'YXZ'; pc.userData.restY = tt.userData.top; pc.position.y = tt.userData.top;
    const L = ownMaterials(pc, ['PoliceRed', 'PoliceBlue']);
    const red = glowSprite('#ff2a2a', 3, 0); red.position.set(-0.3, 1.6, 0.15);
    const blue = glowSprite('#2a6bff', 3, 0); blue.position.set(0.3, 1.6, 0.15);
    pc.add(red, blue);
    lights(pc, 1.2);
    root.add(tt, pc);
    scene.add(root);
    const wheels = wheelsOf(pc);
    const br = base(inst('breathalyzer'));
    br.scale.setScalar(4.2); br.userData.s0 = 4.2;
    scene.add(br);
    const scr = screenTexture(256, 256, (c, w, h, val) => {
      c.fillStyle = '#06140c'; c.fillRect(0, 0, w, h);
      c.fillStyle = val > 240 ? '#ff5a4a' : '#58f08f'; c.font = '700 130px Karantina, Arial'; c.textAlign = 'center';
      c.fillText(String(Math.round(val)), w / 2, 135);
      c.font = '600 30px Assistant, Arial'; c.fillStyle = '#9fe8bb'; c.fillText('µg/L', w / 2, 185);
      if (val > 240) { c.fillStyle = '#ff5a4a'; c.fillRect(30, 205, w - 60, 10); }
    });
    scr.tex.center.set(0.5, 0.5); scr.tex.rotation = Math.PI;
    find(br, 'screen').material = new THREE.MeshBasicMaterial({ map: scr.tex, toneMapped: false, side: THREE.DoubleSide });
    const reading = { v: 0 };
    scr.redraw(0);
    const s = { name: 'police', scene, cam, look, root, ang: 0.8, spin: 1, wheelSpin: 0 };
    const fwd = new THREE.Vector3(), right = new THREE.Vector3();
    s.update = (dt, tt2) => {
      s.ang += dt * 0.3 * s.spin;
      root.rotation.y = s.ang;
      wheels.forEach((w) => { w.rotation.x -= s.wheelSpin * dt; });
      const ph = (tt2 * 2.6) % 1;
      const r = ph < 0.25 || (ph > 0.5 && ph < 0.6) ? 1 : 0;
      const b = (ph > 0.25 && ph < 0.5) || ph > 0.75 ? 1 : 0;
      L.PoliceRed.emissiveIntensity = 0.4 + r * 9; L.PoliceBlue.emissiveIntensity = 0.4 + b * 9;
      red.material.opacity = r * 0.9; blue.material.opacity = b * 0.9;
      fwd.subVectors(look, cam.position).normalize();
      right.crossVectors(fwd, cam.up).normalize();
      br.position.copy(cam.position).addScaledVector(fwd, 6).addScaledVector(right, -0.62);
      br.position.y += 0.42 + Math.sin(tt2 * 1.1) * 0.05;
      br.rotation.set(0, Math.atan2(cam.position.x - br.position.x, cam.position.z - br.position.z) + Math.PI + Math.sin(tt2 * 0.6) * 0.25, 0);
    };
    s.enter = (d) => {
      const tl = gsap.timeline();
      popIn(tl, tt, 0.3, 0.45);
      driveIn(tl, s, pc, root, d, 0.12, 1.15);
      // a little drift as it brakes
      tl.fromTo(pc.rotation, { y: s.ang + 0.55 * d }, { y: s.ang, duration: 1.0, ease: 'back.out(2.2)' }, 0.2);
      popIn(tl, br, 0.9, 0.5);
      reading.v = 0;
      tl.to(reading, { v: 310, duration: 2.6, ease: 'power1.inOut', onUpdate: () => scr.redraw(reading.v) }, 1.3);
      return tl;
    };
    s.exit = (d) => {
      const tl = gsap.timeline();
      popOut(tl, br, 0, 0.3);
      driveOut(tl, s, pc, 1, 0.05, 0.65);
      popOut(tl, tt, 0.15, 0.3);
      return tl;
    };
    return s;
  },

  keys(i) {
    const scene = studio(0.75, 0.75);
    const cam = new THREE.PerspectiveCamera(26, 1, 0.05, 60);
    const look = new THREE.Vector3(0, 0.3, 0);
    cam.position.set(0, 1.05, 2.7); cam.lookAt(look);
    const root = new THREE.Group();
    const tt = base(turntable(0.55, 0.06));
    const y = tt.userData.top;
    const mug = shade(base(inst('mug'))); mug.scale.setScalar(4.2); mug.userData.s0 = 4.2; mug.position.set(-0.12, y, 0); mug.rotation.y = 2.2;
    const keys = shade(base(inst('keys'))); keys.scale.setScalar(5); keys.userData.s0 = 5; keys.position.set(0.24, y + 0.05, 0.12); keys.rotation.set(0, 0.7, 0);
    root.add(tt, mug, keys);
    const steam = [];
    for (let k = 0; k < 7; k++) { const p = glowSprite('#ffffff', 0.1, 0); p.userData.k = k; root.add(p); steam.push(p); }
    scene.add(root);
    const s = { name: 'keys', scene, cam, look, root, ang: 0, spin: 1 };
    s.update = (dt, tt2) => {
      s.ang += dt * 0.35 * s.spin;
      root.rotation.y = s.ang;
      steam.forEach((p) => {
        const ph = (tt2 * 0.35 + p.userData.k / 7) % 1;
        p.position.set(-0.12 + Math.sin(ph * 9 + p.userData.k) * 0.03, y + 0.42 + ph * 0.5, 0);
        // only once the mug has landed (not while it drops in)
        const landed = clamp(1 - (mug.position.y - y) * 4, 0, 1);
        p.material.opacity = Math.sin(ph * Math.PI) * 0.13 * (mug.scale.x / 4.2) * landed;
        p.scale.setScalar(0.14 + ph * 0.32);
      });
    };
    s.enter = () => {
      const tl = gsap.timeline();
      popIn(tl, tt, 0.3, 0.45);
      mug.scale.setScalar(4.2);
      tl.fromTo(mug.position, { y: y + 1.8 }, { y, duration: 0.8, ease: 'bounce.out' }, 0.15);
      // the keys are tossed onto the table
      keys.scale.setScalar(5);
      popIn(tl, keys, 0.45, 0.35);
      tl.fromTo(keys.position, { x: 0.55, z: 0.3 }, { x: 0.24, z: 0.12, duration: 0.6, ease: 'power1.out' }, 0.45)
        .fromTo(keys.position, { y: y + 0.45 }, { y: y + 0.05, duration: 0.6, ease: 'bounce.out' }, 0.45)
        .fromTo(keys.rotation, { x: 0.9, z: 0.6 }, { x: 0, z: 0, duration: 0.6, ease: 'power2.out' }, 0.45);
      return tl;
    };
    s.exit = (d, to) => {
      const tl = gsap.timeline();
      // the keys hop up, spin and vanish
      tl.to(keys.position, { y: y + 0.28, duration: 0.25, ease: 'power2.out' }, 0)
        .to(keys.rotation, { y: '+=7', duration: 0.5, ease: 'power1.in' }, 0);
      popOut(tl, keys, 0.2, 0.3);
      popOut(tl, mug, 0.05, 0.35);
      popOut(tl, tt, 0.15, 0.3);
      return tl;
    };
    return s;
  },

  finale(i) {
    const scene = studio(0.6, 3.6);
    const cam = new THREE.PerspectiveCamera(24, 1, 0.1, 400);
    const look = new THREE.Vector3(0, 0.95, 0);
    cam.position.set(0, 1.9, 14.5); cam.lookAt(look);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 96), new THREE.MeshLambertMaterial({ color: '#0a0c16' }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    scene.add(floor);
    const rings = [[3.4, 0.45], [6.2, 0.2]].map(([r, o]) => {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.025, r + 0.025, 128), new THREE.MeshBasicMaterial({ color: '#ffd60a', transparent: true, opacity: o, toneMapped: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.005;
      scene.add(ring);
      return ring;
    });
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 9), new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#ffe0aa', transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.01, 5.5);
    scene.add(pool);
    const car = shade(inst('car')); car.rotation.y = Math.PI;
    const heads = lights(car, 0.75);
    scene.add(car);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 6), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.y = 0.006;
    scene.add(sh);
    const wheels = wheelsOf(car);
    const drive = { z: 0, spin: 0 };
    const s = { name: 'finale', scene, cam, look };
    s.update = (dt, tt2) => {
      car.position.set(0, Math.sin(tt2 * 7) * 0.006, drive.z);
      sh.position.z = drive.z; pool.position.z = drive.z + 5.5;
      wheels.forEach((w) => { w.rotation.x += drive.spin * dt; });
      cam.position.set(Math.sin(tt2 * 0.18) * 1.2, 1.9, 14.5 - Math.min(1.5, tt2 * 0.06));
      cam.lookAt(look);
    };
    s.enter = () => {
      const tl = gsap.timeline();
      rings.forEach((r, k) => tl.fromTo(r.scale, { x: 0.001, y: 0.001, z: 0.001 }, { x: 1, y: 1, z: 1, duration: 0.7, ease: 'power3.out' }, 0.1 + k * 0.12));
      drive.z = -45; drive.spin = 30;
      tl.to(drive, { z: 0, duration: 1.4, ease: 'power3.out' }, 0.05)
        .to(drive, { spin: 0, duration: 1.2 }, 0.3)
        .fromTo(heads.map((h) => h.scale), { x: 0.75, y: 0.75 }, { x: 2.4, y: 2.4, duration: 0.14, yoyo: true, repeat: 3, ease: 'sine.inOut' }, 1.35);
      return tl;
    };
    s.exit = () => {
      const tl = gsap.timeline();
      drive.spin = -30;
      tl.to(drive, { z: -45, duration: 0.8, ease: 'power2.in' }, 0);
      rings.forEach((r, k) => tl.to(r.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.4, ease: 'power2.in' }, 0.2 + k * 0.08));
      return tl;
    };
    return s;
  },
};

// ---------------------------------------------------------------- framing and drawing
function fitScene(i) {
  const s = scenes[i];
  if (!s) return;
  if (s.drv) { s.fit(); return; }
  const v = vizEls[i];
  const r = s.rect = { x: v.offsetLeft, y: v.offsetTop, w: v.offsetWidth, h: v.offsetHeight };
  s.cam.aspect = r.w / r.h;
  // frame the model inside its box, but draw the whole stage so it can travel anywhere
  s.cam.setViewOffset(r.w, r.h, -r.x, -r.y, W, H);
  s.cam.updateProjectionMatrix();
  s.fit && s.fit(r);
}

// the models lean gently toward the mouse (a few degrees of orbit around their look point)
const par = { x: 0, y: 0, tx: 0, ty: 0 };
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
function draw(dt) {
  par.x = damp(par.x, par.tx, 3, dt); par.y = damp(par.y, par.ty, 3, dt);
  MAIN.r.clear();
  for (const i of live) {
    const s = scenes[i];
    s.update && s.update(dt, t - (s.t0 || 0));
    if (s.drv) continue;
    const tilt = s.look && (Math.abs(par.x) + Math.abs(par.y) > 0.001);
    if (tilt) {
      _p.copy(s.cam.position); _q.copy(s.cam.quaternion);
      const dist = s.cam.position.distanceTo(s.look);
      s.cam.updateMatrixWorld();
      _r.setFromMatrixColumn(s.cam.matrixWorld, 0); _u.setFromMatrixColumn(s.cam.matrixWorld, 1);
      s.cam.position.addScaledVector(_r, par.x * dist * 0.06).addScaledVector(_u, -par.y * dist * 0.035);
      s.cam.lookAt(s.look);
    }
    MAIN.r.render(s.scene, s.cam);
    MAIN.r.clearDepth();
    if (tilt) { s.cam.position.copy(_p); s.cam.quaternion.copy(_q); }
  }
}

// ---------------------------------------------------------------- text entrance
function splitWords(el) {
  if (el.dataset.split) return;
  el.dataset.split = '1';
  const walk = (node) => {
    [...node.childNodes].forEach((n) => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach((p) => {
          if (!p) return;
          if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); return; }
          const w = document.createElement('span'); w.className = 'w';
          const inner = document.createElement('span'); inner.textContent = p;
          w.appendChild(inner); frag.appendChild(w);
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1 && n.tagName === 'EM') {
        const w = document.createElement('span'); w.className = 'w';
        n.replaceWith(w);
        const inner = document.createElement('span');
        inner.appendChild(n); w.appendChild(inner);
      } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
    });
  };
  walk(el);
}

function enterContent(el, delay) {
  const tl = gsap.timeline({ delay });
  tl.fromTo($$('.kicker', el), { opacity: 0, x: 80 }, { opacity: 1, x: 0, duration: 0.7, ease: 'power3.out' }, 0);
  tl.fromTo($$('.title .w > span', el), { yPercent: 115, rotation: 4 }, { yPercent: 0, rotation: 0, duration: 0.85, stagger: 0.07, ease: 'power3.out' }, 0.08);
  tl.fromTo($$('.in', el), { opacity: 0, y: 50, rotationX: -32, transformPerspective: 900, transformOrigin: '50% 0%' },
    { opacity: 1, y: 0, rotationX: 0, duration: 0.8, stagger: 0.085, ease: 'power3.out' }, 0.3);
  tl.fromTo($$('.foot', el), { opacity: 0 }, { opacity: 1, duration: 0.6 }, 0.6);
  tl.fromTo($$('.viz:not(.screen)', el), { opacity: 0 }, { opacity: 1, duration: 0.8 }, 0);
  $$('.count', el).forEach((c) => {
    const to = +c.dataset.to;
    const o = { v: 0 };
    c.textContent = '0';
    tl.fromTo(o, { v: 0 }, { v: to, duration: 1.3, ease: 'power2.out', onUpdate: () => { c.textContent = Math.round(o.v); } }, 0.5);
  });
  return tl;
}

// ---------------------------------------------------------------- navigation
function go(i) {
  if (i < 0 || i >= N || i === cur) return;
  if (busy) busy.progress(1);
  const prev = cur;
  cur = i;
  const d = prev < 0 || i > prev ? 1 : -1;
  const A = prev >= 0 ? slides[prev] : null;
  const B = slides[i];
  const sa = prev >= 0 ? scenes[prev] : null;
  const sb = scenes[i];
  const master = gsap.timeline();
  if (A) {
    const kids = [...A.children].filter((c) => !c.classList.contains('screen'));
    master.to(kids, { opacity: 0, y: -26, duration: 0.32, stagger: 0.02, ease: 'power2.in' }, 0);
    master.add(sa.exit(d, sb.name), 0);
  }
  B.classList.add('on');
  gsap.set([...B.children], { opacity: 1, y: 0 });
  live.add(i);
  sb.t0 = t;
  fitScene(i);
  const enterAt = A ? 0.32 : 0;
  master.add(sb.enter(d, sa ? sa.name : null), enterAt);
  enterContent(B, enterAt + 0.5);
  master.eventCallback('onComplete', () => {
    if (A && prev !== cur) {
      A.classList.remove('on');
      live.delete(prev);
      gsap.set([...A.children], { clearProps: 'opacity,transform' });
    }
    busy = null;
  });
  busy = master;
  updateChrome();
}
const next = () => { if (started) go(cur + 1); };
const prev = () => { if (started) go(cur - 1); };

function updateChrome() {
  $('#bNum').textContent = `${cur + 1} / ${N}`;
  gsap.to('#progress i', { width: `${((cur + 1) / N) * 100}%`, duration: 0.8, ease: 'power2.out' });
  $('#notesWho').textContent = `שקופית ${cur + 1} · ${slides[cur].dataset.who}`;
  $('#notesText').textContent = NOTES[cur];
  if (!CAPTURE) history.replaceState(null, '', '#' + (cur + 1));
}

// ---------------------------------------------------------------- BAC demo
function setBac(v) {
  bac = clamp(v, 0, 0.15);
  $('#bac').value = bac;
  $('#bacVal').textContent = bac.toFixed(2) + '%';
  let txt = BAC_TEXT[0][1];
  for (const [th, tx] of BAC_TEXT) if (bac >= th - 1e-6) txt = tx;
  $('#bacText').textContent = txt;
}
function startDemo(delay = 0) {
  if (demo) demo.kill();
  const o = { v: 0 };
  setBac(0);
  demo = gsap.timeline({ repeat: -1, delay, repeatDelay: 0.8 })
    .to(o, { v: 0.15, duration: 6, ease: 'power1.in', onUpdate: () => setBac(o.v) })
    .to(o, { v: 0, duration: 2.4, delay: 1.6, ease: 'power2.inOut', onUpdate: () => setBac(o.v) });
}

// ---------------------------------------------------------------- UI
function wireUI() {
  $('#bNext').onclick = (e) => { e.stopPropagation(); next(); };
  $('#bPrev').onclick = (e) => { e.stopPropagation(); prev(); };
  $('#bFull').onclick = (e) => { e.stopPropagation(); toggleFull(); };
  $('#bNotes').onclick = (e) => { e.stopPropagation(); $('#notes').classList.toggle('show'); };
  $('#bac').addEventListener('input', (e) => { if (demo) demo.kill(); setBac(+e.target.value); });
  $('#playBtn').onclick = (e) => { e.stopPropagation(); window.open('/game/', '_blank'); };
  $('#startBtn').onclick = (e) => { e.stopPropagation(); start(true); };
  addEventListener('keydown', (e) => {
    const k = e.key;
    if (e.target.tagName === 'INPUT') e.target.blur();
    if (!started) { if (k === 'Enter' || k === ' ') { e.preventDefault(); start(true); } return; }
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) { e.preventDefault(); next(); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); prev(); }
    else if (k === 'Home') go(0);
    else if (k === 'End') go(N - 1);
    else if (k === 'f' || k === 'F' || k === 'כ') toggleFull();
    else if (k === 'n' || k === 'N' || k === 'מ') $('#notes').classList.toggle('show');
    else if (k === 'b' || k === 'B' || k === '.' || k === 'נ') $('#black').classList.toggle('on');
    else if (k === 'Escape') $('#black').classList.remove('on');
  });
  addEventListener('pointerdown', (e) => {
    if (!started || e.button !== 0) return;
    if (e.target.closest('#bar, #notes, button, input, [data-nonav], #start')) return;
    if ($('#black').classList.contains('on')) { $('#black').classList.remove('on'); return; }
    next();
  });
  addEventListener('contextmenu', (e) => { if (started) { e.preventDefault(); prev(); } });
  let hideT = 0;
  addEventListener('pointermove', (e) => {
    par.tx = (e.clientX / innerWidth) * 2 - 1;
    par.ty = (e.clientY / innerHeight) * 2 - 1;
    $('#bar').classList.add('show');
    clearTimeout(hideT);
    hideT = setTimeout(() => $('#bar').classList.remove('show'), 2400);
  });
}
function toggleFull() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.();
}

function start(user) {
  if (started) return;
  started = true;
  if (user && !CAPTURE && !Q.has('nofs')) document.documentElement.requestFullscreen?.().catch(() => {});
  $('#start').classList.add('gone');
  const at = Math.min(N, Math.max(1, parseInt((location.hash || '#1').slice(1), 10) || 1)) - 1;
  slides[0].classList.remove('on');
  live.clear();
  go(at);
}

// ---------------------------------------------------------------- loop
function resize(w, h, pr) {
  stageScale = Math.min(w / 1920, h / 1080);
  quality = pr / Math.min(window.devicePixelRatio || 1, 1.25);
  document.documentElement.style.setProperty('--s', stageScale.toFixed(4));
  MAIN.r.setPixelRatio(clamp(stageScale * Math.min(window.devicePixelRatio || 1, 2) * quality, 0.35, 2));
  MAIN.r.setSize(W, H, false);
  for (const i of live) fitScene(i);
}

function update(dt) {
  t += dt;
  draw(dt);
}

function driftOrbs() {
  gsap.to('#bg .orb.o1', { x: -120, y: 80, duration: 9, yoyo: true, repeat: -1, ease: 'sine.inOut' });
  gsap.to('#bg .orb.o2', { x: 140, y: -70, duration: 11, yoyo: true, repeat: -1, ease: 'sine.inOut' });
  // faint headlight / taillight trails streaking across the background, like a long-exposure night road
  const box = $('#trails');
  // kept to the top and bottom edges so they never cross the text
  const lanes = [[18, 'w', -1], [40, 'r', 1], [1050, 'r', 1], [1068, 'w', -1]];
  lanes.forEach(([y, kind, dir], k) => {
    for (let j = 0; j < 2; j++) {
      const el = document.createElement('i');
      el.className = `trail ${kind}`;
      el.style.top = `${y + j * 6}px`;
      const len = 260 + ((k * 7 + j * 3) % 5) * 70;
      el.style.width = `${len}px`;
      box.appendChild(el);
      const from = dir > 0 ? -len - 40 : W + 40, to = dir > 0 ? W + 40 : -len - 40;
      const dur = 5.5 + ((k * 3 + j) % 4) * 1.3;
      gsap.timeline({ repeat: -1, delay: k * 1.1 + j * 2.4, repeatDelay: 1.5 + ((k + j) % 3) })
        .fromTo(el, { x: from, opacity: 0 }, { x: to, duration: dur, ease: 'none' })
        .to(el, { opacity: 0.32, duration: dur * 0.25, ease: 'sine.out' }, 0)
        .to(el, { opacity: 0, duration: dur * 0.25, ease: 'sine.in' }, dur * 0.75);
    }
  });
}

async function boot() {
  const fill = $('#loader .fill');
  // the 3D labels and screens are drawn with these fonts, so they must be ready first
  await Promise.all(['700 64px Karantina', '800 64px Assistant', '600 30px Assistant'].map((f) => document.fonts.load(f).catch(() => {})));
  await loadModels(MODELS, (p) => { fill.style.width = `${Math.round(p * 100)}%`; });
  slides.forEach((el, i) => {
    $$('.title', el).forEach(splitWords);
    scenes[i] = BUILD[vizEls[i].dataset.scene](i);
  });
  wireUI();
  setBac(0);
  driftOrbs();
  const fake = { setPixelRatio() {}, setSize() {} };
  runLoop({ renderer: fake, update, resize });
  scenes.forEach((s, i) => { fitScene(i); (s.drv ? DRV : MAIN).r.compile(s.scene, s.cam); });
  // slide 1 waits behind the start screen
  slides[0].classList.add('on');
  live.add(0);
  scenes[0].t0 = 0;
  $('#loader').classList.add('done');
  window.__pres = { go, next, prev, setBac, start, scenes, get cur() { return cur; } };
  window.__ready = true;
  if (CAPTURE) { $('#loader').style.display = 'none'; $('#start').style.display = 'none'; }
  if (CAPTURE || Q.has('autostart')) start(false);
}
boot();
