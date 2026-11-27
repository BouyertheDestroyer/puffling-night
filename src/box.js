import * as THREE from 'three';
import { buildPufflingModel } from './puffling.js';

function cardboardTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#a7804f'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '60,40,20' : '220,190,140'},${Math.random() * 0.12})`; g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1); }
  g.fillStyle = 'rgba(120,85,45,0.6)'; g.fillRect(0, 120, 256, 16); // tape mark
  g.strokeStyle = 'rgba(40,30,20,0.6)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(40, 60); g.lineTo(80, 40); g.lineTo(120, 60); g.stroke(); // a little "this way up" doodle
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// An open cardboard box that shows the pufflings inside.
// every box shares its materials and geometry
let SHARED = null;
const geo = (sx, sy, sz) => { const k = [sx, sy, sz].join(); return SHARED.geo[k] ??= new THREE.BoxGeometry(sx, sy, sz); };
export function buildBox() {
  const W = 0.5, D = 0.38, H = 0.3, th = 0.008;
  SHARED ??= {
    mat: new THREE.MeshStandardMaterial({ map: cardboardTexture(), roughness: 0.95, side: THREE.DoubleSide }),
    inner: new THREE.MeshStandardMaterial({ color: 0x6d5235, roughness: 1, side: THREE.DoubleSide }), geo: {},
  };
  const { mat, inner } = SHARED;
  const g = new THREE.Group();
  const wall = (w, h, x, y, z, ry) => { const m = new THREE.Mesh(geo(w, h, th), mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  wall(W, H, 0, H / 2, D / 2, 0); wall(W, H, 0, H / 2, -D / 2, 0);
  wall(D, H, W / 2, H / 2, 0, Math.PI / 2); wall(D, H, -W / 2, H / 2, 0, Math.PI / 2);
  const bottom = new THREE.Mesh(geo(W, th, D), inner); bottom.position.y = th / 2; g.add(bottom);
  // open flaps
  const flap = (w, along, x, z, axis, sign) => {
    const piv = new THREE.Group(); piv.position.set(x, H, z);
    const m = new THREE.Mesh(geo(axis === 'x' ? w : along, th, axis === 'x' ? along : w), mat);
    if (axis === 'x') { m.position.z = sign * along / 2; piv.rotation.x = sign * 0.5; }
    else { m.position.x = sign * along / 2; piv.rotation.z = -sign * 0.5; }
    m.castShadow = true; piv.add(m); g.add(piv);
  };
  flap(W, D * 0.5, 0, D / 2, 'x', 1); flap(W, D * 0.5, 0, -D / 2, 'x', -1);
  flap(D, W * 0.35, W / 2, 0, 'z', 1); flap(D, W * 0.35, -W / 2, 0, 'z', -1);
  // slots for up to six pufflings
  const slots = [];
  for (let i = 0; i < 6; i++) {
    const m = buildPufflingModel();
    const cx = (i % 3 - 1) * 0.14, cz = (Math.floor(i / 3) - 0.5) * 0.15;
    m.root.position.set(cx, 0.04, cz); m.root.rotation.y = (i * 1.7) % 6.28; m.root.scale.setScalar(0.92);
    m.root.visible = false;
    g.add(m.root); slots.push(m);
  }
  return {
    group: g, slots, capacity: 6,
    show(n, t = 0) {
      slots.forEach((s, i) => {
        s.root.visible = i < n;
        s.root.rotation.y = (i * 1.7) % 6.28 + Math.sin(t * 1.3 + i) * 0.4;
        s.tilt.rotation.x = Math.max(0, Math.sin(t * 2 + i * 2)) * 0.2;
      });
    },
  };
}

const PASSENGER = new THREE.Vector3(-0.38, 0.66, 0.02);
// A box of pufflings: in someone's hands, on a car's passenger seat, or on the ground.
export class Box {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.mesh = buildBox(); this.group = this.mesh.group;
    this.count = 0; this.capacity = 6; this.where = null; this.holder = null;
  }
  get room() { return this.capacity - this.count; }
  release() { if (this.where === 'car' && this.holder?.box === this) this.holder.box = null; if (this.where === 'hands' && this.holder?.box === this) this.holder.box = null; }
  toCar(car) {
    this.release();
    car.model.body.add(this.group); car.box = this;
    this.group.position.copy(PASSENGER); this.group.rotation.set(0, 0, 0); this.group.scale.setScalar(0.95);
    this.where = 'car'; this.holder = car;
  }
  toHands(walker) {
    this.release();
    walker.person.carry.add(this.group);
    this.group.position.set(0, -0.2, 0.02); this.group.rotation.set(0, Math.PI / 2, 0); this.group.scale.setScalar(1);
    this.where = 'hands'; this.holder = walker;
  }
  toGround(x, z) {
    this.release();
    this.scene.add(this.group);
    this.group.position.set(x, Math.max(this.world.ground(x, z), -0.1), z); this.group.rotation.set(0, Math.random() * 6.28, 0); this.group.scale.setScalar(1);
    this.where = 'ground'; this.holder = null;
  }
  worldPos(out = new THREE.Vector3()) { return this.group.getWorldPosition(out); }
  show(t) { this.mesh.show(this.count, t); }
  dispose() { this.release(); this.group.removeFromParent(); }
}
