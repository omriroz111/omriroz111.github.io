// Renderer, clock, timers and the main loop shared by the presentation and the game.
// ?capture switches to frame stepping (window.__frame(dt)) so videos can be recorded frame by frame.
import * as THREE from 'three';

export const Q = new URLSearchParams(location.search);
export const CAPTURE = Q.has('capture');

export const clock = { now: 0, timers: [] };

/** run fn after `sec` seconds of app time (works in capture mode too) */
export function after(sec, fn) {
  const t = { at: clock.now + sec, fn, dead: false };
  clock.timers.push(t);
  return () => { t.dead = true; };
}

function runTimers() {
  if (!clock.timers.length) return;
  const due = [];
  clock.timers = clock.timers.filter((t) => {
    if (t.dead) return false;
    if (t.at <= clock.now) { due.push(t); return false; }
    return true;
  });
  for (const t of due) t.fn();
}

export function makeRenderer(canvas, { exposure = 1 } = {}) {
  const r = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: CAPTURE,
  });
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = exposure;
  return r;
}

/**
 * Starts the loop. Keeps the pixel ratio adaptive: if the frame rate drops (weak school PCs),
 * the render resolution steps down until it is smooth again.
 */
export function runLoop({ renderer, update, resize }) {
  const maxPR = Math.min(window.devicePixelRatio || 1, Q.has('hq') ? 2 : 1.25);
  let pr = Q.has('pr') ? +Q.get('pr') : maxPR;
  const fixedPR = Q.has('pr') || CAPTURE;
  const doResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    resize && resize(w, h, pr);
  };
  window.addEventListener('resize', doResize);
  doResize();

  const step = (dt) => {
    if (clock.paused) return;
    clock.now += dt;
    runTimers();
    update(dt);
  };

  if (CAPTURE) {
    window.gsap && gsap.ticker.remove(gsap.updateRoot);
    window.__frame = (dt) => {
      step(dt);
      window.gsap && gsap.updateRoot(clock.now);
    };
    return { get pr() { return pr; } };
  }

  let last = performance.now(), frames = 0, acc = 0, slowStreak = 0;
  const tick = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!document.hidden && !fixedPR) {
      frames++; acc += dt;
      if (acc > 1.5) {
        const fps = frames / acc;
        frames = 0; acc = 0;
        if (fps < 45) slowStreak++; else slowStreak = 0;
        if (slowStreak >= 1 && pr > 0.6) { pr = Math.max(0.6, +(pr - 0.15).toFixed(2)); doResize(); slowStreak = 0; }
        else if (fps > 58 && pr < maxPR) { pr = Math.min(maxPR, +(pr + 0.05).toFixed(2)); doResize(); }
      }
    }
    step(dt);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return { get pr() { return pr; } };
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
