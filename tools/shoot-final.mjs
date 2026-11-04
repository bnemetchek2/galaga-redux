/**
 * Final verification pass: every mode, the challenging stage, two players and
 * the tractor beam. Writes PNGs to shots/ and prints engine diagnostics.
 */
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CDP = process.env.CDP_URL ?? 'http://127.0.0.1:9223';
await mkdir('shots', { recursive: true });

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.setViewport({ width: 1600, height: 960, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__galaga !== undefined');

const shot = async (name) => {
  await page.screenshot({ path: `shots/${name}.png` });
  console.log('shot', name);
};

await sleep(1500);
await shot('final-01-attract');

const start = async (players = 1) => {
  await page.evaluate((p) => {
    window.__galaga.setInput(p === 2 ? 'start2' : 'start1', true);
  }, players);
  await sleep(140);
  await page.evaluate((p) => {
    window.__galaga.setInput(p === 2 ? 'start2' : 'start1', false);
  }, players);
};

await start(1);
await sleep(2400);
await shot('final-02-stage-intro');

// Wait until the fleet is parked, then play a little.
await page.waitForFunction(
  () => window.__galaga.engine.enemies.filter((e) => e.state === 'formation').length > 28,
  { timeout: 20000 },
);
await page.evaluate(() => {
  window.__galaga.setInput('fire', true);
  window.__galaga.setInput('right', true);
});
await sleep(700);
await page.evaluate(() => window.__galaga.setInput('right', false));
await shot('final-03-side-play');

// Tractor beam.
await page.waitForFunction(
  () => window.__galaga.engine.enemies.some((e) => e.kind === 'boss' && e.state === 'formation'),
  { timeout: 15000 },
);
await page.evaluate(() => window.__galaga.engine.forceCapture());
await sleep(1600);
await shot('final-04-beam');

// Challenging stage.
await page.evaluate(() => {
  window.__galaga.engine.debugStage(3);
});
await sleep(4200);
await page.evaluate(() => window.__galaga.applyMode('side'));
await sleep(300);
await shot('final-05-challenge-side');

// Classic only.
await page.evaluate(() => window.__galaga.applyMode('classic'));
await sleep(500);
await shot('final-06-classic');

// Enhanced only.
await page.evaluate(() => window.__galaga.applyMode('enhanced'));
await sleep(600);
await shot('final-07-enhanced');

// Two-player mode.
await page.evaluate(() => window.__galaga.engine.startGame(2));
await sleep(3500);
await page.evaluate(() => window.__galaga.applyMode('side'));
await sleep(500);
await shot('final-08-two-player');

const diag = await page.evaluate(() => {
  const e = window.__galaga.engine;
  return {
    phase: e.phase,
    stage: e.stage,
    isTwoPlayer: e.isTwoPlayer,
    scores: e.players.map((p) => p.score),
    lives: e.lives,
    enemies: e.enemies.length,
    hash: e.snapshotHash(),
    mode: document.body.dataset.mode,
  };
});
console.log('DIAG', JSON.stringify(diag));
console.log('LOGS', logs.join('\n') || '(none)');
await page.close();
browser.disconnect();
