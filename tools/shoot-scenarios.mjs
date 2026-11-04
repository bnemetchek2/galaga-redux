/**
 * Scenario shots: drives the game into specific states (tractor beam, diving
 * fleet, challenge stage) so the visuals can be reviewed.
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

const start = async () => {
  await page.evaluate(() => window.__galaga.setInput('start1', true));
  await sleep(140);
  await page.evaluate(() => window.__galaga.setInput('start1', false));
};

await page.evaluate(() => window.__galaga.applyMode('enhanced'));
await start();
await sleep(7500);

// Wait for the flagship to settle into formation, then open its tractor beam.
await page.waitForFunction(
  () => window.__galaga.engine.enemies.some((e) => e.kind === 'boss' && e.state === 'formation'),
  { timeout: 15000 },
);
const playerBefore = await page.evaluate(() => {
  const e = window.__galaga.engine;
  return { x: e.player.x, y: e.player.y, visible: e.player.visible, lives: e.lives, phase: e.phase };
});
console.log('PLAYER', JSON.stringify(playerBefore));
await page.evaluate(() => {
  window.__galaga.engine.forceCapture();
});
await sleep(1700);
const beamState = await page.evaluate(() => ({
  tractor: window.__galaga.engine.tractor,
  visible: window.__galaga.engine.player.visible,
}));
console.log('BEAM', JSON.stringify(beamState));
await page.screenshot({ path: 'shots/sc-beam-enhanced.png' });

await page.evaluate(() => window.__galaga.applyMode('side'));
await sleep(600);
await page.screenshot({ path: 'shots/sc-beam-side.png' });

// Let the game breathe: kills, dives, particles.
await page.evaluate(() => {
  window.__galaga.setInput('fire', true);
  window.__galaga.setInput('left', true);
});
await sleep(1200);
await page.evaluate(() => {
  window.__galaga.setInput('left', false);
  window.__galaga.setInput('right', true);
});
await sleep(900);
await page.evaluate(() => {
  window.__galaga.setInput('right', false);
});
await page.evaluate(() => window.__galaga.applyMode('enhanced'));
await sleep(400);
await page.screenshot({ path: 'shots/sc-action-enhanced.png' });

const diag = await page.evaluate(() => {
  const e = window.__galaga.engine;
  return {
    phase: e.phase,
    stage: e.stage,
    score: e.score,
    lives: e.lives,
    tractor: e.tractor,
    enemies: e.enemies.length,
  };
});
console.log('DIAG', JSON.stringify(diag));
console.log('LOGS', logs.join('\n') || '(none)');
await page.close();
browser.disconnect();
