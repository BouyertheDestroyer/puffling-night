import * as THREE from 'three';
import { Npc } from './people.js';
import { SEAT } from './player.js';
import { clamp, angleDiff, rng } from './noise.js';

const COLORS = [0xe8e8e8, 0x1d2b44, 0x6e7478, 0x111111, 0x2f4a3a, 0xc8c2b0, 0x335d8a, 0xd8b030, 0x5a2a6a];

// Other drivers. Far away they glide along the lane; near the player they drive the real car physics.
export class Traffic {
  constructor(game) {
    this.g = game; this.list = []; this.r = rng(3131); this.target = 6; this.spawnT = 0;
    this.roads = game.L.roads.filter(r => r.name !== 'Vitavegur');
    // where roads meet: for each road point, the nearest point on every other road within reach
    this.junc = new Map();
    for (const a of this.roads) a.pts.forEach((p, i) => {
      const out = [];
      for (const b of this.roads) {
        if (b === a) continue;
        let bj = -1, bd = i === 0 || i === a.pts.length - 1 ? 9 : 6;
        b.pts.forEach((q, j) => { const d = Math.hypot(q.x - p.x, q.z - p.z); if (d < bd) { bd = d; bj = j; } });
        if (bj >= 0) out.push({ road: b, i: bj });
      }
      if (out.length) this.junc.set(a.id * 1000 + i, out);
    });
  }
  // a point in the right-hand lane
  lane(road, i, dir) {
    const pts = road.pts, n = pts.length;
    const a = pts[clamp(i - 1, 0, n - 1)], b = pts[clamp(i + 1, 0, n - 1)], p = pts[clamp(i, 0, n - 1)];
    let tx = (b.x - a.x) * dir, tz = (b.z - a.z) * dir; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const off = road.width / 4 + 0.15;
    return { x: p.x - tz * off, z: p.z + tx * off, tx, tz };
  }
  spawn(minD, maxD) {
    const P = this.g.focus();
    for (let k = 0; k < 25; k++) {
      const road = this.r.pick(this.roads), i = this.r.int(2, road.pts.length - 3), dir = this.r.chance(0.5) ? 1 : -1;
      const p = this.lane(road, i, dir), d = Math.hypot(p.x - P.x, p.z - P.z);
      if (d < minD || d > maxD) continue;
      if (this.g.cars.some(c => Math.hypot(c.pos.x - p.x, c.pos.z - p.z) < 14)) continue;
      const car = this.g.addCar(this.r.pick(COLORS), p.x, p.z, Math.atan2(p.tz, p.tx));
      car.setLights(true); car.engineOn = true;
      const driver = new Npc(this.g.scene, this.g.world, 'ped', this.r);
      driver.state = 'driver'; this.g.people.list.push(driver);
      this.seat(driver, car);
      const ai = { car, driver, road, i: i + dir, dir, f: 0, kin: true, stuckT: 0, honkT: 0, blockT: 0, mode: 'drive', t: 0 };
      car.ai = ai; car.driver = driver;
      if (this.r.chance(0.35)) { const b = this.g.newBox(); b.count = this.r.int(2, 5); b.toCar(car); }
      this.list.push(ai);
      return ai;
    }
    return null;
  }
  seat(driver, car) {
    car.model.body.add(driver.root);
    driver.root.position.copy(SEAT); driver.root.rotation.set(0, 0, 0);
    driver.person.anim.s.sit = 1; driver.car = car; driver.pos.copy(car.pos);
  }
  populate() { for (let i = 0; i < this.target; i++) this.spawn(30, 260); }
  // the driver leaves the car: pulled out by the player, or getting out after a crash
  eject(car, how) {
    const ai = car.ai, n = car.driver; if (!n) return;
    this.g.scene.attach(n.root);
    const f = car.forward, ds = car.doorSpot();
    n.state = 'walk'; n.route = null; n.place(ds.x + f.y * 0.4, ds.z - f.x * 0.4, Math.atan2(-f.x, f.y));
    car.driver = null; n.car = null;
    if (ai) { const i = this.list.indexOf(ai); if (i >= 0) this.list.splice(i, 1); car.ai = null; }
    const P = this.g.people;
    if (how === 'jacked') { n.knockDown(f.y * 3.2, -f.x * 3.2, 2.2, 1.4); n.wasHit = true; P.say(n, 'jacked', 3); }
    else if (how === 'angry') { n.state = 'angry'; n.t = 0; P.say(n, 'angry', 2); }
    else { n.state = 'flee'; n.t = 6; n.threat = { x: car.pos.x, z: car.pos.z }; }
  }
  remove(ai) {
    const i = this.list.indexOf(ai); if (i >= 0) this.list.splice(i, 1);
    ai.car.ai = null;
    this.g.removeCar(ai.car); // takes the driver and any box with it
  }
  update(dt) {
    const g = this.g, P = g.focus(), cam = g.E.camera.position;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 1.5;
      for (const ai of [...this.list]) if (Math.hypot(ai.car.pos.x - P.x, ai.car.pos.z - P.z) > 330) this.remove(ai);
      if (this.list.length < this.target) this.spawn(150, 300);
    }
    for (const ai of [...this.list]) this.drive(ai, dt, P, cam);
  }
  drive(ai, dt, P, cam) {
    const g = this.g, car = ai.car;
    ai.t += dt; ai.honkT -= dt;
    const d = Math.hypot(car.pos.x - P.x, car.pos.z - P.z);
    // level of detail: physics near the player, a simple glide far away
    if (ai.kin && d < 110) { ai.kin = false; car.kinematic = false; car.wake(); }
    else if (!ai.kin && d > 140 && car.upright > 0.8 && !car.inWater) { ai.kin = true; car.kinematic = true; ai.f = 0; }
    if (car.inWater > 0.5) { if (car.inWater > 9) this.remove(ai); else car.update(dt, null); return; }
    let want = ai.road.kind === 'main' ? 11 : 8.5;
    // look ahead along the lane
    const n = ai.road.pts.length;
    const ahead = []; let i = ai.i;
    for (let k = 0; k < 4 && i >= 0 && i < n; k++, i += ai.dir) ahead.push(this.lane(ai.road, i, ai.dir));
    if (ahead.length >= 3) { // slow for bends
      const a = ahead[0], c = ahead[2];
      const bend = Math.abs(angleDiff(Math.atan2(a.tz, a.tx), Math.atan2(c.tz, c.tx)));
      want = Math.min(want, 4 + 9 * (1 - clamp(bend / 1.2, 0, 1)));
    }
    if (ai.turning > 0) { ai.turning -= dt; want = Math.min(want, 4.5); }
    if (ai.kin) {
      const a = this.lane(ai.road, ai.i - ai.dir, ai.dir), b = this.lane(ai.road, ai.i, ai.dir);
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      ai.f += want * dt / len;
      if (ai.f >= 1) { ai.f -= 1; this.next(ai, true); }
      const a2 = this.lane(ai.road, ai.i - ai.dir, ai.dir), b2 = this.lane(ai.road, ai.i, ai.dir);
      const f = Math.min(ai.f, 1);
      car.setPose(a2.x + (b2.x - a2.x) * f, a2.z + (b2.z - a2.z) * f, Math.atan2(b2.z - a2.z, b2.x - a2.x), want);
      return;
    }
    // ---- physics driving
    const tgt = this.lane(ai.road, ai.i, ai.dir);
    const fx = Math.cos(car.heading), fz = Math.sin(car.heading);
    const dx = tgt.x - car.pos.x, dz = tgt.z - car.pos.z, dist = Math.hypot(dx, dz);
    if (dist < 4.5 || (dx * fx + dz * fz < 0 && dist < 10)) this.next(ai, false);
    // aim a little further along the lane
    const aim = this.lane(ai.road, clamp(ai.i + (dist < 7 ? ai.dir : 0), 0, n - 1), ai.dir);
    let steer = clamp(angleDiff(car.heading, Math.atan2(aim.z - car.pos.z, aim.x - car.pos.x)) * 2.2, -1, 1);
    // anything in the way?
    const obst = this.blocked(car, fx, fz);
    if (obst) { want = Math.min(want, Math.max(0, (obst.d - 4.5) * 0.9)); if (obst.player) ai.blockT += dt; }
    else ai.blockT = 0;
    // the player walking up to the car: stop and wait (or get pulled out)
    const pl = g.player;
    if (pl.seq?.car === car || (!pl.inCar && Math.hypot(pl.pos.x - car.pos.x, pl.pos.z - car.pos.z) < 4.5)) want = 0;
    if (ai.blockT > 2 && ai.honkT <= 0) { g.audio.horn(); ai.honkT = 6; g.people.say(ai.driver, 'honk'); }
    let thr = 0, brk = 0, hb = false;
    const v = car.speed;
    if (ai.mode === 'reverse') {
      brk = 0.7; steer = -ai.revSteer; thr = 0;
      if (ai.t > 2.2) { ai.mode = 'drive'; ai.t = 0; }
    } else {
      if (v < want - 0.5) thr = clamp((want - v) * 0.35, 0.15, 1);
      else if (v > want + 0.8) brk = clamp((v - want) * 0.3, 0.1, 1);
      if (want === 0 && Math.abs(v) < 1) hb = true;
      // stuck against something: back up and try again
      if (want > 3 && Math.abs(v) < 0.4) ai.stuckT += dt; else ai.stuckT = 0;
      if (ai.stuckT > 3) { ai.mode = 'reverse'; ai.t = 0; ai.revSteer = steer || 1; ai.stuckT = 0; }
    }
    car.update(dt, { throttle: thr, brake: brk, steer, handbrake: hb, parked: want === 0 && Math.abs(v) < 0.5 });
    // rolled over or wrecked: the driver gives up on it
    if (car.upright < 0.4) { ai.flipT = (ai.flipT ?? 0) + dt; if (ai.flipT > 2) this.eject(car, 'flee'); }
    else ai.flipT = 0;
  }
  // move on to the next point; at junctions sometimes turn, at dead ends turn round
  next(ai, kin) {
    const n = ai.road.pts.length;
    const opts = this.junc.get(ai.road.id * 1000 + ai.i);
    const atEnd = ai.i + ai.dir < 0 || ai.i + ai.dir >= n;
    if (opts && (atEnd || (ai.t > 4 && this.r.chance(0.3)))) {
      const o = this.r.pick(opts), m = o.road.pts.length;
      const dir = o.i <= 1 ? 1 : o.i >= m - 2 ? -1 : this.r.chance(0.5) ? 1 : -1;
      ai.road = o.road; ai.i = clamp(o.i + dir, 0, m - 1); ai.dir = dir; ai.t = 0; ai.turning = 2.5; ai.f = 0;
      return;
    }
    if (ai.i + ai.dir < 0 || ai.i + ai.dir >= n) {
      // dead end: turn round (out of sight it simply happens)
      ai.dir = -ai.dir; ai.i = clamp(ai.i + ai.dir, 0, n - 1); ai.f = 0;
      if (!kin) { ai.mode = 'reverse'; ai.t = 0; ai.revSteer = 1; }
      return;
    }
    ai.i += ai.dir;
  }
  // the nearest thing in front of the car, within braking distance
  blocked(car, fx, fz) {
    const g = this.g, reach = 5 + Math.max(0, car.speed) * 1.3;
    let best = null;
    const test = (x, z, w, isPlayer) => {
      const dx = x - car.pos.x, dz = z - car.pos.z, f = dx * fx + dz * fz, l = -dx * fz + dz * fx;
      if (f > 0 && f < reach && Math.abs(l) < 1.5 + w && (!best || f < best.d)) best = { d: f, player: isPlayer };
    };
    for (const c of g.cars) if (c !== car) test(c.pos.x, c.pos.z, 0.9, c === g.car && g.player.inCar);
    const pl = g.player;
    if (!pl.inCar) test(pl.pos.x, pl.pos.z, 0.3, true);
    for (const p of g.people.list) if (p.state !== 'driver' && Math.abs(p.pos.x - car.pos.x) < reach && Math.abs(p.pos.z - car.pos.z) < reach) test(p.pos.x, p.pos.z, 0.3, false);
    return best;
  }
}
