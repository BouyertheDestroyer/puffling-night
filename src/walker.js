import * as THREE from 'three';
import { clamp, damp, angleDiff } from './noise.js';

export const GRAVITY = 16;
const SWIM_Y = -0.22; // root height while swimming (the body is tipped forward)

// Anyone who walks: the player, the townsfolk and the draugar. Moving over the ground with
// gravity, jumping, walking off edges, swimming, and being knocked flat.
export class Walker {
  constructor(scene, world, person) {
    this.scene = scene; this.world = world; this.person = person; this.root = person.root;
    scene.add(this.root);
    this.pos = new THREE.Vector3(); this.heading = 0; this.speed = 0;
    this.vy = 0; this.onGround = true; this.swimming = false; this.airT = 0;
    this.ko = null; this.fall = 0; this.fallDir = -1; this.spin = 0; this.swimK = 0;
    this.radius = 0.32;
  }
  place(x, z, heading = this.heading) {
    const g = this.world.ground(x, z);
    this.pos.set(x, g < -0.7 ? SWIM_Y : g, z); this.heading = heading;
    this.vy = 0; this.onGround = g >= -0.7; this.swimming = g < -0.7;
    this.ko = null; this.fall = 0; this.spin = 0; this.speed = 0;
    this.sync();
  }
  get down() { return !!this.ko; }
  // Walk or swim towards (mx, mz) (length 0..1) at up to `target` m/s. Returns events.
  locomote(dt, mx, mz, target, opts = {}) {
    const W = this.world, ev = {};
    const mag = Math.min(1, Math.hypot(mx, mz));
    let want = 0;
    if (mag > 0.05) {
      want = target * mag * (this.swimming ? 0.45 : 1);
      this.heading += angleDiff(this.heading, Math.atan2(mz, mx)) * (1 - Math.exp(-(opts.turn ?? 12) * dt));
    }
    // no steering in mid-air, just a little drift
    if (!this.onGround && !this.swimming) want = Math.max(want * 0.25, this.speed);
    this.speed = damp(this.speed, want, want > this.speed ? 7 : 10, dt);
    this.moveHoriz(dt, Math.cos(this.heading) * this.speed, Math.sin(this.heading) * this.speed, ev);
    this.vertical(dt, ev);
    return ev;
  }
  moveHoriz(dt, vx, vz, ev = {}) {
    const W = this.world;
    const g0 = W.ground(this.pos.x, this.pos.z);
    let gx = this.pos.x + vx * dt, gz = this.pos.z + vz * dt;
    const push = W.pushOut(gx, gz, this.radius, { above: this.pos.y - g0, ...this.pushOpts });
    gx += push.x; gz += push.z;
    const gh = W.ground(gx, gz);
    const step = Math.hypot(gx - this.pos.x, gz - this.pos.z) + 1e-4;
    let ok;
    if (this.swimming) ok = gh < SWIM_Y + 0.2 || (gh - this.pos.y) / step < 1.6; // climb out where the shore is gentle
    else if (this.onGround) ok = (gh - this.pos.y) / step < 2.2 || gh - this.pos.y < 0.35; // no climbing rock walls
    else ok = gh < this.pos.y + 0.3;
    if (this.noEdges && this.onGround && gh < this.pos.y - 0.8) ok = false; // careful walkers (townsfolk) don't step off
    if (ok) { this.pos.x = gx; this.pos.z = gz; }
    else { this.speed *= 0.5; ev.blocked = true; }
    if (push.x || push.z) ev.pushed = true;
    return ev;
  }
  vertical(dt, ev = {}) {
    const W = this.world;
    const g = W.ground(this.pos.x, this.pos.z);
    const deep = g < -0.7;
    if (this.swimming) {
      if (!deep && g > this.pos.y - 0.1) { this.swimming = false; this.onGround = true; this.pos.y = g; }
      else { this.vy = damp(this.vy, 0, 3, dt); this.pos.y = damp(this.pos.y + this.vy * dt, SWIM_Y + Math.sin(performance.now() / 600) * 0.04, 2.5, dt); }
    } else if (this.onGround) {
      if (g < this.pos.y - 0.6) { this.onGround = false; this.vy = 0; }
      else this.pos.y = damp(this.pos.y, g, 18, dt);
    }
    if (!this.onGround && !this.swimming) {
      this.airT += dt;
      this.vy -= GRAVITY * dt;
      this.pos.y += this.vy * dt;
      if (deep && this.pos.y < 0) {
        this.swimming = true; ev.splash = -this.vy; this.vy *= 0.15; this.airT = 0;
      } else if (this.pos.y <= g) {
        ev.landed = -this.vy; this.pos.y = g; this.vy = 0; this.onGround = true; this.airT = 0;
      }
    } else this.airT = 0;
    this.swimK = damp(this.swimK, this.swimming ? 1 : 0, 5, dt);
    return ev;
  }
  jump(v = 6.2) {
    if (!this.onGround || this.swimming || this.ko) return false;
    this.onGround = false; this.vy = v; return true;
  }
  // knocked flat: fly with a velocity, land, lie there for `dur`, then get up
  knockDown(vx, vz, vy, dur = 3) {
    const toward = Math.cos(this.heading) * vx + Math.sin(this.heading) * vz;
    this.fallDir = toward > 0 ? 1 : -1; // pushed from behind: face down; from the front: on your back
    this.ko = { t: 0, dur, phase: 'fly', vel: new THREE.Vector3(vx, vy, vz), spin: Math.hypot(vx, vz) > 9 ? (Math.random() < 0.5 ? -1 : 1) * 9 : 0 };
    this.onGround = false; this.speed = 0;
  }
  // returns events while knocked down (null when standing)
  updateKO(dt) {
    const k = this.ko; if (!k) return null;
    const W = this.world, ev = {};
    k.t += dt;
    if (k.phase === 'fly') {
      k.vel.y -= GRAVITY * dt;
      this.moveHoriz(dt, k.vel.x, k.vel.z);
      this.pos.y += k.vel.y * dt;
      this.spin += k.spin * dt;
      const g = W.ground(this.pos.x, this.pos.z);
      if (g < -0.7 && this.pos.y < 0) { this.swimming = true; this.ko = null; this.spin = 0; this.fall = 0; ev.splash = -k.vel.y; return ev; }
      if (this.pos.y <= g) {
        this.pos.y = g;
        if (k.vel.y < -4) { ev.landed = -k.vel.y; k.vel.y *= -0.3; k.vel.x *= 0.5; k.vel.z *= 0.5; }
        else { k.phase = 'down'; k.t = 0; k.vel.set(0, 0, 0); this.onGround = true; ev.landed = ev.landed ?? 1; }
      }
      this.fall = Math.min(1, this.fall + dt * 3.5);
    } else if (k.phase === 'down') {
      this.spin = damp(this.spin, Math.round(this.spin / (Math.PI * 2)) * Math.PI * 2, 8, dt);
      this.fall = Math.min(1, this.fall + dt * 4);
      this.pos.y = damp(this.pos.y, W.ground(this.pos.x, this.pos.z), 10, dt);
      if (k.t > k.dur) { k.phase = 'up'; k.t = 0; ev.gettingUp = true; }
    } else if (k.phase === 'up') {
      this.fall = Math.max(0, 1 - k.t / 0.7);
      if (k.t > 0.7) { this.ko = null; this.spin = 0; this.fall = 0; ev.up = true; }
    }
    return ev;
  }
  sync() {
    const r = this.root;
    r.position.copy(this.pos);
    r.rotation.order = 'YXZ';
    r.rotation.set(0, Math.PI / 2 - this.heading, 0);
    if (this.fall > 0 || this.spin) {
      // tip over about the feet; lift a little so the body lies on the ground rather than in it
      r.rotation.x = this.fallDir * this.fall * Math.PI / 2 + this.spin;
      r.position.y += this.fall * 0.13;
    }
    if (this.swimK > 0.01) r.rotation.x += this.swimK * 1.25;
  }
}
