/**
 * Verification for the two new features: the expert demo and the no-fire bug.
 */
import { mkdir } from 'node:fs/promises';
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
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__galaga !== undefined');

const shot = async (name) => {
  await page.screenshot({ path: `shots/${name}.png` });
  console.log('shot', name);
};

// Expert demo, side by side.
await page.evaluate(() => window.__galaga.setDemo(true));
await sleep(26000);
await shot('feature-demo-side');

const demoStats = await page.evaluate(() => {
  const e = window.__galaga.engine;
  return {
    phase: e.phase,
    stage: e.stage,
    score: e.score,
    lives: e.lives,
    enemies: e.enemies.length,
    decision: window.__galaga.pilot.decision,
  };
});
console.log('DEMO', JSON.stringify(demoStats));

// The no-fire bug, forced on during the demo.
await page.evaluate(() => window.__galaga.setNoFire(true));
await sleep(2500);
await shot('feature-nofire-side');

const bugStats = await page.evaluate(() => {
  const e = window.__galaga.engine;
  return {
    hung: e.shotSlotsHung,
    noFire: e.noFireActive,
    slots: e.shotSlots,
    bullets: e.bullets.filter((b) => b.from === 'enemy').length,
    score: e.score,
    stage: e.stage,
  };
});
console.log('BUG', JSON.stringify(bugStats));

// Classic only, with both features on.
await page.evaluate(() => window.__galaga.applyMode('classic'));
await sleep(700);
await shot('feature-nofire-classic');

// Enhanced only.
await page.evaluate(() => window.__galaga.applyMode('enhanced'));
await sleep(900);
await shot('feature-demo-enhanced');

console.log('LOGS', logs.join('\n') || '(none)');
await page.close();
browser.disconnect();
