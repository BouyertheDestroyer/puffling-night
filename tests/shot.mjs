// node tests/shot.mjs <outdir> <query> [more queries...]  -> screenshots + console errors
// Env: WAIT (ms after ready), HEADLESS=1, EVAL (js to run after ready), STEPS (n screenshots per query, STEP_MS apart)
import { firefox } from 'playwright';
const [, , out, ...queries] = process.argv;
const browser = await firefox.launch({ headless: process.env.HEADLESS === '1' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && !m.text().includes('texSubImage'))) errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(0, 5).join(' | ')));
let i = 0;
for (const q of queries) {
  await page.goto(`http://localhost:5199/?${q}`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 }).catch(e => errors.push('timeout ' + e.message));
  if (process.env.EVAL) await page.evaluate(process.env.EVAL).catch(e => errors.push('eval: ' + e.message));
  const steps = +(process.env.STEPS || 1);
  for (let k = 0; k < steps; k++) {
    await page.waitForTimeout(k === 0 ? +(process.env.WAIT || 2500) : +(process.env.STEP_MS || 1000));
    const fps = await page.evaluate(() => window.__fps).catch(() => null);
    await page.screenshot({ path: `${out}/shot${i++}.png` });
    console.log(q, k, 'fps', fps);
  }
}
console.log(errors.slice(0, 30).join('\n'));
await browser.close();
