/**
 * Balance probe: runs the compiled engine headless with a simple auto-player
 * and reports how long a run survives. Used to tune difficulty, not shipped.
 */
import { GalagaEngine } from '../dist/src/engine/engine.js';
import { FIXED_DT } from '../dist/src/engine/constants.js';

function simulate(seconds, policy) {
  const engine = new GalagaEngine({ seed: 424242 });
  engine.startGame(1);
  let deaths = 0;
  let lastLives = engine.lives;
  let stage = 1;
  const steps = Math.round(seconds / FIXED_DT);

  for (let i = 0; i < steps; i++) {
    policy(engine, i);
    engine.update(FIXED_DT);
    for (const event of engine.drainEvents()) {
      if (event.type === 'playerExplode' || event.type === 'capture') deaths++;
      if (event.type === 'stageClear') stage = engine.stage + 1;
    }
    lastLives = engine.lives;
    if (engine.phase === 'gameOver') {
      return { deaths, survived: (i * FIXED_DT).toFixed(1), stage, score: engine.score, gameOver: true };
    }
  }
  return { deaths, survived: seconds, stage: engine.stage, score: engine.score, lives: lastLives, gameOver: false };
}

// A do-nothing player that holds the fire button.
const turret = (engine) => {
  engine.setInput('fire', true);
};

// A wanderer that patrols left and right while firing.
const wanderer = (engine, i) => {
  const phase = Math.floor(i / 110) % 2;
  engine.setInput('fire', true);
  engine.setInput('left', phase === 0);
  engine.setInput('right', phase === 1);
};

for (const [name, policy] of [
  ['turret', turret],
  ['wanderer', wanderer],
]) {
  const runs = [0, 1, 2].map(() => simulate(120, policy));
  console.log(name, JSON.stringify(runs));
}
