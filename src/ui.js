import { WORLD, height } from './world/layout.js';

const STAR = '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.6 6 20.9l1.3-6.7-5-4.7 6.8-.8z"/></svg>';
export const STAR_AT = [1, 4, 9, 16, 25];

export class UI {
  constructor(root, L) {
    this.L = L;
    root.innerHTML = `
<div id="hud" hidden>
  <div id="stars">${STAR.repeat(5)}</div>
  <div id="saved"></div>
  <div id="boxinfo"></div>
  <canvas id="mini" width="220" height="220"></canvas>
  <div id="prompt"></div>
  <div id="toast"></div>
</div>
<div id="tools">
  <button id="helpBtn" title="Help (H)">?</button><button id="muteBtn" title="Sound on/off">🔊</button><button id="fullBtn" title="Full screen">⛶</button>
</div>
<div id="title" class="screen">
  <h1>Puffling Night</h1>
  <p class="lede">Every September the young puffins of the islands leave their burrows at night and fly out to sea by the light of the moon. The lights of the town lead some of them astray. Tonight you help them home.</p>
  <div id="loadbar"><div></div></div>
  <button id="playBtn" disabled>Loading…</button>
  <button id="skipIntroBtn" class="secondary" hidden>Play without the intro</button>
</div>
<div id="caption"></div>
<button id="skip" hidden>Skip intro ›</button>
<div id="mapScreen" class="screen" hidden><canvas id="bigmap" width="900" height="900"></canvas><p>M or Esc to close</p></div>
<div id="help" class="screen" hidden>
  <div class="cols">
    <section><h2>On foot</h2><ul>
      <li><b>W A S D</b> or arrows: move</li><li><b>Mouse</b>: look around (click the game first)</li>
      <li><b>Shift</b>: run</li><li><b>C</b>: sneak (pufflings don't scare)</li>
      <li><b>E</b>: catch a puffling, take or put the box, throw from the cliff</li>
      <li><b>F</b>: get in the car</li></ul></section>
    <section><h2>Driving</h2><ul>
      <li><b>W / S</b>: accelerate, brake and reverse</li><li><b>A / D</b>: steer</li>
      <li><b>Space</b>: handbrake</li><li><b>Q</b>: horn</li><li><b>L</b>: headlights</li><li><b>F</b>: get out</li></ul></section>
    <section><h2>The night</h2><ul>
      <li>Stranded pufflings sit near street lights, doors and parked cars. Listen for their peeps.</li>
      <li>Take the box from the car (<b>E</b> by the car), catch pufflings, then put the box back in the car.</li>
      <li>Drive to the cliff lookout by the lighthouse (the star on the map) and throw them out over the sea.</li>
      <li>Running scares them. Sneak up, or wait for a tired one to stop.</li>
      <li>The more you save, the more stars you earn.</li>
      <li><b>M</b>: map · <b>H</b>: this help · <b>Esc</b>: pause</li></ul></section>
  </div>
  <p class="pad">Gamepad: left stick move/steer, right stick look, RT/LT drive, A interact, Y car, B handbrake, Back map.</p>
  <button id="helpClose">Back to the night</button>
</div>
<div id="pause" class="screen" hidden><h2>Paused</h2><button id="resumeBtn">Resume</button></div>
`;
    this.$ = id => document.getElementById(id);
    this.mini = this.$('mini').getContext('2d');
    this.big = this.$('bigmap').getContext('2d');
    this.toastT = 0; this.captionT = 0;
    this.mapImage = this.renderMapImage(512);
  }
  // pre-render the terrain, roads and buildings into an image
  renderMapImage(N) {
    const c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d');
    const img = g.createImageData(N, N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = WORLD.minX + (i + 0.5) / N * (WORLD.maxX - WORLD.minX), z = WORLD.minZ + (j + 0.5) / N * (WORLD.maxZ - WORLD.minZ);
      const h = height(x, z), o = (j * N + i) * 4;
      if (h < 0) { img.data[o] = 12; img.data[o + 1] = 24 + Math.max(-10, h); img.data[o + 2] = 42 + Math.max(-14, h) * 1.2; }
      else { const k = Math.min(1, h / 120); img.data[o] = 38 + k * 50; img.data[o + 1] = 52 + k * 40; img.data[o + 2] = 36 + k * 40; }
      img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const s = N / (WORLD.maxX - WORLD.minX), px = x => (x - WORLD.minX) * s, pz = z => (z - WORLD.minZ) * s;
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const r of this.L.roads) {
      g.strokeStyle = '#8c8f94'; g.lineWidth = Math.max(2, r.width * s * 1.2);
      g.beginPath(); r.pts.forEach((p, i) => (i ? g.lineTo(px(p.x), pz(p.z)) : g.moveTo(px(p.x), pz(p.z)))); g.stroke();
    }
    g.fillStyle = '#c9b48a';
    for (const b of this.L.buildings) {
      g.save(); g.translate(px(b.x), pz(b.z)); g.rotate(b.ang); g.fillRect(-b.w * s / 2, -b.d * s / 2, b.w * s, b.d * s); g.restore();
    }
    this.mapScale = s; this.mapN = N;
    return c;
  }
  drawMinimap(player, car, heading, pufflings, lookout, boxPos) {
    const g = this.mini, W = 220, R = 105, zoom = 1.6; // pixels per metre on the minimap = zoom * mapScale-ish
    const s = this.mapScale, px = x => (x - WORLD.minX) * s, pz = z => (z - WORLD.minZ) * s;
    const k = 1.9 / s; // canvas px per map px
    g.save();
    g.clearRect(0, 0, W, W);
    g.beginPath(); g.arc(W / 2, W / 2, R, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#0b1a2a'; g.fillRect(0, 0, W, W);
    g.translate(W / 2, W / 2);
    g.rotate(-heading - Math.PI / 2);
    g.scale(k, k);
    g.translate(-px(player.x), -pz(player.z));
    g.imageSmoothingEnabled = true;
    g.drawImage(this.mapImage, 0, 0);
    const dot = (x, z, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(px(x), pz(z), r / k, 0, Math.PI * 2); g.fill(); };
    for (const p of pufflings) if (Math.hypot(p.pos.x - player.x, p.pos.z - player.z) < 70) dot(p.pos.x, p.pos.z, 3.2, '#f2f2ee');
    dot(lookout.x, lookout.z, 6, '#ffd34a');
    if (car) dot(car.x, car.z, 5, '#6ec3ff');
    if (boxPos) dot(boxPos.x, boxPos.z, 3.5, '#d9a66b');
    g.restore();
    // lookout arrow at the edge if off-screen
    const dx = lookout.x - player.x, dz = lookout.z - player.z, d = Math.hypot(dx, dz);
    if (d * 1.9 > R) {
      const a = Math.atan2(dz, dx) - heading - Math.PI / 2;
      g.save(); g.translate(W / 2 + Math.cos(a) * (R - 10), W / 2 + Math.sin(a) * (R - 10)); g.rotate(a);
      g.fillStyle = '#ffd34a'; g.beginPath(); g.moveTo(8, 0); g.lineTo(-5, -6); g.lineTo(-5, 6); g.closePath(); g.fill(); g.restore();
    }
    // player arrow
    g.save(); g.translate(W / 2, W / 2); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath(); g.fill(); g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2; g.beginPath(); g.arc(W / 2, W / 2, R, 0, Math.PI * 2); g.stroke();
  }
  drawBigMap(player, heading, car, lookout, pufflings) {
    const g = this.big, N = 900;
    g.clearRect(0, 0, N, N);
    // crop to the playable area
    const x0 = -420, x1 = 460, z0 = -580, z1 = 440, S = Math.min(N / (x1 - x0), N / (z1 - z0));
    const s = this.mapScale;
    g.save();
    g.scale(S / s, S / s);
    g.translate(-(x0 - WORLD.minX) * s, -(z0 - WORLD.minZ) * s);
    g.drawImage(this.mapImage, 0, 0);
    g.restore();
    const P = (x, z) => [(x - x0) * S, (z - z0) * S];
    const dot = (x, z, r, c) => { const [a, b] = P(x, z); g.fillStyle = c; g.beginPath(); g.arc(a, b, r, 0, 7); g.fill(); };
    for (const p of pufflings) if (Math.hypot(p.pos.x - player.x, p.pos.z - player.z) < 70) dot(p.pos.x, p.pos.z, 3, '#f2f2ee');
    dot(car.x, car.z, 7, '#6ec3ff');
    const [lx, lz] = P(lookout.x, lookout.z);
    g.fillStyle = '#ffd34a'; g.font = '28px system-ui'; g.textAlign = 'center'; g.fillText('★', lx, lz + 10);
    g.font = '15px system-ui'; g.fillText('Lookout', lx + 44, lz + 6);
    const [ax, az] = P(player.x, player.z);
    g.save(); g.translate(ax, az); g.rotate(heading + Math.PI / 2); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -12); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.restore();
  }
  setStars(n, saved) {
    [...this.$('stars').children].forEach((s, i) => s.classList.toggle('on', i < n));
    this.$('saved').textContent = saved === 1 ? '1 puffling saved' : `${saved} pufflings saved`;
  }
  setBox(count, where) {
    this.$('boxinfo').textContent = `Box: ${count}/6` + (where === 'car' ? ' (in the car)' : where === 'hands' ? '' : '');
  }
  prompt(text) { const p = this.$('prompt'); if (p.textContent !== text) p.textContent = text; p.style.opacity = text ? 1 : 0; }
  toast(text, secs = 3) { const t = this.$('toast'); t.innerHTML = text; t.style.opacity = 1; this.toastT = secs; }
  caption(text, secs = 4) { const c = this.$('caption'); c.textContent = text; c.style.opacity = text ? 1 : 0; this.captionT = secs; }
  update(dt) {
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.$('toast').style.opacity = 0; }
    if (this.captionT > 0) { this.captionT -= dt; if (this.captionT <= 0) this.$('caption').style.opacity = 0; }
  }
  starBurst() {
    const el = this.$('stars'); el.classList.remove('burst'); void el.offsetWidth; el.classList.add('burst');
  }
}
