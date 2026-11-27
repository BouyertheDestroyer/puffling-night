// 90 s of random driving and walking; reports errors, frame rate and object counts over time.
import { firefox } from 'playwright';
const base = process.argv[2] || 'http://localhost:5199/';
const b = await firefox.launch({ headless: false });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(base + '?play');
await p.waitForFunction(() => window.__ready, null, { timeout: 90000 });
await p.waitForTimeout(1500);
const keys = ['w', 'a', 'd', 's', 'Space'];
const stat = () => p.evaluate(() => { let n = 0; __E.scene.traverse(() => n++); return { fps: window.__fps, objs: n, puff: __game.pufflings.list.length, geos: __E.renderer.info.memory.geometries, pr: __E.renderer.getPixelRatio(), inCar: __game.player.inCar }; });
console.log('start', JSON.stringify(await stat()));
for (let s = 0; s < 90; s++) {
  if (s % 15 === 0) { await p.keyboard.press('f'); }
  const k = keys[Math.floor(Math.random() * keys.length)];
  await p.keyboard.down('w'); await p.keyboard.down(k); await p.waitForTimeout(1000); await p.keyboard.up(k); await p.keyboard.up('w');
  if (Math.random() < 0.3) await p.keyboard.press('e');
  if (s % 30 === 29) console.log('t=' + (s + 1), JSON.stringify(await stat()));
}
console.log(errs.length ? errs.slice(0, 10).join('\n') : 'no errors');
await b.close();
