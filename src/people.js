import * as THREE from 'three';
import { buildPerson } from './character.js';
import { Walker } from './walker.js';
import { clamp, damp, angleDiff, rng } from './noise.js';

// Townsfolk out on the pavements (some of them rescuing pufflings of their own) and the draugar,
// the restless dead of Icelandic stories, who wander the edges of town at night.
const SWEATERS = [['#d9cfbd', '#3b3029', '#8a2b22'], ['#2b2d33', '#d9d4c8', '#7a8c9a'], ['#7a2a22', '#efe8da', '#2a2a2a'],
  ['#3d5a46', '#e8e2d0', '#b8862a'], ['#9aa0a6', '#1f2a3a', '#c23a2a'], ['#e8e2d2', '#5a3a2a', '#2f5f8a'], ['#24364f', '#e9e4d6', '#d8a92a']];
const HATS = [['#a52a22', '#f0ece2'], ['#2a3a5a', '#e0e0e0'], ['#3a5a3a', '#f0d040'], ['#555555', '#cccccc'], ['#d8b030', '#3a2a1a']];
const SKINS = [0xf1c6a8, 0xd6a184, 0xb07a5a, 0x8a5a3c, 0x5e3b26, 0xe8b896];
const HAIR = [0x3a2416, 0x1a1410, 0x8a5a2a, 0xc8a060, 0x6a6a6a, 0xa03a1a];
const TROUSERS = [0x26324a, 0x2a2a2a, 0x4a3a2a, 0x3a4a3a, 0x5a5a62, 0x1a2436];

export class Npc extends Walker {
  constructor(scene, world, kind, r) {
    const look = kind === 'zombie'
      ? { zombie: true, sweater: r.pick(['#3a3a30', '#2a2c28', '#45403a']), pattern: '#1a1a16', pattern2: '#3a2a20', skin: r.pick([0x7d8c7a, 0x8a9488, 0x6f7d70]), hair: 0x2a2a26, trousers: 0x23221e, boots: 0x1a1a18, mitten: 0x6a7468 }
      : (() => { const s = r.pick(SWEATERS), h = r.pick(HATS); return { sweater: s[0], pattern: s[1], pattern2: s[2], hatA: h[0], hatB: h[1], skin: r.pick(SKINS), hair: r.pick(HAIR), trousers: r.pick(TROUSERS), boots: r.pick([0x1e3a24, 0x2a1a12, 0x111111, 0x5a2a1a]), mitten: r.pick([0x6b6560, 0x8a2a22, 0x2a3a5a]) }; })();
    super(scene, world, buildPerson(look));
    this.kind = kind;
    this.voice = { pitch: kind === 'zombie' ? 0.1 : 0.55 + r() * 0.95, rate: 0.95 + r() * 0.25, voice: r.int(0, 8) };
    this.hp = kind === 'zombie' ? 2 : 3; this.maxHp = this.hp;
    this.state = kind === 'zombie' ? 'rise' : 'walk'; this.t = 0; this.cool = 0; this.talkCool = r.range(2, 10);
    this.walkSpeed = kind === 'zombie' ? 0.8 : 1.2 + r() * 0.5;
    this.box = null; this.route = null; this.target = null; this.threat = null;
    this.noEdges = true; this.radius = 0.3;
    this.r = r; this.id = r.int(0, 1e9);
    const s = 0.92 + r() * 0.16; this.root.scale.setScalar(s);
  }
}

export class People {
  constructor(game) {
    this.g = game; this.list = []; this.r = rng(4711);
    this.pedTarget = 14; this.zombieTarget = 6; this.spawnT = 0;
    this.groanT = 3;
  }
  get peds() { return this.list.filter(n => n.kind === 'ped'); }
  // ------------------------------------------------------------- spawning
  sidewalkPoint(minD, maxD) {
    const { L } = this.g, P = this.g.focus();
    for (let k = 0; k < 30; k++) {
      const road = this.r.pick(L.roads);
      if (road.name === 'Vitavegur') continue;
      const i = this.r.int(1, road.pts.length - 2), side = this.r.chance(0.5) ? 1 : -1;
      const p = this.walkPt(road, i, side);
      const d = Math.hypot(p.x - P.x, p.z - P.z);
      if (d < minD || d > maxD) continue;
      if (this.g.world.blocked(p.x, p.z, 0.35)) continue;
      return { p, route: { road, i, dir: this.r.chance(0.5) ? 1 : -1, side } };
    }
    return null;
  }
  walkPt(road, i, side) {
    const pts = road.pts, a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], p = pts[i];
    const tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1;
    const off = road.width / 2 + this.g.L.SIDEWALK * 0.55;
    return { x: p.x - tz / l * side * off, z: p.z + tx / l * side * off };
  }
  spawnPed(minD = 45, maxD = 115) {
    const s = this.sidewalkPoint(minD, maxD); if (!s) return null;
    const n = new Npc(this.g.scene, this.g.world, 'ped', this.r);
    n.route = s.route; n.place(s.p.x, s.p.z, this.r.range(0, 6.28));
    if (this.r.chance(0.35)) { // out rescuing pufflings too
      const b = this.g.newBox(); b.count = this.r.int(1, 4); b.toHands(n); n.box = b;
    }
    this.list.push(n); return n;
  }
  spawnZombie(minD = 45, maxD = 110) {
    const { world, L } = this.g, P = this.g.focus();
    for (let k = 0; k < 30; k++) {
      const a = this.r.range(0, 6.28), d = this.r.range(minD, maxD);
      const x = P.x + Math.cos(a) * d, z = P.z + Math.sin(a) * d;
      if (world.ground(x, z) < 1.2 || L.roadDist(x, z, 10).d < 3 || world.blocked(x, z, 0.6)) continue;
      if (this.g.jail && Math.hypot(x - this.g.jail.x, z - this.g.jail.z) < 15) continue;
      if (Math.hypot(x - L.lookout.x, z - L.lookout.z) < 45) continue; // leave the lookout in peace
      const n = new Npc(this.g.scene, world, 'zombie', this.r);
      n.place(x, z, this.r.range(0, 6.28)); n.noWater = true;
      n.state = 'rise'; n.t = 0; n.pos.y -= 1.8; n.sync();
      this.list.push(n); return n;
    }
    return null;
  }
  remove(n) {
    const i = this.list.indexOf(n); if (i < 0) return;
    if (n.box) { if (n.box.where === 'hands' && n.box.holder === n) this.g.removeBox(n.box); n.box = null; }
    n.root.removeFromParent();
    // free the GPU side: each person has their own merged meshes and materials (textures are shared)
    for (const m of n.person.meshes ?? []) { m.geometry.dispose(); m.skeleton?.dispose(); }
    for (const k in n.person.M) n.person.M[k].dispose();
    this.list.splice(i, 1);
  }
  populate() {
    for (let i = 0; i < this.pedTarget; i++) this.spawnPed(12, 115);
    for (let i = 0; i < this.zombieTarget; i++) this.spawnZombie(40, 110);
  }
  // ------------------------------------------------------------- per frame
  update(dt) {
    const g = this.g, P = g.focus();
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 1;
      for (const n of [...this.list]) {
        if (n.state === 'driver') continue;
        const d = Math.hypot(n.pos.x - P.x, n.pos.z - P.z);
        if (d > 160) this.remove(n);
        else n.person.setShadow?.(d < 40);
      }
      const peds = this.list.filter(n => n.kind === 'ped' && n.state !== 'driver').length;
      const zs = this.list.filter(n => n.kind === 'zombie').length;
      if (peds < this.pedTarget) this.spawnPed();
      if (zs < this.zombieTarget) this.spawnZombie();
    }
    // the dead moan now and then
    this.groanT -= dt;
    if (this.groanT <= 0) {
      this.groanT = 2.5 + this.r() * 4;
      const z = this.list.filter(n => n.kind === 'zombie' && n.state !== 'sink').sort((a, b) => a.pos.distanceToSquared(P) - b.pos.distanceToSquared(P))[0];
      if (z && z.pos.distanceTo(P) < 45) g.audio.groan(z.pos.clone().setY(z.pos.y + 1.6));
    }
    for (const n of [...this.list]) this.step(n, dt);
  }
  step(n, dt) {
    const g = this.g;
    n.t += dt; n.cool -= dt; n.talkCool -= dt;
    if (n.state === 'driver') { if (n.car) n.pos.copy(n.car.pos); n.person.anim.update(dt, { sit: true }); return; }
    // 6. a destroyed draugr goes back into the ground wherever it ended up (even the sea)
    if (n.kind === 'zombie' && n.dead && !n.ko && n.state !== 'sink') { n.state = 'sink'; n.t = 0; }
    // knocked down
    if (n.ko) {
      const ev = n.updateKO(dt);
      if (ev?.gettingUp && n.kind === 'ped' && n.talkCool < 0) this.say(n, 'getUp');
      if (ev?.up) this.afterGetUp(n);
      if (n.kind === 'zombie' && n.dead && n.ko && n.ko.phase === 'down') { n.ko = null; n.state = 'sink'; n.t = 0; n.fall = 1; }
      if (n.ko && n.swimming) n.ko = null;
      n.person.anim.update(dt, { ko: !!n.ko && n.ko.phase !== 'up', speed: 0 });
      n.sync(); return;
    }
    const P = g.player, pFoot = !P.inCar && !P.seq && !g.jailed;
    const dP = Math.hypot(P.pos.x - n.pos.x, P.pos.z - n.pos.z);
    let mx = 0, mz = 0, speed = n.walkSpeed, anim = {};
    const toward = (x, z) => { const dx = x - n.pos.x, dz = z - n.pos.z, d = Math.hypot(dx, dz) || 1; mx = dx / d; mz = dz / d; return d; };
    if (n.kind === 'zombie') {
      anim.zombie = true;
      if (n.state === 'rise') {
        const gy = g.world.ground(n.pos.x, n.pos.z);
        n.pos.y = Math.min(gy, n.pos.y + dt * 0.75);
        if (n.pos.y >= gy - 0.01) { n.state = 'wander'; n.t = 0; }
        n.person.anim.update(dt, { zombie: true, speed: 0.3 }); n.sync(); return;
      }
      if (n.state === 'sink') { // back into the ground it came from
        n.pos.y -= dt * 0.9; n.fall = 1;
        if (n.t > 2.4) { this.remove(n); return; }
        n.person.anim.update(dt, { ko: true }); n.sync(); return;
      }
      // pick the nearest living thing on foot
      let tgt = null, best = 22;
      if (pFoot && !P.swimming && dP < best) { tgt = P; best = dP; }
      for (const o of this.list) {
        if (o.kind !== 'ped' || o.ko || o.state === 'driver') continue;
        const d = Math.hypot(o.pos.x - n.pos.x, o.pos.z - n.pos.z);
        if (d < best - 4) { tgt = o; best = d; }
      }
      if (n.state === 'lunge') {
        speed = 0; anim.reach = true;
        if (n.t > 0.55 && !n.struck) {
          n.struck = true;
          const t = n.lungeAt;
          if (t && !t.ko && Math.hypot(t.pos.x - n.pos.x, t.pos.z - n.pos.z) < 1.6) {
            if (t === P) g.hitPlayer(n, 2); else this.knock(t, n.pos, 4, 3);
          }
        }
        if (n.t > 1.1) { n.state = 'chase'; n.cool = 2; }
      } else if (tgt) {
        n.state = 'chase';
        const d = toward(tgt.pos.x, tgt.pos.z);
        speed = d < 7 ? 2.9 : 2.0;
        if (d < 1.15 && n.cool <= 0) { n.state = 'lunge'; n.t = 0; n.struck = false; n.lungeAt = tgt; }
      } else {
        n.state = 'wander';
        if (n.t > 4 || !n.wanderH) { n.t = 0; n.wanderH = n.r.range(0, 6.28); }
        // the lookout is holy ground: they drift away from it
        const lk = g.L.lookout, dl = Math.hypot(n.pos.x - lk.x, n.pos.z - lk.z);
        if (dl < 35) n.wanderH = Math.atan2(n.pos.z - lk.z, n.pos.x - lk.x);
        mx = Math.cos(n.wanderH); mz = Math.sin(n.wanderH); speed = 0.7;
      }
    } else {
      // ---------------- townsfolk
      if (n.state === 'walk' || n.state === 'idle' || n.state === 'hunt') {
        // things worth running from
        const z = this.list.find(o => o.kind === 'zombie' && o.state !== 'sink' && !o.ko && Math.hypot(o.pos.x - n.pos.x, o.pos.z - n.pos.z) < 9);
        if (z) { this.flee(n, z.pos, 'zombie'); }
        else if (P.inCar && g.car && Math.abs(g.car.speed) > 7) {
          const c = g.car, dx = n.pos.x - c.pos.x, dz = n.pos.z - c.pos.z, d = Math.hypot(dx, dz);
          const f = c.forward, ahead = (dx * f.x + dz * f.y) * Math.sign(c.speed);
          if (d < 10 && ahead > 0 && Math.abs(-dx * f.y + dz * f.x) < 2.2) { // jump out of the way
            n.state = 'flee'; n.t = 4.5; n.threat = { x: c.pos.x, z: c.pos.z }; n.dodge = 0.5;
          }
        }
      }
      if (n.state === 'walk') {
        const R = n.route;
        if (!R) { this.findRoute(n); }
        else {
          const p = this.walkPt(R.road, R.i, R.side);
          if (toward(p.x, p.z) < 1.3) this.advance(n);
        }
        // greet the player when passing
        if (pFoot && dP < 3 && n.talkCool < 0 && n.r.chance(0.5)) { this.say(n, 'greet'); n.talkCool = 25; }
        else if (dP < 3) n.talkCool = Math.max(n.talkCool, 2);
        // rescuers go after pufflings
        if (n.box && n.box.count < 5 && n.cool <= 0 && n.t > 3 && n.box.where === 'hands') {
          const pf = g.pufflings.nearestCatchable(n.pos.x, n.pos.z, 12);
          if (pf) { n.state = 'hunt'; n.target = pf; n.t = 0; }
          n.cool = 2;
        }
        if (n.t > 18 && n.r.chance(dt * 0.15)) { n.state = 'idle'; n.t = 0; }
      } else if (n.state === 'idle') {
        speed = 0; if (n.t > 4) { n.state = 'walk'; n.t = 0; }
      } else if (n.state === 'hunt') {
        const pf = n.target;
        if (!n.box || !pf || !['idle', 'waddle', 'flee'].includes(pf.state) || n.t > 12) { n.state = 'walk'; n.cool = 25; this.findRoute(n); }
        else {
          const d = toward(pf.pos.x, pf.pos.z); speed = d < 3 ? 0.9 : 1.6;
          if (d < 0.8) { g.pufflings.catch(pf, true); n.box.count++; n.state = 'walk'; n.cool = 30; n.t = 0; this.findRoute(n); }
        }
      } else if (n.state === 'flee') {
        const th = n.threat;
        const dx = n.pos.x - th.x, dz = n.pos.z - th.z, d = Math.hypot(dx, dz) || 1;
        mx = dx / d; mz = dz / d;
        if (n.dodge > 0) { n.dodge -= dt; const s = Math.sign((n.id % 2) - 0.5); [mx, mz] = [-mz * s, mx * s]; }
        speed = 5.2; anim.panic = n.dodge <= 0;
        n.t -= dt * 2; // (t counts down while fleeing)
        if (n.t <= 0 || d > 40) { n.state = 'walk'; n.t = 0; this.findRoute(n); }
      } else if (n.state === 'angry') {
        if (!pFoot || dP > 30 || n.t > 15) { n.state = 'walk'; n.t = 0; this.findRoute(n); }
        else if (n.punch) {
          speed = 0; n.punch.t += dt / 0.45; anim.punch = n.punch.t; anim.punchSide = n.punch.side;
          if (!n.punch.hit && n.punch.t > 0.6) { n.punch.hit = true; if (dP < 1.5) g.hitPlayer(n, 1); }
          if (n.punch.t >= 1) { n.punch = null; n.cool = 0.9 + n.r() * 0.6; }
        } else {
          const d = toward(P.pos.x, P.pos.z); speed = d > 1.3 ? 4.4 : 0; anim.guard = d < 4;
          if (d < 1.3) { n.heading = Math.atan2(mz, mx); if (n.cool <= 0) n.punch = { t: 0, side: n.r.chance(0.5) ? 'L' : 'R', hit: false }; }
        }
      }
      if (n.box) anim.carry = true;
    }
    if (n.noWater) { const gx = n.pos.x + mx * 0.6, gz = n.pos.z + mz * 0.6; if (g.world.ground(gx, gz) < 0.4) { mx = -mx; mz = -mz; n.wanderH = (n.wanderH ?? 0) + Math.PI; } }
    const ev = n.locomote(dt, mx, mz, speed, { turn: n.kind === 'zombie' ? 3 : 8 });
    if (ev.blocked && n.state === 'walk') this.advance(n);
    if (ev.blocked && n.state === 'wander') n.wanderH += 2;
    anim.speed = n.speed; anim.swim = n.swimming;
    n.person.anim.update(dt, anim);
    n.sync();
  }
  // ------------------------------------------------------------- routes along the pavements
  findRoute(n) {
    const { seg } = this.g.L.roadDist(n.pos.x, n.pos.z, 40);
    if (!seg || seg.road.name === 'Vitavegur') { n.route = null; n.state = n.kind === 'ped' ? 'idle' : n.state; n.t = 0; return; }
    const cross = (seg.bx - seg.ax) * (n.pos.z - seg.az) - (seg.bz - seg.az) * (n.pos.x - seg.ax);
    n.route = { road: seg.road, i: Math.min(seg.road.pts.length - 2, Math.max(1, seg.i)), dir: n.r.chance(0.5) ? 1 : -1, side: cross > 0 ? 1 : -1 };
  }
  advance(n) {
    const R = n.route; if (!R) return;
    const next = R.i + R.dir;
    if (next < 1 || next > R.road.pts.length - 2) {
      // end of the street: turn onto a street that meets it, or turn back
      const end = R.road.pts[R.i];
      const other = this.g.L.roads.filter(r => r !== R.road && r.name !== 'Vitavegur').map(r => {
        let bi = -1, bd = 12; r.pts.forEach((p, j) => { const d = Math.hypot(p.x - end.x, p.z - end.z); if (d < bd) { bd = d; bi = j; } });
        return { r, bi };
      }).filter(o => o.bi > 0 && o.bi < o.r.pts.length - 1);
      if (other.length && n.r.chance(0.8)) { const o = n.r.pick(other); n.route = { road: o.r, i: o.bi, dir: n.r.chance(0.5) ? 1 : -1, side: R.side }; }
      else R.dir = -R.dir;
    } else R.i = next;
  }
  // ------------------------------------------------------------- reactions
  say(n, kind, prio = 1) {
    const d = Math.hypot(n.pos.x - this.g.E.camera.position.x, n.pos.z - this.g.E.camera.position.z);
    const text = this.g.voices.say(kind, n.voice, d, prio);
    if (d < 30) this.g.ui.say(text);
    n.talkCool = 4;
  }
  flee(n, from, line) {
    if (n.state !== 'flee' && n.talkCool < 0 && line) this.say(n, line);
    n.state = 'flee'; n.t = 7; n.threat = { x: from.x, z: from.z }; n.dodge = 0;
  }
  // a punch or a cut from the player
  hurt(n, dmg, dir, knife) {
    n.hp -= dmg;
    if (n.kind === 'zombie') {
      if (n.hp <= 0) { n.dead = true; this.knock(n, n.pos.clone().sub(new THREE.Vector3(dir.x, 0, dir.z)), 3, 1); }
      else { n.pos.x += dir.x * 0.35; n.pos.z += dir.z * 0.35; n.cool = Math.max(n.cool, 0.8); }
      return;
    }
    if (n.state === 'driver') return;
    if (n.hp <= 0) { this.knock(n, n.pos.clone().sub(new THREE.Vector3(dir.x, 0, dir.z)), knife ? 3.5 : 3, knife ? 9 : 5); n.hp = n.maxHp; n.wasHit = true; }
    else {
      n.pos.x += dir.x * 0.35; n.pos.z += dir.z * 0.35;
      this.say(n, 'hit', 2);
      if (n.state !== 'angry' && n.r.chance(n.box ? 0.25 : 0.45)) { n.state = 'angry'; n.t = 0; n.cool = 0.5; }
      else if (n.state !== 'angry') this.flee(n, this.g.player.pos, null);
    }
    this.alarm(n.pos, n);
  }
  // knocked over by a blow, a car or a draugr
  knock(n, from, speed, dur, up = 2.5) {
    const dx = n.pos.x - from.x, dz = n.pos.z - from.z, d = Math.hypot(dx, dz) || 1;
    n.knockDown(dx / d * speed, dz / d * speed, up, dur);
    n.punch = null;
    if (n.kind === 'ped') { if (n.talkCool < 2) this.say(n, 'hit', 2); this.dropBox(n); }
  }
  dropBox(n) {
    if (!n.box) return;
    const b = n.box; n.box = null;
    this.g.dropBoxAt(b, n.pos, n.heading);
  }
  afterGetUp(n) {
    if (n.kind === 'zombie') { if (n.dead) { n.state = 'sink'; n.t = 0; } else n.state = 'wander'; return; }
    const g = this.g;
    if (n.wasHit && n.r.chance(0.35) && !g.player.inCar) { n.state = 'angry'; n.t = 0; this.say(n, 'angry', 2); }
    else this.flee(n, g.player.pos, null);
    n.wasHit = false;
  }
  // others nearby see a fight and run
  alarm(at, except) {
    for (const o of this.list) {
      if (o === except || o.kind !== 'ped' || o.ko || o.state === 'angry' || o.state === 'driver') continue;
      const d = Math.hypot(o.pos.x - at.x, o.pos.z - at.z);
      if (d < 14 && o.r.chance(0.7)) this.flee(o, this.g.player.pos, o.talkCool < 0 && o.r.chance(0.4) ? 'flee' : null);
    }
  }
  // the closest person you could pinch from: holding a box, standing, and you are behind them
  pickpocketTarget(P, maxD = 1.7) {
    let best = null, bd = maxD;
    for (const n of this.list) {
      if (n.kind !== 'ped' || !n.box || n.ko || n.state === 'driver') continue;
      const d = Math.hypot(n.pos.x - P.x, n.pos.z - P.z);
      if (d < bd) { bd = d; best = n; }
    }
    if (!best) return null;
    const ax = P.x - best.pos.x, az = P.z - best.pos.z;
    const behind = (ax * Math.cos(best.heading) + az * Math.sin(best.heading)) / (bd || 1) < -0.3;
    return { n: best, behind: behind && best.state !== 'angry' && best.state !== 'flee' };
  }
  // the person a swing would land on
  meleeTarget(P, heading, reach) {
    let best = null, bd = reach;
    const fx = Math.cos(heading), fz = Math.sin(heading);
    for (const n of this.list) {
      if (n.state === 'driver' || n.state === 'sink' || n.state === 'rise' || (n.ko && n.ko.phase !== 'up')) continue;
      const dx = n.pos.x - P.x, dz = n.pos.z - P.z, d = Math.hypot(dx, dz);
      if (d < bd && (dx * fx + dz * fz) / (d || 1) > 0.35 && Math.abs(n.pos.y - P.y) < 1.2) { bd = d; best = n; }
    }
    return best;
  }
}
