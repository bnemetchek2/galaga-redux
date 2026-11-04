/**
 * Fast training/evaluation harness for the expert pilot.
 *
 * Runs the simulation as fast as the CPU allows (no rendering, no audio) and
 * reports every death with enough context to tune the pilot.
 */
import { GalagaEngine } from '../dist/src/engine/engine.js';
import { AutoPilot } from '../dist/src/app/autopilot.js';
import { FIXED_DT } from '../dist/src/engine/constants.js';

const seed = Number(process.argv[2] ?? 1);
const minutes = Number(process.argv[3] ?? 10);
const noFire = process.argv.includes('--no-fire');
const verbose = process.argv.includes('--verbose');

const engine = new GalagaEngine({ seed });
engine.startGame(1);
if (noFire) engine.setNoFireBug(true);
const bot = new AutoPilot();

const steps = Math.round((minutes * 60) / FIXED_DT);
const started = performance.now();
let deaths = 0;
let lastStage = 1;
let maxStage = 1;
let simulated = 0;
let reachedEnd = false;
const deathLog = [];

for (let i = 0; i < steps; i++) {
  bot.step(engine);
  engine.update(FIXED_DT);

  for (const event of engine.drainEvents()) {
    if (event.type !== 'playerExplode' && event.type !== 'capture') continue;
    deaths++;
    if (deathLog.length < 40) {
      const near = engine.enemies
        .filter((e) => Math.hypot(e.x - engine.player.x, e.y - engine.player.y) < 36)
        .map((e) => `${e.kind}/${e.state}@${Math.round(e.x)},${Math.round(e.y)}`);
      const shots = engine.bullets
        .filter((b) => b.from === 'enemy' && Math.abs(b.y - engine.player.y) < 30)
        .map((b) => `${Math.round(b.x)},${Math.round(b.y)}`);
      deathLog.push({
        stage: engine.stage,
        at: Number((i * FIXED_DT).toFixed(0)),
        type: event.type,
        x: Math.round(engine.player.x),
        near: near.join(' '),
        shots: shots.join(' '),
      });
    }
  }

  lastStage = engine.stage;
  if (engine.stage > maxStage) maxStage = engine.stage;
  if (engine.stage === 255) reachedEnd = true;
  simulated = (i + 1) * FIXED_DT;
  if (engine.phase === 'gameOver') break;
}

const elapsed = (performance.now() - started) / 1000;
const summary = {
  seed,
  noFire,
  simulatedSeconds: Number(simulated.toFixed(0)),
  deaths,
  stage: lastStage,
  maxStage,
  reachedStage255: reachedEnd,
  score: engine.score,
  gameOver: engine.phase === 'gameOver',
  wallSeconds: Number(elapsed.toFixed(2)),
  speedup: Number((simulated / elapsed).toFixed(0)),
};
console.log(JSON.stringify(summary));
if (verbose) console.log(JSON.stringify(deathLog, null, 1));
