/**
 * Layout check: verifies the header never overlaps at a range of widths.
 */
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL ?? 'http://127.0.0.1:9223';
await mkdir('shots', { recursive: true });
const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();

const widths = [1600, 1440, 1280, 1100, 980, 860, 700];
const results = [];

for (const width of widths) {
  await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:4173/?view=side', { waitUntil: 'networkidle2' });
  await page.waitForFunction('window.__galaga !== undefined');

  const report = await page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) };
    };
    const overlaps = (a, b) =>
      Boolean(a && b && a.right > b.left + 1 && a.left < b.right - 1 && a.bottom > b.top + 1 && a.top < b.bottom - 1);
    const brand = rect('.brand');
    const modes = rect('.modes');
    const tools = rect('.tools');
    return {
      brand,
      modes,
      tools,
      modesVsTools: overlaps(modes, tools),
      brandVsModes: overlaps(brand, modes),
      overflowsRight: Math.max(modes?.right ?? 0, tools?.right ?? 0) > window.innerWidth - 2,
      headerHeight: Math.round(document.querySelector('.topbar').getBoundingClientRect().height),
    };
  });
  results.push({ width, ...report });

  if (width === 1280 || width === 1100) {
    await page.screenshot({ path: `shots/layout-${width}.png` });
  }
}

for (const r of results) {
  console.log(
    `${String(r.width).padStart(4)}  modesVsTools=${r.modesVsTools}  brandVsModes=${r.brandVsModes}  overflow=${r.overflowsRight}  headerH=${r.headerHeight}`,
  );
}
await page.close();
browser.disconnect();
