import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9223", defaultViewport: null });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 960 });
await page.goto("http://127.0.0.1:4173/?view=enhanced&demo=1", { waitUntil: "networkidle2" });
await page.waitForFunction("window.__galaga !== undefined");
await sleep(14000);
await page.screenshot({ path: "shots/enh-demo-trail.png" });
console.log(JSON.stringify(await page.evaluate(() => {
  const e = window.__galaga.engine;
  return { phase: e.phase, stage: e.stage, score: e.score, lives: e.lives, x: Math.round(e.player.x) };
})));
await page.close();
browser.disconnect();
