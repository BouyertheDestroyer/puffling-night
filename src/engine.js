import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { MOON_DIR } from './world/sky.js';
import { A, setAniso } from './assets.js';

// Renderer, post-processing, environment and the pooled street lights.
export function createEngine(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  setAniso(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 12000);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0.0006);
  scene.fog.color.setRGB(0.008, 0.012, 0.022, THREE.LinearSRGBColorSpace);

  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.6, 0.82);
  composer.addPass(bloom);
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uVig: { value: 0.35 }, uFade: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig, uFade; varying vec2 vUv;
      void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 q = vUv - 0.5; float v = 1.0 - uVig * dot(q, q) * 2.2;
        c.rgb *= v * (1.0 - uFade); gl_FragColor = c; }`,
  });
  composer.addPass(grade);
  composer.addPass(new OutputPass());

  // environment: the night HDRI, dimmed
  const pmrem = new THREE.PMREMGenerator(renderer);
  A.hdr.mapping = THREE.EquirectangularReflectionMapping;
  const envRT = pmrem.fromEquirectangular(A.hdr);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.55;
  scene.environmentRotation = new THREE.Euler(0, 1.2, 0);

  // moonlight
  const moon = new THREE.DirectionalLight(0xaec4ff, 0.7);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  const S = 70;
  Object.assign(moon.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 600 });
  moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.04;
  scene.add(moon, moon.target);
  const hemi = new THREE.HemisphereLight(0x223048, 0x0a0806, 0.25);
  scene.add(hemi);

  // pooled point lights for the nearest street lamps
  const POOL = 14;
  const pool = [];
  for (let i = 0; i < POOL; i++) {
    const l = new THREE.PointLight(0xffb46b, 0, 34, 2);
    l.position.set(0, -100, 0);
    scene.add(l); pool.push(l);
  }
  let lampSources = [];
  const tmp = new THREE.Vector3();
  function setLampSources(list) { lampSources = list; } // [{pos: Vector3, color, intensity}]
  function updateLampPool(focus) {
    const sorted = lampSources
      .map(s => ({ s, d: s.pos.distanceToSquared(focus) }))
      .sort((a, b) => a.d - b.d).slice(0, POOL);
    for (let i = 0; i < POOL; i++) {
      const l = pool[i], e = sorted[i];
      if (!e) { l.intensity = 0; continue; }
      l.position.copy(e.s.pos);
      l.color.setHex(e.s.color ?? 0xffb46b);
      const far = Math.sqrt(e.d);
      l.intensity = (e.s.intensity ?? 60) * (1 - THREE.MathUtils.smoothstep(far, 90, 130));
      l.distance = e.s.distance ?? 34;
    }
  }

  function followShadow(target) {
    tmp.copy(MOON_DIR).multiplyScalar(250);
    const snap = 2;
    const tx = Math.round(target.x / snap) * snap, tz = Math.round(target.z / snap) * snap;
    moon.target.position.set(tx, target.y, tz);
    moon.position.set(tx + tmp.x, target.y + tmp.y, tz + tmp.z);
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  return { renderer, scene, camera, composer, renderPass, bloom, grade, moon, hemi, pool, setLampSources, updateLampPool, followShadow, resize };
}
