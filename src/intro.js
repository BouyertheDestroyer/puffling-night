import * as THREE from 'three';
import { buildPerson } from './character.js';
import { buildPufflingModel } from './puffling.js';
import { GeoBuilder, col } from './geo.js';
import { model, pbr } from './assets.js';
import { height, coastX, shoreS } from './world/layout.js';
import { MOON_DIR } from './world/sky.js';
import { clamp, lerp, smoothstep, rng } from './noise.js';

const W = (s, z) => { const x = coastX(z) + s; return new THREE.Vector3(x, height(x, z), z); };

// The time-lapse opening: pufflings fly to the moon; then people, fire, a house, a town, a city;
// and the birds turn towards the lights.
export class Intro {
  constructor(ctx) {
    Object.assign(this, ctx); // E, audio, ui, sky, ocean, terrain, town, game
    this.t = 0; this.active = false; this.useWorld = true;
    this.group = new THREE.Group(); this.group.name = 'intro'; this.group.visible = false;
    this.E.scene.add(this.group);
    this.r = rng(31);
    this.fireAt = W(12, -40); this.fireAt.y = height(this.fireAt.x, this.fireAt.z);
    this.buildProps();
    this.buildFlock();
    this.cityBuilt = false;
    // camera keyframes [time, position, lookAt]
    const cliffTop = W(30, -365); cliffTop.y += 4.5;
    const f = this.fireAt;
    const seaWide = W(-170, 40); seaWide.y = 48;
    const town = W(110, 90); town.y = 14;
    this.keys = [
      [0, cliffTop, cliffTop.clone().add(new THREE.Vector3(MOON_DIR.x * 100, 16, MOON_DIR.z * 100))],
      [8.5, cliffTop.clone().add(new THREE.Vector3(MOON_DIR.x * 22, 7, MOON_DIR.z * 22)), cliffTop.clone().add(new THREE.Vector3(MOON_DIR.x * 130, 34, MOON_DIR.z * 130))],
      [9.0, f.clone().add(new THREE.Vector3(-5, 1.9, 5)), f.clone().add(new THREE.Vector3(0.5, 0.9, -0.5))],
      [15.5, f.clone().add(new THREE.Vector3(-7.5, 2.6, 8)), f.clone().add(new THREE.Vector3(1.5, 1.2, -1.5))],
      [21.0, f.clone().add(new THREE.Vector3(-30, 10, 32)), f.clone().add(new THREE.Vector3(6, 2, -3))],
      [22.0, f.clone().add(new THREE.Vector3(-34, 12, 36)), f.clone().add(new THREE.Vector3(8, 2, -2))],
      [28.0, seaWide, town],
      [35.0, seaWide.clone().add(new THREE.Vector3(-60, 30, 30)), town.clone().add(new THREE.Vector3(80, 10, 0))],
      [40.0, seaWide.clone().add(new THREE.Vector3(-70, 34, 32)), town.clone().add(new THREE.Vector3(90, 10, 0))],
    ];
    this.captions = [
      [0.8, 'Every late summer, the young puffins leave their burrows for the first time.', 7],
      [5.0, 'They fly out to sea by the light of the moon and the stars.', 3.8],
      [9.8, 'Then people came, and they brought fire.', 5],
      [16.3, 'They built houses.', 4.5],
      [22.4, 'Then towns.', 4.5],
      [28.0, 'Then cities, full of lights.', 4.8],
      [33.0, 'And the pufflings turned towards the lights.', 4.6],
      [38.0, 'Tonight you help them find the sea.', 3.2],
    ];
    this.duration = 41.5;
  }
  buildProps() {
    const g = this.group, f = this.fireAt;
    // fire pit, flames and light
    const pit = model('stone_fire_pit', 0.45); pit.position.copy(f); g.add(pit);
    this.fireLight = new THREE.PointLight(0xff8a3a, 0, 30, 2); this.fireLight.position.copy(f).add(new THREE.Vector3(0, 0.8, 0)); g.add(this.fireLight);
    const flameMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        void main(){ vec2 p = vUv; float x = (p.x-0.5)*2.0;
          float t = uTime*2.5; float nn = n(vec2(p.x*5.0, p.y*4.0 - t)) * 0.6 + n(vec2(p.x*11.0, p.y*9.0 - t*1.7))*0.4;
          float shape = (1.0 - abs(x) * (1.0 + p.y*2.5)) - p.y*0.9 + nn*0.55 - 0.25;
          float a = smoothstep(0.0, 0.35, shape);
          vec3 c = mix(vec3(1.0,0.35,0.05), vec3(1.0,0.85,0.45), smoothstep(0.2, 0.9, shape));
          gl_FragColor = vec4(c * a * 2.4, 1.0); }`,
    });
    this.flameMat = flameMat;
    this.flames = new THREE.Group(); this.flames.position.copy(f).add(new THREE.Vector3(0, 0.15, 0));
    for (let i = 0; i < 3; i++) { const q = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.1), flameMat); q.position.y = 0.5; q.rotation.y = i * Math.PI / 3; this.flames.add(q); }
    g.add(this.flames);
    // embers
    const N = 60, pos = new Float32Array(N * 3); this.embers = { pos, life: new Float32Array(N).map(() => Math.random()), vel: [] };
    for (let i = 0; i < N; i++) this.embers.vel.push(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.8 + Math.random(), (Math.random() - 0.5) * 0.4));
    const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.emberPts = new THREE.Points(eg, new THREE.PointsMaterial({ color: 0xffa040, size: 0.05, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.emberPts.frustumCulled = false; g.add(this.emberPts);
    // the caveman, crouched by the fire
    this.caveman = buildPerson({ caveman: true, trousers: 0x5a4430, skin: 0xc99474, hair: 0x2a1a10 });
    const cp = f.clone().add(new THREE.Vector3(-1.3, 0, 0.9)); cp.y = height(cp.x, cp.z);
    this.caveman.root.position.copy(cp);
    this.caveman.root.lookAt(f.x, cp.y, f.z);
    g.add(this.caveman.root);
    // a spear stuck in the ground
    const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.9 }));
    spear.position.copy(cp).add(new THREE.Vector3(-0.8, 1.05, -0.6)); spear.rotation.z = 0.12; g.add(spear);
    // a turf house: stone walls, grass roof, a wooden gable with a lit window
    this.house = this.buildTurfHouse(f.clone().add(new THREE.Vector3(5, 0, -7)));
    g.add(this.house);
    // the city: towers of lit windows on the hills behind the town
    this.city = new THREE.Group(); this.city.visible = false; g.add(this.city);
  }
  buildTurfHouse(at) {
    const grp = new THREE.Group();
    const y = height(at.x, at.z);
    grp.position.set(at.x, y, at.z); grp.rotation.y = -2.3;
    const B = new GeoBuilder(1.5), R = new GeoBuilder(1.5), Wd = new GeoBuilder(1);
    const w = 6, d = 4.5, h = 1.6, ridge = 3.4;
    B.box(0, h / 2, 0, w + 1.2, h, d + 1.2, col(0x8a8478));
    R.quad([w / 2 + 0.6, h, d / 2 + 0.6], [w / 2 + 0.6, ridge, 0], [-w / 2 - 0.6, ridge, 0], [-w / 2 - 0.6, h, d / 2 + 0.6], col(0xffffff));
    R.quad([-w / 2 - 0.6, h, -d / 2 - 0.6], [-w / 2 - 0.6, ridge, 0], [w / 2 + 0.6, ridge, 0], [w / 2 + 0.6, h, -d / 2 - 0.6], col(0xffffff));
    // wooden gable end
    Wd.tri([w / 2 + 0.62, 0, -d / 2], [w / 2 + 0.62, 0, d / 2], [w / 2 + 0.62, ridge - 0.2, 0], col(0x2a2622));
    Wd.quad([w / 2 + 0.62, 0, -d / 2], [w / 2 + 0.62, 0, d / 2], [w / 2 + 0.62, h, d / 2], [w / 2 + 0.62, h, -d / 2], col(0x2a2622));
    Wd.box(w / 2 + 0.66, 0.9, 0.9, 0.06, 1.8, 0.9, col(0x6a2a1e));
    Wd.box(w / 2 + 0.64, ridge - 0.25, 0, 0.08, 0.1, 1.2, col(0xe8e4da));
    const stone = pbr('dark_rock', { vertexColors: true });
    const grass = pbr('aerial_grass_rock');
    const wood = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    for (const [b, m] of [[B, stone], [R, grass], [Wd, wood]]) { const mesh = new THREE.Mesh(b.build(), m); mesh.castShadow = mesh.receiveShadow = true; grp.add(mesh); }
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.5), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffb060, emissiveIntensity: 3 }));
    win.position.set(w / 2 + 0.67, 1.9, -0.6); win.rotation.y = Math.PI / 2; grp.add(win);
    const l = new THREE.PointLight(0xffa050, 14, 14, 2); l.position.set(w / 2 + 1.4, 2.2, -0.2); grp.add(l);
    grp.userData.light = l;
    return grp;
  }
  buildCity() {
    // instanced towers with lit-window textures on the hills inland of the town
    const c = document.createElement('canvas'); c.width = 64; c.height = 128;
    const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 64, 128);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) if (Math.random() < 0.3) { g.fillStyle = Math.random() < 0.8 ? '#ffd9a0' : '#cfe0ff'; g.fillRect(x * 8 + 2, y * 8 + 2, 4, 5); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = THREE.NearestFilter;
    const mat = new THREE.MeshStandardMaterial({ color: 0x0c0e12, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.1, roughness: 0.6 });
    const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
    const N = 170, im = new THREE.InstancedMesh(geo, mat, N), m = new THREE.Object3D();
    const r = this.r;
    for (let i = 0; i < N; i++) {
      const s = r.range(260, 540), z = r.range(-170, 380);
      const x = coastX(z) + s;
      const h = r.range(12, 60) * (1 - Math.abs(z - 100) / 500);
      m.position.set(x, height(x, z) - 1, z); m.scale.set(r.range(10, 22), h, r.range(10, 22)); m.rotation.y = r.range(0, 6.28);
      m.updateMatrix(); im.setMatrixAt(i, m.matrix);
    }
    this.city.add(im);
    // sodium-orange glow points across the hills (street lights of the city)
    const P = 2500, pos = new Float32Array(P * 3);
    for (let i = 0; i < P; i++) {
      const s = r.range(200, 560), z = r.range(-200, 420), x = coastX(z) + s;
      pos.set([x, height(x, z) + 6, z], i * 3);
    }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffb060, size: 1.6, sizeAttenuation: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.city.add(pts);
    this.cityBuilt = true;
  }
  buildFlock() {
    this.birds = [];
    for (let i = 0; i < 46; i++) {
      const m = buildPufflingModel(); m.root.scale.setScalar(i < 22 ? 2.6 : 4.5);
      m.root.visible = false; this.group.add(m.root);
      this.birds.push({ m, seed: this.r(), wave: i < 22 ? 0 : i < 34 ? 1 : 2, delay: this.r.range(0, 1) });
    }
  }
  birdPath(b, t, out) {
    // returns false if not visible at time t
    const moon = new THREE.Vector3(MOON_DIR.x, 0, MOON_DIR.z).normalize();
    if (b.wave === 0) { // from the cliffs out towards the moon
      const t0 = b.delay * 7, k = t - t0;
      if (k < 0 || k > 12) return false;
      // they set off from the cliff top around and behind the camera and fly past it, out to sea
      const cam = this.keys[0][1], side = new THREE.Vector3(-moon.z, 0, moon.x);
      const s2 = (b.seed * 7.13) % 1, s3 = (b.seed * 3.71) % 1;
      const start = cam.clone().addScaledVector(moon, -8 - s2 * 22).addScaledVector(side, (s3 - 0.5) * 26);
      start.y = Math.max(height(start.x, start.z) + 0.6, cam.y - 3 + s2 * 4);
      out.copy(start).addScaledVector(moon, k * 10).add(new THREE.Vector3(Math.sin(k * 0.8 + b.seed * 9) * 2, k * 3.2 + Math.sin(k * 3 + b.seed * 5) * 0.3, Math.cos(k * 0.7 + b.seed * 4) * 2));
      out.userData = { dir: moon };
      return true;
    }
    if (b.wave === 1) { // past the fire, still heading out to sea
      const t0 = 9 + b.delay * 5, k = t - t0;
      if (k < 0 || k > 9) return false;
      const f = this.fireAt;
      const start = f.clone().add(new THREE.Vector3(40 + b.seed * 20, 18 + b.seed * 6, -20 - b.seed * 30));
      out.copy(start).addScaledVector(moon, k * 10); out.y += Math.sin(k * 2 + b.seed * 8) * 0.4;
      out.userData = { dir: moon };
      return true;
    }
    // the turn: they come in from the sea and curve towards the city lights
    const t0 = 29.5 + b.delay * 6, k = t - t0;
    if (k < 0 || k > 11) return false;
    const town = W(160, 90 + (b.seed - 0.5) * 220); town.y = 30;
    const cam = this.keys[6][1], dirT = town.clone().sub(cam).setY(0).normalize(), sd = new THREE.Vector3(-dirT.z, 0, dirT.x);
    const s2 = (b.seed * 7.13) % 1;
    const sea = cam.clone().addScaledVector(dirT, -10 - s2 * 20).addScaledVector(sd, (b.seed - 0.5) * 40); sea.y = cam.y - 6 + s2 * 8;
    const u = clamp(k / 11, 0, 1);
    out.lerpVectors(sea, town, u);
    out.x += Math.sin(u * Math.PI) * -30 * (b.seed - 0.5);
    out.y += Math.sin(k * 2 + b.seed * 6) * 0.6;
    out.userData = { dir: town.clone().sub(sea).setY(0).normalize() };
    return true;
  }
  start() {
    this.active = true; this.t = this.t || 0;
    this.group.visible = true;
    this.setGameVisible(false);
    this.town.group.visible = false;
    this.lampsOn(0);
    this.audio.pad([[110, 164.8, 220, 277.2], [98, 146.8, 196, 246.9], [87.3, 130.8, 174.6, 220], [98, 146.8, 196, 246.9], [110, 164.8, 220, 277.2], [130.8, 196, 261.6, 329.6], [116.5, 174.6, 233.1, 293.7], [110, 164.8, 220, 277.2]], 5.2);
    this.E.grade.uniforms.uFade.value = 1;
    this.lastCap = -1;
  }
  setGameVisible(v) {
    const g = this.game;
    g.car.root.visible = v; g.player.root.visible = v;
    for (const p of g.pufflings.list) p.m.root.visible = v && p.state !== 'caught';
    for (const m of g.parkedMeshes ?? []) m.visible = v;
  }
  lampsOn(k) { this.lampLevel = k; }
  end() {
    if (!this.active && !this.group.visible) return;
    this.active = false;
    this.group.visible = false;
    this.town.group.visible = true;
    this.setGameVisible(true);
    this.lampLevel = 1;
    for (const l of this.E.pool) l.visible = true;
    this.sky.userData.uniforms.uSpin.value = 0;
    this.sky.userData.uniforms.uAurora.value = 1;
    this.E.grade.uniforms.uFade.value = 0;
    this.audio.stopMusic(); this.audio.crackle(false);
    this.ui.caption('', 0);
    this.E.scene.fog.density = 0.0006;
  }
  update(dt) {
    if (!this.active) return true;
    this.t += dt;
    const t = this.t, E = this.E;
    // captions
    for (let i = 0; i < this.captions.length; i++) {
      const [at, text, secs] = this.captions[i];
      if (t >= at && this.lastCap < i) { this.lastCap = i; this.ui.caption(text, secs); }
    }
    // fades in and out, and around the cut to the fire
    let fade = 1 - smoothstep(0, 2.5, t);
    fade = Math.max(fade, 1 - Math.abs(t - 8.8) / 0.4 > 0 ? 1 - Math.abs(t - 8.8) / 0.4 : 0);
    fade = Math.max(fade, smoothstep(39.5, 41.3, t));
    E.grade.uniforms.uFade.value = fade;
    // time-lapse sky: stars wheel overhead
    const su = this.sky.userData.uniforms;
    su.uSpin.value += dt * 0.06;
    su.uAurora.value = t < 25 ? 1 : 1 - smoothstep(25, 33, t) * 0.8;
    // camera
    const k = this.keys;
    let i = 0; while (i < k.length - 2 && t > k[i + 1][0]) i++;
    const [t0, p0, l0] = k[i], [t1, p1, l1] = k[i + 1];
    const u = smoothstep(t0, t1, t);
    E.camera.position.lerpVectors(p0, p1, u);
    const look = new THREE.Vector3().lerpVectors(l0, l1, u);
    E.camera.lookAt(look);
    if (E.camera.fov !== 55) { E.camera.fov = 55; E.camera.updateProjectionMatrix(); }
    // stages
    const fireOn = t > 9.4;
    this.flames.visible = fireOn; this.emberPts.visible = fireOn; this.caveman.root.visible = t > 9.2;
    this.fireLight.intensity = fireOn ? 26 + Math.sin(t * 17) * 5 + Math.sin(t * 7.3) * 4 : 0;
    this.flameMat.uniforms.uTime.value = t;
    this.audio.crackle(fireOn && t < 22);
    if (fireOn) this.audio.crackleTick();
    this.caveman.anim.update(dt, { speed: 0, wave: t > 11.5 && t < 14 });
    const hk = smoothstep(16.2, 17.6, t);
    this.house.visible = hk > 0;
    this.house.scale.setScalar(Math.max(0.001, hk));
    this.house.userData.light.intensity = 14 * hk;
    // the town and its lights
    const townOn = t > 22.2;
    this.town.group.visible = townOn;
    this.lampsOn(townOn ? smoothstep(22.2, 24, t) : 0);
    for (const l of E.pool) l.visible = townOn;
    if (t > 26 && !this.cityBuilt) this.buildCity();
    this.city.visible = t > 28.0;
    // light pollution brightens the sky
    su.uBright.value = 1 + smoothstep(28, 34, t) * 0.6;
    E.scene.fog.density = 0.0006 + smoothstep(28, 34, t) * 0.0006;
    // embers
    const e = this.embers;
    for (let n = 0; n < e.life.length; n++) {
      e.life[n] += dt * 0.6; if (e.life[n] > 1) { e.life[n] = 0; e.vel[n].x = (Math.random() - 0.5) * 0.4; e.vel[n].z = (Math.random() - 0.5) * 0.4; }
      const L = e.life[n];
      e.pos[n * 3] = this.fireAt.x + e.vel[n].x * L * 2 + Math.sin(L * 9 + n) * 0.1;
      e.pos[n * 3 + 1] = this.fireAt.y + 0.3 + e.vel[n].y * L * 2.5;
      e.pos[n * 3 + 2] = this.fireAt.z + e.vel[n].z * L * 2;
    }
    this.emberPts.geometry.attributes.position.needsUpdate = true;
    // birds
    const v = new THREE.Vector3();
    for (const b of this.birds) {
      const ok = this.birdPath(b, t, v);
      b.m.root.visible = ok;
      if (!ok) continue;
      b.m.root.position.copy(v);
      const d = v.userData.dir;
      b.m.root.rotation.set(0, Math.atan2(d.x, d.z), 0);
      b.m.tilt.rotation.x = 1.25;
      const fl = t * 15 + b.seed * 10;
      for (const w of b.m.wings) w.rotation.z = w.userData.side * (1.0 + Math.sin(fl) * 0.9);
    }
    // lamp pool focus: the town centre when it is visible
    const focus = townOn ? W(110, 90) : E.camera.position;
    if (townOn) E.updateLampPool(focus); else for (const l of E.pool) l.intensity = 0;
    E.followShadow(E.camera.position.clone().add(new THREE.Vector3(0, 0, 0)));
    return t >= this.duration;
  }
}
