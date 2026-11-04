/**
 * Verifies the turbo mode, the victory state and the upgraded 3D scene.
 * Runs the expert at 256× until stage 255 is cleared, then captures the ending.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CDP = process.env.CDP_URL ?? 'http://127.0.0.1:9223';
await mkdir('shots', { recursive: true });

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.setViewport({ width: 1600, height: 960, deviceScaleFactor: 1 });

await page.goto('http://127.0.0.1:4173/?view=side&demo=1&speed=256', {
  waitUntil: 'networkidle2',
});
await page.waitForFunction('window.__galaga !== undefined');
await sleep(6000);
await page.screenshot({ path: 'shots/turbo-running.png' });
console.log(
  'TURBO',
  JSON.stringify(
    await page.evaluate(() => {
      const e = window.__galaga.engine;
      return { stage: e.stage, score: e.score, speed: window.__galaga.getSpeed(), lives: e.lives };
    }),
  ),
);

// Run to the end. At 256× a full three-hour game takes about a minute.
const started = Date.now();
let reached = false;
for (let i = 0; i < 240; i++) {
  await sleep(1000);
  const state = await page.evaluate(() => {
    const e = window.__galaga.engine;
    return { phase: e.phase, stage: e.stage, speed: window.__galaga.getSpeed(), score: e.score };
  });
  if (i % 10 === 0) console.log('…', JSON.stringify(state), `${Math.round((Date.now() - started) / 1000)}s`);
  if (state.phase === 'victory') {
    reached = true;
    break;
  }
}
console.log('REACHED VICTORY', reached);

if (reached) {
  await sleep(900);
  await page.screenshot({ path: 'shots/victory-side.png' });
  await page.evaluate(() => window.__galaga.applyMode('enhanced'));
  await sleep(1400);
  await page.screenshot({ path: 'shots/victory-enhanced.png' });
  const summary = await page.evaluate(() => {
    const e = window.__galaga.engine;
    return {
      phase: e.phase,
      stage: e.stage,
      score: e.score,
      highScore: e.highScore,
      speed: window.__galaga.getSpeed(),
    };
  });
  console.log('VICTORY', JSON.stringify(summary));
  await page.evaluate(() => window.__galaga.applyMode('side'));
  await sleep(600);
  await page.screenshot({ path: 'shots/victory-side-both.png' });
}

console.log('LOGS', logs.slice(0, 8).join('\n') || '(none)');
await writeFile('shots/victory-log.json', JSON.stringify({ reached, logs }, null, 2));
await page.close();
browser.disconnect();
