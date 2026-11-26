// The shape of the world: coastline, terrain height, roads, building lots, lamps.
// Pure data, no three.js, so it can be used by the generator, physics, AI and the map.
import { fbm, noise2, rng, smoothstep, lerp, clamp } from '../noise.js';

export const SEED = 20260915;
export const WORLD = { minX: -620, maxX: 620, minZ: -620, maxZ: 620 };
export const PLAY = { minX: -400, maxX: 430, minZ: -560, maxZ: 430 }; // where you can go

// ---------------------------------------------------------------- coast & height
export function cliffT(z) { return smoothstep(-160, -330, z); }

export function coastX(z) {
  let x = -160 + 35 * Math.sin(z / 160 + 0.5) + 18 * fbm(z / 90, 3.1, 3);
  x += 48 * Math.exp(-(((z - 120) / 70) ** 2)); // the harbour bay
  x += 22 * fbm(z / 35, 7.7, 3) * cliffT(z); // ragged cliffs in the north
  // the north coast turns east so the headland is surrounded by sea on two sides
  x -= 0; return x;
}
// signed distance-ish from the shoreline, positive on land
export function shoreS(x, z) {
  const sWest = x - coastX(z);
  const northEdge = -520 + 30 * fbm(x / 70, 2.2, 3); // northern shore of the headland
  const sNorth = z - northEdge;
  return Math.min(sWest, sNorth);
}

const STACKS = (() => {
  const r = rng(SEED + 7), out = [];
  for (let i = 0; i < 9; i++) {
    const z = r.range(-500, -250);
    out.push({ x: coastX(z) - r.range(25, 90), z, r: r.range(7, 16), h: r.range(16, 38) });
  }
  out.push({ x: -120, z: -545, r: 12, h: 30 });
  return out;
})();

export const HARBOUR = { z0: 75, z1: 170, quayS: 6 };

function landHeight(x, z, s) {
  const ss = Math.max(s, 0);
  const hills = 3.5 * fbm(x / 150, z / 150, 3) * smoothstep(0, 150, ss);
  const mountains = 150 * smoothstep(330, 640, ss) * (0.6 + 0.4 * fbm(x / 220, z / 220, 4));
  const south = 70 * smoothstep(330, 620, z) * (0.7 + 0.3 * fbm(x / 120, z / 90, 3));
  let town = 1.8 + ss * 0.075 + hills;
  // beach between the waterline and the harbour road
  if (s < 22) town = lerp(-0.8, 1.8 + 22 * 0.075, smoothstep(-2, 22, s));
  // harbour quay: flat, with a wall into deep water
  const hz = smoothstep(HARBOUR.z0 - 15, HARBOUR.z0, z) * (1 - smoothstep(HARBOUR.z1, HARBOUR.z1 + 15, z));
  if (hz > 0) {
    const quay = s > HARBOUR.quayS ? 2.4 + Math.max(0, s - 25) * 0.075 : lerp(-5, 2.4, smoothstep(HARBOUR.quayS - 1.5, HARBOUR.quayS, s));
    town = lerp(town, quay, hz);
  }
  const plateau = 44 + 5 * fbm(x / 120, z / 120, 4) + 0.03 * ss + 2 * noise2(x / 25, z / 25) * smoothstep(10, 40, ss);
  const ct = cliffT(z);
  const edge = smoothstep(-3, 7, s);
  const cliff = lerp(-9 + 3 * noise2(x / 20, z / 20), plateau, edge);
  return lerp(town, cliff, ct) + mountains + south;
}

// Roads are graded into the terrain: near a road the ground blends to the road's smoothed height.
let roadField = null;
export function height(x, z) {
  const h0 = baseHeight(x, z);
  if (!roadField) return h0;
  const near = roadField.grid.query(x, z, 10, roadField.scratch);
  if (!near.size) { near.clear(); return h0; }
  let best = Infinity, hr = 0, hw = 4;
  for (const seg of near) {
    const r = distToSeg(x, z, seg.ax, seg.az, seg.bx, seg.bz);
    if (r.d < best) { best = r.d; hr = seg.ha + (seg.hb - seg.ha) * r.t; hw = seg.road.width / 2; }
  }
  near.clear();
  const w = 1 - smoothstep(hw + 2.6, hw + 9, best);
  return lerp(h0, hr, w);
}

function baseHeight(x, z) {
  const s = shoreS(x, z);
  let h = landHeight(x, z, s);
  if (s < 0) h = Math.min(h, -1 + s * 0.12); // sea floor shelves away
  h = Math.max(h, -16 + 2 * noise2(x / 40, z / 40));
  for (const st of STACKS) {
    const d = Math.hypot(x - st.x, z - st.z);
    if (d < st.r * 1.6) h = Math.max(h, lerp(-6, st.h + 3 * noise2(x / 6, z / 6), smoothstep(st.r * 1.5, st.r * 0.75, d)));
  }
  return h;
}

export function normalAt(x, z, e = 0.7) {
  const hx = height(x + e, z) - height(x - e, z), hz = height(x, z + e) - height(x, z - e);
  const nx = -hx, ny = 2 * e, nz = -hz, l = Math.hypot(nx, ny, nz);
  return [nx / l, ny / l, nz / l];
}

// world point from (shore distance, z)
const W = (s, z) => ({ x: coastX(z) + s, z });

// ---------------------------------------------------------------- spatial grid
export class Grid {
  constructor(cell = 24) { this.cell = cell; this.map = new Map(); }
  key(i, j) { return i * 100003 + j; }
  insertAABB(item, x0, z0, x1, z1) {
    const c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++)
      for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
        const k = this.key(i, j); let a = this.map.get(k); if (!a) this.map.set(k, a = []); a.push(item);
      }
  }
  query(x, z, r, out = new Set()) {
    const c = this.cell;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++)
      for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) {
        const a = this.map.get(this.key(i, j)); if (a) for (const it of a) out.add(it);
      }
    return out;
  }
}

function catmull(ctrl, step = 4) {
  const pts = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    const len = Math.hypot(p2.x - p1.x, p2.z - p1.z), n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      pts.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  pts.push({ ...ctrl[ctrl.length - 1] });
  return pts;
}

export function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0; t = clamp(t, 0, 1);
  const cx = ax + dx * t, cz = az + dz * t;
  return { d: Math.hypot(px - cx, pz - cz), t, cx, cz };
}

// ---------------------------------------------------------------- the town plan
export function buildLayout() {
  const r = rng(SEED);
  const roads = [];
  const addRoad = (ctrlSZ, width, kind, name) => {
    const ctrl = ctrlSZ.map(([s, z]) => W(s, z));
    const pts = catmull(ctrl, 4);
    const road = { pts, width, kind, name, id: roads.length };
    roads.push(road); return road;
  };
  const wig = (seed, z) => 6 * fbm(z / 80, seed, 2);

  // Harbour road along the coast, then up the hill to the cliffs
  addRoad([[45, 360], [44, 260], [46, 160], [47, 80], [44, -20], [48, -100], [66, -170], [95, -225], [88, -290], [62, -345], [40, -392], [28, -412]], 8, 'main', 'Strandvegur');
  // Cliff top spur to the lighthouse
  addRoad([[62, -345], [70, -400], [62, -450], [48, -480]], 6, 'lane', 'Vitavegur');
  // Streets parallel to the shore
  const longS = [118, 190, 262];
  longS.forEach((s, i) => {
    const z0 = 300 - i * 25, z1 = -110 + i * 15;
    const ctrl = []; for (let z = z0; z >= z1 - 1; z -= 60) ctrl.push([s + wig(11 + i, z), z]);
    ctrl.push([s + wig(11 + i, z1), z1]);
    addRoad(ctrl, i === 0 ? 7.5 : 7, i === 0 ? 'main' : 'street', ['Hafnargata', 'Kirkjuvegur', 'Heiðarvegur'][i]);
  });
  // Cross streets running uphill
  const crossZ = [-85, -15, 50, 118, 188, 255];
  const crossNames = ['Brekkugata', 'Lundagata', 'Bárustígur', 'Vesturvegur', 'Skólavegur', 'Hólagata'];
  crossZ.forEach((z, i) => {
    const sEnd = i === 0 ? 262 : i === 5 ? 200 : 262;
    const ctrl = []; for (let s = 45; s <= sEnd + 0.1; s += 40) ctrl.push([s, z + 5 * fbm(s / 60, 40 + i, 2)]);
    addRoad(ctrl, 7, 'street', crossNames[i]);
  });

  // road heights: the terrain along the centreline, smoothed
  roadField = null;
  for (const road of roads) {
    const raw = road.pts.map(p => baseHeight(p.x, p.z));
    road.pts.forEach((p, i) => {
      let s = 0, n = 0;
      for (let k = -4; k <= 4; k++) { const j = Math.min(raw.length - 1, Math.max(0, i + k)); s += raw[j]; n++; }
      p.h = Math.max(s / n, 1.6);
    });
  }
  // where roads meet, the side street takes the height of the road it joins
  for (const road of roads) for (const end of [0, road.pts.length - 1]) {
    const p = road.pts[end];
    for (const other of roads) {
      if (other === road) continue;
      for (const q of other.pts) if (Math.hypot(q.x - p.x, q.z - p.z) < 4) {
        const dh = q.h - p.h;
        road.pts.forEach((pp, i) => { const t = Math.max(0, 1 - Math.abs(i - end) / 8); pp.h += dh * t; });
        break;
      }
    }
  }
  // road segment grid
  const roadGrid = new Grid(24);
  const fieldGrid = new Grid(24);
  for (const road of roads) {
    for (let i = 0; i < road.pts.length - 1; i++) {
      const a = road.pts[i], b = road.pts[i + 1];
      const seg = { road, i, ax: a.x, az: a.z, bx: b.x, bz: b.z, ha: a.h, hb: b.h };
      fieldGrid.insertAABB(seg, Math.min(a.x, b.x) - 12, Math.min(a.z, b.z) - 12, Math.max(a.x, b.x) + 12, Math.max(a.z, b.z) + 12);
      const m = road.width / 2 + 4;
      roadGrid.insertAABB(seg, Math.min(a.x, b.x) - m, Math.min(a.z, b.z) - m, Math.max(a.x, b.x) + m, Math.max(a.z, b.z) + m);
    }
  }
  roadField = { grid: fieldGrid, scratch: new Set() };
  const scratch = new Set();
  // distance from a point to the nearest road edge (negative = on the road)
  function roadDist(x, z, radius = 20, exclude = null) {
    scratch.clear(); roadGrid.query(x, z, radius, scratch);
    let best = Infinity, bestSeg = null;
    for (const seg of scratch) {
      if (seg.road === exclude) continue;
      const d = distToSeg(x, z, seg.ax, seg.az, seg.bx, seg.bz).d - seg.road.width / 2;
      if (d < best) { best = d; bestSeg = seg; }
    }
    return { d: best, seg: bestSeg };
  }

  // ---- buildings
  const buildings = [];
  const bGrid = new Grid(24);
  const SIDEWALK = 2.4;
  function fits(cx, cz, hw, hd, ang, margin = 1.2) {
    if (shoreS(cx, cz) < 12 || cliffT(cz) > 0.25) return false;
    const c = Math.cos(ang), s = Math.sin(ang);
    const pts = [[0, 0]];
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) pts.push([u * hw, v * hd]);
    for (const [u, v] of pts) {
      const x = cx + u * c - v * s, z = cz + u * s + v * c;
      if (roadDist(x, z, 20).d < SIDEWALK + margin) return false;
    }
    const near = bGrid.query(cx, cz, 30);
    const rad = Math.hypot(hw, hd);
    for (const b of near) if (Math.hypot(b.x - cx, b.z - cz) < rad + b.rad + 1.5) return false;
    return true;
  }
  function addBuilding(b) {
    b.rad = Math.hypot(b.w / 2, b.d / 2);
    buildings.push(b);
    bGrid.insertAABB(b, b.x - b.rad, b.z - b.rad, b.x + b.rad, b.z + b.rad);
  }
  const WALLS = [0xb5302a, 0xe8e4da, 0x2f5f8a, 0xe1b63a, 0x4b7a52, 0x9aa3a8, 0xf0efe9, 0x7a2f2a, 0x324e6e, 0xd8d2c2];
  const ROOFS = [0x8a2a22, 0x2b2f33, 0x3b5f48, 0x2c4a6a, 0x6e2420, 0x1f2326];

  // church on a prominent corner
  {
    const p = W(150, 85);
    addBuilding({ type: 'church', x: p.x, z: p.z, w: 9, d: 18, ang: angleOfRoadNear(p.x, p.z) + Math.PI / 2, wall: 0xf2f0ea, roof: 0x9a2a20, floors: 1, seed: 99 });
  }
  function angleOfRoadNear(x, z) {
    const { seg } = roadDist(x, z, 60);
    return seg ? Math.atan2(seg.bz - seg.az, seg.bx - seg.ax) : 0;
  }

  // harbour warehouses on the sea side of the harbour road
  for (let z = HARBOUR.z0 - 50; z < HARBOUR.z1 + 60; z += 34) {
    const p = W(24 + r.range(-2, 2), z + r.range(-4, 4));
    const ang = angleOfRoadNear(p.x, p.z);
    const w = r.range(22, 30), d = r.range(12, 15);
    if (shoreS(p.x, p.z) > 9 && fits(p.x, p.z, w / 2, d / 2, ang, 0.6))
      addBuilding({ type: 'shed', x: p.x, z: p.z, w, d, ang, wall: r.pick([0x9aa3a8, 0x2f5f8a, 0xe8e4da, 0x6f7b80]), roof: r.pick(ROOFS), floors: 1, seed: r.int(0, 1e6) });
  }

  // houses along every street
  for (const road of roads) {
    if (road.name === 'Vitavegur') continue;
    let acc = r.range(0, 10);
    for (let i = 1; i < road.pts.length; i++) {
      const a = road.pts[i - 1], b = road.pts[i];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      acc += segLen;
      if (acc < 15) continue;
      acc = r.range(-4, 2);
      const ang = Math.atan2(b.z - a.z, b.x - a.x);
      for (const side of [-1, 1]) {
        if (!r.chance(0.86)) continue;
        const big = r.chance(0.15);
        const w = big ? r.range(13, 17) : r.range(8, 12), d = big ? r.range(9, 11) : r.range(6.5, 8.5);
        const set = road.width / 2 + SIDEWALK + r.range(3, 6) + d / 2;
        const nx = -Math.sin(ang) * side, nz = Math.cos(ang) * side;
        const cx = b.x + nx * set, cz = b.z + nz * set;
        if (!fits(cx, cz, w / 2, d / 2, ang)) continue;
        addBuilding({
          type: big ? 'block' : 'house', x: cx, z: cz, w, d, ang, side,
          wall: r.pick(WALLS), roof: r.pick(ROOFS), floors: big ? 2 + r.int(0, 1) : 1 + r.int(0, 1),
          seed: r.int(0, 1e6),
        });
      }
    }
  }

  // lighthouse on the headland
  { const p = W(48, -500); addBuilding({ type: 'lighthouse', x: p.x, z: p.z, w: 5, d: 5, ang: 0, wall: 0xf3f1ea, roof: 0xb02a22, floors: 1, seed: 5 }); }

  // ---- street lamps along the roads
  const lamps = [];
  for (const road of roads) {
    let acc = 0, side = 1;
    for (let i = 1; i < road.pts.length; i++) {
      const a = road.pts[i - 1], b = road.pts[i];
      acc += Math.hypot(b.x - a.x, b.z - a.z);
      if (acc < (road.kind === 'main' ? 30 : 34)) continue;
      acc = 0;
      const ang = Math.atan2(b.z - a.z, b.x - a.x);
      side = road.kind === 'main' ? -side : side;
      const off = road.width / 2 + 0.7;
      const x = b.x - Math.sin(ang) * side * off, z = b.z + Math.cos(ang) * side * off;
      // skip lamps that would stand in another road
      if (roadDist(x, z, 15, road).d < 0.8) continue;
      if (lamps.some(l => Math.hypot(l.x - x, l.z - z) < 14)) continue;
      lamps.push({ x, z, ang: ang + (side > 0 ? -Math.PI / 2 : Math.PI / 2), road });
    }
  }

  // ---- landmarks
  const cliffSpot = (() => { const p = W(8, -418); return { x: p.x, z: p.z }; })();
  const lookout = (() => { // direction out to sea from the lookout
    const a = W(0, -430), b = W(0, -406);
    const tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz);
    return { x: cliffSpot.x, z: cliffSpot.z, seaDir: { x: tz / l * -1, z: -tx / l * -1 } };
  })();
  // make sure seaDir points towards the sea
  { const t = { x: lookout.x + lookout.seaDir.x * 20, z: lookout.z + lookout.seaDir.z * 20 };
    if (shoreS(t.x, t.z) > shoreS(lookout.x, lookout.z)) { lookout.seaDir.x *= -1; lookout.seaDir.z *= -1; } }

  const carStart = (() => { const road = roads[3]; const p = road.pts[Math.floor(road.pts.length * 0.55)], q = road.pts[Math.floor(road.pts.length * 0.55) + 1]; return { x: p.x, z: p.z, ang: Math.atan2(q.z - p.z, q.x - p.x) }; })();

  return { roads, roadGrid, roadDist, buildings, bGrid, lamps, lookout, carStart, SIDEWALK, stacks: STACKS };
}
