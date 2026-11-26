// Debug: render the layout to a PNG (node tools/plot-layout.mjs out.png)
import sharp from 'sharp';
import { buildLayout, height, WORLD, shoreS } from '../src/world/layout.js';
const L = buildLayout();
const N = 600, sc = N / (WORLD.maxX - WORLD.minX);
const px = x => (x - WORLD.minX) * sc, pz = z => (z - WORLD.minZ) * sc;
const img = Buffer.alloc(N * N * 3);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const x = WORLD.minX + i / sc, z = WORLD.minZ + j / sc, h = height(x, z), o = (j * N + i) * 3;
  if (h < 0) { img[o] = 20; img[o + 1] = 40 + h * 2; img[o + 2] = 90 + h * 3; }
  else { const g = Math.min(255, 60 + h * 2.5); img[o] = g * 0.6; img[o + 1] = g; img[o + 2] = g * 0.5; }
}
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${N}" height="${N}">`;
for (const r of L.roads) svg += `<polyline fill="none" stroke="#333" stroke-width="${r.width * sc}" points="${r.pts.map(p => px(p.x) + ',' + pz(p.z)).join(' ')}"/>`;
for (const b of L.buildings) svg += `<rect x="${px(b.x) - b.w * sc / 2}" y="${pz(b.z) - b.d * sc / 2}" width="${b.w * sc}" height="${b.d * sc}" fill="#${b.wall.toString(16).padStart(6, '0')}" transform="rotate(${b.ang * 180 / Math.PI} ${px(b.x)} ${pz(b.z)})"/>`;
for (const l of L.lamps) svg += `<circle cx="${px(l.x)}" cy="${pz(l.z)}" r="1.5" fill="#ffd060"/>`;
svg += `<circle cx="${px(L.lookout.x)}" cy="${pz(L.lookout.z)}" r="5" fill="none" stroke="red" stroke-width="2"/>`;
svg += `<line x1="${px(L.lookout.x)}" y1="${pz(L.lookout.z)}" x2="${px(L.lookout.x + L.lookout.seaDir.x * 40)}" y2="${pz(L.lookout.z + L.lookout.seaDir.z * 40)}" stroke="red"/>`;
svg += `<circle cx="${px(L.carStart.x)}" cy="${pz(L.carStart.z)}" r="4" fill="cyan"/></svg>`;
await sharp(img, { raw: { width: N, height: N, channels: 3 } }).composite([{ input: Buffer.from(svg) }]).png().toFile(process.argv[2]);
console.log('buildings', L.buildings.length, 'lamps', L.lamps.length, 'roads', L.roads.length);
