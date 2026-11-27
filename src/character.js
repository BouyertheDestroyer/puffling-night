import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, damp, lerp, smoothstep } from './noise.js';

// A procedurally built person in a lopapeysa (Icelandic wool sweater), with procedural animation.
// Faces +z in local space.

const TEX = new Map();
const cached = (key, fn) => { if (!TEX.has(key)) TEX.set(key, fn()); return TEX.get(key); };
function sweaterTexture(base = '#d9cfbd', pat = '#3b3029', pat2 = '#8a2b22', torn = false) {
  return cached(['sw', base, pat, pat2, torn].join(), () => makeSweater(base, pat, pat2, torn));
}
function makeSweater(base, pat, pat2, torn) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 512, 256);
  // wool speckle
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.08})`; g.fillRect(Math.random() * 512, Math.random() * 256, 2, 2); }
  // yoke pattern near the top (v=1 is the top of the lathe)
  const row = (y, h, col, fn) => { g.fillStyle = col; for (let x = 0; x < 512; x += 2) if (fn(x / 2)) g.fillRect(x, y, 2, h); };
  g.fillStyle = pat; g.fillRect(0, 0, 512, 10);
  for (let k = 0; k < 6; k++) row(12 + k * 4, 4, pat, x => ((x + k * 3) % 12) < 6 - Math.abs(k - 3));
  g.fillStyle = pat2; g.fillRect(0, 38, 512, 5);
  for (let k = 0; k < 8; k++) row(46 + k * 4, 4, pat, x => { const m = x % 16; return Math.abs(m - 8) <= (k < 4 ? k : 7 - k) + 1 && (m + k) % 2 === 0; });
  g.fillStyle = pat; g.fillRect(0, 80, 512, 4);
  for (let k = 0; k < 3; k++) row(88 + k * 4, 4, pat2, x => (x + k) % 6 === 0);
  // cuffs/hem
  g.fillStyle = pat; g.fillRect(0, 240, 512, 16);
  if (torn) { // rags: dark holes and stains
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${10 + Math.random() * 20},${12 + Math.random() * 20},8,${0.4 + Math.random() * 0.5})`; g.beginPath(); g.ellipse(Math.random() * 512, Math.random() * 256, 4 + Math.random() * 14, 3 + Math.random() * 10, Math.random() * 3, 0, 7); g.fill(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  return t;
}
function hatTexture(a = '#a52a22', b = '#f0ece2') { return cached(['hat', a, b].join(), () => makeHat(a, b)); }
function makeHat(a, b) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = a; g.fillRect(0, 0, 256, 128);
  g.fillStyle = b;
  for (let x = 0; x < 256; x += 16) { g.fillRect(x, 92, 8, 8); g.fillRect(x + 8, 100, 8, 8); }
  g.fillRect(0, 84, 256, 4); g.fillRect(0, 112, 256, 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  return t;
}

const limb = (r, len, mat, segs = 10) => {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, segs), mat);
  m.position.y = -len / 2; m.castShadow = true; m.receiveShadow = true;
  return m;
};

export function buildPerson(opts = {}) {
  const M = {
    sweater: new THREE.MeshStandardMaterial({ map: sweaterTexture(opts.sweater, opts.pattern, opts.pattern2, opts.zombie), roughness: 1 }),
    jeans: new THREE.MeshStandardMaterial({ color: opts.trousers ?? 0x26324a, roughness: 0.92 }),
    boots: new THREE.MeshStandardMaterial({ color: opts.boots ?? 0x1e3a24, roughness: 0.35 }),
    skin: new THREE.MeshStandardMaterial({ color: opts.skin ?? 0xd6a184, roughness: 0.62 }),
    hat: new THREE.MeshStandardMaterial({ map: hatTexture(opts.hatA, opts.hatB), roughness: 1 }),
    mitten: new THREE.MeshStandardMaterial({ color: opts.mitten ?? 0x6b6560, roughness: 1 }),
    hair: new THREE.MeshStandardMaterial({ color: opts.hair ?? 0x3a2416, roughness: 0.8 }),
    eye: opts.zombie ? new THREE.MeshStandardMaterial({ color: 0x9fd8ff, emissive: 0x8fd0ff, emissiveIntensity: 5, roughness: 0.2 })
      : new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2 }),
    fur: new THREE.MeshStandardMaterial({ color: 0x6b5236, roughness: 1 }),
  };
  const J = {};
  const root = new THREE.Group();
  const add = (parent, name, x, y, z) => { const o = new THREE.Group(); o.position.set(x, y, z); parent.add(o); J[name] = o; return o; };
  const hips = add(root, 'hips', 0, 0.94, 0);
  const spine = add(hips, 'spine', 0, 0.1, 0);
  const chest = add(spine, 'chest', 0, 0.24, 0);
  const neck = add(chest, 'neck', 0, 0.25, 0);
  const head = add(neck, 'head', 0, 0.07, 0);
  // torso: a lathe in sweater
  const prof = [[0.0, -0.36], [0.17, -0.36], [0.19, -0.3], [0.19, -0.12], [0.18, 0.0], [0.2, 0.12], [0.215, 0.2], [0.2, 0.26], [0.13, 0.31], [0.07, 0.33], [0.0, 0.33]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const torso = new THREE.Mesh(new THREE.LatheGeometry(prof, 24), opts.caveman ? M.fur : M.sweater);
  torso.scale.set(1, 1, 0.72); torso.position.y = 0.0; torso.castShadow = true; torso.receiveShadow = true;
  chest.add(torso);
  // collar
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.03, 8, 16), opts.caveman ? M.fur : M.sweater);
  collar.rotation.x = Math.PI / 2; collar.position.y = 0.32; chest.add(collar);
  // pelvis
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.175, 16, 10), M.jeans);
  pelvis.scale.set(1, 0.65, 0.78); pelvis.position.y = -0.02; pelvis.castShadow = true; hips.add(pelvis);
  // neck & head
  const neckM = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.12, 10), M.skin); neckM.position.y = 0.0; neck.add(neckM);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.108, 24, 16), M.skin);
  skull.scale.set(0.92, 1.08, 1.0); skull.position.set(0, 0.11, 0.01); skull.castShadow = true; head.add(skull);
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 10), M.skin); jaw.position.set(0, 0.05, 0.035); jaw.scale.set(1, 0.8, 1); head.add(jaw);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), M.skin); nose.position.set(0, 0.1, 0.112); nose.scale.set(1, 1.3, 1); head.add(nose);
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), M.eye); e.position.set(s * 0.036, 0.13, 0.095); head.add(e);
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), M.skin); ear.position.set(s * 0.1, 0.11, 0.0); ear.scale.set(0.5, 1, 0.8); head.add(ear);
  }
  if (opts.caveman || opts.zombie) {
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), M.hair);
    hair.position.set(0, 0.125, -0.005); hair.scale.set(1, 1.1, 1.05); head.add(hair);
    const beard = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), M.hair); beard.position.set(0, 0.03, 0.06); beard.scale.set(1, 1.1, 0.7); head.add(beard);
  } else {
    // woolly hat with a bobble
    const hat = new THREE.Mesh(new THREE.SphereGeometry(0.118, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), M.hat);
    hat.position.set(0, 0.13, 0.0); hat.scale.set(0.98, 1.12, 1.04); hat.castShadow = true; head.add(hat);
    const brim = new THREE.Mesh(new THREE.TorusGeometry(0.106, 0.02, 8, 24), M.hat); brim.rotation.x = Math.PI / 2; brim.position.set(0, 0.145, 0.0); brim.scale.set(1, 1.04, 1); head.add(brim);
    const bob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), M.hat); bob.position.set(0, 0.265, 0); head.add(bob);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, Math.PI * 0.4, Math.PI * 0.3), M.hair); hair.position.set(0, 0.11, -0.01); head.add(hair);
  }
  // arms
  for (const [s, n] of [[1, 'L'], [-1, 'R']]) {
    const sh = add(chest, 'shoulder' + n, s * 0.2, 0.2, 0);
    const ua = add(sh, 'upperArm' + n, 0, 0, 0);
    ua.add(limb(0.058, 0.22, opts.caveman ? M.fur : M.sweater));
    const fa = add(ua, 'foreArm' + n, 0, -0.29, 0);
    fa.add(limb(0.05, 0.2, opts.caveman ? M.skin : M.sweater));
    const hand = add(fa, 'hand' + n, 0, -0.27, 0);
    const mit = new THREE.Mesh(new THREE.SphereGeometry(0.048, 10, 8), opts.caveman ? M.skin : M.mitten); mit.scale.set(0.8, 1.2, 1); mit.position.y = -0.03; mit.castShadow = true; hand.add(mit);
    // legs
    const hip = add(hips, 'thigh' + n, s * 0.095, -0.05, 0);
    hip.add(limb(0.078, 0.34, M.jeans));
    const knee = add(hip, 'shin' + n, 0, -0.43, 0);
    knee.add(limb(0.064, 0.34, M.jeans));
    const ankle = add(knee, 'foot' + n, 0, -0.43, 0);
    const boot = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.13, 4, 8), opts.caveman ? M.fur : M.boots);
    boot.rotation.x = Math.PI / 2; boot.position.set(0, -0.03, 0.05); boot.castShadow = true; ankle.add(boot);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.065, 0.2, 10), opts.caveman ? M.fur : M.boots); shaft.position.y = 0.06; ankle.add(shaft);
  }
  // anchor in front of the chest where a carried box sits
  const carry = add(chest, 'carry', 0, -0.02, 0.36);
  const anim = new PersonAnimator(J);
  const person = { root, J, anim, M, carry };
  if (opts.rigid !== true) skinPerson(person);
  return person;
}

// Merge every body part into one skinned mesh per material (each vertex follows the joint its part
// hangs from), so a person costs a handful of draw calls instead of forty.
function skinPerson(person) {
  const { root, J } = person;
  root.updateMatrixWorld(true);
  const bones = [root, ...Object.values(J)];
  const index = new Map(bones.map((b, i) => [b, i]));
  const byMat = new Map(), meshes = [];
  root.traverse(o => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    let b = m.parent; while (b && !index.has(b)) b = b.parent;
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const n = g.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const bi = index.get(b) ?? 0;
    for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    if (!byMat.has(m.material)) byMat.set(m.material, []);
    byMat.get(m.material).push(g);
    m.removeFromParent();
  }
  const skeleton = new THREE.Skeleton(bones);
  person.meshes = [];
  for (const [mat, geos] of byMat) {
    const sm = new THREE.SkinnedMesh(mergeGeometries(geos), mat);
    sm.castShadow = true; sm.receiveShadow = true;
    root.add(sm); sm.bind(skeleton);
    sm.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.4);
    person.meshes.push(sm);
  }
  person.setShadow = on => { for (const m of person.meshes) m.castShadow = on; };
}

export class PersonAnimator {
  constructor(J) {
    this.J = J; this.phase = 0;
    this.s = { speed: 0, carry: 0, sit: 0, grab: 0, throwT: -1, sneak: 0, wave: 0, crouchIdle: 0, flail: 0,
      air: 0, ko: 0, swim: 0, zombie: 0, panic: 0, reach: 0, guard: 0 };
    this.t = 0;
  }
  update(dt, target) {
    const s = this.s; this.t += dt;
    s.speed = damp(s.speed, target.speed ?? 0, 10, dt);
    s.carry = damp(s.carry, target.carry ? 1 : 0, 8, dt);
    s.sit = damp(s.sit, target.sit ? 1 : 0, 9, dt);
    s.sneak = damp(s.sneak, target.sneak ? 1 : 0, 6, dt);
    s.grab = target.grab ?? 0;
    s.throwT = target.throwT ?? -1;
    s.wave = damp(s.wave, target.wave ? 1 : 0, 4, dt);
    s.crouchIdle = damp(s.crouchIdle, target.crouchIdle ? 1 : 0, 4, dt);
    s.air = damp(s.air, target.air ? 1 : 0, 9, dt);
    s.ko = damp(s.ko, target.ko ? 1 : 0, 7, dt);
    s.swim = damp(s.swim, target.swim ? 1 : 0, 5, dt);
    s.zombie = target.zombie ? 1 : 0;
    s.panic = damp(s.panic, target.panic ? 1 : 0, 6, dt);
    s.reach = damp(s.reach, target.reach ? 1 : 0, 10, dt);
    s.guard = damp(s.guard, target.guard ? 1 : 0, 8, dt);
    const punch = target.punch ?? -1, slash = target.slash ?? -1;
    const J = this.J, sp = s.speed;
    const run = smoothstep(2.6, 5.5, sp);
    const amp = clamp(sp / 1.4, 0, 1);
    const freq = lerp(0.85, 1.45, clamp(sp / 6.5, 0, 1));
    this.phase += dt * freq * Math.PI * 2 * (amp > 0.02 ? 1 : 0);
    const p = this.phase;
    const sn = s.sneak;
    // legs
    const swing = (0.42 + 0.28 * run) * amp * (1 - 0.3 * sn);
    const legL = Math.sin(p) * swing, legR = Math.sin(p + Math.PI) * swing;
    const kneeK = (0.25 + 1.0 * run) * amp + sn * 0.5;
    const kneeL = Math.max(0, Math.sin(p - Math.PI / 2)) ** 1.3 * kneeK + 0.05 + sn * 0.35;
    const kneeR = Math.max(0, Math.sin(p + Math.PI / 2)) ** 1.3 * kneeK + 0.05 + sn * 0.35;
    J.thighL.rotation.set(-legL - sn * 0.35, 0, 0.02);
    J.thighR.rotation.set(-legR - sn * 0.35, 0, -0.02);
    J.shinL.rotation.set(kneeL, 0, 0); J.shinR.rotation.set(kneeR, 0, 0);
    J.footL.rotation.set(-kneeL * 0.3 + legL * 0.3, 0, 0); J.footR.rotation.set(-kneeR * 0.3 + legR * 0.3, 0, 0);
    let hipY = 0.94 - Math.abs(Math.cos(p)) * 0.035 * amp - run * 0.04 - sn * 0.12;
    const breathe = Math.sin(this.t * 1.7) * 0.012;
    J.spine.rotation.set(0.05 + 0.16 * run + sn * 0.3, Math.sin(p) * 0.12 * amp, 0);
    J.chest.rotation.set(breathe, -Math.sin(p) * 0.1 * amp, 0);
    J.hips.rotation.set(0, Math.sin(p) * 0.08 * amp, Math.cos(p) * 0.03 * amp);
    J.head.rotation.set(-0.05 - 0.1 * run - sn * 0.2, 0, 0);
    // arms: natural swing
    const aswing = (0.35 + 0.55 * run) * amp;
    let uaL = Math.sin(p + Math.PI) * aswing, uaR = Math.sin(p) * aswing;
    const armRot = {
      uaL: [-uaL, 0, 0.12], uaR: [-uaR, 0, -0.12],
      faL: [-0.2 - 1.0 * run + breathe, 0, 0], faR: [-0.2 - 1.0 * run + breathe, 0, 0],
    };
    // carrying a box: both arms forward
    const c = s.carry;
    const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    armRot.uaL = mix3(armRot.uaL, [-0.55 + Math.sin(p) * 0.04 * amp, 0, -0.32], c);
    armRot.uaR = mix3(armRot.uaR, [-0.55 + Math.sin(p) * 0.04 * amp, 0, 0.32], c);
    armRot.faL = mix3(armRot.faL, [-1.05, 0.3, 0], c);
    armRot.faR = mix3(armRot.faR, [-1.05, -0.3, 0], c);
    // waving (intro)
    if (s.wave > 0.01) {
      armRot.uaR = mix3(armRot.uaR, [-2.6, 0, -0.3 + Math.sin(this.t * 7) * 0.25], s.wave);
      armRot.faR = mix3(armRot.faR, [-0.4, 0, 0], s.wave);
    }
    // grabbing something on the ground: crouch and reach
    if (s.grab > 0) {
      const g = Math.sin(clamp(s.grab, 0, 1) * Math.PI);
      hipY = lerp(hipY, 0.5, g);
      J.thighL.rotation.x = lerp(J.thighL.rotation.x, -1.45, g); J.thighR.rotation.x = lerp(J.thighR.rotation.x, -0.9, g);
      J.shinL.rotation.x = lerp(J.shinL.rotation.x, 1.9, g); J.shinR.rotation.x = lerp(J.shinR.rotation.x, 1.7, g);
      J.footL.rotation.x = lerp(J.footL.rotation.x, -0.4, g); J.footR.rotation.x = lerp(J.footR.rotation.x, 0.2, g);
      J.spine.rotation.x = lerp(J.spine.rotation.x, 0.75, g);
      J.head.rotation.x = lerp(J.head.rotation.x, 0.3, g);
      armRot.uaR = mix3(armRot.uaR, [-1.1, 0, 0.1], g);
      armRot.faR = mix3(armRot.faR, [-0.2, 0, 0], g);
      if (!target.carry) { armRot.uaL = mix3(armRot.uaL, [-1.0, 0, -0.1], g); armRot.faL = mix3(armRot.faL, [-0.2, 0, 0], g); }
    }
    // throwing from the box with the right arm
    if (s.throwT >= 0) {
      const t = s.throwT;
      let a;
      if (t < 0.25) a = [lerp(-0.55, -0.9, t / 0.25), 0, lerp(0.32, 0.2, t / 0.25)];
      else if (t < 0.55) { const k = (t - 0.25) / 0.3; a = [lerp(-0.9, -2.9, smoothstep(0, 1, k)), 0, lerp(0.2, -0.35, k)]; }
      else if (t < 0.7) { const k = (t - 0.55) / 0.15; a = [lerp(-2.9, -1.0, k), 0, -0.35]; }
      else { const k = (t - 0.7) / 0.3; a = [lerp(-1.0, -0.55, k), 0, lerp(-0.35, 0.32, k)]; }
      const w = Math.sin(clamp(t, 0, 1) * Math.PI) ** 0.3;
      armRot.uaR = mix3(armRot.uaR, a, w);
      armRot.faR = mix3(armRot.faR, [t < 0.55 ? -1.5 : -0.4, 0, 0], w);
      J.spine.rotation.y += Math.sin(t * Math.PI * 2) * -0.3;
      J.spine.rotation.x += (t > 0.5 && t < 0.8) ? 0.25 : 0;
    }
    // shambling undead: arms out in front, head lolling, a dragging leg
    if (s.zombie) {
      const sw = Math.sin(this.t * 1.1) * 0.06;
      armRot.uaL = [-1.45 + sw, 0, 0.12]; armRot.uaR = [-1.35 - sw, 0, -0.12];
      armRot.faL = [-0.25, 0, 0]; armRot.faR = [-0.4, 0, 0];
      J.head.rotation.z = 0.32 + Math.sin(this.t * 0.7) * 0.08; J.head.rotation.x += 0.15;
      J.spine.rotation.x += 0.18; J.thighR.rotation.x *= 0.45; J.shinR.rotation.x *= 0.4;
    }
    // running away with arms in the air
    if (s.panic > 0.01) {
      const f = Math.sin(this.t * 13) * 0.35;
      armRot.uaL = mix3(armRot.uaL, [-2.7 + f, 0, 0.5], s.panic); armRot.uaR = mix3(armRot.uaR, [-2.7 - f, 0, -0.5], s.panic);
      armRot.faL = mix3(armRot.faL, [-0.5, 0, 0], s.panic); armRot.faR = mix3(armRot.faR, [-0.5, 0, 0], s.panic);
    }
    // fists up
    const guard = Math.max(s.guard, punch >= 0 ? 1 : 0);
    if (guard > 0.01) {
      armRot.uaL = mix3(armRot.uaL, [-0.75, 0, -0.35], guard); armRot.uaR = mix3(armRot.uaR, [-0.75, 0, 0.35], guard);
      armRot.faL = mix3(armRot.faL, [-1.95, 0.2, 0], guard); armRot.faR = mix3(armRot.faR, [-1.95, -0.2, 0], guard);
    }
    if (punch >= 0) { // a straight jab with one arm
      const t = clamp(punch, 0, 1), e = t < 0.3 ? smoothstep(0, 0.3, t) : 1 - smoothstep(0.45, 1, t);
      const L = target.punchSide === 'L', ua = L ? 'uaL' : 'uaR', fa = L ? 'faL' : 'faR';
      armRot[ua] = mix3(armRot[ua], [-1.6, 0, L ? -0.05 : 0.05], e);
      armRot[fa] = mix3(armRot[fa], [-0.12, 0, 0], e);
      J.spine.rotation.y += (L ? -0.4 : 0.4) * e; J.spine.rotation.x += 0.1 * e;
    }
    if (slash >= 0) { // a sweeping cut with the right hand
      const t = clamp(slash, 0, 1), k = smoothstep(0.15, 0.55, t), w = Math.sin(t * Math.PI) ** 0.4;
      armRot.uaR = mix3(armRot.uaR, [-1.35, 0, lerp(1.1, -0.9, k)], w);
      armRot.faR = mix3(armRot.faR, [-0.35, 0, 0], w);
      J.spine.rotation.y += lerp(0.55, -0.55, k) * w;
    }
    if (s.reach > 0.01) { // reaching for a door handle, or a collar
      armRot.uaR = mix3(armRot.uaR, [-1.5, 0, -0.1], s.reach); armRot.faR = mix3(armRot.faR, [-0.15, 0, 0], s.reach);
    }
    // in the air: knees up, arms out for balance
    if (s.air > 0.01) {
      const k = s.air;
      J.thighL.rotation.x = lerp(J.thighL.rotation.x, -0.75, k); J.thighR.rotation.x = lerp(J.thighR.rotation.x, -0.35, k);
      J.shinL.rotation.x = lerp(J.shinL.rotation.x, 1.1, k); J.shinR.rotation.x = lerp(J.shinR.rotation.x, 0.7, k);
      if (!target.carry) { armRot.uaL = mix3(armRot.uaL, [-0.5, 0, 0.9], k); armRot.uaR = mix3(armRot.uaR, [-0.5, 0, -0.9], k); }
    }
    // swimming: breaststroke (the caller tips the body forward)
    if (s.swim > 0.01) {
      const k = s.swim, c = Math.sin(this.t * 3.4), o = Math.max(0, c), kick = Math.max(0, -c);
      armRot.uaL = mix3(armRot.uaL, [-2.9 + o * 0.4, 0, 0.25 + o * 0.9], k); armRot.uaR = mix3(armRot.uaR, [-2.9 + o * 0.4, 0, -0.25 - o * 0.9], k);
      armRot.faL = mix3(armRot.faL, [-0.2 - o * 0.6, 0, 0], k); armRot.faR = mix3(armRot.faR, [-0.2 - o * 0.6, 0, 0], k);
      J.thighL.rotation.set(lerp(J.thighL.rotation.x, -0.25 - kick * 0.5, k), 0, 0.15 * kick * k);
      J.thighR.rotation.set(lerp(J.thighR.rotation.x, -0.25 - kick * 0.5, k), 0, -0.15 * kick * k);
      J.shinL.rotation.x = lerp(J.shinL.rotation.x, 0.3 + kick * 1.3, k); J.shinR.rotation.x = lerp(J.shinR.rotation.x, 0.3 + kick * 1.3, k);
      J.head.rotation.x = lerp(J.head.rotation.x, -0.9, k);
      hipY = lerp(hipY, 0.94, k);
    }
    // knocked down: limp, arms flung out (the caller lays the body flat)
    if (s.ko > 0.01) {
      const k = s.ko;
      J.thighL.rotation.x = lerp(J.thighL.rotation.x, -0.15, k); J.thighR.rotation.x = lerp(J.thighR.rotation.x, 0.05, k);
      J.shinL.rotation.x = lerp(J.shinL.rotation.x, 0.5, k); J.shinR.rotation.x = lerp(J.shinR.rotation.x, 0.15, k);
      J.spine.rotation.set(lerp(J.spine.rotation.x, 0, k), 0, 0); J.chest.rotation.y = 0;
      J.head.rotation.set(lerp(J.head.rotation.x, 0.1, k), 0, 0.5 * k);
      armRot.uaL = mix3(armRot.uaL, [-0.3, 0, 1.3], k); armRot.uaR = mix3(armRot.uaR, [-1.0, 0, -1.1], k);
      armRot.faL = mix3(armRot.faL, [-0.3, 0, 0], k); armRot.faR = mix3(armRot.faR, [-0.6, 0, 0], k);
      hipY = lerp(hipY, 0.94, k);
    }
    // sitting (in the car)
    if (s.sit > 0.01) {
      const k = s.sit;
      hipY = lerp(hipY, 0.0, k);
      J.thighL.rotation.x = lerp(J.thighL.rotation.x, -1.5, k); J.thighR.rotation.x = lerp(J.thighR.rotation.x, -1.5, k);
      J.shinL.rotation.x = lerp(J.shinL.rotation.x, 1.4, k); J.shinR.rotation.x = lerp(J.shinR.rotation.x, 1.4, k);
      J.spine.rotation.x = lerp(J.spine.rotation.x, -0.12, k);
      armRot.uaL = mix3(armRot.uaL, [-1.0, 0, -0.15], k); armRot.uaR = mix3(armRot.uaR, [-1.0, 0, 0.15], k);
      armRot.faL = mix3(armRot.faL, [-0.6, 0.0, 0], k); armRot.faR = mix3(armRot.faR, [-0.6, 0.0, 0], k);
    }
    J.hips.position.y = hipY;
    J.upperArmL.rotation.set(...armRot.uaL); J.upperArmR.rotation.set(...armRot.uaR);
    J.foreArmL.rotation.set(...armRot.faL); J.foreArmR.rotation.set(...armRot.faR);
  }
}
