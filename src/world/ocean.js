import * as THREE from 'three';
import { WORLD } from './layout.js';

// A tileable wave normal map, generated from integer-frequency sine waves.
function waveNormalTexture(n = 256) {
  const h = new Float32Array(n * n);
  const waves = [];
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 40; i++) {
    const fx = Math.round((rnd() * 2 - 1) * (2 + i * 0.6)), fy = Math.round((rnd() * 2 - 1) * (2 + i * 0.6));
    if (!fx && !fy) continue;
    waves.push([fx, fy, 1 / Math.pow(Math.hypot(fx, fy), 1.2), rnd() * 6.28]);
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let s = 0;
    for (const [fx, fy, a, p] of waves) s += a * Math.sin((fx * x + fy * y) / n * 2 * Math.PI + p);
    h[y * n + x] = s;
  }
  const data = new Uint8Array(n * n * 4);
  const k = 1.6;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = h[y * n + ((x + 1) % n)] - h[y * n + ((x - 1 + n) % n)];
    const dy = h[((y + 1) % n) * n + x] - h[((y - 1 + n) % n) * n + x];
    const nx = -dx * k, ny = -dy * k, nz = 1, l = Math.hypot(nx, ny, nz), o = (y * n + x) * 4;
    data[o] = (nx / l * 0.5 + 0.5) * 255; data[o + 1] = (ny / l * 0.5 + 0.5) * 255; data[o + 2] = (nz / l * 0.5 + 0.5) * 255; data[o + 3] = 255;
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

export function buildOcean(heightTex) {
  // a radial grid: dense near the middle, coarse towards the horizon
  const rings = 90, segs = 160, rMax = 9000;
  const pos = [], idx = [];
  pos.push(0, 0, 0);
  for (let i = 1; i <= rings; i++) {
    const r = Math.pow(i / rings, 2.6) * rMax;
    for (let j = 0; j < segs; j++) { const a = j / segs * Math.PI * 2; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); }
  }
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 1; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = 1 + (i - 1) * segs + j, b = 1 + (i - 1) * segs + ((j + 1) % segs), c = a + segs, d = b + segs;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();

  const nt = waveNormalTexture();
  const uniforms = {
    uTime: { value: 0 }, tWave: { value: nt }, tHeight: { value: heightTex },
    uWorld: { value: new THREE.Vector4(WORLD.minX, WORLD.minZ, WORLD.maxX - WORLD.minX, WORLD.maxZ - WORLD.minZ) },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0x0a1820, roughness: 0.06, metalness: 0.0, envMapIntensity: 0.35 });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime; varying vec3 vWP;
vec3 gerst(vec2 p, vec2 dir, float L, float A, float spd, inout vec3 nrm){
  float k = 6.2831/L; float f = k*(dot(dir,p) - spd*uTime);
  nrm.x -= dir.x * k*A*cos(f); nrm.z -= dir.y * k*A*cos(f);
  return vec3(0.0, A*sin(f), 0.0);
}`)
      .replace('#include <begin_vertex>', `
vec4 wp0 = modelMatrix * vec4(position, 1.0);
vec3 nrmW = vec3(0.0, 1.0, 0.0);
vec3 transformed = position;
float fade = 1.0 - smoothstep(300.0, 1500.0, length(wp0.xz - cameraPosition.xz));
transformed += fade * gerst(wp0.xz, normalize(vec2(0.8, 0.3)), 38.0, 0.35, 6.0, nrmW);
transformed += fade * gerst(wp0.xz, normalize(vec2(0.6, -0.5)), 21.0, 0.18, 4.5, nrmW);
transformed += fade * gerst(wp0.xz, normalize(vec2(0.95, 0.1)), 11.0, 0.08, 3.2, nrmW);
`)
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWP = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime; uniform sampler2D tWave, tHeight; uniform vec4 uWorld; varying vec3 vWP;
vec3 oN; float oDepth;`)
      .replace('#include <map_fragment>', `
vec2 huv = (vWP.xz - uWorld.xy) / uWorld.zw;
float ground = (huv.x>0.0 && huv.x<1.0 && huv.y>0.0 && huv.y<1.0) ? texture2D(tHeight, huv).r : -30.0;
oDepth = max(0.0, vWP.y - ground);
float dist = length(vWP - cameraPosition);
vec2 p1 = vWP.xz / 23.0 + vec2(uTime * 0.020, uTime * 0.006);
vec2 p2 = vWP.xz / 7.3 + vec2(-uTime * 0.017, uTime * 0.028);
vec2 p3 = vWP.xz / 2.1 + vec2(uTime * 0.05, -uTime * 0.03);
vec3 w = (texture2D(tWave, p1).xyz*2.0-1.0) + (texture2D(tWave, p2).xyz*2.0-1.0)*0.8 + (texture2D(tWave, p3).xyz*2.0-1.0) * 0.5 * (1.0 - smoothstep(20.0, 120.0, dist));
float flat0 = smoothstep(150.0, 2500.0, dist);
oN = normalize(vec3(w.x, 0.0, -w.y) * mix(0.55, 0.18, flat0) + vec3(0.0, 1.0, 0.0));
vec3 deep = vec3(0.006, 0.020, 0.028), shallow = vec3(0.03, 0.08, 0.075);
diffuseColor.rgb = mix(shallow, deep, smoothstep(0.0, 9.0, oDepth));
// foam where the water meets the land
float foamN = texture2D(tWave, vWP.xz/4.0 + uTime*0.03).r;
float foam = smoothstep(1.4, 0.0, oDepth + (foamN - 0.5) * 1.5) * (0.55 + 0.45*sin(uTime*0.9 + vWP.x*0.15 + vWP.z*0.1));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.6, 0.62), clamp(foam, 0.0, 1.0) * 0.75);
`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.6, clamp(foam,0.0,1.0)) + flat0*0.05;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(oN, 0.0)).xyz);');
  };
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.name = 'ocean';
  mesh.update = (camera, t) => {
    uniforms.uTime.value = t;
    // snap so the waves don't swim with the camera
    mesh.position.set(Math.round(camera.position.x / 20) * 20, 0, Math.round(camera.position.z / 20) * 20);
  };
  return mesh;
}
