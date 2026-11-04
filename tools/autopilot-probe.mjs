/**
 * Headless probe for the expert pilot: how far does it get, and does the
 * no-fire bug behave like the arcade?
 */
import { GalagaEngine } from '../dist/src/engine/engine.js';
import { AutoPilot } from '../dist/src/app/autopilot.js';
import { FIXED_DT } from '../dist/src/engine/constants.js';

function play(seed, seconds, { noFire = false } = {}) {
  const engine = new GalagaEngine({ seed });
  engine.startGame(1);
  const bot = new AutoPilot();
  if (noFire) engine.setNoFireBug(true);

  let deaths = 0;
  let captured = 0;
  let rescues = 0;
  let maxStage = 1;
  let shotsFired = 0;
  const steps = Math.round(seconds / FIXED_DT);

  for (let i = 0; i < steps; i++) {
    bot.step(engine);
    engine.update(FIXED_DT);
    for (const event of engine.drainEvents()) {
      if (event.type === 'playerExplode') deaths++;
      if (event.type === 'capture') captured++;
      if (event.type === 'rescue') rescues++;
      if (event.type === 'shoot') shotsFired++;
    }
    maxStage = Math.max(maxStage, engine.stage);
    if (engine.phase === 'gameOver') {
      return {
        seed,
        seconds: Number((i * FIXED_DT).toFixed(1)),
        deaths,
        captured,
        rescues,
        stage: maxStage,
        score: engine.score,
        gameOver: true,
        hung: engine.shotSlotsHung,
      };
    }
  }
  return {
    seed,
    seconds,
    deaths,
    captured,
    rescues,
    stage: maxStage,
    score: engine.score,
    gameOver: false,
    lives: engine.lives,
    hung: engine.shotSlotsHung,
    shotsFired,
  };
}

const results = [];
for (const seed of [1, 7, 42]) results.push(play(seed, 300));
console.log('normal ', JSON.stringify(results, null, 0));

const bug = [];
for (const seed of [1, 7, 42]) bug.push(play(seed, 120, { noFire: true }));
console.log('no-fire', JSON.stringify(bug, null, 0));

// Does the bug appear on its own in ordinary play?
const drift = [];
for (const seed of [3, 11, 99]) drift.push(play(seed, 600));
console.log('drift  ', JSON.stringify(drift.map((r) => ({ seed: r.seed, hung: r.hung, stage: r.stage })), null, 0));
