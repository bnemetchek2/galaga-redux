import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.setViewport({ width: 1600, height: 960 });
await page.goto('http://127.0.0.1:4173/?view=classic&nofire=1&demo=1', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__galaga !== undefined');
await sleep(9000);
await page.screenshot({ path: 'shots/feature-deeplink-classic.png' });
console.log(JSON.stringify(await page.evaluate(() => {
  const e = window.__galaga.engine;
  return { hung: e.shotSlotsHung, score: e.score, stage: e.stage, demo: window.__galaga.isDemo(), mode: document.body.dataset.mode };
})));
console.log('LOGS', logs.join(' | ') || '(none)');
await page.close();
browser.disconnect();
