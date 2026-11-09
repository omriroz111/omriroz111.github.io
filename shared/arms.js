// Forearms for the first-person cockpit. The hands are part of the steering wheel model (they turn
// with it); each forearm is stretched every frame from its wrist down to a fixed shoulder point
// below the camera, so the arms follow the hands as the wheel turns.
import * as THREE from 'three';
import { find } from './assets.js';
import { weave } from './textures.js';

// shoulders in cockpit space (x right, y up, z toward the back of the car); well below the eye
const SHOULDER = { l: new THREE.Vector3(-0.66, 0.62, 0.42), r: new THREE.Vector3(-0.08, 0.62, 0.42) };
const UP = new THREE.Vector3(0, 1, 0);

export function armRig(ck, { sleeve = '#2e3a5c' } = {}) {
  const wrists = { l: find(ck, 'wrist_l'), r: find(ck, 'wrist_r') };
  if (!wrists.l || !wrists.r) return () => {};
  let skinMat = null;
  find(ck, 'hand_l').traverse((o) => { if (o.isMesh && !skinMat && o.material.name === 'Skin') skinMat = o.material; });
  // the cabin light sits right above the hands: a slightly deeper, less shiny skin keeps them from looking plastic
  skinMat = skinMat.clone();
  skinMat.color.multiplyScalar(0.8);
  skinMat.roughness = 0.62;
  for (const k of ['hand_l', 'hand_r']) find(ck, k).traverse((o) => { if (o.isMesh && o.material.name === 'Skin') o.material = skinMat; });
  const wv = weave().clone();
  wv.repeat.set(9, 12);
  const sleeveMat = new THREE.MeshStandardMaterial({ color: sleeve, roughness: 0.88, bumpMap: wv, bumpScale: 1.2 });
  const cuffMat = new THREE.MeshStandardMaterial({ color: '#b9bec8', roughness: 0.8 });
  // unit-length pieces along +Y, scaled to the wrist-shoulder distance each frame
  const sleeveGeo = new THREE.CylinderGeometry(0.066, 0.046, 1, 18, 1, true);
  sleeveGeo.translate(0, 0.5, 0);
  const forearmGeo = new THREE.CylinderGeometry(0.04, 0.031, 0.13, 14);
  forearmGeo.translate(0, 0.065, 0);
  const cuffGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.035, 18);
  const parts = {};
  for (const k of ['l', 'r']) {
    const arm = new THREE.Mesh(forearmGeo, skinMat);
    const sl = new THREE.Mesh(sleeveGeo, sleeveMat);
    const cuff = new THREE.Mesh(cuffGeo, cuffMat);
    ck.add(arm, sl, cuff);
    parts[k] = { arm, sl, cuff };
  }
  const w = new THREE.Vector3(), dir = new THREE.Vector3(), q = new THREE.Quaternion(), p = new THREE.Vector3();
  return function update() {
    ck.updateMatrixWorld(true);
    for (const k of ['l', 'r']) {
      wrists[k].getWorldPosition(w);
      ck.worldToLocal(w);
      dir.subVectors(SHOULDER[k], w);
      const len = dir.length();
      dir.normalize();
      q.setFromUnitVectors(UP, dir);
      const { arm, sl, cuff } = parts[k];
      arm.position.copy(w); arm.quaternion.copy(q);
      p.copy(w).addScaledVector(dir, 0.12);
      cuff.position.copy(p); cuff.quaternion.copy(q);
      sl.position.copy(p); sl.quaternion.copy(q);
      sl.scale.set(1, Math.max(0.01, len - 0.12), 1);
    }
  };
}
