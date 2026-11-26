import * as THREE from 'three';
import { rng } from '../noise.js';

export const MOON_DIR = new THREE.Vector3(-0.86, 0.34, -0.38).normalize();

const NOISE_GLSL = `
float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float fbm2(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5; } return s; }
`;

export function buildSky() {
  const group = new THREE.Group();
  group.name = 'sky';
  const uniforms = {
    uTime: { value: 0 }, uMoonDir: { value: MOON_DIR.clone() }, uAurora: { value: 1.0 },
    uSpin: { value: 0 }, uBright: { value: 1.0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
varying vec3 vDir; uniform float uTime, uAurora, uSpin, uBright; uniform vec3 uMoonDir;
${NOISE_GLSL}
mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0,-s, 0,1,0, s,0,c); }
void main(){
  vec3 d = normalize(vDir);
  float up = max(d.y, 0.0);
  vec3 zen = vec3(0.0012, 0.0024, 0.0075), hor = vec3(0.010, 0.016, 0.030);
  vec3 col = mix(hor, zen, pow(up, 0.45));
  // faint light pollution glow over the town (east, low)
  col += vec3(0.022, 0.012, 0.004) * exp(-max(d.y,0.0)*9.0) * smoothstep(-0.2, 0.9, d.x) * 0.8;
  // milky way band
  vec3 sd = rotY(-uSpin) * d;
  vec3 mwN = normalize(vec3(0.35, 0.55, 0.76));
  float band = exp(-pow(dot(sd, mwN)*4.0, 2.0));
  float mwn = fbm2(sd.xz * 5.0 + vec2(sd.y * 3.1, -sd.y * 2.3));
  col += vec3(0.010, 0.011, 0.014) * band * smoothstep(0.35, 0.8, mwn) * smoothstep(0.0, 0.25, d.y) * 2.0;
  // aurora curtains
  if (d.y > 0.02 && uAurora > 0.0) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 10; i++) {
      float hgt = 1.0 + float(i) * 0.09;
      vec2 p = d.xz / d.y * hgt;
      p = p * 0.22 + vec2(0.0, uTime * 0.008);
      float curtain = fbm2(vec2(p.x * 0.7 + fbm2(p * 0.6 + uTime*0.01) * 1.6, p.y * 0.18));
      float rib = smoothstep(0.52, 0.66, curtain) * (1.0 - smoothstep(0.66, 0.78, curtain));
      float fi = float(i) / 10.0;
      vec3 c = mix(vec3(0.05, 0.9, 0.35), vec3(0.45, 0.15, 0.55), smoothstep(0.4, 1.0, fi));
      acc += c * rib * (1.0 - fi) * 0.06;
    }
    float region = smoothstep(0.03, 0.25, d.y) * smoothstep(-0.6, 0.4, -d.z * 0.7 + d.x * 0.3);
    col += acc * region * uAurora * 0.55;
  }
  // moon halo and disc
  float md = dot(d, normalize(uMoonDir));
  col += vec3(0.16, 0.18, 0.22) * pow(max(md, 0.0), 900.0) * 0.6;
  col += vec3(0.05, 0.06, 0.08) * pow(max(md, 0.0), 60.0) * 0.35;
  float ang = acos(clamp(md, -1.0, 1.0));
  float R = 0.0105;
  if (ang < R) {
    vec3 m = normalize(uMoonDir);
    vec3 t = normalize(cross(m, vec3(0,1,0))), b = cross(t, m);
    vec2 q = vec2(dot(d - m, t), dot(d - m, b)) / R;
    float z = sqrt(max(0.0, 1.0 - dot(q,q)));
    float maria = fbm2(q * 2.3 + 4.0);
    float cr = fbm2(q * 9.0);
    float alb = mix(0.55, 1.0, smoothstep(0.42, 0.6, maria)) * mix(0.85, 1.05, cr);
    float limb = mix(0.6, 1.0, z);
    vec3 mc = vec3(1.0, 0.97, 0.9) * alb * limb * 5.5;
    col = mix(col, mc, smoothstep(1.0, 0.96, length(q)));
  }
  col *= uBright;
  if (d.y < 0.0) col = mix(col, hor * 0.8, smoothstep(0.0, -0.08, d.y));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), mat);
  dome.renderOrder = -10; dome.frustumCulled = false;
  group.add(dome);

  // stars
  const r = rng(77), N = 5200;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), ph = new Float32Array(N);
  const mwN = new THREE.Vector3(0.35, 0.55, 0.76).normalize();
  for (let i = 0; i < N; i++) {
    let v;
    for (;;) { // more stars near the milky way
      v = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1); if (v.lengthSq() > 1 || v.lengthSq() < 0.01) continue; v.normalize();
      if (r() < 0.35 + 0.65 * Math.exp(-((v.dot(mwN) * 3) ** 2))) break;
    }
    pos.set([v.x * 3500, v.y * 3500, v.z * 3500], i * 3);
    const temp = r();
    const c = temp < 0.15 ? [1.0, 0.75, 0.55] : temp < 0.4 ? [1.0, 0.92, 0.8] : temp < 0.85 ? [0.95, 0.97, 1.0] : [0.75, 0.85, 1.0];
    const mag = Math.pow(r(), 9);
    const bright = 0.25 + 4.5 * mag;
    col.set(c.map(x => x * bright), i * 3);
    size[i] = 1.2 + 2.8 * mag;
    ph[i] = r() * 100;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  sg.setAttribute('size', new THREE.BufferAttribute(size, 1));
  sg.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uPix: { value: 1 }, uBright: uniforms.uBright },
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `attribute float size; attribute float phase; attribute vec3 color; varying vec3 vC; uniform float uTime, uPix, uBright;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_Position.z = gl_Position.w * 0.99999;
        vec3 wd = normalize((modelMatrix * vec4(position,1.0)).xyz - cameraPosition);
        float horizon = smoothstep(-0.01, 0.12, wd.y);
        float tw = 0.75 + 0.25 * sin(uTime * (2.0 + mod(phase, 3.0)) + phase);
        vC = color * tw * horizon * uBright; gl_PointSize = size * uPix; }`,
    fragmentShader: `varying vec3 vC; void main(){ vec2 q = gl_PointCoord - 0.5; float d = length(q); float a = exp(-d*d*18.0); if (a < 0.02) discard; gl_FragColor = vec4(vC * a, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  });
  const stars = new THREE.Points(sg, starMat);
  stars.frustumCulled = false; stars.renderOrder = -9;
  group.add(stars);

  group.userData = { uniforms, starMat, stars };
  group.update = (camera, t, pix) => {
    group.position.copy(camera.position);
    uniforms.uTime.value = t;
    starMat.uniforms.uPix.value = pix;
    stars.rotation.y = uniforms.uSpin.value;
  };
  return group;
}
