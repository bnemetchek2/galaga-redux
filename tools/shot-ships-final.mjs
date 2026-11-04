/**
 * Final ship/parity captures with the expert flying, so the fighter is alive.
 */
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await mkdir('shots', { recursive: true });

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.setViewport({ width: 1600, height: 960, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:4173/?view=enhanced&demo=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__galaga !== undefined');

// Wait for a moment with plenty of ships and a live fighter.
await page.waitForFunction(
  () => {
    const e = window.__galaga.engine;
    return e.phase === 'playing' && e.enemies.length > 22 && e.player.visible && e.player.invulnerable <= 0;
  },
  { timeout: 30000 },
);
await sleep(250);
await page.screenshot({ path: 'shots/ship-enhanced.png' });

const px = await page.evaluate(() => window.__galaga.engine.player.x);
const cropX = Math.max(0, Math.min(1300, Math.round((px / 224) * 1560 + 20 - 150)));
await page.screenshot({ path: 'shots/ship-player.png', clip: { x: cropX, y: 680, width: 300, height: 200 } });

await page.evaluate(() => window.__galaga.applyMode('side'));
await sleep(700);
await page.screenshot({ path: 'shots/ship-side.png' });

console.log('LOG', logs.slice(0, 5).join(' | ') || '(none)');
console.log('STATE', JSON.stringify(await page.evaluate(() => {
  const e = window.__galaga.engine;
  return { stage: e.stage, enemies: e.enemies.length, lives: e.lives, playerVisible: e.player.visible };
})));
await page.close();
browser.disconnect();

