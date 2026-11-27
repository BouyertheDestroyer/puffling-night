import * as THREE from 'three';
import { buildPerson } from './character.js';
import { clamp, damp, lerp, angleDiff } from './noise.js';

const SEAT = new THREE.Vector3(0.38, 0.6, 0.02); // driver's seat, car-local (root of the sitting person)
const DOOR = new THREE.Vector3(1.45, 0, 0.3); // where you stand to get in, car-local

// The person you play: walking, carrying the box, getting into and out of the car.
export class Player {
  constructor(scene, world, audio) {
    this.scene = scene; this.world = world; this.audio = audio;
    this.person = buildPerson();
    this.root = this.person.root;
    scene.add(this.root);
    this.pos = new THREE.Vector3(); this.heading = 0; this.vel = new THREE.Vector2();
    this.inCar = false; this.seq = null; // enter/exit sequence
    this.sneak = false; this.speed = 0; this.noiseRadius = 3.5;
    this.action = null; // {type:'grab'|'throw', t, dur, onHit, fired}
    this.stepPhase = 0;
  }
  place(x, z, heading) { this.pos.set(x, this.world.ground(x, z), z); this.heading = heading; this.sync(); }
  sync() {
    this.root.position.copy(this.pos);
    this.root.rotation.set(0, Math.PI / 2 - this.heading, 0);
  }
  get busy() { return !!this.seq || !!this.action; }
  // --------------------------------------------------------- on foot
  updateOnFoot(dt, move, sprint, carrying) {
    const W = this.world;
    const mag = Math.min(1, Math.hypot(move.x, move.z));
    let target = 0;
    if (!this.action && mag > 0.05) {
      target = this.sneak ? 1.35 : sprint ? (carrying ? 5.2 : 6.6) : 3.6;
      target *= mag;
      const want = Math.atan2(move.z, move.x);
      this.heading += angleDiff(this.heading, want) * (1 - Math.exp(-12 * dt));
    }
    this.speed = damp(this.speed, target, target > this.speed ? 7 : 10, dt);
    const nx = this.pos.x + Math.cos(this.heading) * this.speed * dt, nz = this.pos.z + Math.sin(this.heading) * this.speed * dt;
    let gx = nx, gz = nz;
    const push = W.pushOut(gx, gz, 0.32); gx += push.x; gz += push.z;
    const gh = W.ground(gx, gz);
    // don't walk into deep water or off a cliff, and don't climb walls of rock
    const step = Math.hypot(gx - this.pos.x, gz - this.pos.z) + 1e-4;
    const okWater = gh > -0.5;
    const okDrop = gh > this.pos.y - Math.max(0.9, step * 2.5);
    const okClimb = (gh - this.pos.y) / step < 2.2 || gh - this.pos.y < 0.35;
    if (okWater && okDrop && okClimb) { this.pos.x = gx; this.pos.z = gz; }
    else { this.speed *= 0.5; }
    this.pos.y = damp(this.pos.y, W.ground(this.pos.x, this.pos.z), 18, dt);
    this.noiseRadius = this.sneak ? 1.6 : this.speed > 4.5 ? 7.5 : this.speed > 0.5 ? 3.6 : 2.2;
    // footsteps
    const ph = this.person.anim.phase;
    if (this.speed > 0.4 && Math.floor(ph / Math.PI) !== Math.floor(this.stepPhase / Math.PI)) this.audio.step(this.world.L.roadDist(this.pos.x, this.pos.z, 6).d < 2.4 ? 'road' : 'grass');
    this.stepPhase = ph;
    this.sync();
  }
  // --------------------------------------------------------- actions (grab / throw)
  startAction(type, dur, hitAt, onHit, onDone) { this.action = { type, t: 0, dur, hitAt, onHit, onDone, fired: false }; }
  updateAction(dt) {
    const a = this.action; if (!a) return;
    a.t += dt / a.dur;
    if (!a.fired && a.t >= a.hitAt) { a.fired = true; a.onHit?.(); }
    if (a.t >= 1) { this.action = null; a.onDone?.(); }
  }
  // --------------------------------------------------------- car sequences
  // walk to the door, open it, sit down, close it
  enterCar(car, onSeated) {
    this.seq = { type: 'enter', phase: 'walk', t: 0, car, onSeated };
  }
  exitCar(car, onOut) {
    this.seq = { type: 'exit', phase: 'open', t: 0, car, onOut };
    car.doorTarget = 1; this.audio.door(true);
  }
  updateSeq(dt) {
    const s = this.seq; if (!s) return;
    const car = s.car;
    s.t += dt;
    if (s.type === 'enter') {
      if (s.phase === 'walk') {
        const spot = car.doorSpot();
        const dx = spot.x - this.pos.x, dz = spot.z - this.pos.z, d = Math.hypot(dx, dz);
        if (d > 0.15 && s.t < 3) {
          this.updateOnFoot(dt, { x: dx / d * Math.min(1, d), z: dz / d * Math.min(1, d) }, false, false);
          this.speed = Math.min(this.speed, 2.6);
        } else {
          // face the car's side, then open the door
          s.phase = 'open'; s.t = 0; car.doorTarget = 1; this.audio.door(true);
          this.attachToCar(car);
          s.from = this.root.position.clone(); s.fromRot = this.root.rotation.y;
        }
      } else if (s.phase === 'open') {
        this.root.rotation.y = lerp(s.fromRot, -Math.PI / 2, clamp(s.t / 0.3, 0, 1));
        this.root.position.lerpVectors(s.from, DOOR, clamp(s.t / 0.3, 0, 1));
        if (s.t > 0.42) { s.phase = 'in'; s.t = 0; }
      } else if (s.phase === 'in') {
        const k = clamp(s.t / 0.75, 0, 1), e = k * k * (3 - 2 * k);
        this.root.position.lerpVectors(DOOR, SEAT, e);
        this.root.position.y = lerp(0, SEAT.y, Math.min(1, e * 1.4)) + Math.sin(k * Math.PI) * 0.08;
        this.root.rotation.y = lerp(-Math.PI / 2, 0, clamp((k - 0.2) / 0.6, 0, 1));
        this.sitTarget = k > 0.25;
        if (k >= 1) { s.phase = 'close'; s.t = 0; car.doorTarget = 0; }
      } else if (s.phase === 'close') {
        if (s.t > 0.3) { this.audio.door(false); this.seq = null; this.inCar = true; s.onSeated?.(); }
      }
    } else if (s.type === 'exit') {
      if (s.phase === 'open') {
        this.sitTarget = true;
        if (s.t > 0.35) { s.phase = 'out'; s.t = 0; }
      } else if (s.phase === 'out') {
        const k = clamp(s.t / 0.7, 0, 1), e = k * k * (3 - 2 * k);
        this.root.position.lerpVectors(SEAT, DOOR, e);
        this.root.position.y = lerp(SEAT.y, 0, Math.min(1, e * 1.3)) + Math.sin(k * Math.PI) * 0.08;
        this.root.rotation.y = lerp(0, -Math.PI / 2, clamp(k / 0.6, 0, 1));
        this.sitTarget = k < 0.55;
        if (k >= 1) {
          s.phase = 'close'; s.t = 0;
          this.detachFromCar(car);
        }
      } else if (s.phase === 'close') {
        // step away from the door, then close it
        if (s.t < 0.35) this.updateOnFoot(dt, { x: Math.cos(this.heading) * 0.6, z: Math.sin(this.heading) * 0.6 }, false, false);
        if (s.t > 0.25 && car.doorTarget) { car.doorTarget = 0; }
        if (s.t > 0.55) { this.audio.door(false); this.seq = null; s.onOut?.(); }
      }
    }
  }
  attachToCar(car) {
    car.model.body.updateMatrixWorld(true);
    car.model.body.attach(this.root);
  }
  detachFromCar(car) {
    this.scene.attach(this.root);
    const p = this.root.getWorldPosition(new THREE.Vector3());
    this.pos.set(p.x, this.world.ground(p.x, p.z), p.z);
    const f = car.forward;
    // if the driver's side is water or a wall, step out on the passenger side instead
    if (this.world.ground(p.x, p.z) < 0.3 || this.world.blocked(p.x, p.z, 0.3, { static: true })) {
      const ox = car.pos.x * 2 - p.x, oz = car.pos.z * 2 - p.z;
      if (this.world.ground(ox, oz) >= 0.3) this.pos.set(ox, this.world.ground(ox, oz), oz);
    }
    // face away from the car
    this.heading = Math.atan2(-f.x, f.y); // = left of the car's forward
    this.inCar = false;
    this.sync();
  }
  animate(dt, carrying) {
    const a = this.action;
    this.person.anim.update(dt, {
      speed: this.inCar ? 0 : this.speed,
      carry: carrying,
      sit: this.inCar || this.sitTarget,
      sneak: this.sneak && !this.inCar,
      grab: a && a.type === 'grab' ? a.t : 0,
      throwT: a && a.type === 'throw' ? a.t : -1,
    });
    if (!this.seq) this.sitTarget = false;
  }
}
