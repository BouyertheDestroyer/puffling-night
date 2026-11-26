// Shrinks tools/raw/ (from fetch-assets.mjs) into public/assets/.
// Models -> meshopt-compressed .glb with webp textures; textures -> 1024px webp.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import sharp from 'sharp';
import { TEXTURES, MODELS, HDRIS } from './fetch-assets.mjs';

const RAW = path.resolve('tools/raw');
const OUT = path.resolve('public/assets');
await fs.mkdir(`${OUT}/models`, { recursive: true });
await fs.mkdir(`${OUT}/tex`, { recursive: true });

const TEX_SIZE = { cardboard_box_01: 512, lifebuoy: 512, fire_hydrant: 512, ocean_buoy: 512 };
for (const id of MODELS) {
  const out = `${OUT}/models/${id}.glb`;
  const size = TEX_SIZE[id] ?? 1024;
  execSync(`npx gltf-transform optimize "${RAW}/models/${id}/${id}.gltf" "${out}" --compress meshopt --texture-compress webp --texture-size ${size} --simplify-ratio 0.5 --simplify-error 0.002`, { stdio: 'inherit' });
}
for (const id of TEXTURES) {
  for (const m of ['diff', 'nor', 'arm']) {
    await sharp(`${RAW}/tex/${id}/${m}.jpg`).resize(1024, 1024).webp({ quality: m === 'nor' ? 90 : 82 }).toFile(`${OUT}/tex/${id}_${m}.webp`);
  }
}
for (const id of HDRIS) await fs.copyFile(`${RAW}/hdri/${id}_1k.hdr`, `${OUT}/${id}_1k.hdr`);
console.log('optimized');
