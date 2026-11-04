/** Diagnose autopilot deaths: what was nearby when the fighter was lost? */
import { GalagaEngine } from '../dist/src/engine/engine.js';
import { AutoPilot } from '../dist/src/app/autopilot.js';
import { FIXED_DT } from '../dist/src/engine/constants.js';

const seed = Number(process.argv[2] ?? 7);
const noFire = process.argv.includes('--no-fire');
const engine = new GalagaEngine({ seed });
engine.startGame(1);
if (noFire) engine.setNoFireBug(true);
const bot = new AutoPilot();

const steps = Math.round(180 / FIXED_DT);
for (let i = 0; i < steps; i++) {
  const decision = bot.step(engine);
  engine.update(FIXED_DT);
  for (const event of engine.drainEvents()) {
    if (event.type !== 'playerExplode' && event.type !== 'capture') continue;
    const near = engine.enemies
      .filter((e) => Math.hypot(e.x - engine.player.x, e.y - engine.player.y) < 40)
      .map((e) => ({ kind: e.kind, state: e.state, x: Math.round(e.x), y: Math.round(e.y) }));
    const nearBullets = engine.bullets
      .filter((b) => b.from === 'enemy' && Math.abs(b.y - engine.player.y) < 60)
      .map((b) => ({
        x: Math.round(b.x),
        y: Math.round(b.y),
        vx: Math.round(b.vx),
        vy: Math.round(b.vy),
      }));
    console.log(
      JSON.stringify({
        t: (i * FIXED_DT).toFixed(1),
        event: event.type,
        playerX: Math.round(engine.player.x),
        decision,
        near,
        nearBullets,
        bullets: engine.bullets.filter((b) => b.from === 'enemy').length,
      }),
    );
  }
  if (engine.phase === 'gameOver') break;
}
console.log('final stage', engine.stage, 'score', engine.score);
