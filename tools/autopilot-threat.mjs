/** Recompute the pilot's threat model at the instant of death. */
import { GalagaEngine } from '../dist/src/engine/engine.js';
import { AutoPilot } from '../dist/src/app/autopilot.js';
import { FIXED_DT } from '../dist/src/engine/constants.js';

const seed = Number(process.argv[2] ?? 42);
const engine = new GalagaEngine({ seed });
engine.startGame(1);
const bot = new AutoPilot();
const HORIZON = 1.6;

for (let i = 0; i < Math.round(180 / FIXED_DT); i++) {
  const preX = engine.player.x;
  const preY = engine.player.y;
  const preBullets = engine.bullets.map((b) => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, from: b.from }));
  const decision = bot.step(engine);
  engine.update(FIXED_DT);
  const events = engine.drainEvents();
  if (!events.some((e) => e.type === 'playerExplode')) continue;

  const blobs = [];
  for (const b of preBullets) {
    if (b.from !== 'enemy' || b.vy <= 0) continue;
    const t = (preY - 4 - b.y) / b.vy;
    let blob = null;
    if (t < 0) {
      if (b.y - (preY - 4) > -26) blob = { x: b.x, radius: 9, weight: 3.4, note: 'past-row' };
    } else if (t <= HORIZON) {
      blob = { x: b.x + b.vx * t, radius: 7 + t * 4, weight: 0.6 + (1 - t / HORIZON) * 1.6, note: 'future' };
    }
    if (blob) blobs.push({ ...blob, bullet: b });
  }
  const px = Math.round(preX);
  const total = blobs.reduce((sum, blob) => {
    const d = Math.abs(px - blob.x);
    return d >= blob.radius ? sum : sum + blob.weight * (1 - (d / blob.radius) ** 2);
  }, 0);

  console.log(JSON.stringify({ t: (i * FIXED_DT).toFixed(1), preX, decision, recomputedThreat: total, blobs },
    (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v), 2));
  break;
}
