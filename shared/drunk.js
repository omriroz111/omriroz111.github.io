// "Drunk vision" post effect: double image, blur, sway and tunnel vision, scaled by `amount` (0..1).
// When amount is 0 the scene renders straight to the screen with no extra cost.
import * as THREE from 'three';

export class DrunkPass {
  constructor(renderer) {
    this.renderer = renderer;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { samples: 4, type: THREE.HalfFloatType });
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: this.rt.texture }, amount: { value: 0 }, time: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float amount; uniform float time; varying vec2 vUv;
        void main(){
          float a = amount;
          vec2 c = vUv - 0.5;
          vec2 uv = 0.5 + c * (1.0 - 0.035 * a * (0.5 + 0.5 * sin(time * 0.6)));
          uv += vec2(sin(time * 0.9) * 0.014, sin(time * 0.7 + 1.3) * 0.008) * a;
          float off = 0.022 * a * (0.65 + 0.35 * sin(time * 1.25));
          vec2 dir = vec2(1.0, 0.18);
          float blur = 0.0045 * a;
          vec3 col = vec3(0.0);
          for (int i = -2; i <= 2; i++) {
            vec2 o = vec2(float(i) * blur, float(i) * blur * 0.4);
            col += texture2D(tDiffuse, uv + o + dir * off).rgb * 0.55;
            col += texture2D(tDiffuse, uv + o - dir * off * 0.7).rgb * 0.45;
          }
          col /= 5.0;
          float vig = smoothstep(0.95 - 0.45 * a, 0.2, length(c * vec2(1.15, 1.0)));
          col *= mix(1.0, vig, min(1.0, a * 1.15));
          float l = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(col, vec3(l), 0.25 * a);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.qScene = new THREE.Scene();
    this.qScene.add(this.quad);
    this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h, pr) {
    this.rt.setSize(Math.floor(w * pr), Math.floor(h * pr));
  }

  render(scene, camera, amount, time) {
    const r = this.renderer;
    if (amount < 0.003) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    this.mat.uniforms.amount.value = amount;
    this.mat.uniforms.time.value = time;
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.qScene, this.qCam);
  }
}
