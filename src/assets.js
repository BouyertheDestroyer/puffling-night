import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const base = 'assets/';
const tl = new THREE.TextureLoader();
const gl = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

export const A = { tex: {}, models: {}, hdr: null };
let maxAniso = 8;
export function setAniso(n) { maxAniso = n; }

function loadTex(url, srgb) {
  return new Promise((res, rej) => tl.load(url, t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    res(t);
  }, undefined, rej));
}

export const TEXTURES = ['asphalt_02', 'concrete_pavement', 'corrugated_iron_02', 'aerial_grass_rock', 'cliff_side',
  'coast_sand_rocks_02', 'white_plaster_rough_01', 'wood_planks_grey', 'dark_rock', 'gravel_road'];
export const MODELS = ['cardboard_box_01', 'street_lamp_01', 'stone_fire_pit', 'metal_trash_can',
  'painted_wooden_bench', 'lifebuoy', 'rock_moss_set_01', 'utility_box_01', 'fire_hydrant', 'coast_rocks_01', 'ocean_buoy'];

export async function loadAll(onProgress = () => {}) {
  const jobs = [];
  for (const id of TEXTURES) {
    A.tex[id] = {};
    jobs.push(loadTex(`${base}tex/${id}_diff.webp`, true).then(t => (A.tex[id].map = t)));
    jobs.push(loadTex(`${base}tex/${id}_nor.webp`, false).then(t => (A.tex[id].normalMap = t)));
    jobs.push(loadTex(`${base}tex/${id}_arm.webp`, false).then(t => (A.tex[id].arm = t)));
  }
  for (const id of MODELS) jobs.push(gl.loadAsync(`${base}models/${id}.glb`).then(g => (A.models[id] = g.scene)));
  jobs.push(new RGBELoader().loadAsync(`${base}rogland_clear_night_1k.hdr`).then(t => (A.hdr = t)));
  let done = 0;
  await Promise.all(jobs.map(j => j.then(() => onProgress(++done / jobs.length))));
  return A;
}

// A PBR material from a Poly Haven texture set. arm = AO / roughness / metalness packed.
export function pbr(id, opts = {}) {
  const t = A.tex[id];
  const m = new THREE.MeshStandardMaterial({
    map: t.map, normalMap: t.normalMap, roughnessMap: t.arm, metalnessMap: opts.metal ? t.arm : null,
    aoMap: null, roughness: opts.roughness ?? 1, metalness: opts.metalness ?? 0, color: opts.color ?? 0xffffff,
    vertexColors: !!opts.vertexColors, normalScale: new THREE.Vector2(opts.normal ?? 1, opts.normal ?? 1),
  });
  return m;
}

// Clone a loaded model, scaled so its height is h (if given), sitting on y=0.
export function model(id, h) {
  const src = A.models[id];
  const o = src.clone(true);
  const box = new THREE.Box3().setFromObject(o);
  const s = h ? h / (box.max.y - box.min.y) : 1;
  o.scale.setScalar(s);
  o.position.y = -box.min.y * s;
  const g = new THREE.Group(); g.add(o);
  g.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  return g;
}

// Quantized (meshopt) attributes -> plain float, so transforms don't clamp.
export function toFloat(src) {
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(src.attributes)) {
    const n = a.count, k = a.itemSize, arr = new Float32Array(n * k);
    for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) arr[i * k + j] = a.getComponent(i, j);
    g.setAttribute(name, new THREE.BufferAttribute(arr, k));
  }
  if (src.index) g.setIndex(Array.from(src.index.array));
  return g;
}

// Single merged geometry+material from a model (for instancing).
export function modelMeshes(id, h) {
  const o = A.models[id];
  o.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(o);
  const s = h ? h / (box.max.y - box.min.y) : 1;
  const out = [];
  o.traverse(c => {
    if (!c.isMesh) return;
    const g = toFloat(c.geometry);
    g.applyMatrix4(c.matrixWorld);
    g.translate(0, -box.min.y, 0);
    g.scale(s, s, s);
    out.push({ geometry: g, material: c.material });
  });
  return out;
}
