import * as THREE from 'three';
import { height, normalAt, shoreS, cliffT } from './layout.js';
import { rng } from '../noise.js';

// Instanced grass tufts on the open ground around the camera, rebuilt as the camera moves.
function bladeTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 26; i++) {
    const x = 8 + Math.random() * 112, h = 50 + Math.random() * 76, lean = (Math.random() - 0.5) * 30;
    const shade = 70 + Math.random() * 60;
    g.strokeStyle = `rgb(${shade * 0.75},${shade},${shade * 0.45})`;
    g.lineWidth = 2 + Math.random() * 2.5;
    g.beginPath(); g.moveTo(x, 128); g.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.6, x + lean, 128 - h); g.stroke();
  }
  // keep grass colour under the transparent pixels so mipmaps don't fade to black
  const img = g.getImageData(0, 0, 128, 128), d = img.data;
  const out = new Uint8Array(128 * 128 * 4);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const i = (y * 128 + x) * 4, o = ((127 - y) * 128 + x) * 4, a = d[i + 3];
    const k = a > 0 ? 255 / a : 0;
    out[o] = a > 8 ? Math.min(255, d[i] * k) : 82; out[o + 1] = a > 8 ? Math.min(255, d[i + 1] * k) : 104; out[o + 2] = a > 8 ? Math.min(255, d[i + 2] * k) : 50;
    out[o + 3] = a;
  }
  const t = new THREE.DataTexture(out, 128, 128, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

export function buildGrass(L, terrain) {
  // a tuft: three crossed quads
  const quads = [];
  for (let k = 0; k < 3; k++) {
    const q = new THREE.PlaneGeometry(0.6, 0.34, 1, 2); q.translate(0, 0.17, 0); q.rotateY(k * Math.PI / 3);
    quads.push(q);
  }
  const geo = new THREE.BufferGeometry();
  {
    const pos = [], uv = [], nrm = [], idx = []; let base = 0;
    for (const q of quads) {
      const p = q.attributes.position, u = q.attributes.uv;
      for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); uv.push(u.getX(i), u.getY(i)); nrm.push(0, 1, 0); }
      for (let i = 0; i < q.index.count; i++) idx.push(q.index.getX(i) + base);
      base += p.count;
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setIndex(idx);
  }
  const uniforms = { uTime: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({ map: bladeTexture(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.85, color: 0xc8c890 });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 ip = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float sway = sin(uTime * 1.7 + ip.x * 0.35 + ip.z * 0.21) * 0.08 + sin(uTime * 3.1 + ip.x) * 0.03;
        transformed.x += sway * transformed.y * 2.0; transformed.z += sway * 0.6 * transformed.y * 2.0;`);
    // both faces of a tuft are lit like the ground beneath it
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
  };
  const MAX = 9000;
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.count = 0; mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.name = 'grass';
  // tufts are found per 24 m chunk on a fixed jittered lattice, cached, and a few chunks are worked
  // out per frame so moving fast never stalls a frame
  const CELL = 0.7, RADIUS = 30, CHUNK = 24;
  const chunks = new Map(), queue = [];
  const hash = (i, j) => { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const d = new THREE.Object3D();
  function computeChunk(ci, cj) {
    const list = [];
    const x0 = ci * CHUNK, z0 = cj * CHUNK, n = Math.round(CHUNK / CELL);
    const sample = terrain.userData.sample;
    const ccx = x0 + CHUNK / 2, ccz = z0 + CHUNK / 2;
    // whole chunk is sea or far beach: skip quickly
    if (shoreS(ccx, ccz) < -20) return new Float32Array(0);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const i = Math.round(x0 / CELL) + a, j = Math.round(z0 / CELL) + b;
      const h1 = hash(i, j), h2 = hash(j + 7, i - 3), h3 = hash(i * 3 + 1, j * 5 - 2);
      if (h3 < 0.35) continue;
      const px = (i + h1) * CELL, pz = (j + h2) * CELL;
      const y = sample(px, pz);
      if (y < 1.2) continue;
      const sl = Math.abs(sample(px + 0.8, pz) - y) + Math.abs(sample(px, pz + 0.8) - y);
      if (sl > 0.45) continue; // rock
      if (shoreS(px, pz) < 20 && cliffT(pz) < 0.5) continue; // beach
      if (L.roadDist(px, pz, 6).d < L.SIDEWALK + 0.3) continue;
      d.position.set(px, y - 0.03, pz);
      d.rotation.set(0, h1 * 6.28, 0);
      const s = 0.6 + h2 * 0.7;
      d.scale.set(s, s * (0.7 + h3 * 0.7), s);
      d.updateMatrix();
      list.push(...d.matrix.elements, px, pz);
    }
    return new Float32Array(list);
  }
  let lastKey = '';
  function assemble(x, z) {
    let n = 0;
    const arr = mesh.instanceMatrix.array;
    const ci0 = Math.floor((x - RADIUS) / CHUNK), ci1 = Math.floor((x + RADIUS) / CHUNK);
    const cj0 = Math.floor((z - RADIUS) / CHUNK), cj1 = Math.floor((z + RADIUS) / CHUNK);
    for (let ci = ci0; ci <= ci1; ci++) for (let cj = cj0; cj <= cj1; cj++) {
      const c = chunks.get(ci + ',' + cj); if (!c) continue;
      for (let k = 0; k < c.length && n < MAX; k += 18) {
        const px = c[k + 16], pz = c[k + 17];
        if ((px - x) ** 2 + (pz - z) ** 2 > RADIUS * RADIUS) continue;
        arr.set(c.subarray(k, k + 16), n * 16); n++;
      }
    }
    mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
  }
  let ax = Infinity, az = Infinity;
  mesh.update = (camPos, t) => {
    uniforms.uTime.value = t;
    const ci0 = Math.floor((camPos.x - RADIUS) / CHUNK), ci1 = Math.floor((camPos.x + RADIUS) / CHUNK);
    const cj0 = Math.floor((camPos.z - RADIUS) / CHUNK), cj1 = Math.floor((camPos.z + RADIUS) / CHUNK);
    let built = 0, missing = false;
    for (let ci = ci0; ci <= ci1; ci++) for (let cj = cj0; cj <= cj1; cj++) {
      const key = ci + ',' + cj;
      if (chunks.has(key)) continue;
      if (built < 1) { chunks.set(key, computeChunk(ci, cj)); built++; } else missing = true;
    }
    if (built || Math.hypot(camPos.x - ax, camPos.z - az) > 4) { ax = camPos.x; az = camPos.z; assemble(ax, az); }
    if (chunks.size > 400) chunks.clear();
  };
  return mesh;
}
