/**
 * Quick single screenshot of one mode: node tools/shot-one.mjs <mode> <name> [delayMs]
 */
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const mode = process.argv[2] ?? 'enhanced';
const name = process.argv[3] ?? `shot-${mode}`;
const delay = Number(process.argv[4] ?? 2500);
const CDP = process.env.CDP_URL ?? 'http://127.0.0.1:9223';

await mkdir('shots', { recursive: true });
const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.setViewport({ width: 1600, height: 960, deviceScaleFactor: 1 });
await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:4173/', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__galaga !== undefined');
await page.evaluate((m) => window.__galaga.applyMode(m), mode);
await page.evaluate(() => window.__galaga.setInput('start1', true));
await new Promise((r) => setTimeout(r, 150));
await page.evaluate(() => window.__galaga.setInput('start1', false));
await new Promise((r) => setTimeout(r, delay));
await page.screenshot({ path: `shots/${name}.png` });
console.log(`shot ${name}`, logs.join(' | ') || '(no logs)');
await page.close();
browser.disconnect();
