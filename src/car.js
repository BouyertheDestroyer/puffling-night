import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, damp, lerp } from './noise.js';
const ni = g => (g.index ? g.toNonIndexed() : g);

// ------------------------------------------------------------------ the model
// Local frame: +z forward, +x left (driver side is -x... we drive on the left seat = +x side? no:
// Iceland drives on the right, so the driver sits on the LEFT of the car = local +x).
const LEN = 4.3, WID = 1.82;
export const CAR_DIMS = { LEN, WID, wheelBase: 2.62, track: 1.56, wheelR: 0.36, ride: 0.0 };
const WHEELS = [[0.78, 1.31], [-0.78, 1.31], [0.78, -1.31], [-0.78, -1.31]]; // x, z

function sideProfile() {
  // lower body side silhouette in (z, y), with wheel arches
  const s = new THREE.Shape();
  const r = 0.45, wz = 1.31, wy = 0.36;
  s.moveTo(-2.15, 0.42);
  s.lineTo(-wz - r - 0.02, 0.42);
  s.absarc(-wz, wy, r, Math.PI - 0.12, 0.12, true);
  s.lineTo(wz - r - 0.02, 0.42);
  s.absarc(wz, wy, r, Math.PI - 0.12, 0.12, true);
  s.lineTo(2.12, 0.42);
  s.quadraticCurveTo(2.2, 0.48, 2.2, 0.62);
  s.lineTo(2.16, 0.86);
  s.quadraticCurveTo(2.1, 0.98, 1.85, 1.0); // hood front
  s.lineTo(0.95, 1.07); // hood
  s.lineTo(-1.95, 1.08); // belt line to rear
  s.quadraticCurveTo(-2.18, 1.07, -2.2, 0.9);
  s.lineTo(-2.2, 0.55);
  s.quadraticCurveTo(-2.2, 0.42, -2.15, 0.42);
  return s;
}
function cabinProfile(inset = 0) {
  const s = new THREE.Shape();
  const i = inset;
  s.moveTo(0.95 - i, 1.06 + i * 0.3);
  s.lineTo(0.12 - i * 0.6, 1.58 - i);
  s.quadraticCurveTo(0.0, 1.62 - i, -0.2, 1.62 - i);
  s.lineTo(-1.78 + i * 0.5, 1.6 - i);
  s.quadraticCurveTo(-1.92 + i * 0.5, 1.58 - i, -1.98 + i * 0.5, 1.45 - i);
  s.lineTo(-2.06 + i * 0.4, 1.08 + i * 0.3);
  s.lineTo(0.95 - i, 1.06 + i * 0.3);
  return s;
}
function extrudeX(shape, width, bevel, segs = 4, curveSegs = 18) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: segs, curveSegments: curveSegs });
  g.translate(0, 0, -(width - 2 * bevel) / 2);
  g.rotateY(Math.PI / 2); // shape x(=z) -> -z... fix below
  // after rotateY(+90): shape x -> -z, extrude z -> x. We want shape x -> +z.
  g.scale(1, 1, -1);
  // flipping one axis inverts winding
  const idx = g.index; if (idx) { for (let k = 0; k < idx.count; k += 3) { const a = idx.getX(k + 1); idx.setX(k + 1, idx.getX(k + 2)); idx.setX(k + 2, a); } }
  else { const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv; for (let k = 0; k < p.count; k += 3) for (const at of [p, n, uv]) { for (let c = 0; c < at.itemSize; c++) { const t = at.getComponent(k + 1, c); at.setComponent(k + 1, c, at.getComponent(k + 2, c)); at.setComponent(k + 2, c, t); } } }
  return g;
}

function wheelGeometries() {
  // tyre: lathe of a rounded profile around the x axis
  const pts = [];
  const R = 0.36, w = 0.24, ri = 0.24;
  for (let i = 0; i <= 16; i++) { const a = -Math.PI / 2 + i / 16 * Math.PI; pts.push(new THREE.Vector2(R - 0.05 + Math.cos(a) * 0.05, Math.sin(a) * w / 2)); }
  pts.unshift(new THREE.Vector2(ri, -w / 2 + 0.01)); pts.push(new THREE.Vector2(ri, w / 2 - 0.01));
  const tyre = new THREE.LatheGeometry(pts, 32); tyre.rotateZ(Math.PI / 2);
  // rim: a disc with five spokes, extruded
  const rim = new THREE.Shape(); rim.absarc(0, 0, 0.235, 0, Math.PI * 2, false);
  for (let k = 0; k < 5; k++) {
    const a0 = k / 5 * Math.PI * 2 + 0.25, a1 = a0 + Math.PI * 2 / 5 - 0.5;
    const h = new THREE.Path(); h.moveTo(Math.cos(a0) * 0.08, Math.sin(a0) * 0.08);
    h.absarc(0, 0, 0.2, a0, a1, false); h.lineTo(Math.cos(a1) * 0.08, Math.sin(a1) * 0.08); h.closePath();
    rim.holes.push(h);
  }
  const rimG = new THREE.ExtrudeGeometry(rim, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 1, curveSegments: 8 });
  rimG.rotateY(Math.PI / 2); rimG.translate(0.06, 0, 0);
  const hub = new THREE.CylinderGeometry(0.2, 0.2, 0.16, 24); hub.rotateZ(Math.PI / 2); hub.translate(-0.02, 0, 0);
  const disc = new THREE.CylinderGeometry(0.17, 0.17, 0.03, 24); disc.rotateZ(Math.PI / 2); disc.translate(-0.05, 0, 0);
  return { tyre, rim: mergeGeometries([ni(rimG), ni(hub)]), disc };
}

export function carMaterials(color = 0xa01818) {
  return {
    paint: new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0b0e12, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
    black: new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.6 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 1, roughness: 0.18 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.85 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.9, roughness: 0.28 }),
    head: new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff4e0, emissiveIntensity: 6, roughness: 0.1 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x300404, emissive: 0xff1508, emissiveIntensity: 1.6, roughness: 0.2 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.9 }),
    plate: new THREE.MeshStandardMaterial({ color: 0xe8ecf0, roughness: 0.5 }),
  };
}

// geometry per material, in car-local space (wheels excluded)
function carGeometryParts() {
  const P = { paint: [], glass: [], black: [], chrome: [], head: [], tail: [], interior: [], plate: [] };
  const lower = extrudeX(sideProfile(), WID, 0.1);
  P.paint.push(lower);
  const cabin = extrudeX(cabinProfile(), 1.56, 0.08, 3, 12);
  P.glass.push(cabin);
  // roof panel and pillars in paint
  const roof = extrudeX((() => { const s = new THREE.Shape(); s.moveTo(0.02, 1.6); s.quadraticCurveTo(-0.05, 1.67, -0.25, 1.67); s.lineTo(-1.78, 1.65); s.quadraticCurveTo(-1.92, 1.63, -1.95, 1.55); s.lineTo(-1.9, 1.56); s.lineTo(0.0, 1.585); s.closePath(); return s; })(), 1.5, 0.05, 2, 8);
  P.paint.push(roof);
  const pillar = (z0, y0, z1, y1, x) => {
    const len = Math.hypot(z1 - z0, y1 - y0);
    const g = new THREE.BoxGeometry(0.06, len, 0.09);
    g.rotateX(Math.atan2(z1 - z0, y1 - y0));
    g.translate(x, (y0 + y1) / 2, (z0 + z1) / 2);
    return g.toNonIndexed();
  };
  for (const x of [-0.77, 0.77]) {
    P.paint.push(pillar(0.93, 1.07, 0.1, 1.6, x)); // A
    P.paint.push(pillar(-0.62, 1.08, -0.62, 1.63, x)); // B
    P.paint.push(pillar(-2.02, 1.1, -1.9, 1.56, x)); // C
  }
  // bumpers & trim
  const box = (sx, sy, sz, x, y, z) => { const g = new THREE.BoxGeometry(sx, sy, sz); g.translate(x, y, z); return g.toNonIndexed(); };
  P.black.push(box(1.86, 0.2, 0.18, 0, 0.5, 2.24), box(1.86, 0.2, 0.18, 0, 0.5, -2.24));
  P.black.push(box(0.9, 0.2, 0.06, 0, 0.74, 2.27)); // grille
  for (const [z, r] of [[1.31, 0.47], [-1.31, 0.47]]) for (const x of [-0.92, 0.92]) {
    const arch = new THREE.TorusGeometry(r, 0.045, 6, 20, Math.PI * 0.86); arch.rotateY(Math.PI / 2); arch.rotateX(Math.PI * 0.07);
    arch.translate(x, 0.36, z); P.black.push(arch.toNonIndexed());
  }
  P.black.push(box(0.03, 0.05, 2.3, 0.93, 0.47, 0), box(0.03, 0.05, 2.3, -0.93, 0.47, 0));
  // lights
  for (const x of [-0.62, 0.62]) {
    P.head.push(box(0.38, 0.12, 0.06, x, 0.86, 2.27));
    P.tail.push(box(0.3, 0.16, 0.05, x * 1.18, 0.92, -2.29));
  }
  P.plate.push(box(0.52, 0.12, 0.02, 0, 0.6, 2.33), box(0.52, 0.12, 0.02, 0, 0.72, -2.31));
  // mirrors
  for (const x of [-1, 1]) { P.paint.push(box(0.2, 0.12, 0.1, x * 1.0, 1.12, 0.78)); P.black.push(box(0.15, 0.12, 0.04, x * 0.92, 1.12, 0.82)); }
  // interior: seats, dashboard, wheel
  for (const x of [0.38, -0.38]) {
    P.interior.push(box(0.5, 0.12, 0.5, x, 0.62, 0.05), box(0.5, 0.65, 0.12, x, 0.98, -0.25), box(0.26, 0.2, 0.1, x, 1.38, -0.28));
  }
  P.interior.push(box(1.42, 0.45, 0.4, 0, 0.62, -1.0), box(1.42, 0.5, 0.12, 0, 0.95, -1.18)); // rear bench
  P.interior.push(box(1.5, 0.22, 0.45, 0, 0.98, 0.85));
  const sw = new THREE.TorusGeometry(0.17, 0.025, 6, 20); sw.rotateX(-0.35); sw.translate(0.38, 1.08, 0.58); P.interior.push(sw.toNonIndexed());
  const out = {};
  for (const k in P) if (P[k].length) out[k] = mergeGeometries(P[k].map(g => (g.index ? g.toNonIndexed() : g)).map(g => { for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a); if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; }));
  return out;
}

// The driver door: a separate panel hinged at its front edge.
function doorGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0.92, 0.5); s.lineTo(-0.6, 0.5); s.lineTo(-0.6, 1.06); s.lineTo(0.92, 1.06); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2 });
  g.rotateY(-Math.PI / 2); // shape x -> z, extrude -> +x... (rotateY(-90): x->z, z->-x)
  const win = new THREE.Shape();
  win.moveTo(0.9, 1.07); win.lineTo(0.12, 1.57); win.lineTo(-0.58, 1.6); win.lineTo(-0.58, 1.07); win.closePath();
  const wg = new THREE.ShapeGeometry(win); wg.rotateY(-Math.PI / 2);
  const inner = new THREE.ShapeGeometry(s); inner.rotateY(-Math.PI / 2);
  return { panel: g, glass: wg, inner };
}

let SHARED = null;
function shared() {
  if (!SHARED) SHARED = { parts: carGeometryParts(), wheel: wheelGeometries(), door: doorGeometry() };
  return SHARED;
}

export function buildCarModel(color = 0xa01818) {
  const S = shared();
  const M = carMaterials(color);
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  for (const k in S.parts) {
    const m = new THREE.Mesh(S.parts[k], M[k]);
    m.castShadow = k !== 'glass'; m.receiveShadow = true;
    if (k === 'glass') m.renderOrder = 2;
    body.add(m);
  }
  // driver door (left side, +x)
  const doorPivot = new THREE.Group(); doorPivot.position.set(0.92, 0, 0.92);
  const panel = new THREE.Mesh(S.door.panel, M.paint); panel.position.set(-0.92 + 0.92 + 0.005, 0, -0.92); panel.castShadow = true;
  const dglass = new THREE.Mesh(S.door.glass, M.glass); dglass.position.set(0.005 - 0.92 + 0.92 - 0.12, 0, -0.92); dglass.renderOrder = 3;
  const dinner = new THREE.Mesh(S.door.inner, M.interior); dinner.position.set(-0.045, 0, -0.92);
  doorPivot.add(panel, dglass, dinner);
  body.add(doorPivot);
  // the dark opening that shows when the door is open
  const opening = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.56), M.interior);
  opening.rotation.y = Math.PI / 2; opening.position.set(0.915, 0.78, 0.16); opening.visible = false;
  body.add(opening);
  // wheels
  const wheels = [];
  for (const [x, z] of WHEELS) {
    const w = new THREE.Group(); w.position.set(x, 0.36, z);
    const spin = new THREE.Group(); w.add(spin);
    const side = x > 0 ? 1 : -1;
    const tyre = new THREE.Mesh(S.wheel.tyre, M.tyre); tyre.castShadow = true;
    const rim = new THREE.Mesh(S.wheel.rim, M.rim); rim.scale.x = side;
    const disc = new THREE.Mesh(S.wheel.disc, M.chrome); disc.scale.x = side;
    spin.add(tyre, rim, disc);
    root.add(w); wheels.push({ g: w, spin, front: z > 0 });
  }
  return { root, body, M, doorPivot, opening, wheels };
}

// Merged, single-mesh-per-material version for parked cars (instanced).
export function parkedCarGeometries() {
  const S = shared();
  const out = { paint: [], glass: [], black: [], chrome: [], tail: [], interior: [], plate: [], tyre: [], rim: [] };
  for (const k in S.parts) if (k !== 'head') out[k].push(S.parts[k]);
  const doorM = new THREE.Matrix4().makeTranslation(0.925, 0, 0);
  out.paint.push(ni(S.door.panel.clone()).applyMatrix4(doorM));
  out.glass.push(ni(S.door.glass.clone()).applyMatrix4(new THREE.Matrix4().makeTranslation(0.925 - 0.12, 0, 0)));
  for (const [x, z] of WHEELS) {
    const m = new THREE.Matrix4().makeTranslation(x, 0.36, z);
    const sm = new THREE.Matrix4().makeScale(x > 0 ? 1 : -1, 1, 1);
    out.tyre.push(ni(S.wheel.tyre.clone()).applyMatrix4(m));
    out.rim.push(ni(S.wheel.rim.clone()).applyMatrix4(sm).applyMatrix4(m));
  }
  const res = {};
  for (const k in out) {
    if (!out[k].length) continue;
    res[k] = mergeGeometries(out[k].map(g => { g = g.index ? g.toNonIndexed() : g; for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a); if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; }));
  }
  return res;
}

// ------------------------------------------------------------------ the driveable car
export class Car {
  constructor(scene, world, color = 0xb3261e) {
    this.world = world;
    this.model = buildCarModel(color);
    this.root = this.model.root;
    scene.add(this.root);
    this.pos = new THREE.Vector3(); this.heading = 0; // forward = (cos h, sin h)
    this.vel = new THREE.Vector2(); this.yawRate = 0;
    this.steer = 0; this.throttle = 0; this.brake = 0; this.handbrake = false;
    this.pitch = 0; this.roll = 0; this.bob = 0; this.bobV = 0;
    this.doorOpen = 0; this.doorTarget = 0;
    this.lightsOn = true; this.engineOn = false;
    this.wheelSpin = 0; this.speed = 0;
    this.braking = false; this.reversing = false;
    // headlights
    this.heads = [];
    for (const x of [-0.62, 0.62]) {
      const l = new THREE.SpotLight(0xfff1dc, 0, 60, 0.5, 0.5, 1.6);
      l.position.set(x, 0.86, 2.35);
      l.target.position.set(x * 1.5, 0.0, 14);
      this.root.add(l, l.target);
      this.heads.push(l);
    }
    this.heads[0].castShadow = true;
    this.heads[0].shadow.mapSize.set(1024, 1024);
    this.heads[0].shadow.camera.near = 0.5; this.heads[0].shadow.bias = -0.0005;
    this.tailLight = new THREE.PointLight(0xff2010, 0, 6, 2); this.tailLight.position.set(0, 0.9, -2.5); this.root.add(this.tailLight);
    this.setLights(false);
  }
  get forward() { return new THREE.Vector2(Math.cos(this.heading), Math.sin(this.heading)); }
  place(x, z, heading) {
    this.pos.set(x, this.world.ground(x, z), z); this.heading = heading; this.vel.set(0, 0); this.yawRate = 0;
    this.updateTransform(0);
  }
  setLights(on) {
    this.lightsOn = on;
    for (const l of this.heads) l.intensity = on ? 110 : 0;
    this.model.M.head.emissiveIntensity = on ? 3.5 : 0.3;
    this.model.M.tail.emissiveIntensity = on ? 1.6 : 0.15;
    this.tailLight.intensity = on ? 1.2 : 0;
  }
  // circles approximating the car's footprint, world space
  circles() {
    const f = this.forward, out = [];
    for (const o of [-1.35, 0, 1.35]) out.push({ x: this.pos.x + f.x * o, z: this.pos.z + f.y * o, r: 0.95 });
    return out;
  }
  update(dt, input) {
    const W = this.world;
    const f = this.forward, rgt = new THREE.Vector2(-f.y, f.x);
    let vf = this.vel.dot(f), vl = this.vel.dot(rgt);
    const thr = input ? input.throttle : 0, brk = input ? input.brake : 0;
    this.handbrake = input ? input.handbrake : false;
    // steering: less at speed
    const maxSteer = lerp(0.58, 0.16, clamp(Math.abs(vf) / 32, 0, 1));
    this.steer = damp(this.steer, (input ? input.steer : 0) * maxSteer, 8, dt);
    // engine and brakes
    const maxV = 33;
    this.braking = false; this.reversing = false;
    if (thr > 0) {
      if (vf < -0.5) { vf += 14 * dt * thr; this.braking = true; }
      else vf += thr * 8.5 * (1 - clamp(vf / maxV, 0, 1) ** 2) * dt;
    }
    if (brk > 0) {
      if (vf > 0.5) { vf -= 16 * dt * brk; this.braking = true; }
      else { vf -= brk * 5 * dt * (vf > -9 ? 1 : 0); this.reversing = true; }
    }
    if (!thr && !brk) vf -= Math.sign(vf) * Math.min(Math.abs(vf), (1.2 + Math.abs(vf) * 0.05) * dt);
    if (this.handbrake) { vf -= Math.sign(vf) * Math.min(Math.abs(vf), 9 * dt); this.braking = true; }
    vf -= vf * Math.abs(vf) * 0.0011 * dt;
    // slope
    const n = W.normal(this.pos.x, this.pos.z);
    vf += -9.81 * (n[0] * f.x + n[2] * f.y) * dt * 0.9;
    // lateral grip
    const grip = this.handbrake ? 1.6 : 9;
    vl *= Math.exp(-grip * dt);
    // a parked car (nobody driving, or someone getting in or out) stays put
    if (input && input.parked && Math.abs(vf) < 2) { vf = 0; vl = 0; }
    // yaw
    const targetYaw = vf / CAR_DIMS.wheelBase * Math.tan(this.steer) * (this.handbrake ? 1.35 : 1);
    this.yawRate = damp(this.yawRate, targetYaw, this.handbrake ? 3 : 10, dt);
    this.heading += this.yawRate * dt;
    const f2 = this.forward, r2 = new THREE.Vector2(-f2.y, f2.x);
    this.vel.set(f2.x * vf + r2.x * vl, f2.y * vf + r2.y * vl);
    // integrate with collision
    const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.y * dt;
    const prevH = this.pos.y, px0 = this.pos.x, pz0 = this.pos.z;
    this.pos.x = nx; this.pos.z = nz;
    this.collide(prevH, px0, pz0);
    this.speed = this.vel.dot(this.forward);
    this.updateTransform(dt);
  }
  collide(prevH, px0, pz0) {
    const W = this.world;
    // water or a sudden drop: go back to where we were and bounce off it
    const bad = () => this.circles().some(c => { const h = W.ground(c.x, c.z); return h < 0.25 || h < prevH - 2.2; });
    if (bad()) {
      this.pos.x = px0; this.pos.z = pz0;
      const sp = this.vel.length();
      this.vel.multiplyScalar(-0.25);
      if (sp > 4) this.onCrash?.(sp * 0.5);
    }
    for (let iter = 0; iter < 2; iter++) {
      for (const c of this.circles()) {
        const push = W.pushOut(c.x, c.z, c.r, { car: this });
        const px = push.x, pz = push.z;
        if (px || pz) {
          this.pos.x += px; this.pos.z += pz;
          const nl = Math.hypot(px, pz), nxx = px / nl, nzz = pz / nl;
          const into = this.vel.x * nxx + this.vel.y * nzz;
          if (into < 0) {
            this.vel.x -= into * nxx * 1.25; this.vel.y -= into * nzz * 1.25;
            this.vel.multiplyScalar(0.85);
            if (-into > 4) this.onCrash?.(-into);
          }
        }
      }
    }
  }
  updateTransform(dt) {
    const W = this.world, f = this.forward, r = new THREE.Vector2(-f.y, f.x);
    const hw = 0.78, hl = 1.31;
    const h = (a, b) => W.ground(this.pos.x + f.x * a + r.x * b, this.pos.z + f.y * a + r.y * b);
    const fl = h(hl, hw), fr = h(hl, -hw), rl = h(-hl, hw), rr = h(-hl, -hw);
    const y = (fl + fr + rl + rr) / 4;
    const pitch = Math.atan2((fl + fr) / 2 - (rl + rr) / 2, 2 * hl);
    const roll = Math.atan2((fr + rr) / 2 - (fl + rl) / 2, 2 * hw);
    this.pos.y = y;
    // body sway from acceleration and turning
    const accelTilt = dt ? clamp(-(this.speed - (this._lastSpeed ?? this.speed)) / dt * 0.006, -0.05, 0.05) : 0;
    this._lastSpeed = this.speed;
    const sway = clamp(-this.yawRate * this.speed * 0.004, -0.06, 0.06);
    this.pitch = dt ? damp(this.pitch, accelTilt, 6, dt) : 0;
    this.roll = dt ? damp(this.roll, sway, 6, dt) : 0;
    this.root.position.set(this.pos.x, y, this.pos.z);
    this.root.rotation.set(0, 0, 0);
    this.root.rotation.order = 'YXZ';
    this.root.rotation.y = Math.PI / 2 - this.heading;
    this.root.rotation.x = -pitch;
    this.root.rotation.z = roll;
    this.model.body.rotation.x = this.pitch;
    this.model.body.rotation.z = this.roll;
    // wheels
    this.wheelSpin += this.speed * dt / 0.36;
    for (const w of this.model.wheels) {
      w.spin.rotation.x = this.wheelSpin;
      w.g.rotation.y = w.front ? -this.steer : 0;
    }
    // door
    if (dt) this.doorOpen = damp(this.doorOpen, this.doorTarget, 7, dt);
    this.model.doorPivot.rotation.y = -this.doorOpen * 1.15;
    this.model.opening.visible = this.doorOpen > 0.05;
    // brake / reverse lights
    this.model.M.tail.emissiveIntensity = this.braking ? 5 : this.lightsOn ? 1.6 : 0.15;
    this.tailLight.intensity = this.braking ? 4 : this.lightsOn ? 1.2 : 0;
  }
  // where the driver stands to get in, world space
  doorSpot() {
    const f = this.forward, r = new THREE.Vector2(-f.y, f.x);
    // local +x is left of forward: in world that's -right
    const lx = 1.55, lz = 0.25;
    return { x: this.pos.x + f.x * lz - r.x * lx, z: this.pos.z + f.y * lz - r.y * lx };
  }
  seatWorld(local = new THREE.Vector3(0.38, 0.6, 0.05)) {
    return local.clone().applyMatrix4(this.root.matrixWorld);
  }
}
