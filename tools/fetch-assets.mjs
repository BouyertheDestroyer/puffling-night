// Downloads the CC0 assets used by the game from Poly Haven (https://polyhaven.com, CC0)
// into tools/raw/, then tools/optimize-assets.mjs shrinks them into public/assets/.
// Run: node tools/fetch-assets.mjs
import fs from 'node:fs/promises';
import path from 'node:path';

const RAW = path.resolve('tools/raw');
const UA = { 'User-Agent': 'puffling-night-asset-fetch' };

export const TEXTURES = [
  'asphalt_02', 'concrete_pavement', 'corrugated_iron_02', 'aerial_grass_rock',
  'cliff_side', 'coast_sand_rocks_02', 'white_plaster_rough_01', 'wood_planks_grey',
  'dark_rock', 'gravel_road',
];
export const MODELS = [
  'cardboard_box_01', 'street_lamp_01', 'stone_fire_pit', 'metal_trash_can',
  'painted_wooden_bench', 'lifebuoy', 'rock_moss_set_01', 'utility_box_01', 'fire_hydrant',
  'coast_rocks_01', 'ocean_buoy',
];
export const HDRIS = ['rogland_clear_night'];

async function get(url, dest) {
  try { await fs.access(dest); return; } catch {}
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()));
  console.log('got', path.relative(RAW, dest));
}
const files = async id => (await fetch(`https://api.polyhaven.com/files/${id}`, { headers: UA })).json();

for (const id of TEXTURES) {
  const f = await files(id);
  await get(f.Diffuse['1k'].jpg.url, `${RAW}/tex/${id}/diff.jpg`);
  await get(f.nor_gl['1k'].jpg.url, `${RAW}/tex/${id}/nor.jpg`);
  await get((f.arm ?? f.Rough)['1k'].jpg.url, `${RAW}/tex/${id}/arm.jpg`);
}
for (const id of MODELS) {
  const g = (await files(id)).gltf['1k'].gltf;
  await get(g.url, `${RAW}/models/${id}/${id}.gltf`);
  for (const [rel, v] of Object.entries(g.include)) await get(v.url, `${RAW}/models/${id}/${rel}`);
}
for (const id of HDRIS) {
  const f = await files(id);
  await get(f.hdri['1k'].hdr.url, `${RAW}/hdri/${id}_1k.hdr`);
}
console.log('done');
