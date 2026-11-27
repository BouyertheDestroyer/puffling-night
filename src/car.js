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
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0b0e12, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.FrontSide }),
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
// A rigid body on four raycast suspension struts: it can jump, roll over, tumble and fall off cliffs.
const MASS = 1200, COM = new THREE.Vector3(0, 0.55, 0);
const INV_I = new THREE.Vector3(1 / 2045, 1 / 2173, 1 / 560); // local x (pitch), y (yaw), z (roll)
const ANCHOR_Y = 0.62, WHEEL_R = 0.36, L_MAX = 0.44, L_REST = 0.26;
const K_SPRING = MASS * 9.81 / 4 / (L_MAX - L_REST), C_DAMP = 2600;
const P = (x, y, z) => new THREE.Vector3(x, y, z);
// points on the body that can hit the ground (car-local, origin at the bottom of the tyres)
const BUMPERS = [P(0.88, 0.32, 2.2), P(-0.88, 0.32, 2.2), P(0.88, 0.32, -2.2), P(-0.88, 0.32, -2.2), P(0, 0.4, 2.3), P(0, 0.4, -2.3)];
const BODY_PTS = [...BUMPERS,
  P(0.92, 1.05, 2.0), P(-0.92, 1.05, 2.0), P(0.92, 1.05, -2.1), P(-0.92, 1.05, -2.1), P(0.95, 0.7, 0), P(-0.95, 0.7, 0),
  P(0.72, 1.63, 0.05), P(-0.72, 1.63, 0.05), P(0.72, 1.6, -1.85), P(-0.72, 1.6, -1.85), P(0, 1.68, -0.9),
  P(0.8, 0.3, 0), P(-0.8, 0.3, 0)];
const UP = P(0, 1, 0), FWD = P(0, 0, 1), LEFT = P(1, 0, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _r = new THREE.Vector3();
const _n = new THREE.Vector3(), _f = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(), _fw = new THREE.Vector3(), _lf = new THREE.Vector3();
const V = () => new THREE.Vector3();
const _pr = V(), _ir = V(), _ic = V(), _id = V(), _ar = V(), _ac = V(), _ad = V(), _fJ = V();
const _qi = new THREE.Quaternion(), _dq = new THREE.Quaternion(), _e = new THREE.Euler();

export class Car {
  constructor(scene, world, color = 0xb3261e, withLights = false) {
    this.world = world; this.scene = scene;
    this.model = buildCarModel(color);
    this.root = this.model.root;
    scene.add(this.root);
    this.pos = new THREE.Vector3(); this.heading = 0; // forward = (cos h, sin h)
    this.q = new THREE.Quaternion(); this.com = new THREE.Vector3();
    this.v = new THREE.Vector3(); this.w = new THREE.Vector3();
    this.vel = new THREE.Vector2(); this.speed = 0; this.steer = 0;
    this.wheelL = [L_REST, L_REST, L_REST, L_REST]; this.wheelV = [0, 0, 0, 0]; this.contacts = 4;
    this.doorOpen = 0; this.doorTarget = 0;
    this.lightsOn = true; this.engineOn = false;
    this.wheelSpin = [0, 0, 0, 0];
    this.braking = false; this.reversing = false;
    this.asleep = false; this.sleepT = 0; this.inWater = 0; this.airT = 0; this.upright = 1; this.impact = 0;
    this.kinematic = false; this.box = null; this.driver = null;
    // real headlights only on the car the player drives (they move with the player from car to car,
    // so the number of lights in the scene never changes); other cars just glow
    this.heads = []; this.tailLight = null;
    if (withLights) {
      for (const x of [-0.62, 0.62]) {
        const l = new THREE.SpotLight(0xfff1dc, 0, 60, 0.5, 0.5, 1.6);
        l.position.set(x, 0.86, 2.35);
        l.target.position.set(x * 1.5, 0.0, 14);
        this.root.add(l, l.target);
        this.heads.push(l);
      }
      this.tailLight = new THREE.PointLight(0xff2010, 0, 6, 2); this.tailLight.position.set(0, 0.9, -2.5); this.root.add(this.tailLight);
    }
    this.setLights(false);
  }
  moveLightsTo(other) {
    if (other === this || !this.heads.length) return;
    for (const l of this.heads) other.root.add(l, l.target);
    other.root.add(this.tailLight);
    other.heads = this.heads; other.tailLight = this.tailLight;
    this.heads = []; this.tailLight = null;
    const on = this.lightsOn; this.setLights(on); other.setLights(true);
  }
  // headlight shadows cost a full render each, so only the player's car has them
  enableShadows() {
    const h = this.heads[0]; if (!h) return;
    h.castShadow = true; h.shadow.mapSize.set(1024, 1024); h.shadow.camera.near = 0.5; h.shadow.bias = -0.0005;
  }
  dispose() {
    this.root.removeFromParent();
    this.model.opening.geometry.dispose();
    for (const k in this.model.M) this.model.M[k].dispose();
    for (const l of this.heads) { l.shadow?.map?.dispose(); l.dispose?.(); }
  }
  get forward() { return new THREE.Vector2(Math.cos(this.heading), Math.sin(this.heading)); }
  place(x, z, heading) {
    const g = this.world.ground(x, z);
    this.q.setFromEuler(_e.set(0, Math.PI / 2 - heading, 0));
    this.pos.set(x, g, z); this.com.set(x, g + COM.y, z);
    this.v.set(0, 0, 0); this.w.set(0, 0, 0); this.heading = heading; this.speed = 0;
    this.wheelL.fill(L_REST); this.asleep = false; this.sleepT = 0; this.inWater = 0;
    this.updateTransform(0);
  }
  // put the car on the road surface at a pose, tilted to the ground (used for distant traffic)
  setPose(x, z, heading, speed = 0) {
    const W = this.world, fx = Math.cos(heading), fz = Math.sin(heading), rx = -fz, rz = fx;
    const h = (a, b) => W.ground(x + fx * a + rx * b, z + fz * a + rz * b);
    const fl = h(1.31, 0.78), fr = h(1.31, -0.78), rl = h(-1.31, 0.78), rr = h(-1.31, -0.78);
    const y = (fl + fr + rl + rr) / 4;
    _e.set(-Math.atan2((fl + fr) / 2 - (rl + rr) / 2, 2.62), Math.PI / 2 - heading, Math.atan2((fr + rr) / 2 - (fl + rl) / 2, 1.56), 'YXZ');
    this.q.setFromEuler(_e);
    this.pos.set(x, y, z); this.com.copy(COM).applyQuaternion(this.q).add(this.pos);
    this.heading = heading; this.speed = speed;
    this.v.set(fx * speed, 0, fz * speed); this.w.set(0, 0, 0); this.vel.set(this.v.x, this.v.z);
    this.wheelL.fill(L_REST); this.wheelV.fill(speed); this.contacts = 4; this.upright = 1;
    this.updateTransform(1 / 60);
  }
  setLights(on) {
    this.lightsOn = on;
    for (const l of this.heads) l.intensity = on ? 110 : 0;
    this.model.M.head.emissiveIntensity = on ? 3.5 : 0.3;
    this.model.M.tail.emissiveIntensity = on ? 1.6 : 0.15;
    if (this.tailLight) this.tailLight.intensity = on ? 1.2 : 0;
  }
  // circles approximating the car's footprint, world space
  circles() {
    const f = this.forward, out = [];
    for (const o of [-1.35, 0, 1.35]) out.push({ x: this.pos.x + f.x * o, z: this.pos.z + f.y * o, r: 0.95 });
    return out;
  }
  wake() { this.asleep = false; this.sleepT = 0; }
  // ---- rigid body helpers (world space); each has its own scratch vectors
  toWorld(local, out) { return out.copy(local).sub(COM).applyQuaternion(this.q).add(this.com); }
  pointVel(p, out) { _pr.copy(p).sub(this.com); return out.copy(this.w).cross(_pr).add(this.v); }
  invI(vec, out) { _qi.copy(this.q).invert(); out.copy(vec).applyQuaternion(_qi).multiply(INV_I).applyQuaternion(this.q); return out; }
  invMassAt(p, n) {
    _ir.copy(p).sub(this.com); _ic.copy(_ir).cross(n); this.invI(_ic, _id); _id.cross(_ir);
    return 1 / MASS + n.dot(_id);
  }
  applyImpulse(J, p) {
    this.v.addScaledVector(J, 1 / MASS);
    _ar.copy(p).sub(this.com); _ac.copy(_ar).cross(J); this.invI(_ac, _ad); this.w.add(_ad);
  }
  applyForce(F, p, h) { _fJ.copy(F).multiplyScalar(h); this.applyImpulse(_fJ, p); }
  syncPos() { this.pos.copy(COM).applyQuaternion(this.q).negate().add(this.com); }

  update(dt, input) {
    if (this.kinematic) return;
    const thr = input?.throttle || 0, brk = input?.brake || 0, hb = !!input?.handbrake, parked = !!input?.parked;
    const maxSteer = lerp(0.6, 0.17, clamp(Math.abs(this.speed) / 32, 0, 1));
    this.steer = damp(this.steer, (input?.steer || 0) * maxSteer, 8, dt);
    if (this.asleep) {
      if (!parked || thr || brk) this.wake();
      else { this.updateTransform(dt); return; }
    }
    const W = this.world;
    const onRoad = W.L.roadDist(this.com.x, this.com.z, 8).d < 0.6;
    const mu = onRoad ? 1.15 : W.ground(this.com.x, this.com.z) < 0.3 ? 0.65 : 0.85;
    const gn = W.normal(this.com.x, this.com.z); _n.set(gn[0], gn[1], gn[2]);
    this.gNormal = (this.gNormal ?? new THREE.Vector3()).copy(_n);
    const n = Math.min(12, Math.ceil(dt * 240)), h = dt / n;
    this.impact = 0; this.splash = false;
    let wet = false;
    for (let k = 0; k < n; k++) wet = this.step(h, thr, brk, hb, parked, mu) || wet;
    this.syncPos();
    _fw.copy(FWD).applyQuaternion(this.q); _up.copy(UP).applyQuaternion(this.q);
    if (Math.hypot(_fw.x, _fw.z) > 0.15) this.heading = Math.atan2(_fw.z, _fw.x);
    this.vel.set(this.v.x, this.v.z);
    this.speed = this.v.dot(_fw);
    this.upright = _up.y;
    this.airT = this.contacts ? 0 : this.airT + dt;
    if (this.impact > 4) this.onCrash?.(this.impact);
    // in the sea
    if (wet) { if (!this.inWater) this.splash = true; this.inWater += dt; } else this.inWater = Math.max(0, this.inWater - dt * 0.3);
    // a parked car that has come to rest goes to sleep and stops costing anything
    if (parked && this.contacts >= 3 && this.v.lengthSq() < 0.04 && this.w.lengthSq() < 0.04) {
      if ((this.sleepT += dt) > 0.4) { this.asleep = true; this.v.set(0, 0, 0); this.w.set(0, 0, 0); }
    } else this.sleepT = 0;
    this.updateTransform(dt);
  }
  step(h, thr, brk, hb, parked, mu) {
    const W = this.world, q = this.q;
    const up = _up.copy(UP).applyQuaternion(q), fwd = _fw.copy(FWD).applyQuaternion(q), left = _lf.copy(LEFT).applyQuaternion(q);
    const vf = this.v.dot(fwd);
    this.v.y -= 9.81 * h;
    // the sea: it floats for a few seconds, then fills up and sinks
    let wet = false;
    const gc = W.ground(this.com.x, this.com.z);
    if (gc < -0.3 && this.com.y < 0.7) {
      wet = true;
      const depth = clamp((0.7 - this.com.y) / 1.3, 0, 1);
      if (-this.v.y > 6 && depth < 0.4) this.impact = Math.max(this.impact, -this.v.y * 0.5);
      this.v.y += 9.81 * 1.3 * depth * Math.max(0, 1 - this.inWater / 7) * h;
      this.v.multiplyScalar(Math.exp(-1.4 * depth * h)); this.w.multiplyScalar(Math.exp(-1.8 * depth * h));
    }
    // ---- wheels
    let contacts = 0;
    this.braking = false; this.reversing = false;
    for (let i = 0; i < 4; i++) {
      const [lx, lz] = WHEELS[i];
      const A = this.toWorld(_a.set(lx, ANCHOR_Y, lz), _a);
      if (up.y < 0.3) { this.wheelL[i] = L_MAX; continue; }
      const g = W.ground(A.x, A.z);
      const t = (A.y - g) / up.y, L = t - WHEEL_R;
      if (L > L_MAX) { this.wheelL[i] = Math.min(L_MAX, this.wheelL[i] + h * 2); continue; }
      contacts++;
      const Lc = Math.max(L, 0.03);
      const Pc = _b.copy(up).multiplyScalar(-t).add(A); // where the tyre touches
      const vp = this.pointVel(Pc, _c);
      const vUp = vp.dot(up);
      let N = K_SPRING * (L_MAX - Lc) - C_DAMP * vUp;
      if (L < 0.07) N += 90000 * (0.07 - L) - 4000 * vUp; // bump stop
      N = Math.max(0, N);
      // tyre frame on the ground
      const sa = lz > 0 ? this.steer : 0;
      const wf = _f.copy(fwd).multiplyScalar(Math.cos(sa)).addScaledVector(left, -Math.sin(sa));
      wf.addScaledVector(this.gNormal, -wf.dot(this.gNormal)).normalize();
      const ws = _s.copy(this.gNormal).cross(wf);
      const vlong = vp.dot(wf), vlat = vp.dot(ws);
      const rear = lz < 0, share = rear ? 0.325 : 0.175;
      const lock = parked || (hb && rear);
      let Fx = 0, brake = lock ? 1 : 0;
      if (thr > 0) {
        if (vf < -0.5) brake = Math.max(brake, thr);
        else Fx += thr * MASS * 8.5 * (1 - clamp(vf / 34, 0, 1) ** 2) * share;
      }
      if (brk > 0) {
        if (vf > 0.5) brake = Math.max(brake, brk);
        else if (vf > -10) { Fx -= brk * MASS * 5 * share; this.reversing = true; }
      }
      const lim = mu * N;
      if (brake > 0) { Fx -= clamp(vlong * 6, -1, 1) * lim * brake; this.braking = true; }
      else if (!thr && !brk) Fx -= clamp(vlong * 4, -1, 1) * N * 0.11 + vlong * N * 0.004; // rolling and engine drag
      const latMu = hb && rear ? 0.42 : 1;
      let Fy = -clamp(vlat * 5, -1, 1) * lim * latMu;
      const f = Math.hypot(Fx, Fy), cap = lim * (hb && rear ? 0.6 : 1);
      if (f > cap) { Fx *= cap / f; Fy *= cap / f; }
      _d.copy(wf).multiplyScalar(Fx).addScaledVector(ws, Fy).addScaledVector(up, N);
      this.applyForce(_d, Pc, h);
      this.wheelL[i] = L; this.wheelV[i] = vlong;
    }
    this.contacts = contacts;
    // ---- the body against the ground (roofs, bumpers, sides)
    const pts = contacts >= 3 && up.y > 0.8 ? BUMPERS : BODY_PTS;
    let maxPen = 0;
    for (const lp of pts) {
      const p = this.toWorld(lp, _a);
      const g = W.ground(p.x, p.z);
      if (p.y >= g) continue;
      const nn = W.normal(p.x, p.z), nrm = _n.set(nn[0], nn[1], nn[2]);
      const pen = (g - p.y) * nrm.y;
      const vp = this.pointVel(p, _c), vn = vp.dot(nrm);
      if (vn < 0) {
        const j = -1.15 * vn / this.invMassAt(p, nrm);
        this.applyImpulse(_b.copy(nrm).multiplyScalar(j), p);
        this.pointVel(p, _c); _c.addScaledVector(nrm, -_c.dot(nrm));
        const vt = _c.length();
        if (vt > 1e-4) { _c.divideScalar(vt); const jt = Math.min(vt / this.invMassAt(p, _c), 0.55 * j); this.applyImpulse(_c.multiplyScalar(-jt), p); }
        this.impact = Math.max(this.impact, -vn);
      }
      maxPen = Math.max(maxPen, pen);
    }
    if (maxPen > 0) this.com.y += maxPen * 0.6;
    // ---- walls, lamp posts, parked cars
    const fl = Math.hypot(fwd.x, fwd.z);
    if (fl > 0.05) {
      const fx = fwd.x / fl, fz = fwd.z / fl;
      for (const o of [-1.35 * fl, 0, 1.35 * fl]) {
        const cx = this.com.x + fx * o, cz = this.com.z + fz * o;
        const above = this.com.y - COM.y - W.ground(cx, cz);
        const push = W.pushOut(cx, cz, 0.95, { static: true, vehicle: true, above });
        if (!push.x && !push.z) continue;
        const pl = Math.hypot(push.x, push.z), nrm = _n.set(push.x / pl, 0, push.z / pl);
        this.com.x += push.x * 0.8; this.com.z += push.z * 0.8;
        const p = _a.set(cx - nrm.x * 0.95, this.com.y, cz - nrm.z * 0.95);
        const vn = this.pointVel(p, _c).dot(nrm);
        if (vn < 0) {
          const j = -1.3 * vn / this.invMassAt(p, nrm);
          this.applyImpulse(_b.copy(nrm).multiplyScalar(j), p);
          this.pointVel(p, _c); _c.addScaledVector(nrm, -_c.dot(nrm)); _c.y = 0;
          const vt = _c.length();
          if (vt > 1e-4) { _c.divideScalar(vt); const jt = Math.min(vt / this.invMassAt(p, _c), 0.3 * j); this.applyImpulse(_c.multiplyScalar(-jt), p); }
          this.impact = Math.max(this.impact, -vn);
        }
      }
    }
    // ---- integrate
    this.v.addScaledVector(this.v, -this.v.length() * 0.00045 * h);
    this.w.multiplyScalar(1 - 0.15 * h);
    this.com.addScaledVector(this.v, h);
    _dq.set(this.w.x * h * 0.5, this.w.y * h * 0.5, this.w.z * h * 0.5, 0).multiply(q);
    q.set(q.x + _dq.x, q.y + _dq.y, q.z + _dq.z, q.w + _dq.w).normalize();
    return wet;
  }
  // R: set an overturned car back on its wheels
  rightUp() {
    this.place(this.pos.x, this.pos.z, this.heading);
    this.com.y += 0.6; this.syncPos();
  }
  updateTransform(dt) {
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.q);
    // wheels: suspension travel, steering and spin
    this.model.wheels.forEach((w, i) => {
      w.g.position.y = ANCHOR_Y - Math.min(this.wheelL[i], L_MAX);
      this.wheelSpin[i] += this.wheelV[i] * dt / WHEEL_R;
      w.spin.rotation.x = this.wheelSpin[i];
      w.g.rotation.y = w.front ? -this.steer : 0;
    });
    // door
    if (dt) this.doorOpen = damp(this.doorOpen, this.doorTarget, 7, dt);
    this.model.doorPivot.rotation.y = -this.doorOpen * 1.15;
    this.model.opening.visible = this.doorOpen > 0.05;
    // brake / reverse lights
    this.model.M.tail.emissiveIntensity = this.braking && this.engineOn ? 5 : this.lightsOn ? 1.6 : 0.15;
    if (this.tailLight) this.tailLight.intensity = this.braking && this.engineOn ? 4 : this.lightsOn ? 1.2 : 0;
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

// Two cars bumping into each other: push them apart and trade momentum. Returns the closing speed.
export function collideCars(a, b) {
  if (a.kinematic && b.kinematic) return 0;
  if (Math.abs(a.com.y - b.com.y) > 1.8) return 0;
  if (Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) > 5.6) return 0;
  let best = null;
  for (const ca of a.circles()) for (const cb of b.circles()) {
    const d = Math.hypot(ca.x - cb.x, ca.z - cb.z), o = ca.r + cb.r - d;
    if (o > 0 && (!best || o > best.o)) best = { ca, cb, d, o };
  }
  if (!best) return 0;
  const { ca, cb, d, o } = best;
  const n = new THREE.Vector3(d > 1e-4 ? (ca.x - cb.x) / d : 1, 0, d > 1e-4 ? (ca.z - cb.z) / d : 0);
  const wa = a.kinematic ? 0 : 1, wb = b.kinematic ? 0 : 1, tot = wa + wb;
  a.com.addScaledVector(n, o * wa / tot); b.com.addScaledVector(n, -o * wb / tot);
  a.syncPos(); b.syncPos();
  const p = new THREE.Vector3((ca.x + cb.x) / 2, (a.com.y + b.com.y) / 2, (ca.z + cb.z) / 2);
  const va = a.pointVel(p, new THREE.Vector3()), vb = b.pointVel(p, new THREE.Vector3());
  const vn = va.sub(vb).dot(n);
  if (vn >= 0) return 0;
  const k = (wa ? a.invMassAt(p, n) : 0) + (wb ? b.invMassAt(p, n) : 0);
  const j = -1.3 * vn / k;
  if (wa) { a.applyImpulse(n.clone().multiplyScalar(j), p); a.wake(); }
  if (wb) { b.applyImpulse(n.clone().multiplyScalar(-j), p); b.wake(); }
  return -vn;
}
