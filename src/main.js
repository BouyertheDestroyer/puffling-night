import * as THREE from 'three';
import { loadAll } from './assets.js';
import { createEngine } from './engine.js';
import { buildLayout } from './world/layout.js';
import { buildTerrain, makeHeightTexture } from './world/terrain.js';
import { buildSky } from './world/sky.js';
import { buildOcean } from './world/ocean.js';
import { buildTown } from './world/town.js';
import { buildGrass } from './world/grass.js';
import { createWorld } from './world/physics.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { Game } from './game.js';
import { Intro } from './intro.js';

const params = new URLSearchParams(location.search);
const L = buildLayout();
const ui = new UI(document.getElementById('ui'), L);
const $ = ui.$;

await loadAll(p => { $('loadbar').firstChild.style.width = Math.round(p * 100) + '%'; });
const canvas = document.getElementById('c');
const E = createEngine(canvas);
const heightTex = makeHeightTexture();
const terrain = buildTerrain(); E.scene.add(terrain);
const sky = buildSky(); E.scene.add(sky);
const ocean = buildOcean(heightTex); E.scene.add(ocean);
// the sea reflects our own sky
{
  const crt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  const cc = new THREE.CubeCamera(1, 10000, crt);
  const sc = new THREE.Scene(); const skyCopy = buildSky(); sc.add(skyCopy);
  skyCopy.update(cc, 0, 1); skyCopy.userData.starMat.uniforms.uPix.value = 1.5;
  cc.update(E.renderer, sc);
  const pm = new THREE.PMREMGenerator(E.renderer);
  ocean.material.envMap = pm.fromCubemap(crt.texture).texture;
  ocean.material.envMapIntensity = 1.0;
}
const town = buildTown(L, E); E.scene.add(town.group);
const world = createWorld(L, town);
const grass = buildGrass(L, terrain); E.scene.add(grass);
const input = new Input(canvas);
const audio = new Audio();
const game = new Game({ E, L, world, town, input, audio, ui, sky, ocean });
const intro = new Intro({ E, audio, ui, sky, ocean, terrain, town, game });
window.__game = game; window.__L = L; window.__E = E; window.__intro = intro;

let mode = 'title';
const playBtn = $('playBtn');
playBtn.disabled = false; playBtn.textContent = 'Play';
$('skipIntroBtn').hidden = false;
let fadeIn = 0;
function startGame() {
  mode = 'play';
  intro.end();
  fadeIn = 1.6; E.grade.uniforms.uFade.value = 1;
  $('help').hidden = true; $('mapScreen').hidden = true;
  input.endFrame(); input.keys.clear();
  $('title').hidden = true; $('hud').hidden = false; $('skip').hidden = true;
  ui.toast('Find the stranded pufflings', 3);
  input.showTouch(true);
  ui.caption(input.touch || navigator.maxTouchPoints > 0 ? 'Take the box from the car (E), catch the pufflings, then drive them to the cliff. Left thumb moves, drag on the right to look.' : 'Take the box from the car (E), catch the pufflings, then drive them to the cliff.', 7);
  input.lock();
}
function startIntro() {
  audio.start();
  $('title').hidden = true;
  mode = 'intro'; intro.start(); $('skip').hidden = false;
}
playBtn.onclick = () => { startIntro(); };
$('skipIntroBtn').onclick = () => { audio.start(); startGame(); };
$('skip').onclick = () => startGame();
canvas.addEventListener('pointerup', e => { if (e.pointerType === 'mouse' && mode === 'play' && !game.overlay) input.lock(); });
$('helpBtn').onclick = () => { if (mode === 'play') game.toggleOverlay('help'); else $('help').hidden = !$('help').hidden; };
$('helpClose').onclick = () => { if (mode === 'play') { game.toggleOverlay('help'); input.lock(); } else $('help').hidden = true; };
$('muteBtn').onclick = () => { audio.setMuted(!audio.muted); $('muteBtn').textContent = audio.muted ? '🔇' : '🔊'; };
$('fullBtn').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); };
$('resumeBtn').onclick = () => { game.toggleOverlay('pause'); input.lock(); };
$('mapClose').onclick = () => { if (game.overlay === 'map') game.toggleOverlay('map'); input.lock(); };
document.addEventListener('pointerlockchange', () => {
  // losing the pointer lock with Esc pauses the game
  if (mode === 'play' && !input.touch && !document.pointerLockElement && !game.overlay && game.wasLocked) game.toggleOverlay('pause');
  game.wasLocked = !!document.pointerLockElement;
});
document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'play' && !game.overlay) game.toggleOverlay('pause'); });

// debug/test hooks
for (const n of (params.get('hide') || '').split(',').filter(Boolean)) E.scene.traverse(o => { if (o.name === n) o.visible = false; });
if (params.has('play')) { audio.start(); startGame(); }
if (params.has('intro')) { startIntro(); if (params.get('intro')) intro.t = +params.get('intro'); }

const clock = new THREE.Clock();
let fpsN = 0, fpsT = 0, slow = 0, fast = 0, playTime = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  if (mode === 'play') {
    game.update(dt);
    if (fadeIn > 0) { fadeIn = Math.max(0, fadeIn - dt); E.grade.uniforms.uFade.value = Math.min(1, fadeIn / 1.2); }
  }
  else if (mode === 'intro') { if (intro.update(dt)) startGame(); else input.endFrame(); }
  else { // title: slow drift over the town
    const a = t * 0.02;
    E.camera.position.set(L.carStart.x + Math.cos(a) * 160, 70, L.carStart.z + Math.sin(a) * 160);
    E.camera.lookAt(L.carStart.x, 10, L.carStart.z);
    E.updateLampPool(E.camera.position); E.followShadow(new THREE.Vector3(L.carStart.x, 0, L.carStart.z));
  }
  if (mode !== 'intro' || intro.useWorld) {
    sky.update(E.camera, t, E.renderer.getPixelRatio());
    ocean.update(E.camera, t);
    town.group.userData.update(t, E.camera);
    const t0 = performance.now(); grass.update(E.camera.position, t); const gt = performance.now() - t0; if (gt > 4) window.__grassMs = Math.max(window.__grassMs || 0, gt);
  }
  E.composer.render();
  // frame rate and adaptive resolution
  fpsN++;
  if (t - fpsT > 1) {
    const fps = fpsN / (t - fpsT); window.__fps = Math.round(fps); fpsN = 0; fpsT = t;
    // adaptive resolution: wait out the first seconds (shaders compiling), then only react to a
    // sustained slow or fast frame rate
    if (mode === 'play' && !params.has('fixed') && (playTime += 1) > 6) {
      const pr = E.renderer.getPixelRatio(), maxPr = Math.min(devicePixelRatio, 1.5);
      slow = fps < 32 ? slow + 1 : 0;
      fast = fps > 50 ? fast + 1 : 0;
      if (slow >= 3 && pr > 0.6) { E.renderer.setPixelRatio(Math.max(0.6, pr - 0.15)); E.resize(); slow = 0; }
      else if (fast >= 4 && pr < maxPr) { E.renderer.setPixelRatio(Math.min(pr + 0.1, maxPr)); E.resize(); fast = 0; }
    }
  }
  requestAnimationFrame(frame);
}
frame();
window.__ready = true;
