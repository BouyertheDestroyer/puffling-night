import { height, normalAt, shoreS } from './layout.js';

// Ground height and simple 2D collision against the town's obstacles.
export function createWorld(L, town) {
  const obstacles = town.obstacles;
  const extra = []; // dynamic circles (e.g. the car) {get circles()}
  const scratch = new Set();

  function surfaceOffset(x, z) {
    const r = L.roadDist(x, z, 8);
    if (r.d < 0) return 0.06;
    if (r.d < L.SIDEWALK && r.seg && r.seg.road.name !== 'Vitavegur') return 0.18;
    return 0;
  }
  function inRect(x, z, R) {
    const c = Math.cos(R.ang), s = Math.sin(R.ang), dx = x - R.x, dz = z - R.z;
    return Math.abs(dx * c + dz * s) < R.hw && Math.abs(-dx * s + dz * c) < R.hd;
  }
  function ground(x, z) {
    if (L.pier && inRect(x, z, L.pier)) return L.pier.top;
    return height(x, z) + surfaceOffset(x, z);
  }
  function normal(x, z) { return normalAt(x, z, 1.2); }

  function pushCircleBox(x, z, r, o) {
    const dx = x - o.x, dz = z - o.z;
    const lx = dx * o.c + dz * o.s, lz = -dx * o.s + dz * o.c;
    const cx = Math.max(-o.hw, Math.min(o.hw, lx)), cz = Math.max(-o.hd, Math.min(o.hd, lz));
    let px = lx - cx, pz = lz - cz;
    const d = Math.hypot(px, pz);
    let ox, oz;
    if (d > 1e-6) {
      if (d >= r) return null;
      const k = (r - d) / d; ox = px * k; oz = pz * k;
    } else {
      // centre inside: leave by the nearest face
      const ex = o.hw - Math.abs(lx), ez = o.hd - Math.abs(lz);
      if (ex < ez) { ox = Math.sign(lx || 1) * (ex + r); oz = 0; } else { ox = 0; oz = Math.sign(lz || 1) * (ez + r); }
    }
    return { x: ox * o.c - oz * o.s, z: ox * o.s + oz * o.c };
  }
  function pushCircleCircle(x, z, r, o) {
    const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz), R = r + o.r;
    if (d >= R) return null;
    if (d < 1e-6) return { x: R, z: 0 };
    return { x: dx / d * (R - d), z: dz / d * (R - d) };
  }
  // total push needed to move a circle out of everything it overlaps
  function pushOut(x, z, r, opts = {}) {
    scratch.clear(); obstacles.query(x, z, r + 2, scratch);
    let tx = 0, tz = 0;
    for (const o of scratch) {
      if (o.disabled) continue;
      if (opts.vehicle && o.fence) continue; // cars smash through the cliff-top fence
      if (o.top !== undefined && opts.above > o.top) continue; // jumped or flew over it
      if (opts.boxesOnly && (o.type !== 'box' || (o.parked && opts.above > 1.5))) continue;
      const p = o.type === 'box' ? pushCircleBox(x + tx, z + tz, r, o) : pushCircleCircle(x + tx, z + tz, r, o);
      if (p) { tx += p.x; tz += p.z; }
    }
    for (const e of opts.static ? [] : extra) {
      if (e === opts.car || e.ghost) continue;
      for (const c of e.circles()) {
        const p = pushCircleCircle(x + tx, z + tz, r, c);
        if (p) { tx += p.x; tz += p.z; }
      }
    }
    return { x: tx, z: tz };
  }
  // is there a solid obstacle at this point?
  function blocked(x, z, r = 0.3, opts) { const p = pushOut(x, z, r, opts); return p.x !== 0 || p.z !== 0; }

  return { ground, normal, pushOut, blocked, extra, shoreS, L };
}
