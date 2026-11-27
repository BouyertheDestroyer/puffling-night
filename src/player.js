import * as THREE from 'three';
import { buildPerson } from './character.js';
import { clamp, damp, lerp } from './noise.js';
import { Walker } from './walker.js';

export const SEAT = new THREE.Vector3(0.38, 0.6, 0.02); // driver's seat, car-local (root of the sitting person)
export const DOOR = new THREE.Vector3(1.45, 0, 0.3); // where you stand to get in, car-local

function knifeMesh() {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.2, 0.035), new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 1, roughness: 0.2 }));
  blade.position.y = -0.16; blade.geometry.translate(0, 0, 0.006);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.11, 8), new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.8 }));
  handle.position.y = -0.03;
  g.add(blade, handle); g.position.set(0, -0.04, 0.02); g.rotation.x = -1.4;
  return g;
}

// The person you play: walking, jumping, swimming, fighting, carrying the box, and getting in and
// out of cars (including other people's).
export class Player extends Walker {
  constructor(scene, world, audio) {
    super(scene, world, buildPerson());
    this.audio = audio;
    this.inCar = false; this.seq = null; // enter/exit sequence
    this.sneak = false; this.noiseRadius = 3.5;
    this.action = null; // {type:'grab'|'throw'|'punch'|'slash', t, dur, onHit, fired}
    this.stepPhase = 0; this.punchSide = 'R';
    this.knife = knifeMesh(); this.knife.visible = false; this.person.J.handR.add(this.knife);
    this.hasKnife = false; this.weapon = 'fists';
    this.hurt = 0; // hits taken recently
  }
  get busy() { return !!this.seq || !!this.action || !!this.ko; }
  setWeapon(w) { this.weapon = w; this.knife.visible = w === 'knife'; }
  // --------------------------------------------------------- on foot
  updateOnFoot(dt, move, sprint, carrying) {
    const target = this.sneak ? 1.35 : sprint ? (carrying ? 5.2 : 6.6) : 3.6;
    const ev = this.locomote(dt, this.action ? 0 : move.x, this.action ? 0 : move.z, target);
    this.noiseRadius = this.sneak ? 1.6 : this.speed > 4.5 ? 7.5 : this.speed > 0.5 ? 3.6 : 2.2;
    if (!this.onGround && !this.swimming) this.noiseRadius = 5;
    // footsteps
    const ph = this.person.anim.phase;
    if (this.onGround && this.speed > 0.4 && Math.floor(ph / Math.PI) !== Math.floor(this.stepPhase / Math.PI)) this.audio.step(this.world.L.roadDist(this.pos.x, this.pos.z, 6).d < 2.4 ? 'road' : 'grass');
    this.stepPhase = ph;
    this.hurt = Math.max(0, this.hurt - dt * 0.2);
    this.sync();
    return ev;
  }
  // --------------------------------------------------------- actions (grab / throw / punch / slash)
  startAction(type, dur, hitAt, onHit, onDone) { this.action = { type, t: 0, dur, hitAt, onHit, onDone, fired: false }; }
  updateAction(dt) {
    const a = this.action; if (!a) return;
    a.t += dt / a.dur;
    if (!a.fired && a.t >= a.hitAt) { a.fired = true; a.onHit?.(); }
    if (a.t >= 1) { this.action = null; a.onDone?.(); }
  }
  attack(onHit) {
    if (this.weapon === 'knife') this.startAction('slash', 0.5, 0.4, onHit);
    else { this.punchSide = this.punchSide === 'R' ? 'L' : 'R'; this.startAction('punch', 0.38, 0.3, onHit); }
    this.speed *= 0.3;
  }
  // --------------------------------------------------------- car sequences
  // walk to the door, open it, (pull out whoever is driving), sit down, close it
  enterCar(car, onSeated, onJack) {
    this.seq = { type: 'enter', phase: 'walk', t: 0, car, onSeated, onJack, jack: !!car.driver };
  }
  exitCar(car, onOut) {
    this.seq = { type: 'exit', phase: 'open', t: 0, car, onOut };
    car.doorTarget = 1; this.audio.door(true);
  }
  // jump out of a moving car and roll
  bailOut(car) {
    car.doorTarget = 1; this.audio.door(true);
    this.detachFromCar(car);
    const f = car.forward, out = { x: f.y, z: -f.x }; // driver's side (local +x)
    this.knockDown(car.vel.x * 0.75 + out.x * 2.5, car.vel.y * 0.75 + out.z * 2.5, 2.5, 0.9);
    setTimeout(() => { car.doorTarget = 0; }, 900);
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
          this.updateOnFoot(dt, { x: dx / d * Math.min(1, d), z: dz / d * Math.min(1, d) }, s.jack, false);
          this.speed = Math.min(this.speed, s.jack ? 4 : 2.6);
        } else {
          // face the car's side, then open the door
          s.phase = 'open'; s.t = 0; car.doorTarget = 1; this.audio.door(true);
          this.attachToCar(car);
          s.from = this.root.position.clone(); s.fromRot = this.root.rotation.y;
          s.jack = !!car.driver;
        }
      } else if (s.phase === 'open') {
        this.root.rotation.set(0, lerp(s.fromRot, -Math.PI / 2, clamp(s.t / 0.3, 0, 1)), 0);
        this.root.position.lerpVectors(s.from, DOOR, clamp(s.t / 0.3, 0, 1));
        this.reach = s.jack;
        if (s.jack && s.t > 0.35 && !s.pulled) { s.pulled = true; s.onJack?.(); }
        if (s.t > (s.jack ? 0.85 : 0.42)) { s.phase = 'in'; s.t = 0; this.reach = false; }
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
          this.detachFromCar(car, true);
          s.phase = 'close'; s.t = 0;
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
  detachFromCar(car, keepSeq = false) {
    this.scene.attach(this.root);
    const p = this.root.getWorldPosition(new THREE.Vector3());
    const W = this.world;
    let x = p.x, z = p.z;
    // if the driver's side is water, a wall or a drop, step out on the passenger side instead
    const bad = (x, z) => W.ground(x, z) < 0.3 || W.blocked(x, z, 0.3, { static: true }) || Math.abs(W.ground(x, z) - car.pos.y) > 1.5;
    if (car.upright > 0.5 && bad(x, z)) {
      const ox = car.pos.x * 2 - x, oz = car.pos.z * 2 - z;
      if (!bad(ox, oz)) { x = ox; z = oz; }
    }
    const f = car.forward;
    this.heading = Math.atan2(-f.x, f.y); // = left of the car's forward
    this.inCar = false; this.fall = 0; this.spin = 0;
    if (!keepSeq) this.seq = null;
    const g = W.ground(x, z);
    this.pos.set(x, Math.max(g, Math.min(p.y, g + 0.3)), z);
    this.onGround = true; this.swimming = false; this.vy = 0;
    if (g < -0.7) { this.swimming = true; this.onGround = false; this.pos.y = Math.min(p.y, -0.22); }
    this.sync();
  }
  animate(dt, carrying) {
    const a = this.action;
    this.person.anim.update(dt, {
      speed: this.inCar || this.ko ? 0 : this.speed,
      carry: carrying,
      sit: this.inCar || this.sitTarget,
      sneak: this.sneak && !this.inCar,
      grab: a && a.type === 'grab' ? a.t : 0,
      throwT: a && a.type === 'throw' ? a.t : -1,
      punch: a && a.type === 'punch' ? a.t : -1, punchSide: this.punchSide,
      slash: a && a.type === 'slash' ? a.t : -1,
      air: !this.inCar && !this.seq && !this.onGround && !this.swimming && !this.ko,
      swim: this.swimming && !this.inCar,
      ko: !!this.ko && this.ko.phase !== 'up',
      reach: this.reach,
    });
    if (!this.seq) this.sitTarget = false;
  }
}
