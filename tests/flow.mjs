// From the title screen: Play, watch the whole intro, land in the game.
import { firefox } from 'playwright';
const out = process.argv[2] || '.', base = process.argv[3] || 'http://localhost:5199/';
const browser = await firefox.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
await page.goto(base);
await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/flow-title.png` });
await page.click('#playBtn');
for (let s = 0; s < 46; s += 6) { await page.waitForTimeout(6000); await page.screenshot({ path: `${out}/flow-${String(s).padStart(2, '0')}.png` }); }
const mode = await page.evaluate(() => ({ hud: !document.getElementById('hud').hidden, fps: window.__fps, fade: __E.grade.uniforms.uFade.value }));
console.log(JSON.stringify(mode));
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
