/**
 * Verifies pause semantics: the simulation must stop, the frame must freeze,
 * and any key or a click must resume.
 */
import { createHash } from 'node:crypto';
import puppeteer from 'puppeteer-core';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex').slice(0, 12);

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

const time = () => page.evaluate(() => window.__galaga.engine.time);
const paused = () => page.evaluate(() => document.body.classList.contains('is-paused'));

await page.setViewport({ width: 1600, height: 960 });
await page.goto('http://127.0.0.1:4173/?view=side', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__galaga !== undefined');
await page.evaluate(() => window.__galaga.setInput('start1', true));
await sleep(150);
await page.evaluate(() => window.__galaga.setInput('start1', false));
await sleep(4000);

// --- pause via the button -------------------------------------------------
await page.click('#pause-toggle');
await sleep(200);
const pausedFlag = await paused();
const t0 = await time();

// Compare both panes separately: the classic canvas and the 3D canvas.
const classicA = await page.evaluate(() => document.querySelector('.classic-canvas').toDataURL());
const enhancedA = await (await page.$('.enh-canvas')).screenshot();
await sleep(1200);
const t1 = await time();
const classicB = await page.evaluate(() => document.querySelector('.classic-canvas').toDataURL());
const enhancedB = await (await page.$('.enh-canvas')).screenshot();

console.log('paused flag:', pausedFlag);
console.log('engine time frozen:', t0 === t1, `(${t0.toFixed(3)} -> ${t1.toFixed(3)})`);
console.log('classic frame frozen:', hash(classicA) === hash(classicB), `${hash(classicA)} / ${hash(classicB)}`);
console.log('enhanced frame frozen:', hash(enhancedA) === hash(enhancedB), `${hash(enhancedA)} / ${hash(enhancedB)}`);

// --- any key resumes ------------------------------------------------------
await page.keyboard.press('ArrowLeft');
await sleep(700);
const afterKey = await time();
console.log('key resumed play:', afterKey > t1, `(${t1.toFixed(3)} -> ${afterKey.toFixed(3)})`, 'paused:', await paused());

// --- click resumes --------------------------------------------------------
await page.keyboard.press('KeyP');
await sleep(200);
const tPause = await time();
await page.mouse.click(800, 500);
await sleep(700);
const afterClick = await time();
console.log('click resumed play:', afterClick > tPause, `(${tPause.toFixed(3)} -> ${afterClick.toFixed(3)})`, 'paused:', await paused());

// --- P toggles again ------------------------------------------------------
await page.keyboard.press('KeyP');
await sleep(200);
const pausedAgain = await paused();
await page.keyboard.press('Escape');
await sleep(300);
console.log('P pauses, Esc resumes:', pausedAgain && !(await paused()));

console.log('errors:', errors.length ? errors.slice(0, 3).join(' | ') : '(none)');
await page.close();
browser.disconnect();

