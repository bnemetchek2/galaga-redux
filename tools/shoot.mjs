/**
 * Screenshot harness for the running app.
 *
 * Connects to an already-running Edge/Chrome with --remote-debugging-port
 * (this sandbox blocks Puppeteer from spawning the browser itself), drives the
 * three view modes and writes PNGs to shots/.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:4173/';
const CDP = process.env.CDP_URL ?? 'http://127.0.0.1:9222';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await mkdir('shots', { recursive: true });

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
const logs = [];
page.on('console', (message) => logs.push(`[${message.type()}] ${message.text()}`));
page.on('pageerror', (error) => logs.push(`[pageerror] ${error.message}`));
page.on('requestfailed', (request) =>
  logs.push(`[requestfailed] ${request.url()} ${request.failure()?.errorText ?? ''}`),
);

await page.setViewport({ width: 1600, height: 960, deviceScaleFactor: 1 });
await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 45000 });
await page.waitForFunction('window.__galaga !== undefined', { timeout: 30000 });
await sleep(1800);

const shot = async (name) => {
  await page.screenshot({ path: `shots/${name}.png` });
  console.log(`shot ${name}`);
};

await shot('01-attract-side');

// Start a one-player game.
await page.evaluate(() => {
  window.__galaga.setInput('start1', true);
});
await sleep(120);
await page.evaluate(() => {
  window.__galaga.setInput('start1', false);
});
await sleep(1200);
await shot('02-stage-intro');

await sleep(6000);
await shot('03-fleet-side');

// Fire and move so both views show action.
await page.evaluate(() => {
  window.__galaga.setInput('fire', true);
  window.__galaga.setInput('left', true);
});
await sleep(900);
await page.evaluate(() => {
  window.__galaga.setInput('left', false);
  window.__galaga.setInput('right', true);
});
await sleep(900);
await page.evaluate(() => {
  window.__galaga.setInput('right', false);
});
await shot('04-action-side');

await page.evaluate(() => window.__galaga.applyMode('classic'));
await sleep(700);
await shot('05-classic');

await page.evaluate(() => window.__galaga.applyMode('enhanced'));
await sleep(1200);
await shot('06-enhanced');

await page.evaluate(() => window.__galaga.applyMode('side'));
await sleep(700);
await shot('07-side-late');

const diagnostics = await page.evaluate(() => {
  const engine = window.__galaga.engine;
  return {
    phase: engine.phase,
    stage: engine.stage,
    score: engine.score,
    lives: engine.lives,
    enemies: engine.enemies.length,
    bullets: engine.bullets.length,
    hash: engine.snapshotHash(),
    mode: document.body.dataset.mode,
    webgl: (() => {
      const canvas = document.querySelector('.enh-canvas');
      if (!canvas) return 'no-canvas';
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      return gl ? 'ok' : 'none';
    })(),
    classicCanvas: (() => {
      const canvas = document.querySelector('.classic-canvas');
      return canvas ? `${canvas.width}x${canvas.height}` : 'missing';
    })(),
  };
});

console.log('DIAGNOSTICS', JSON.stringify(diagnostics, null, 2));
console.log('LOGS', logs.join('\n') || '(none)');
await writeFile('shots/diagnostics.json', JSON.stringify({ diagnostics, logs }, null, 2));

await page.close();
browser.disconnect();
