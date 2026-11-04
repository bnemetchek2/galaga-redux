/**
 * Application shell.
 *
 * Owns exactly one simulation. The three view modes only change which
 * renderers are shown; in side-by-side mode both renderers read the same
 * engine instance on the same frame, so the gameplay is identical by
 * construction rather than by coincidence.
 */

import { FIXED_DT, MAX_CATCHUP_STEPS, MAX_STAGE } from '../engine/constants.js';
import { GalagaEngine } from '../engine/engine.js';
import type { InputState } from '../engine/types.js';
import { ClassicRenderer } from '../render/classic/classicRenderer.js';
import { EnhancedRenderer } from '../render/enhanced/enhancedRenderer.js';
import type { GameRenderer } from '../render/renderer.js';
import { GameAudio } from './audio.js';
import { AutoPilot } from './autopilot.js';

type ViewMode = 'classic' | 'enhanced' | 'side';

const HIGH_SCORE_KEY = 'galaga.dualview.highscore';
const MODE_KEY = 'galaga.dualview.mode';

const $ = <T extends HTMLElement>(selector: string): T => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`missing element: ${selector}`);
  return el;
};

const classicMount = $('#classic-mount');
const enhancedMount = $('#enhanced-mount');
const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.mode-btn'));
const soundButton = $('#sound-toggle') as HTMLButtonElement;
const pauseButton = $('#pause-toggle') as HTMLButtonElement;
const demoButton = $('#demo-toggle') as HTMLButtonElement;
const noFireButton = $('#no-fire-toggle') as HTMLButtonElement;
const speedButton = $('#speed-toggle') as HTMLButtonElement;
const syncLabel = $('#sync');
const slotsLabel = $('#slots');
const stageValue = $('#stage-value');
const progressFill = $('#progress-fill') as HTMLElement;
const pauseVeil = $('#pause-veil');

function loadHighScore(): number {
  const raw = localStorage.getItem(HIGH_SCORE_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20000;
}

function loadMode(): ViewMode {
  const raw = localStorage.getItem(MODE_KEY);
  if (raw === 'classic' || raw === 'enhanced' || raw === 'side') return raw;
  return 'side';
}

const audio = new GameAudio();
const engine = new GalagaEngine({
  seed: (Math.random() * 0x7fffffff) | 0,
  highScore: loadHighScore(),
});

const renderers: { classic: GameRenderer | null; enhanced: GameRenderer | null } = {
  classic: null,
  enhanced: null,
};
const mounted: { classic: boolean; enhanced: boolean } = { classic: false, enhanced: false };

let mode: ViewMode = loadMode();
let paused = false;
let demo = false;
let demoRestart = 0;
/** The player's standing intent for the bug, so a demo restart does not clear it. */
let noFireWanted = false;
/** 1x, 4x, 16x, 64x, 256x simulation speed. */
const SPEEDS = [1, 4, 16, 64, 256];
let speedIndex = 0;
let speed = 1;
let userMuted = false;
const pilot = new AutoPilot();
let lastTime = performance.now();
let accumulator = 0;
let frames = 0;
let fpsClock = 0;
let fps = 0;
let highScoreSaved = engine.highScore;

// ------------------------------------------------------------------ renderers --

function ensureRenderer(kind: 'classic' | 'enhanced'): GameRenderer {
  const existing = renderers[kind];
  if (existing && mounted[kind]) return existing;
  const renderer = existing ?? (kind === 'classic' ? new ClassicRenderer() : new EnhancedRenderer());
  if (!mounted[kind]) {
    renderer.mount(kind === 'classic' ? classicMount : enhancedMount);
    mounted[kind] = true;
  }
  renderers[kind] = renderer;
  return renderer;
}

function rendererVisible(kind: 'classic' | 'enhanced'): boolean {
  if (mode === 'side') return true;
  return mode === kind;
}

function applyMode(next: ViewMode, persist = true): void {
  mode = next;
  document.body.dataset.mode = next;
  for (const button of modeButtons) {
    const isActive = button.dataset.mode === next;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  }
  if (rendererVisible('classic')) ensureRenderer('classic').resize();
  if (rendererVisible('enhanced')) ensureRenderer('enhanced').resize();
  if (persist) localStorage.setItem(MODE_KEY, next);
  updateSyncLabel();
}

// --------------------------------------------------------------------- input --

const KEY_MAP: Record<string, keyof InputState> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ControlLeft: 'fire',
  ControlRight: 'fire',
  Space: 'fire',
  KeyZ: 'fire',
  Digit0: 'coin',
  Numpad0: 'coin',
  Digit1: 'start1',
  Numpad1: 'start1',
  Digit2: 'start2',
  Numpad2: 'start2',
};

const PREVENT_DEFAULT = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Space',
  'ControlLeft',
  'ControlRight',
  'Digit0',
  'Digit1',
  'Digit2',
]);

function setKey(code: string, down: boolean): void {
  const action = KEY_MAP[code];
  if (!action) return;
  // While the expert pilot is flying, the keyboard cannot fight it for control.
  if (demo && (action === 'left' || action === 'right' || action === 'fire')) return;
  engine.setInput(action, down);
}

const MODIFIER_KEYS = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

window.addEventListener('keydown', (event) => {
  // While paused, any key resumes and is consumed, so it cannot also fire a
  // shot or nudge the ship.
  if (paused && !MODIFIER_KEYS.has(event.code)) {
    event.preventDefault();
    setPaused(false);
    return;
  }
  if (PREVENT_DEFAULT.has(event.code)) event.preventDefault();
  if (event.repeat) {
    setKey(event.code, true);
    return;
  }
  audio.unlock();
  if (event.code === 'KeyP' || event.code === 'Escape') {
    togglePause();
    return;
  }
  if (event.code === 'KeyV') {
    cycleMode();
    return;
  }
  if (event.code === 'KeyM') {
    toggleSound();
    return;
  }
  if (event.code === 'KeyE') {
    toggleDemo();
    return;
  }
  if (event.code === 'KeyB') {
    toggleNoFire();
    return;
  }
  if (event.code === 'KeyT') {
    cycleSpeed();
    return;
  }
  setKey(event.code, true);
});

window.addEventListener('keyup', (event) => {
  if (PREVENT_DEFAULT.has(event.code)) event.preventDefault();
  setKey(event.code, false);
});

window.addEventListener('blur', () => {
  for (const action of ['left', 'right', 'fire'] as const) engine.setInput(action, false);
});

// A click anywhere (except the pause button itself) resumes play.
window.addEventListener(
  'pointerdown',
  (event) => {
    if (!paused) return;
    const target = event.target as HTMLElement | null;
    if (target && target.closest('#pause-toggle')) return;
    setPaused(false);
  },
  true,
);

function bindTouchControls(): void {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-control]'));
  for (const button of buttons) {
    const action = button.dataset.control as keyof InputState;
    const press = (event: Event) => {
      event.preventDefault();
      audio.unlock();
      if (demo) return;
      engine.setInput(action, true);
    };
    const release = (event: Event) => {
      event.preventDefault();
      if (demo) return;
      engine.setInput(action, false);
    };
    button.addEventListener('pointerdown', press);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('pointerleave', release);
  }
  // Starting the game on a touch device uses the start buttons.
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-start]'))) {
    button.addEventListener('click', () => {
      audio.unlock();
      engine.startGame(button.dataset.start === '2' ? 2 : 1);
    });
  }
}

// -------------------------------------------------------------------- toggles --

function setPaused(next: boolean): void {
  if (paused === next) return;
  paused = next;
  pauseButton.textContent = paused ? 'Resume' : 'Pause';
  pauseButton.classList.toggle('is-active', paused);
  document.body.classList.toggle('is-paused', paused);
  pauseVeil.classList.toggle('is-visible', paused);
  pauseVeil.setAttribute('aria-hidden', String(!paused));
  if (paused) {
    // Drop any held inputs so the ship does not drift when play resumes.
    for (const action of ['left', 'right', 'fire'] as const) engine.setInput(action, false);
  }
}

function togglePause(): void {
  setPaused(!paused);
}

function toggleSound(): void {
  userMuted = !userMuted;
  audio.unlock();
  applyAudioState();
}

/**
 * Sound follows the simulation speed: above 1x the game runs thousands of
 * events per second and the audio would be a wall of noise, so it is suspended
 * automatically and restored when the player returns to normal speed.
 */
function applyAudioState(): void {
  const suspended = speed > 1;
  audio.setMuted(userMuted || suspended);
  soundButton.textContent = userMuted ? 'Sound off' : 'Sound on';
  soundButton.setAttribute('aria-pressed', String(!userMuted));
  soundButton.classList.toggle('is-off', userMuted);
  soundButton.classList.toggle('is-suspended', suspended && !userMuted);
  soundButton.title = suspended ? 'Sound is paused while running fast' : 'Toggle sound (M)';
}

/** Cycle the simulation speed: 1x, 4x, 16x, 64x, 256x. */
function setSpeedIndex(index: number): void {
  speedIndex = ((index % SPEEDS.length) + SPEEDS.length) % SPEEDS.length;
  speed = SPEEDS[speedIndex];
  speedButton.textContent = speed === 1 ? '1× speed' : `${speed}× speed`;
  speedButton.classList.toggle('is-active', speed > 1);
  document.body.classList.toggle('is-turbo', speed > 1);
  applyAudioState();
}

function cycleSpeed(): void {
  setSpeedIndex(speedIndex + 1);
}

/**
 * Expert demo: hand the controls to the autopilot and let it play real games
 * back to back. Human movement input is ignored while it flies.
 */
function setDemo(on: boolean): void {
  demo = on;
  demoButton.classList.toggle('is-active', on);
  demoButton.setAttribute('aria-pressed', String(on));
  document.body.classList.toggle('is-demo', on);
  if (on) {
    pilot.reset();
    demoRestart = 0;
    if (engine.phase !== 'playing') engine.startGame(1);
  } else {
    pilot.release(engine);
  }
  updateTelemetry();
}

function toggleDemo(): void {
  setDemo(!demo);
}

/**
 * The arcade no-fire bug. Forcing it on corrupts all eight enemy shot slots,
 * exactly like fifteen minutes of edge-bee diving does to a real cabinet.
 */
function setNoFire(on: boolean): void {
  noFireWanted = on;
  engine.setNoFireBug(on);
  noFireButton.classList.toggle('is-active', on);
  noFireButton.setAttribute('aria-pressed', String(on));
  document.body.classList.toggle('is-nofire', on);
  if (on) audio.play({ type: 'noFire' });
  updateTelemetry();
}

function toggleNoFire(): void {
  setNoFire(!engine.noFireBugEnabled);
}

/** Eight pips: free, in flight, or permanently jammed. */
function updateTelemetry(): void {
  const slots = engine.shotSlots;
  const hung = slots.filter((s) => s === 'hung').length;
  const pips = slots
    .map((s) => `<i class="slot${s === 'hung' ? ' slot--hung' : s === 'live' ? ' slot--live' : ''}"></i>`)
    .join('');
  slotsLabel.innerHTML = `<span class="slots__label">SHOTS</span>${pips}${
    hung >= slots.length ? '<span class="slots__jam">no fire</span>' : ''
  }`;

  stageValue.textContent = String(engine.stage);
  progressFill.style.width = `${Math.min(100, (engine.stage / MAX_STAGE) * 100)}%`;
  document.body.classList.toggle('is-victory', engine.phase === 'victory');
}

function cycleMode(): void {
  const order: ViewMode[] = ['side', 'classic', 'enhanced'];
  const index = order.indexOf(mode);
  applyMode(order[(index + 1) % order.length]);
}

// ----------------------------------------------------------------------- loop --

function updateSyncLabel(): void {
  const hash = engine.snapshotHash().padStart(8, '0');
  syncLabel.textContent = `engine #${hash} · stage ${engine.stage} · ${fps} fps`;
  syncLabel.classList.toggle('is-live', mode === 'side');
}

function tick(now: number): void {
  const dt = Math.min(0.1, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;

  if (!paused) {
    accumulator += dt * speed;
    const maxSteps = Math.min(400, MAX_CATCHUP_STEPS * speed);
    let steps = 0;
    while (accumulator >= FIXED_DT && steps < maxSteps) {
      if (demo) pilot.step(engine);
      engine.update(FIXED_DT);
      accumulator -= FIXED_DT;
      steps++;
    }
    if (steps >= maxSteps || accumulator > FIXED_DT * maxSteps) accumulator = 0;
  }

  // The demo plays continuous games: restart a little after the last fighter.
  if (demo) {
    if (engine.phase === 'gameOver') {
      demoRestart += dt;
      if (demoRestart > 2.6) {
        demoRestart = 0;
        engine.startGame(1);
      }
    } else {
      demoRestart = 0;
      if (engine.phase === 'attract') engine.startGame(1);
    }
  }

  // A new credit clears the slot table; re-apply a bug the player asked for.
  if (noFireWanted && !engine.noFireBugForced) engine.setNoFireBug(true);

  const events = engine.drainEvents();
  audio.playEvents(events);
  for (const event of events) {
    if (event.type === 'gameOver') {
      localStorage.setItem(HIGH_SCORE_KEY, String(engine.highScore));
      highScoreSaved = engine.highScore;
    }
    if (event.type === 'victory') {
      localStorage.setItem(HIGH_SCORE_KEY, String(engine.highScore));
      highScoreSaved = engine.highScore;
      // Finishing at 256x would flash past in a single frame; drop back to real
      // time so the ending is actually watchable.
      if (speed > 1) setSpeedIndex(0);
    }
  }

  // Renderers get the wall-clock delta, scaled by the simulation speed, so
  // effects age at the same rate as the game when fast-forwarding. While paused
  // they get zero, which freezes the starfield, particles and camera too -- a
  // pause that still animates does not look paused.
  const renderDt = paused ? 0 : Math.min(0.5, dt * speed);
  if (rendererVisible('classic')) ensureRenderer('classic').render(engine, renderDt);
  if (rendererVisible('enhanced')) ensureRenderer('enhanced').render(engine, renderDt);

  frames++;
  fpsClock += dt;
  if (fpsClock >= 0.4) {
    fps = Math.round(frames / fpsClock);
    frames = 0;
    fpsClock = 0;
    updateSyncLabel();
    updateTelemetry();
    if (engine.highScore !== highScoreSaved) {
      highScoreSaved = engine.highScore;
      localStorage.setItem(HIGH_SCORE_KEY, String(highScoreSaved));
    }
  }

  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------- start --

for (const button of modeButtons) {
  button.addEventListener('click', () => applyMode(button.dataset.mode as ViewMode));
}
soundButton.addEventListener('click', toggleSound);
pauseButton.addEventListener('click', togglePause);
demoButton.addEventListener('click', toggleDemo);
noFireButton.addEventListener('click', toggleNoFire);
speedButton.addEventListener('click', cycleSpeed);
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });

bindTouchControls();
applyMode(mode, false);
setSpeedIndex(0);
updateTelemetry();
document.body.classList.add('is-ready');

// Deep links: ?view=classic|enhanced|side&demo=1&nofire=1&speed=64
const params = new URLSearchParams(window.location.search);
const view = params.get('view');
if (view === 'classic' || view === 'enhanced' || view === 'side') applyMode(view, false);
if (params.get('demo') === '1') setDemo(true);
if (params.get('nofire') === '1') setNoFire(true);
const wantedSpeed = Number(params.get('speed'));
const speedIdx = SPEEDS.indexOf(wantedSpeed);
if (speedIdx >= 0) setSpeedIndex(speedIdx);

// Mount the enhanced view eagerly when it is on screen so the WebGL context and
// shaders compile before the first frame of play.
if (rendererVisible('enhanced')) ensureRenderer('enhanced');
if (rendererVisible('classic')) ensureRenderer('classic');

window.addEventListener('resize', () => {
  if (rendererVisible('classic')) renderers.classic?.resize();
  if (rendererVisible('enhanced')) renderers.enhanced?.resize();
});

requestAnimationFrame((now) => {
  lastTime = now;
  tick(now);
});

// Expose for the automated screenshot harness and for curious players.
declare global {
  interface Window {
    __galaga?: {
      engine: GalagaEngine;
      applyMode: (mode: ViewMode) => void;
      setInput: (key: keyof InputState, down: boolean) => void;
      renderers: typeof renderers;
      pilot: AutoPilot;
      setDemo: (on: boolean) => void;
      setNoFire: (on: boolean) => void;
      setSpeed: (index: number) => void;
      isDemo: () => boolean;
      getSpeed: () => number;
    };
  }
}

window.__galaga = {
  engine,
  applyMode,
  setInput: (key, down) => engine.setInput(key, down),
  renderers,
  pilot,
  setDemo,
  setNoFire,
  setSpeed: setSpeedIndex,
  isDemo: () => demo,
  getSpeed: () => speed,
};

