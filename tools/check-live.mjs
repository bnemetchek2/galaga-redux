/**
 * Verifies the deployed Cloudflare Worker in a real browser.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const URL = process.env.LIVE_URL ?? 'https://galaga-redux.kindof-lame.workers.dev/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await mkdir('shots', { recursive: true });

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

await page.setViewport({ width: 1600, height: 960 });
const t0 = Date.now();
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
await page.waitForFunction('window.__galaga !== undefined', { timeout: 20000 });
const loadMs = Date.now() - t0;

await sleep(1200);
await page.screenshot({ path: 'shots/live-attract.png' });

// Run the expert at 16× to prove the engine works on the deployed build.
await page.evaluate(() => {
  window.__galaga.setDemo(true);
  window.__galaga.setSpeed(2); // 16×
});
await sleep(9000);
await page.screenshot({ path: 'shots/live-demo.png' });

const state = await page.evaluate(() => {
  const e = window.__galaga.engine;
  const canvas = document.querySelector('.enh-canvas');
  const gl = canvas ? canvas.getContext('webgl2') ?? canvas.getContext('webgl') : null;
  return {
    phase: e.phase,
    stage: e.stage,
    score: e.score,
    speed: window.__galaga.getSpeed(),
    demo: window.__galaga.isDemo(),
    webgl: gl ? 'ok' : 'none',
    build: document.querySelector('link[rel=icon]') ? 'ok' : 'n/a',
  };
});

console.log('LOAD_MS', loadMs);
console.log('STATE', JSON.stringify(state));
console.log('LOGS', logs.slice(0, 10).join('\n') || '(none)');
await writeFile('shots/live-check.json', JSON.stringify({ url: URL, loadMs, state, logs }, null, 2));
await page.close();
browser.disconnect();
