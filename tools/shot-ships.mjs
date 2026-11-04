/**
 * Close-up review of the 3D ships. Starts a normal game (no autopilot) so the
 * fleet settles and all four ship types are on screen together.
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

await page.setViewport({ width: 1600, height: 960, deviceScaleFactor: 2 });
await page.goto('http://127.0.0.1:4173/?view=enhanced', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__galaga !== undefined', { timeout: 15000 });

await page.evaluate(() => window.__galaga.setInput('start1', true));
await sleep(150);
await page.evaluate(() => window.__galaga.setInput('start1', false));

// Wait for the fleet to be parked, then freeze it for a clean shot.
await page.waitForFunction(
  () => window.__galaga.engine.enemies.filter((e) => e.state === 'formation').length >= 20,
  { timeout: 30000 },
);
await sleep(400);
await page.screenshot({ path: 'shots/ships-full.png' });
await page.screenshot({ path: 'shots/ships-crop.png', clip: { x: 520, y: 140, width: 900, height: 380 } });

console.log(
  'STATE',
  JSON.stringify(
    await page.evaluate(() => {
      const e = window.__galaga.engine;
      return { phase: e.phase, enemies: e.enemies.length, parked: e.enemies.filter((x) => x.state === 'formation').length };
    }),
  ),
);
console.log('LOG', logs.slice(0, 5).join('\n') || '(none)');
await page.close();
browser.disconnect();
