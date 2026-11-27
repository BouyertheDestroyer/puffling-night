import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder, col } from '../geo.js';
import { height, shoreS, cliffT, Grid, HARBOUR, coastX } from './layout.js';
import { A, pbr, modelMeshes } from '../assets.js';
import { rng, fbm } from '../noise.js';
import { buildBoat } from './boats.js';
import { model } from '../assets.js';

// ---------------------------------------------------------------- materials
function windowAtlas() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  const variants = [
    ['#ffcf8a', '#a8642a', 'curtains'], ['#ffe2b0', '#c48a4a', 'lamp'],
    ['#ffd49a', '#7a4a26', 'blinds'], ['#d8e4ff', '#4a5a7a', 'tv'],
  ];
  variants.forEach(([light, dark, kind], i) => {
    const x0 = (i % 2) * 256, y0 = Math.floor(i / 2) * 256;
    const gr = g.createRadialGradient(x0 + 128, y0 + 90, 10, x0 + 128, y0 + 128, 200);
    gr.addColorStop(0, light); gr.addColorStop(1, dark);
    g.fillStyle = gr; g.fillRect(x0, y0, 256, 256);
    if (kind === 'curtains') {
      g.fillStyle = 'rgba(90,30,20,0.85)';
      g.fillRect(x0, y0, 60, 256); g.fillRect(x0 + 196, y0, 60, 256);
      g.fillStyle = 'rgba(0,0,0,0.25)'; for (let k = 0; k < 6; k++) g.fillRect(x0 + 8 + k * 9, y0, 3, 256);
    } else if (kind === 'lamp') {
      g.fillStyle = 'rgba(40,25,15,0.8)'; g.fillRect(x0 + 150, y0 + 170, 70, 86); // furniture
      g.fillStyle = 'rgba(60,40,20,0.7)'; g.beginPath(); g.ellipse(x0 + 70, y0 + 210, 30, 60, 0, 0, 6.3); g.fill(); // plant
    } else if (kind === 'blinds') {
      g.fillStyle = 'rgba(60,35,15,0.45)'; for (let k = 0; k < 16; k++) g.fillRect(x0, y0 + k * 16, 256, 7);
    } else {
      g.fillStyle = 'rgba(20,25,40,0.7)'; g.fillRect(x0 + 40, y0 + 160, 180, 96);
      g.fillStyle = 'rgba(30,20,20,0.85)'; g.beginPath(); g.ellipse(x0 + 128, y0 + 150, 24, 30, 0, 0, 6.3); g.fill();
    }
    // window cross bars
    g.fillStyle = '#eee'; g.fillRect(x0 + 124, y0, 8, 256); g.fillRect(x0, y0 + 96, 256, 8);
    g.fillRect(x0, y0, 256, 6); g.fillRect(x0, y0 + 250, 256, 6); g.fillRect(x0, y0, 6, 256); g.fillRect(x0 + 250, y0, 6, 256);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function darkWindowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#fff'; g.fillRect(61, 0, 6, 128); g.fillRect(0, 46, 128, 6);
  g.fillRect(0, 0, 128, 4); g.fillRect(0, 124, 128, 4); g.fillRect(0, 0, 4, 128); g.fillRect(124, 0, 4, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function townMaterials() {
  const wall = pbr('corrugated_iron_02', { vertexColors: true, roughness: 0.9 });
  const lumTrick = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
      #ifdef USE_MAP
        vec4 tc = texture2D(map, vMapUv);
        float lum = dot(tc.rgb, vec3(0.3, 0.59, 0.11));
        diffuseColor.rgb *= clamp(lum * 3.2, 0.25, 1.25);
      #endif`);
  };
  wall.onBeforeCompile = lumTrick;
  const roof = pbr('corrugated_iron_02', { vertexColors: true, roughness: 0.55, normal: 0.7 });
  roof.onBeforeCompile = lumTrick;
  const plaster = pbr('white_plaster_rough_01', { vertexColors: true });
  const trim = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, vertexColors: true });
  const concrete = pbr('white_plaster_rough_01', { vertexColors: true });
  const glassDarkTex = darkWindowTex();
  const glassDark = new THREE.MeshStandardMaterial({ color: 0x080a0e, roughness: 0.05, metalness: 0.0, emissive: 0x222222, emissiveMap: glassDarkTex, emissiveIntensity: 0.15 });
  const glassLit = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.08, emissive: 0xffffff, emissiveMap: windowAtlas(), emissiveIntensity: 1.5 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.42, metalness: 0.85 });
  const lampLens = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffc785, emissiveIntensity: 9 });
  const wood = pbr('wood_planks_grey', { roughness: 0.9 });
  return { wall, roof, plaster, trim, concrete, glassDark, glassLit, metal, lampLens, wood };
}

// ---------------------------------------------------------------- buildings
function buildHouse(B, b, r) {
  const { w, d } = b;
  const H0 = b.baseY, floorH = b.type === 'block' ? 2.9 : 2.7;
  const H = H0 + b.floors * floorH + (b.type === 'shed' ? 3.5 : 0.3);
  const wallCol = col(b.wall), roofCol = col(b.roof), white = col(0xf4f2ec);
  const W = (b.type === 'block' || (b.type === 'house' && r.chance(0.18))) ? B.plaster : B.wall;
  const hw = w / 2, hd = d / 2;
  const front = -(b.side ?? 1); // local z sign of the street-facing wall
  // foundation
  B.concrete.box(0, (b.minY - 0.4 + H0) / 2, 0, w + 0.3, H0 - b.minY + 0.4, d + 0.3, col(0x9a9a96), { noBottom: true });
  // walls
  W.quad([-hw, H0, hd], [hw, H0, hd], [hw, H, hd], [-hw, H, hd], wallCol, [r() * 3, 0], 2.4);
  W.quad([hw, H0, -hd], [-hw, H0, -hd], [-hw, H, -hd], [hw, H, -hd], wallCol, [r() * 3, 0], 2.4);
  W.quad([hw, H0, hd], [hw, H0, -hd], [hw, H, -hd], [hw, H, hd], wallCol, [r() * 3, 0], 2.4);
  W.quad([-hw, H0, -hd], [-hw, H0, hd], [-hw, H, hd], [-hw, H, -hd], wallCol, [r() * 3, 0], 2.4);
  // corner boards
  for (const [x, z] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) B.trim.box(x, (H0 + H) / 2, z, 0.18, H - H0, 0.18, white);

  // roof
  const flat = b.type === 'block';
  const pitch = b.type === 'shed' ? 0.22 : b.type === 'church' ? 0.85 : r.range(0.5, 0.72);
  const ov = 0.45;
  if (flat) {
    B.concrete.box(0, H + 0.35, 0, w + 0.2, 0.7, d + 0.2, col(0xb8b6b0));
    B.roof.quad([-hw, H + 0.71, hd], [hw, H + 0.71, hd], [hw, H + 0.71, -hd], [-hw, H + 0.71, -hd], col(0x3a3d40), [0, 0], 2.4);
  } else {
    const rise = (hd + ov) * Math.tan(pitch), ridge = H + hd * Math.tan(pitch), eaveY = ridge - rise;
    const X0 = -hw - ov, X1 = hw + ov;
    B.roof.quad([X1, eaveY, hd + ov], [X1, ridge, 0], [X0, ridge, 0], [X0, eaveY, hd + ov], roofCol, [0, 0], 2.4);
    B.roof.quad([X0, eaveY, -hd - ov], [X0, ridge, 0], [X1, ridge, 0], [X1, eaveY, -hd - ov], roofCol, [0, 0], 2.4);
    // undersides
    B.trim.quad([X0, eaveY - 0.02, hd + ov], [X0, ridge - 0.02, 0], [X1, ridge - 0.02, 0], [X1, eaveY - 0.02, hd + ov], col(0xd8d6d0));
    B.trim.quad([X1, eaveY - 0.02, -hd - ov], [X1, ridge - 0.02, 0], [X0, ridge - 0.02, 0], [X0, eaveY - 0.02, -hd - ov], col(0xd8d6d0));
    // gables
    W.tri([hw, H, hd], [hw, H, -hd], [hw, ridge, 0], wallCol, 2.4);
    W.tri([-hw, H, -hd], [-hw, H, hd], [-hw, ridge, 0], wallCol, 2.4);
    // ridge cap and barge boards
    B.trim.box(0, ridge + 0.04, 0, w + 2 * ov, 0.12, 0.3, roofCol);
    for (const s of [-1, 1]) {
      const len = Math.hypot(hd + ov, rise), a = Math.atan2(rise, hd + ov);
      for (const x of [X0, X1]) {
        const m = new THREE.Matrix4().makeTranslation(x, (ridge + eaveY) / 2 - 0.08, s * (hd + ov) / 2).multiply(new THREE.Matrix4().makeRotationX(s * a));
        const saved = B.trim.M.clone(); B.trim.setMatrix(saved.clone().multiply(m));
        B.trim.box(0, 0, 0, 0.06, 0.24, len, white);
        B.trim.setMatrix(saved);
      }
    }
    if (b.type === 'house' && r.chance(0.4)) B.concrete.box(hw * r.range(-0.5, 0.5), ridge - 0.3, hd * 0.3, 0.6, 2.0, 0.6, col(0xa5a39e));
    b.roofTop = ridge;
  }
  if (flat) b.roofTop = H + 0.7;

  // windows and doors
  const lit = r.chance(b.type === 'shed' ? 0.2 : 0.6);
  const winW = b.type === 'church' ? 0.9 : b.type === 'shed' ? 1.4 : 1.1;
  const winH = b.type === 'church' ? 2.4 : b.type === 'shed' ? 0.8 : 1.25;
  const doorAt = r.range(-0.3, 0.3) * w;
  for (const zs of [-1, 1]) {
    const z = zs * (hd + 0.01);
    const n = Math.max(1, Math.floor(w / (b.type === 'block' ? 2.6 : 2.9)));
    for (let f = 0; f < b.floors; f++) {
      const cy = b.type === 'shed' ? H - 1.2 : H0 + f * floorH + 1.55;
      for (let i = 0; i < n; i++) {
        const x = -hw + (i + 0.5) * w / n;
        if (zs === front && f === 0 && Math.abs(x - doorAt) < 1.3) continue;
        if (b.type === 'shed' && Math.abs(x) < 3.5 && zs === front) continue;
        addWindow(B, x, cy, z, zs, winW, winH, lit && r.chance(0.55), r);
      }
    }
  }
  // gable-end windows on houses
  if (b.type === 'house') for (const xs of [-1, 1]) if (r.chance(0.6)) addWindowX(B, xs * (hw + 0.01), H0 + 1.55, 0, xs, 1.0, 1.2, lit && r.chance(0.5), r);
  // door
  const doorCol = col(r.pick([0x7a3a20, 0x2a3a5a, 0xf2f0ea, 0x3d5a3a, 0x5a2a2a]));
  const fz = front * (hd + 0.04);
  if (b.type === 'shed') {
    B.trim.box(0, H0 + 2.2, fz, 6, 4.4, 0.1, col(0xb0b4b8));
    for (let k = 0; k < 20; k++) B.trim.box(0, H0 + 0.1 + k * 0.22, fz + front * 0.03, 6, 0.04, 0.05, col(0x808488));
  } else {
    B.trim.box(doorAt, H0 + 1.05, fz, 1.1, 2.15, 0.12, doorCol);
    B.trim.box(doorAt, H0 + 2.2, fz, 1.4, 0.14, 0.2, white);
    // steps
    B.concrete.box(doorAt, H0 - 0.1, front * (hd + 0.6), 1.8, 0.35, 1.0, col(0x9a9a96));
  }
  b.doorWorld = { x: doorAt, y: H0 + 2.4, z: front * (hd + 0.9) };
  if (b.type !== 'shed') B.glassLit.box(doorAt, H0 + 2.45, front * (hd + 0.12), 0.22, 0.22, 0.16, white);
}
function addWindow(B, x, cy, z, zs, ww, wh, lit, r) {
  const G = lit ? B.glassLit : B.glassDark;
  const white = col(0xf4f2ec);
  const v = r.int(0, 3), u0 = (v % 2) * 0.5, v0 = 0.5 - Math.floor(v / 2) * 0.5;
  const a = [x - zs * ww / 2, cy - wh / 2, z + zs * 0.02], b = [x + zs * ww / 2, cy - wh / 2, z + zs * 0.02];
  const c = [b[0], cy + wh / 2, b[2]], d = [a[0], cy + wh / 2, a[2]];
  G.quad(a, b, c, d, white, [0, 0], 1, lit ? [u0, v0, 0.5, 0.5] : [0, 0, 1, 1]);
  B.trim.box(x, cy + wh / 2 + 0.06, z, ww + 0.24, 0.12, 0.14, white);
  B.trim.box(x, cy - wh / 2 - 0.06, z + zs * 0.05, ww + 0.3, 0.1, 0.24, white);
  B.trim.box(x - ww / 2 - 0.06, cy, z, 0.12, wh, 0.14, white);
  B.trim.box(x + ww / 2 + 0.06, cy, z, 0.12, wh, 0.14, white);
}
function addWindowX(B, x, cy, z, xs, ww, wh, lit, r) {
  const G = lit ? B.glassLit : B.glassDark;
  const white = col(0xf4f2ec);
  const v = r.int(0, 3), u0 = (v % 2) * 0.5, v0 = 0.5 - Math.floor(v / 2) * 0.5;
  const a = [x + xs * 0.02, cy - wh / 2, z + xs * ww / 2], b = [x + xs * 0.02, cy - wh / 2, z - xs * ww / 2];
  G.quad(a, b, [b[0], cy + wh / 2, b[2]], [a[0], cy + wh / 2, a[2]], white, [0, 0], 1, lit ? [u0, v0, 0.5, 0.5] : [0, 0, 1, 1]);
  B.trim.box(x, cy + wh / 2 + 0.06, z, 0.14, 0.12, ww + 0.24, white);
  B.trim.box(x + xs * 0.05, cy - wh / 2 - 0.06, z, 0.24, 0.1, ww + 0.3, white);
  B.trim.box(x, cy, z - ww / 2 - 0.06, 0.14, wh, 0.12, white);
  B.trim.box(x, cy, z + ww / 2 + 0.06, 0.14, wh, 0.12, white);
}

function buildChurch(B, b, r) {
  buildHouse(B, { ...b, type: 'church' }, r);
  // tower on the street end
  const tx = -b.w / 2 - 1.6, H0 = b.baseY, th = 9.5;
  B.wall.quad([tx - 1.6, H0, 1.6], [tx + 1.6, H0, 1.6], [tx + 1.6, H0 + th, 1.6], [tx - 1.6, H0 + th, 1.6], col(b.wall), [0, 0], 2.4);
  B.wall.quad([tx + 1.6, H0, -1.6], [tx - 1.6, H0, -1.6], [tx - 1.6, H0 + th, -1.6], [tx + 1.6, H0 + th, -1.6], col(b.wall), [0, 0], 2.4);
  B.wall.quad([tx - 1.6, H0, -1.6], [tx - 1.6, H0, 1.6], [tx - 1.6, H0 + th, 1.6], [tx - 1.6, H0 + th, -1.6], col(b.wall), [0, 0], 2.4);
  B.concrete.box(tx, H0 - 0.3, 0, 3.6, 1.0, 3.6, col(0x9a9a96));
  const top = H0 + th, sp = 7.5;
  const roofCol = col(b.roof);
  const P = [[tx - 1.9, top, -1.9], [tx + 1.9, top, -1.9], [tx + 1.9, top, 1.9], [tx - 1.9, top, 1.9]];
  const apex = [tx, top + sp, 0];
  for (let i = 0; i < 4; i++) B.roof.tri(P[(i + 1) % 4], P[i], apex, roofCol, 2.4);
  B.trim.box(tx, top + sp + 0.6, 0, 0.12, 1.4, 0.12, col(0xd8c060));
  B.trim.box(tx, top + sp + 0.85, 0, 0.12, 0.12, 0.7, col(0xd8c060));
  B.trim.box(tx - 1.62, H0 + 1.2, 0, 0.12, 2.4, 1.3, col(0x6a2a1a));
  for (const z of [-1, 1]) addWindow(B, tx, top - 1.6, z * 1.61, z, 0.7, 1.0, true, r);
  addWindowX(B, tx - 1.61, top - 1.6, 0, -1, 0.7, 1.0, true, r);
}

// ---------------------------------------------------------------- roads
function buildRoads(L, mats) {
  const roadB = new GeoBuilder(1), walkB = new GeoBuilder(1);
  const markP = [];
  const grey = col(0xffffff);
  const lift = 0.06;
  const across = [-1, -0.5, 0, 0.5, 1];
  for (const road of L.roads) {
    const pts = road.pts, hw = road.width / 2;
    let dist = 0;
    const rows = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
      const tx = q.x - o.x, tz = q.z - o.z, tl = Math.hypot(tx, tz) || 1;
      const nx = -tz / tl, nz = tx / tl;
      if (i > 0) dist += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
      const row = across.map(a => { const x = p.x + nx * a * hw, z = p.z + nz * a * hw; return [x, height(x, z) + lift + road.id * 0.004, z]; });
      // sidewalk rows: curb top inner, outer
      const sw = [];
      for (const side of [-1, 1]) {
        const xi = p.x + nx * side * hw, zi = p.z + nz * side * hw, xo = p.x + nx * side * (hw + L.SIDEWALK), zo = p.z + nz * side * (hw + L.SIDEWALK);
        const other = Math.min(L.roadDist((xi + xo) / 2, (zi + zo) / 2, 15, road).d, L.roadDist(xo, zo, 15, road).d);
        sw.push({ side, inner: [xi, height(xi, zi) + lift, zi], outer: [xo, height(xo, zo) + 0.18, zo], ok: other > 0.3 && road.name !== 'Vitavegur' });
      }
      // centre line only where we're not in another road
      const inOther = L.roadDist(p.x, p.z, 15, road).d < 1.5;
      rows.push({ row, dist, sw, inOther, nx, nz, p });
    }
    for (let i = 0; i < rows.length - 1; i++) {
      const A0 = rows[i], A1 = rows[i + 1];
      for (let k = 0; k < across.length - 1; k++) {
        const a = A0.row[k], b = A0.row[k + 1], c = A1.row[k + 1], d = A1.row[k];
        const u0 = across[k] * hw, u1 = across[k + 1] * hw;
        // u = metric across, v = metric along
        pushQuadUV(roadB, a, b, c, d, [u0, A0.dist], [u1, A0.dist], [u1, A1.dist], [u0, A1.dist], grey);
      }
      if (road.kind === 'main' && !A0.inOther && !A1.inOther) {
        // dashed centre line
        if (Math.floor(A0.dist / 3) % 2 === 0) markP.push(A0, A1);
      }
      for (let s = 0; s < 2; s++) {
        const S0 = A0.sw[s], S1 = A1.sw[s];
        if (!S0.ok || !S1.ok) continue;
        const up0 = [S0.inner[0], S0.outer[1], S0.inner[2]], up1 = [S1.inner[0], S1.outer[1], S1.inner[2]];
        const flip = S0.side < 0;
        // top
        if (!flip) pushQuadUV(walkB, up0, S0.outer, S1.outer, up1, [0, A0.dist], [2.4, A0.dist], [2.4, A1.dist], [0, A1.dist], grey);
        else pushQuadUV(walkB, S0.outer, up0, up1, S1.outer, [2.4, A0.dist], [0, A0.dist], [0, A1.dist], [2.4, A1.dist], grey);
        // curb face
        const cc = col(0xbdbab2);
        if (!flip) pushQuadUV(walkB, S1.inner, S0.inner, up0, up1, [A1.dist, 0], [A0.dist, 0], [A0.dist, 0.2], [A1.dist, 0.2], cc);
        else pushQuadUV(walkB, S0.inner, S1.inner, up1, up0, [A0.dist, 0], [A1.dist, 0], [A1.dist, 0.2], [A0.dist, 0.2], cc);
      }
    }
  }
  // road markings as thin strips
  const markB = new GeoBuilder(1);
  for (let i = 0; i < markP.length; i += 2) {
    const A0 = markP[i], A1 = markP[i + 1];
    const w = 0.07;
    const f = (R, s) => { const x = R.p.x + R.nx * s, z = R.p.z + R.nz * s; return [x, R.row[2][1] + 0.012, z]; };
    pushQuadUV(markB, f(A0, -w), f(A0, w), f(A1, w), f(A1, -w), [0, 0], [1, 0], [1, 1], [0, 1], col(0xe8e2c8));
  }
  const asph = pbr('asphalt_02', { roughness: 1 });
  asph.map = A.tex.asphalt_02.map.clone(); asph.normalMap = A.tex.asphalt_02.normalMap.clone(); asph.roughnessMap = A.tex.asphalt_02.arm.clone();
  for (const t of [asph.map, asph.normalMap, asph.roughnessMap]) { t.repeat.set(0.22, 0.22); t.needsUpdate = true; }
  asph.polygonOffset = true; asph.polygonOffsetFactor = -1; asph.polygonOffsetUnits = -2;
  asph.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <fog_vertex>', '#include <fog_vertex>\nvWP = (modelMatrix*vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; float wet;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float pn = texture2D(map, vWP.xz/37.0).r * 0.6 + texture2D(map, vWP.xz/11.0 + 0.3).g * 0.4;
        wet = smoothstep(0.38, 0.30, pn);
        diffuseColor.rgb *= mix(0.85, 0.45, wet);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor * 0.7, 0.3, wet);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(mix(normal, normalize(vNormal), wet));`);
  };
  const walkMat = pbr('concrete_pavement', { vertexColors: true });
  walkMat.map = A.tex.concrete_pavement.map.clone(); walkMat.normalMap = A.tex.concrete_pavement.normalMap.clone(); walkMat.roughnessMap = A.tex.concrete_pavement.arm.clone();
  for (const t of [walkMat.map, walkMat.normalMap, walkMat.roughnessMap]) { t.repeat.set(0.4, 0.4); t.needsUpdate = true; }
  walkMat.polygonOffset = true; walkMat.polygonOffsetFactor = -1; walkMat.polygonOffsetUnits = -1;
  const markMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const g = new THREE.Group();
  const rm = new THREE.Mesh(roadB.build(), asph); rm.receiveShadow = true;
  const wm = new THREE.Mesh(walkB.build(), walkMat); wm.receiveShadow = true;
  const mm = new THREE.Mesh(markB.build(), markMat); mm.receiveShadow = true;
  g.add(rm, wm, mm);
  return g;
}
function pushQuadUV(B, a, b, c, d, ua, ub, uc, ud, color) {
  // normal from geometry (up-ish)
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ad = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  let nx = ab[1] * ad[2] - ab[2] * ad[1], ny = ab[2] * ad[0] - ab[0] * ad[2], nz = ab[0] * ad[1] - ab[1] * ad[0];
  if (ny < 0 && Math.abs(ny) > 0.5) { nx = -nx; ny = -ny; nz = -nz; [b, d] = [d, b]; [ub, ud] = [ud, ub]; }
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  B.vert(...a, nx, ny, nz, ...ua, color); B.vert(...b, nx, ny, nz, ...ub, color); B.vert(...c, nx, ny, nz, ...uc, color);
  B.vert(...a, nx, ny, nz, ...ua, color); B.vert(...c, nx, ny, nz, ...uc, color); B.vert(...d, nx, ny, nz, ...ud, color);
}

// ---------------------------------------------------------------- street lamps
function lampGeometry() {
  const parts = [];
  const pole = new THREE.CylinderGeometry(0.07, 0.11, 7.2, 12, 1); pole.translate(0, 3.6, 0); parts.push(pole);
  const base = new THREE.CylinderGeometry(0.16, 0.2, 0.6, 12); base.translate(0, 0.3, 0); parts.push(base);
  // curved arm
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 6.9, 0), new THREE.Vector3(0, 7.6, 0), new THREE.Vector3(1.6, 7.55, 0));
  parts.push(new THREE.TubeGeometry(curve, 12, 0.05, 8, false));
  const head = new THREE.CylinderGeometry(0.32, 0.38, 0.16, 16); head.scale(1.4, 1, 0.8); head.translate(1.75, 7.52, 0); parts.push(head);
  const g = mergeGeometries(parts.map(p => p.toNonIndexed()));
  const lens = new THREE.CylinderGeometry(0.26, 0.26, 0.03, 16); lens.scale(1.4, 1, 0.8); lens.translate(1.75, 7.43, 0);
  return { body: g, lens };
}

// ---------------------------------------------------------------- instancing helpers
// Instances of a model split into spatial chunks so whole chunks are frustum culled.
export function scatter(parent, meshes, transforms, chunk = 160, opts = {}) {
  const groups = new Map();
  for (const m of transforms) {
    const k = Math.floor(m.x / chunk) + ',' + Math.floor(m.z / chunk);
    if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m);
  }
  const out = [];
  const dummy = new THREE.Object3D();
  for (const list of groups.values()) {
    for (const { geometry, material } of meshes) {
      const im = new THREE.InstancedMesh(geometry, material, list.length);
      list.forEach((t, i) => {
        dummy.position.set(t.x, t.y, t.z); dummy.rotation.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0); dummy.scale.setScalar(t.s ?? 1);
        dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
      });
      im.castShadow = opts.cast ?? true; im.receiveShadow = true;
      im.computeBoundingSphere();
      parent.add(im); out.push(im);
    }
  }
  return out;
}

// ---------------------------------------------------------------- the town
export function buildTown(L, E) {
  const r = rng(4242);
  const M = townMaterials();
  const group = new THREE.Group(); group.name = 'town';
  const B = {};
  for (const k of ['wall', 'roof', 'plaster', 'trim', 'concrete', 'glassDark', 'glassLit']) B[k] = new GeoBuilder(2.4);

  const obstacles = new Grid(16); // collision: {type:'box', x,z,hw,hd,ang} or {type:'circle', x,z,r}
  const addBox = (x, z, hw, hd, ang, extra = {}) => {
    const o = { type: 'box', x, z, hw, hd, ang, c: Math.cos(ang), s: Math.sin(ang), ...extra };
    const R = Math.hypot(hw, hd); obstacles.insertAABB(o, x - R, z - R, x + R, z + R); return o;
  };
  const addCircle = (x, z, rad, extra = {}) => { const o = { type: 'circle', x, z, r: rad, ...extra }; obstacles.insertAABB(o, x - rad, z - rad, x + rad, z + rad); return o; };

  const mtx = new THREE.Matrix4();
  for (const b of L.buildings) {
    if (b.type === 'lighthouse') continue;
    let minY = Infinity, maxY = -Infinity;
    const c = Math.cos(b.ang), s = Math.sin(b.ang);
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
      const x = b.x + u * b.w / 2 * c - v * b.d / 2 * s, z = b.z + u * b.w / 2 * s + v * b.d / 2 * c;
      const h = height(x, z); minY = Math.min(minY, h); maxY = Math.max(maxY, h);
    }
    b.minY = minY - b.x * 0; b.baseY = maxY + 0.45;
    // geometry is built in local space with y absolute
    mtx.makeRotationY(-b.ang).setPosition(b.x, 0, b.z);
    for (const k in B) B[k].setMatrix(mtx);
    const br = rng(b.seed);
    if (b.type === 'church') buildChurch(B, b, br); else buildHouse(B, b, br);
    addBox(b.x, b.z, b.w / 2 + 0.15, b.d / 2 + 0.15, b.ang, { building: b });
    if (b.type === 'church') {
      const tx = b.x + c * (-b.w / 2 - 1.6), tz = b.z + s * (-b.w / 2 - 1.6);
      addBox(tx, tz, 1.8, 1.8, b.ang);
    }
  }
  for (const k in B) {
    if (!B[k].count) continue;
    const mesh = new THREE.Mesh(B[k].build(), M[k]);
    mesh.castShadow = !k.startsWith('glass'); mesh.receiveShadow = true;
    mesh.name = 'b_' + k;
    group.add(mesh);
  }

  // roads
  group.add(buildRoads(L, M));

  // street lamps
  const lampG = lampGeometry();
  const lampX = [];
  const lampSources = [];
  for (const l of L.lamps) {
    const y = height(l.x, l.z);
    lampX.push({ x: l.x, y, z: l.z, ry: -l.ang });
    const hx = l.x + Math.cos(l.ang) * 1.75, hz = l.z + Math.sin(l.ang) * 1.75;
    lampSources.push({ pos: new THREE.Vector3(hx, y + 7.2, hz), color: 0xffb46b, intensity: 70, distance: 30 });
    addCircle(l.x, l.z, 0.22);
    l.head = { x: hx, y: y + 7.4, z: hz };
  }
  scatter(group, [{ geometry: lampG.body, material: M.metal }], lampX, 200);
  scatter(group, [{ geometry: lampG.lens, material: M.lampLens }], lampX, 200, { cast: false });

  // glow halos around lamp heads (mist)
  {
    const pos = new Float32Array(L.lamps.length * 3);
    L.lamps.forEach((l, i) => pos.set([l.head.x, l.head.y - 0.2, l.head.z], i * 3));
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'uniform float uScale; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv; gl_PointSize = uScale * 3.2 / -mv.z; }',
      fragmentShader: 'void main(){ float d = length(gl_PointCoord-0.5)*2.0; float a = exp(-d*d*5.0)*0.10 + exp(-d*d*40.0)*0.25; gl_FragColor = vec4(vec3(1.0,0.72,0.42)*a, 1.0); }',
    });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.name = 'halos';
    group.add(pts);
    group.userData.halo = m;
  }

  // faint cones of light in the damp air under each lamp
  {
    const cone = new THREE.ConeGeometry(3.6, 7.2, 24, 1, true);
    cone.translate(0, -3.6, 0); // apex at the lamp head
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: {},
      vertexShader: `varying float vH; varying float vEdge; varying float vDist;
        void main(){
          vec4 wp = instanceMatrix * vec4(position, 1.0);
          vec4 mv = modelViewMatrix * wp;
          vH = clamp(-position.y / 7.2, 0.0, 1.0);
          vec3 n = normalize(normalMatrix * mat3(instanceMatrix) * normal);
          vEdge = abs(dot(n, normalize(-mv.xyz)));
          vDist = -mv.z;
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vH; varying float vEdge; varying float vDist;
        void main(){
          float a = (1.0 - vH) * (1.0 - vH) * pow(vEdge, 2.0) * 0.05;
          a *= smoothstep(1.0, 6.0, vDist) * (1.0 - smoothstep(60.0, 140.0, vDist));
          gl_FragColor = vec4(vec3(1.0, 0.7, 0.4) * a, 1.0); }`,
    });
    const im = new THREE.InstancedMesh(cone, mat, L.lamps.length);
    const d = new THREE.Object3D();
    L.lamps.forEach((l, i) => { d.position.set(l.head.x, l.head.y - 0.15, l.head.z); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
    im.frustumCulled = false; im.renderOrder = 3; im.name = 'lampCones';
    group.add(im);
  }

  // props along sidewalks
  const propDefs = [
    { id: 'metal_trash_can', h: 0.95, n: 50, r: 0.35 },
    { id: 'fire_hydrant', h: 0.8, n: 28, r: 0.25 },
    { id: 'painted_wooden_bench', h: 0.85, n: 22, r: 0.9, face: true },
    { id: 'utility_box_01', h: 1.3, n: 20, r: 0.5 },
  ];
  const props = [];
  for (const def of propDefs) {
    const list = [];
    let tries = 0;
    while (list.length < def.n && tries++ < 2000) {
      const road = r.pick(L.roads); if (road.name === 'Vitavegur') continue;
      const i = r.int(1, road.pts.length - 2), p = road.pts[i], q = road.pts[i + 1];
      const ang = Math.atan2(q.z - p.z, q.x - p.x), side = r.chance(0.5) ? 1 : -1;
      const off = road.width / 2 + L.SIDEWALK - 0.55;
      const x = p.x - Math.sin(ang) * side * off, z = p.z + Math.cos(ang) * side * off;
      if (L.roadDist(x, z, 15, road).d < 1) continue;
      if (obstacles.query(x, z, 2).size) continue;
      if (props.some(o => Math.hypot(o.x - x, o.z - z) < 4)) continue;
      const faceRoad = -ang + (side > 0 ? Math.PI : 0);
      const t = { x, y: height(x, z) + 0.17, z, ry: def.face ? faceRoad : r.range(0, 6.28) };
      list.push(t); props.push(t); addCircle(x, z, def.r, { prop: def.id });
    }
    scatter(group, modelMeshes(def.id, def.h), list, 200);
  }

  // rocks: along the shore and across the grass
  const shore = [], boulders = [], moss = [];
  for (let z = -560; z < 420; z += 7) {
    const zz = z + r.range(-3, 3);
    if (zz > HARBOUR.z0 - 20 && zz < HARBOUR.z1 + 20) continue;
    const x = coastX(zz) + r.range(-6, 2);
    if (shoreS(x, zz) > 4) continue;
    shore.push({ x, y: height(x, zz) - 0.6, z: zz, ry: r.range(0, 6.28), s: r.range(0.5, 1.4) * (1 + cliffT(zz) * 1.5) });
  }
  for (let i = 0; i < 260; i++) {
    const x = r.range(-350, 420), z = r.range(-540, 400);
    const s = shoreS(x, z);
    if (s < 6) continue;
    if (L.roadDist(x, z, 20).d < 3) continue;
    if (obstacles.query(x, z, 5).size) continue;
    const big = r.chance(0.3);
    const t = { x, y: height(x, z) - 0.2, z, ry: r.range(0, 6.28), s: big ? r.range(0.8, 1.6) : r.range(0.6, 1.2) };
    (big ? boulders : moss).push(t);
    addCircle(x, z, big ? 1.1 * t.s : 0.5 * t.s);
  }
  scatter(group, modelMeshes('coast_rocks_01', 2.2), shore, 160);
  scatter(group, modelMeshes('coast_rocks_01', 1.3), boulders, 160);
  scatter(group, modelMeshes('rock_moss_set_01', 0.6), moss, 160, { cast: false });

  // harbour: a wooden pier and lifebuoys
  const harbour = buildHarbour(L, M, r, addBox);
  group.add(harbour);
  // fishing boats moored along the pier, lifebuoys, a buoy at the harbour mouth, old lamps on the pier
  const boats = [];
  {
    const P = L.pier, c = Math.cos(P.ang), s = Math.sin(P.ang);
    const spots = [[-8, 1], [10, 1], [2, -1]];
    spots.forEach(([along, side], i) => {
      const boat = buildBoat([0x2a4a7a, 0xa8322a, 0x2f6a4a][i], i + 1);
      const off = (P.hd + 2.5) * side;
      boat.position.set(P.x + c * along - s * off, 0, P.z + s * along + c * off);
      boat.rotation.y = -P.ang + (i === 1 ? Math.PI : 0);
      group.add(boat); boats.push(boat);
      addBox(boat.position.x, boat.position.z, 6.5, 2.2, P.ang);
    });
    for (const [along, side] of [[-14, 1], [6, -1], [18, 1]]) {
      const lb = model('lifebuoy', 0.75);
      const off = (P.hd + 0.05) * side;
      lb.position.set(P.x + c * along - s * off, P.top + 0.25, P.z + s * along + c * off);
      lb.rotation.set(Math.PI / 2, 0, -P.ang); lb.rotateX(-Math.PI / 2); lb.rotateY(side > 0 ? 0 : Math.PI);
      group.add(lb);
    }
    for (const along of [-12, 12]) {
      const lp = model('street_lamp_01', 3.4);
      const x = P.x + c * along - s * (P.hd - 0.35) * 1, z = P.z + s * along + c * (P.hd - 0.35);
      lp.position.set(x, P.top, z); group.add(lp);
      lampSources.push({ pos: new THREE.Vector3(x, P.top + 3.1, z), color: 0xffc080, intensity: 25, distance: 18 });
      addCircle(x, z, 0.2);
    }
    const buoy = model('ocean_buoy', 2.4);
    buoy.position.set(P.x - c * 45, -0.4, P.z - s * 45 + 25); group.add(buoy); boats.push(buoy);
    buoy.userData.phase = 3;
  }
  // cardboard boxes stacked by the harbour sheds
  for (const b of L.buildings.filter(b => b.type === 'shed').slice(0, 4)) {
    const c = Math.cos(b.ang), s = Math.sin(b.ang);
    for (let k = 0; k < 3; k++) {
      const bx = model('cardboard_box_01', 0.45);
      const u = b.w / 2 + 0.6, v = -b.d / 2 + 0.6 + k * 0.6;
      bx.position.set(b.x + u * c - v * s, height(b.x + u * c - v * s, b.z + u * s + v * c), b.z + u * s + v * c);
      bx.rotation.y = r.range(0, 6.28);
      if (k === 2) { bx.position.y += 0.45; bx.position.z -= s * 0.6; bx.position.x += c * 0; }
      group.add(bx);
    }
  }

  // lighthouse
  const lh = L.buildings.find(b => b.type === 'lighthouse');
  const lighthouse = buildLighthouse(lh);
  group.add(lighthouse);
  addCircle(lh.x, lh.z, 3.2);

  // cliff lookout: fence along the edge, with a gap to throw from
  const lookout = buildLookout(L, M, addBox);
  group.add(lookout);

  // lit doorways also count as light sources
  for (const b of L.buildings) {
    if (!b.doorWorld || b.type === 'church') continue;
    const c = Math.cos(b.ang), s = Math.sin(b.ang);
    const x = b.x + b.doorWorld.x * c - b.doorWorld.z * s, z = b.z + b.doorWorld.x * s + b.doorWorld.z * c;
    if (r.chance(0.35)) lampSources.push({ pos: new THREE.Vector3(x, b.doorWorld.y, z), color: b.type === 'shed' ? 0xdde6ff : 0xffc890, intensity: b.type === 'shed' ? 10 : 4, distance: 10 });
  }
  // the police station and its cell, and a fishing knife left on the pier
  const jail = buildJail(L, M, addBox, obstacles, lampSources);
  if (jail) group.add(jail.group);
  group.add(buildKnifeCrate(L, M, addCircle));
  E.setLampSources(lampSources);

  // an old lamp on the cliff lookout
  {
    const lk = L.lookout;
    const x = lk.x - lk.seaDir.x * 4.4 + lk.seaDir.z * 3.2, z = lk.z - lk.seaDir.z * 4.4 - lk.seaDir.x * 3.2;
    const lp = model('street_lamp_01', 3.4); const y = height(x, z);
    lp.position.set(x, y, z); group.add(lp);
    lampSources.push({ pos: new THREE.Vector3(x, y + 3.1, z), color: 0xffc080, intensity: 30, distance: 20 });
    addCircle(x, z, 0.2);
  }
  group.userData.update = (t, camera) => {
    for (const b of boats) {
      const ph = b.userData.phase ?? 0;
      b.position.y = Math.sin(t * 0.9 + ph) * 0.12 - (b.userData.sink ?? 0);
      b.rotation.x = Math.sin(t * 0.7 + ph) * 0.025;
      b.rotation.z = Math.sin(t * 0.6 + ph * 2) * 0.02;
    }
    lighthouse.userData.update(t);
    jail?.update(t);
    if (group.userData.halo) group.userData.halo.uniforms.uScale.value = E.renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
  };
  return { group, obstacles, addBox, addCircle, lampSources, materials: M, lighthouse, jail };
}

function buildHarbour(L, M, r, addBox) {
  const g = new THREE.Group();
  const B = new GeoBuilder(2);
  const z0 = (HARBOUR.z0 + HARBOUR.z1) / 2;
  // a pier sticking out from the quay
  const base = { x: coastX(z0) + HARBOUR.quayS, z: z0 };
  const dir = { x: -1, z: 0.1 }; const dl = Math.hypot(dir.x, dir.z); dir.x /= dl; dir.z /= dl;
  const len = 40, wid = 4;
  const ang = Math.atan2(dir.z, dir.x);
  const m = new THREE.Matrix4().makeRotationY(-ang).setPosition(base.x, 0, base.z);
  B.setMatrix(m);
  B.box(len / 2 - 1, 2.25, 0, len + 2, 0.3, wid, col(0xffffff), { scale: 2 });
  for (let x = 0; x <= len; x += 4) for (const z of [-wid / 2 + 0.2, wid / 2 - 0.2]) B.box(x, -3, z, 0.35, 10.5, 0.35, col(0x5a4a3a), { scale: 2 });
  for (let x = 0; x <= len; x += 4) for (const z of [-wid / 2 + 0.1, wid / 2 - 0.1]) B.box(x, 2.85, z, 0.25, 0.9, 0.25, col(0xd8d4c8), { scale: 2 });
  const mesh = new THREE.Mesh(B.build(), M.wood); mesh.castShadow = mesh.receiveShadow = true;
  g.add(mesh);
  const pierRec = { x: base.x + dir.x * (len / 2 - 1), z: base.z + dir.z * (len / 2 - 1), hw: (len + 2) / 2, hd: wid / 2, ang, top: 2.4 };
  L.pier = pierRec;
  return g;
}

function buildLighthouse(b) {
  const g = new THREE.Group();
  const y0 = height(b.x, b.z);
  g.position.set(b.x, y0, b.z);
  const white = new THREE.MeshStandardMaterial({ color: 0xf0eee8, roughness: 0.7 });
  const red = new THREE.MeshStandardMaterial({ color: 0xa82820, roughness: 0.6 });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.4, 14, 24), white); tower.position.y = 7;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.95, 2.2, 24), red); band.position.y = 6;
  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.25, 24), red); gallery.position.y = 14.1;
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 1.8, 16), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff2d0, emissiveIntensity: 6, roughness: 0.1 }));
  glass.position.y = 15.1;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.4, 16), red); cap.position.y = 16.7;
  for (const m of [tower, band, gallery, cap]) { m.castShadow = true; m.receiveShadow = true; }
  g.add(tower, band, gallery, glass, cap);
  // rotating beams
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; varying float vEdge; void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vec3 n = normalize(normalMatrix*normal); vEdge = abs(dot(n, normalize(-mv.xyz))); gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'varying vec2 vUv; varying float vEdge; void main(){ float a = pow(vUv.y, 3.0) * 0.09 * pow(vEdge, 3.0); gl_FragColor = vec4(vec3(1.0,0.95,0.8)*a, 1.0); }',
  });
  const beams = new THREE.Group(); beams.position.y = 15.1;
  for (const s of [0, Math.PI]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(7, 220, 24, 1, true), beamMat);
    cone.geometry.translate(0, -110, 0); cone.rotation.z = Math.PI / 2; cone.rotation.y = s;
    const holder = new THREE.Group(); holder.rotation.y = s; holder.add(cone);
    cone.rotation.set(0, 0, Math.PI / 2);
    beams.add(holder);
  }
  g.add(beams);
  const light = new THREE.PointLight(0xfff2d0, 30, 25, 2); light.position.y = 15.1; g.add(light);
  g.userData.update = t => { beams.rotation.y = t * 0.6; };
  return g;
}

function buildLookout(L, M, addBox) {
  const g = new THREE.Group();
  const lk = L.lookout;
  const B = new GeoBuilder(2);
  const sx = lk.seaDir.x, sz = lk.seaDir.z; // towards the sea
  const tx = -sz, tz = sx; // along the edge
  // wooden viewing deck
  const ang = Math.atan2(sz, sx);
  const y = height(lk.x, lk.z);
  const m = new THREE.Matrix4().makeRotationY(-ang).setPosition(lk.x, y, lk.z);
  B.setMatrix(m);
  B.box(-1.5, 0.12, 0, 7, 0.24, 8, col(0xffffff), { scale: 2 });
  // posts and rails, gap in the middle
  const rail = (z0, z1) => {
    for (let z = z0; z <= z1 + 0.01; z += 1.6) B.box(1.9, 0.6, z, 0.14, 1.2, 0.14, col(0xffffff));
    B.box(1.9, 1.1, (z0 + z1) / 2, 0.1, 0.1, z1 - z0, col(0xffffff));
    B.box(1.9, 0.65, (z0 + z1) / 2, 0.08, 0.08, z1 - z0, col(0xffffff));
  };
  rail(-4, -1); rail(1, 4);
  const mesh = new THREE.Mesh(B.build(), M.wood); mesh.castShadow = mesh.receiveShadow = true;
  g.add(mesh);
  // fences along the cliff edge either side of the deck (collision too)
  for (const side of [-1, 1]) {
    const cx = lk.x + sx * 1.9 + tx * side * 18, cz = lk.z + sz * 1.9 + tz * side * 18;
    addBox(cx, cz, 0.15, 14, Math.atan2(sz, sx), { fence: true, top: 1.1 });
  }
  addBox(lk.x + sx * 1.9 + tx * 2.5, lk.z + sz * 1.9 + tz * 2.5, 0.15, 1.5, ang, { fence: true, top: 1.1 });
  addBox(lk.x + sx * 1.9 - tx * 2.5, lk.z + sz * 1.9 - tz * 2.5, 0.15, 1.5, ang, { fence: true, top: 1.1 });
  // a lamp on the deck
  const lampPos = new THREE.Vector3(lk.x - sx * 4.5, y + 3.2, lk.z - sz * 4.5);
  return g;
}

function signTexture(text, bg, fg) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 96);
  g.fillStyle = fg; g.font = 'bold 62px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 52);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// A small police station with a barred holding cell out front, on a quiet plot beside Kirkjuvegur.
function buildJail(L, M, addBox, obstacles, lampSources) {
  // the first open plot near the middle of town, set back from a street and facing it
  const centre = L.buildings.find(b => b.type === 'church') || L.carStart;
  const cands = [];
  for (const road of L.roads) {
    if (road.name === 'Vitavegur') continue;
    for (let i = 2; i < road.pts.length - 2; i++) {
      const a = road.pts[i - 1], b = road.pts[i + 1], p = road.pts[i];
      const ang = Math.atan2(b.z - a.z, b.x - a.x);
      for (const side of [1, -1]) for (const set of [5.5, 7, 9]) {
        const nx = -Math.sin(ang) * side, nz = Math.cos(ang) * side, off = road.width / 2 + L.SIDEWALK + set;
        const x = p.x + nx * off, z = p.z + nz * off;
        cands.push({ x, z, ang: side > 0 ? ang + Math.PI : ang, d: Math.hypot(x - centre.x, z - centre.z) + set });
      }
    }
  }
  cands.sort((a, b) => a.d - b.d);
  let spot = null;
  const near = new Set();
  for (const c of cands) {
    if (shoreS(c.x, c.z) < 20 || L.roadDist(c.x, c.z, 20).d < 3.2) continue;
    near.clear(); obstacles.query(c.x, c.z, 6, near);
    if ([...near].some(o => Math.hypot(o.x - c.x, o.z - c.z) < 5.8 + (o.type === 'box' ? Math.hypot(o.hw, o.hd) : o.r))) continue;
    if (L.buildings.some(b => Math.hypot(b.x - c.x, b.z - c.z) < b.rad + 6.2)) continue;
    let lo = Infinity, hi = -Infinity;
    for (const [u, v] of [[-4.5, -4.5], [4.5, -4.5], [4.5, 4.5], [-4.5, 4.5], [0, 0]]) { const h = height(c.x + u, c.z + v); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if (hi - lo > 1.8) continue;
    spot = { ...c, base: hi + 0.05 };
    break;
  }
  if (!spot) return null;
  const { x, z, ang, base } = spot;
  const c = Math.cos(ang), s = Math.sin(ang);
  const W = (u, v) => ({ x: x + u * c - v * s, z: z + u * s + v * c });
  const group = new THREE.Group();
  const mtx = new THREE.Matrix4().makeRotationY(-ang).setPosition(x, base, z);
  const C = new GeoBuilder(2.4).setMatrix(mtx), B = new GeoBuilder(1).setMatrix(mtx);
  const grey = col(0xb8b4aa), dark = col(0x6a6a66);
  C.box(0, -0.5, 0.25, 8.4, 1.0, 7.6, grey);        // slab
  C.box(0, 1.6, -2.3, 8.2, 3.2, 3.6, grey);          // the station
  C.box(0, 3.25, -2.3, 8.4, 0.12, 3.8, dark);
  C.box(0, 2.78, 1.3, 4.3, 0.16, 3.8, dark);         // cell roof
  // bars: sides and front, with a sliding door in the middle of the front
  const rods = (u0, v0, u1, v1, B) => {
    const len = Math.hypot(u1 - u0, v1 - v0), n = Math.round(len / 0.17);
    for (let k = 0; k <= n; k++) { const t = k / n; B.box(u0 + (u1 - u0) * t, 1.35, v0 + (v1 - v0) * t, 0.045, 2.7, 0.045, grey); }
    for (const y of [0.12, 1.3, 2.62]) B.box((u0 + u1) / 2, y, (v0 + v1) / 2, Math.abs(u1 - u0) + 0.05, 0.05, Math.abs(v1 - v0) + 0.05, grey);
  };
  rods(-2.1, -0.5, -2.1, 3.15, B); rods(2.1, -0.5, 2.1, 3.15, B);
  rods(-2.1, 3.15, -0.62, 3.15, B); rods(0.62, 3.15, 2.1, 3.15, B);
  const bars = new THREE.Mesh(B.build(), M.metal); bars.castShadow = true;
  const concrete = new THREE.Mesh(C.build(), M.concrete); concrete.castShadow = concrete.receiveShadow = true;
  group.add(concrete, bars);
  // the door
  const D = new GeoBuilder(1);
  rods(-0.6, 0, 0.6, 0, D);
  const door = new THREE.Mesh(D.build(), M.metal);
  const doorPivot = new THREE.Group(); doorPivot.position.set(x, base, z); doorPivot.rotation.y = -ang;
  door.position.set(0, 0, 3.08); doorPivot.add(door); group.add(doorPivot);
  // sign and a blue lamp
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.68), new THREE.MeshStandardMaterial({ map: signTexture('LÖGREGLAN', '#1f3f8f', '#ffffff'), emissive: 0xffffff, emissiveMap: signTexture('LÖGREGLAN', '#1f3f8f', '#ffffff'), emissiveIntensity: 0.6, roughness: 0.5 }));
  const sp = W(0, -0.45); sign.position.set(sp.x, base + 3.0 + 0.05, sp.z); sign.rotation.y = -ang; sign.position.y += 0.02;
  // sits on the station wall above the cell roof
  sign.position.y = base + 3.0; group.add(sign);
  const blueMat = new THREE.MeshStandardMaterial({ color: 0x0a1a4a, emissive: 0x3a6aff, emissiveIntensity: 2 });
  const blue = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), blueMat);
  const bp = W(0, -1.2); blue.position.set(bp.x, base + 3.45, bp.z); group.add(blue);
  const inside = W(0, 1.3);
  lampSources.push({ pos: new THREE.Vector3(inside.x, base + 2.4, inside.z), color: 0xffe2b0, intensity: 8, distance: 9 });
  lampSources.push({ pos: new THREE.Vector3(bp.x, base + 3.6, bp.z), color: 0x4a7aff, intensity: 10, distance: 14 });
  // collision
  const box = (u, v, hu, hv, extra) => { const p = W(u, v); return addBox(p.x, p.z, hu, hv, ang, extra); };
  box(0, -2.3, 4.15, 1.85);
  box(-2.1, 1.3, 0.1, 1.85); box(2.1, 1.3, 0.1, 1.85);
  box(-1.36, 3.15, 0.74, 0.1); box(1.36, 3.15, 0.74, 0.1);
  const doorBox = box(0, 3.15, 0.62, 0.1);
  let open = true, flash = 0;
  const setDoor = o => { open = o; doorBox.disabled = o; };
  setDoor(true);
  const out = W(0, 5.2);
  L.jail = { x, z, ang, cell: inside, out, base };
  return {
    group, x, z, ang, cell: inside, out, setDoor, get open() { return open; },
    alarm(on) { flash = on ? 1 : 0; },
    update(t) {
      door.position.x = THREE.MathUtils.damp(door.position.x, open ? 1.3 : 0, 4, 1 / 60);
      door.position.z = open ? 3.22 : 3.08;
      blueMat.emissiveIntensity = flash ? (Math.sin(t * 12) > 0 ? 8 : 0.5) : 2;
    },
  };
}

function buildKnifeCrate(L, M, addCircle) {
  const g = new THREE.Group(), P = L.pier;
  const c = Math.cos(P.ang), s = Math.sin(P.ang), along = 5;
  const x = P.x + c * along, z = P.z + s * along;
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.5), M.wood);
  crate.position.set(x, P.top + 0.275, z); crate.rotation.y = -P.ang + 0.3; crate.castShadow = crate.receiveShadow = true;
  g.add(crate);
  const knife = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, 0.04), new THREE.MeshStandardMaterial({ color: 0xe8eef2, metalness: 1, roughness: 0.15, emissive: 0x334455, emissiveIntensity: 0.6 }));
  blade.position.x = 0.1;
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.025, 0.035), new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.8 }));
  handle.position.x = -0.055;
  knife.add(blade, handle); knife.position.set(x, P.top + 0.565, z); knife.rotation.y = -P.ang + 1.1;
  g.add(knife);
  addCircle(x, z, 0.4);
  L.knife = { x, z, y: P.top + 0.56, mesh: knife };
  return g;
}
