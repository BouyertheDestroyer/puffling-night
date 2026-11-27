import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, damp, lerp, angleDiff, rng } from './noise.js';
import { MOON_DIR } from './world/sky.js';

// ------------------------------------------------------------------ model
function colored(geo, fn) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  const p = geo.attributes.position, c = new Float32Array(p.count * 3);
  const v = new THREE.Vector3(), col = new THREE.Color();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); fn(v, col); c.set([col.r, col.g, col.b], i * 3); }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}
function fluff(geo, amt, seed) {
  const p = geo.attributes.position; const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 211 + seed) * Math.sin(v.y * 173 + seed * 2) * Math.sin(v.z * 197 + seed * 3);
    v.multiplyScalar(1 + n * amt); p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}
let GEO = null;
function geometries() {
  if (GEO) return GEO;
  const dark = new THREE.Color(0x26272b), grey = new THREE.Color(0x5b5e63), light = new THREE.Color(0xe2e0da), face = new THREE.Color(0xa3a5a9);
  // body: egg shape, tilted upright, dark back, pale belly
  let body = new THREE.SphereGeometry(0.075, 20, 14);
  body.scale(1, 1.2, 1.05);
  body = fluff(body, 0.06, 1);
  body = colored(body, (v, c) => {
    const front = v.z / 0.08, low = -v.y / 0.09;
    const t = clamp(front * 1.4 + low * 0.5 - 0.1, 0, 1);
    c.copy(dark).lerp(light, t);
  });
  body.rotateX(0.35);
  body.translate(0, 0.095, 0);
  let head = new THREE.SphereGeometry(0.052, 16, 12);
  head = fluff(head, 0.05, 2);
  head = colored(head, (v, c) => {
    const f = clamp(v.z / 0.05, 0, 1), side = Math.abs(v.x) / 0.05;
    c.copy(dark).lerp(face, clamp(f * 1.3 - 0.2 + (v.y < 0 ? 0.3 : 0), 0, 1));
    if (v.z > 0.02 && Math.abs(v.y - 0.012) < 0.012 && side > 0.35 && side < 0.75) c.copy(dark);
  });
  head.translate(0, 0.19, 0.03);
  let bill = new THREE.ConeGeometry(0.016, 0.045, 8); bill.rotateX(Math.PI / 2); bill.scale(0.7, 1.1, 1);
  bill = colored(bill, (v, c) => c.set(0x2a2a2c));
  bill.translate(0, 0.185, 0.095);
  const eyes = [-1, 1].map(s => { let e = new THREE.SphereGeometry(0.0085, 8, 6); e = colored(e, (v, c) => c.set(0x050505)); e.translate(s * 0.029, 0.2, 0.068); return e; });
  const feet = [-1, 1].map(s => { let f = new THREE.SphereGeometry(0.022, 8, 6); f.scale(0.9, 0.3, 1.5); f = colored(f, (v, c) => c.set(0x3b3532)); f.translate(s * 0.03, 0.006, 0.025); return f; });
  const mainGeo = mergeGeometries([body, head, bill, ...eyes, ...feet].map(g => { for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(a)) g.deleteAttribute(a); return g; }));
  let wing = new THREE.SphereGeometry(0.05, 12, 8); wing.scale(0.25, 1, 0.6);
  wing = fluff(wing, 0.04, 3);
  wing = colored(wing, (v, c) => c.copy(dark).lerp(grey, 0.15));
  wing.translate(0, -0.045, 0);
  for (const a of Object.keys(wing.attributes)) if (!['position', 'normal', 'color'].includes(a)) wing.deleteAttribute(a);
  GEO = { main: mainGeo, wing };
  return GEO;
}
const MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });

export function buildPufflingModel() {
  const G = geometries();
  const root = new THREE.Group();
  const tilt = new THREE.Group(); root.add(tilt);
  const main = new THREE.Mesh(G.main, MAT); main.castShadow = true; tilt.add(main);
  const wings = [-1, 1].map(s => {
    const piv = new THREE.Group(); piv.position.set(s * 0.068, 0.14, -0.005);
    const w = new THREE.Mesh(G.wing, MAT); w.castShadow = true; piv.add(w); tilt.add(piv);
    piv.userData.side = s; return piv;
  });
  return { root, tilt, wings };
}

// ------------------------------------------------------------------ the flock
export class Pufflings {
  constructor(scene, world, L, audio) {
    this.scene = scene; this.world = world; this.L = L; this.audio = audio;
    this.list = [];
    this.r = rng(9001);
    this.spawnTimer = 0;
    this.target = 22;
    this.saved = 0;
    this.spots = this.makeSpots();
  }
  makeSpots() {
    // stranded pufflings end up near lights: by lamps, lit doors, the harbour and under parked cars
    const spots = [];
    for (const l of this.L.lamps) if (l.road.name !== 'Vitavegur') spots.push({ x: l.x, z: l.z, r: 6 });
    for (const c of this.L.parked ?? []) spots.push({ x: c.x, z: c.z, r: 1.2, under: true });
    return spots;
  }
  findSpawn(player, minDist = 45) {
    for (let k = 0; k < 40; k++) {
      const s = this.r.pick(this.spots);
      const a = this.r.range(0, Math.PI * 2), d = this.r.range(0, s.r);
      const x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d;
      if (player && Math.hypot(x - player.x, z - player.z) < minDist) continue;
      if (!s.under && this.world.blocked(x, z, 0.15)) continue;
      if (this.world.ground(x, z) < 0.6) continue;
      if (this.list.some(p => p.state !== 'gone' && Math.hypot(p.pos.x - x, p.pos.z - z) < 3)) continue;
      return { x, z };
    }
    return null;
  }
  spawn(x, z, arriving = false) {
    const m = buildPufflingModel();
    const s = 1.3 + this.r() * 0.18; m.root.scale.setScalar(s); m.size = s;
    this.scene.add(m.root);
    const p = {
      m, pos: new THREE.Vector3(x, this.world.ground(x, z), z), vel: new THREE.Vector3(), heading: this.r.range(0, 6.28),
      state: 'idle', t: 0, timer: this.r.range(1, 4), target: null, fear: 0, stamina: 1, flap: 0, peepT: this.r.range(1, 8),
      hop: 0, id: this.list.length,
    };
    if (arriving) {
      // fly in from out at sea, attracted by the lights
      p.state = 'arriving';
      p.landAt = new THREE.Vector3(x, this.world.ground(x, z), z);
      const from = new THREE.Vector3(x - 160 + this.r.range(-40, 40), 45 + this.r.range(0, 20), z + this.r.range(-80, 80));
      p.pos.copy(from); p.t = 0; p.dur = from.distanceTo(p.landAt) / 11;
      p.from = from;
    }
    this.list.push(p);
    return p;
  }
  populate(player) {
    for (let i = 0; i < this.target; i++) { const s = this.findSpawn(player, 25); if (s) this.spawn(s.x, s.z); }
  }
  active() { return this.list.filter(p => p.state === 'idle' || p.state === 'waddle' || p.state === 'flee' || p.state === 'arriving'); }
  nearestCatchable(x, z, maxD) {
    let best = null, bd = maxD;
    for (const p of this.list) {
      if (!['idle', 'waddle', 'flee'].includes(p.state)) continue;
      const d = Math.hypot(p.pos.x - x, p.pos.z - z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  // into a box: it leaves the world (the box shows its own pufflings)
  catch(p) { this.audio?.peep(p.pos, 1.25); p.state = 'gone'; }
  // launch one from a hand position out over the sea
  launch(from, dir, up = 5.5, speed = 8) {
    const p = this.spawn(from.x, from.z);
    p.state = 'thrown'; p.t = 0;
    p.pos.copy(from);
    p.vel.set(dir.x * speed, up, dir.z * speed);
    this.saved++;
    return p;
  }
  update(dt, player, cars, car) {
    // keep the town stocked: new pufflings arrive from the sea
    const live = this.list.filter(p => ['idle', 'waddle', 'flee', 'arriving'].includes(p.state)).length;
    this.spawnTimer -= dt;
    if (live < this.target && this.spawnTimer <= 0) {
      const s = this.findSpawn(player ? (player.inCar && car ? car.pos : player.pos) : null, 50);
      if (s) this.spawn(s.x, s.z, true);
      this.spawnTimer = 6;
    }
    this.cars = cars || [];
    for (const p of this.list) this.step(p, dt, player, car);
    // forget the ones that have flown far away
    this.list = this.list.filter(p => {
      if (p.state === 'gone') { p.m.root.removeFromParent(); return false; }
      return true;
    });
  }
  step(p, dt, player, car) {
    const W = this.world;
    p.t += dt;
    const root = p.m.root;
    if (p.state === 'caught') return;
    if (p.state === 'arriving') {
      const k = clamp(p.t / p.dur, 0, 1);
      const e = 1 - (1 - k) * (1 - k);
      p.pos.lerpVectors(p.from, p.landAt, e);
      p.pos.y += Math.sin(k * Math.PI) * 6;
      p.heading = Math.atan2(p.landAt.z - p.from.z, p.landAt.x - p.from.x);
      this.flapWings(p, dt, 14, 1);
      p.m.tilt.rotation.x = lerp(1.1, 0.0, smooth(k, 0.8, 1));
      if (k >= 1) { p.state = 'idle'; p.timer = 2; p.m.tilt.rotation.x = 0; this.audio?.peep(p.pos, 1); }
      this.place(p); return;
    }
    if (p.state === 'thrown' || p.state === 'flying') {
      if (p.state === 'thrown') {
        p.vel.y -= 9.8 * dt * 0.55;
        if (p.t > 0.45) { p.state = 'flying'; p.t = 0; this.audio?.flutter(p.pos); }
      } else {
        // fly out towards the moon over the sea, climbing
        const goal = new THREE.Vector3(MOON_DIR.x, 0, MOON_DIR.z).normalize();
        const desired = goal.multiplyScalar(12); desired.y = 2.5 + Math.sin(p.t * 2) * 0.6;
        p.vel.lerp(desired, 1 - Math.exp(-1.5 * dt));
        if (p.t > 22) p.state = 'gone';
      }
      p.pos.addScaledVector(p.vel, dt);
      p.heading = Math.atan2(p.vel.z, p.vel.x);
      this.flapWings(p, dt, p.state === 'thrown' ? 6 : 15, 1);
      p.m.tilt.rotation.x = 1.2;
      root.position.copy(p.pos);
      root.rotation.set(0, Math.PI / 2 - p.heading, 0);
      return;
    }
    // ---- on the ground
    if (p.frozen > 0) { p.frozen -= dt; this.flapWings(p, dt, 0, 0); this.place(p); return; }
    // a car bearing down: flap and hop out of its way
    if (p.dodgeT > 0) {
      p.dodgeT -= dt; p.hop += dt * 20;
      this.move(p, 6.5, dt); this.flapWings(p, dt, 22, 1);
      this.place(p); p.m.root.position.y += Math.sin(Math.min(1, 1 - p.dodgeT / 0.35) * Math.PI) * 0.45;
      return;
    }
    for (const c of this.cars) {
      const sp = c.speed; if (Math.abs(sp) < 4) continue;
      const dx = p.pos.x - c.pos.x, dz = p.pos.z - c.pos.z; if (dx * dx + dz * dz > 400) continue;
      const f = c.forward, along = (dx * f.x + dz * f.y) * Math.sign(sp), side = -dx * f.y + dz * f.x;
      if (along > -1 && along < Math.abs(sp) * 0.75 + 3 && Math.abs(side) < 1.8 && p.stamina > 0.05) {
        p.dodgeT = 0.35; p.state = 'flee'; p.fleeT = 1;
        const s2 = side >= 0 ? 1 : -1; p.heading = Math.atan2(f.x * s2, -f.y * s2);
        this.audio?.peep(p.pos, 1.5);
        return;
      }
    }
    const threats = [];
    if (player && !player.inCar) threats.push({ x: player.pos.x, z: player.pos.z, r: player.noiseRadius });
    for (const c of this.cars) if (Math.abs(c.speed) > 1) threats.push({ x: c.pos.x, z: c.pos.z, r: 7 });
    let fx = 0, fz = 0, scared = false;
    for (const t of threats) {
      const dx = p.pos.x - t.x, dz = p.pos.z - t.z, d = Math.hypot(dx, dz);
      if (d < t.r) { scared = true; fx += dx / (d + 0.01) * (1 - d / t.r); fz += dz / (d + 0.01) * (1 - d / t.r); }
    }
    if (scared && p.stamina > 0.15) {
      if (p.state !== 'flee') { this.audio?.peep(p.pos, 1.4); }
      p.state = 'flee'; p.fleeT = 1.2;
    }
    if (p.state === 'flee') {
      p.fleeT -= dt;
      p.stamina = Math.max(0, p.stamina - dt * 0.28);
      const fl = Math.hypot(fx, fz);
      if (fl > 0.01) p.heading = turnTo(p.heading, Math.atan2(fz, fx), 6 * dt);
      const spd = 1.7 * (0.4 + 0.6 * p.stamina);
      this.move(p, spd, dt);
      this.flapWings(p, dt, 12, 0.7);
      p.hop += dt * 14;
      if (p.fleeT <= 0 && !scared) { p.state = 'idle'; p.timer = this.r.range(1.5, 3); }
      if (p.stamina <= 0.15) { p.state = 'idle'; p.timer = 2.5; } // too tired to run
    } else {
      p.stamina = Math.min(1, p.stamina + dt * 0.12);
      this.flapWings(p, dt, 0, 0);
      p.timer -= dt;
      if (p.state === 'idle' && p.timer <= 0) {
        p.state = 'waddle'; p.timer = this.r.range(1, 2.5);
        p.heading += this.r.range(-1.5, 1.5);
      } else if (p.state === 'waddle') {
        this.move(p, 0.35, dt);
        p.hop += dt * 9;
        if (p.timer <= 0) { p.state = 'idle'; p.timer = this.r.range(2, 5); }
      }
    }
    // peeping
    p.peepT -= dt;
    if (p.peepT <= 0) { p.peepT = this.r.range(3, 9); this.audio?.peep(p.pos, 1); }
    this.place(p);
  }
  move(p, spd, dt) {
    const W = this.world;
    const nx = p.pos.x + Math.cos(p.heading) * spd * dt, nz = p.pos.z + Math.sin(p.heading) * spd * dt;
    const push = W.pushOut(nx, nz, 0.1);
    const gx = nx + push.x, gz = nz + push.z;
    const gh = W.ground(gx, gz);
    if (gh < 0.4 || Math.abs(gh - p.pos.y) > 0.6) { p.heading += Math.PI * 0.6; return; }
    p.pos.x = gx; p.pos.z = gz;
    if (push.x || push.z) p.heading = turnTo(p.heading, Math.atan2(push.z, push.x) + Math.PI / 2, 2 * dt);
  }
  flapWings(p, dt, rate, amt) {
    p.flap += dt * rate;
    p.wingAmt = damp(p.wingAmt ?? 0, amt, 10, dt);
    for (const w of p.m.wings) w.rotation.z = w.userData.side * (0.15 + p.wingAmt * (0.9 + Math.sin(p.flap) * 0.9));
  }
  place(p) {
    const W = this.world;
    if (p.state !== 'arriving') p.pos.y = damp(p.pos.y, W.ground(p.pos.x, p.pos.z), 20, 1 / 60);
    const root = p.m.root;
    root.position.copy(p.pos);
    const moving = p.state === 'waddle' || p.state === 'flee';
    root.position.y += moving ? Math.abs(Math.sin(p.hop)) * (p.state === 'flee' ? 0.05 : 0.02) : 0;
    root.rotation.set(0, Math.PI / 2 - p.heading, moving ? Math.sin(p.hop) * 0.18 : 0);
    if (p.state === 'idle') p.m.tilt.rotation.x = Math.max(0, Math.sin(p.t * 0.7 + p.id)) * 0.25; // pecking
    else if (p.state !== 'arriving') p.m.tilt.rotation.x = moving ? 0.25 : 0;
  }
}
function turnTo(a, b, k) { return a + clamp(angleDiff(a, b), -k, k); }
function smooth(v, a, b) { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
